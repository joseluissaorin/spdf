//! Inferencia del lector nativo.
//!
//! SIMULACRO de `spdf-infer` (crate del agente «models», carpeta models/rust),
//! con la API que fijó el 7-10-2026 (ModelManager, Embed, Generator, Judge).
//! Cuando el crate exista, este módulo pasa a envolverlo; mientras:
//! - el catálogo lista los modelos reales con su tamaño, pero descargar falla
//!   con un mensaje claro;
//! - el modelo falso de pruebas (`spdf-fake@<dims>`) sí funciona y da los MISMOS
//!   vectores que el de la web (mismo algoritmo), para las pruebas;
//! - Gemini funciona de verdad con la clave del usuario (embedding, generación
//!   en streaming y juez), igual que en la web.

use crate::tipos::{Apoyo, ModeloCatalogo, OpcionesGenerar};
use serde_json::{json, Value};
use std::io::BufRead;
use unicode_normalization::UnicodeNormalization;

pub const MODELO_GEMINI_VECTORES: &str = "gemini-embedding-2";
pub const MODELO_GEMINI_TEXTO: &str = "gemini-flash-latest";
const BASE: &str = "https://generativelanguage.googleapis.com/v1beta";
const PREFIJO_CONSULTA: &str = "task: search result | query: ";
const PREFIJO_DOCUMENTO: &str = "title: none | text: ";

#[allow(dead_code)]
pub fn catalogo(descargados: &dyn Fn(&str) -> bool) -> Vec<ModeloCatalogo> {
    let m = |id: &str, nombre: &str, tipo: &str, bytes: u64, motor: &str, rec: bool| ModeloCatalogo {
        id: id.into(),
        nombre: nombre.into(),
        tipo: tipo.into(),
        bytes,
        licencia: "Apache-2.0".into(),
        descargado: descargados(id),
        recomendado: rec,
        motor: motor.into(),
    };
    vec![
        m("embeddinggemma-2-gguf-q8_0", "EmbeddingGemma 2 (texto, Q8_0)", "embed", 310_000_000, "llama.cpp", true),
        m("gemma-4-e2b-it-gguf-q4_k_m", "Gemma 4 E2B (Q4_K_M)", "generate", 1_500_000_000, "llama.cpp", true),
    ]
}

#[allow(dead_code)]
pub fn descargar(_id: &str) -> Result<(), String> {
    Err("La descarga de modelos llegará con spdf-infer (models/rust), que aún no está en el repositorio. Mientras, puedes usar Gemini con tu clave.".into())
}

/// El espacio que produce un motor con un recorte dado.
pub fn espacio(motor: &str, dims: usize) -> Option<spdf::Space> {
    match motor {
        "prueba" => {
            let mut s = spdf::Space::new("spdf", "spdf-fake", dims);
            s.version = Some("1".into());
            s.truncated_from = if dims == 768 { None } else { Some(768) };
            Some(s)
        }
        "gemini" => {
            // El estilo del productor y de SPDF Commons: taskType de la API.
            let mut s = spdf::Space::new("google", MODELO_GEMINI_VECTORES, dims);
            s.version = Some(MODELO_GEMINI_VECTORES.into());
            s.truncated_from = if dims < 3072 { Some(3072) } else { None };
            s.task_prefixes = Some(json!({ "query": "taskType=RETRIEVAL_QUERY", "document": "taskType=RETRIEVAL_DOCUMENT; title={title}" }));
            Some(s)
        }
        _ => None,
    }
}

/// ¿Sirve un vector de consulta del espacio `q` para los vectores guardados en `g`?
/// La regla del contrato (§2), más una excepción: los SPDF 4.x de Scholaris con
/// `gemini-embedding-2` no declaran prefijos, pero se codificaron con los mismos.
pub fn compatible(g: &spdf::Space, q: &spdf::Space) -> bool {
    // Con Gemini la consulta se adapta al estilo del espacio guardado (taskType o prefijos).
    g.compatible_with(q) || (g.model == MODELO_GEMINI_VECTORES && q.model == MODELO_GEMINI_VECTORES && g.dims == q.dims)
}

/// ¿Se codificó con taskType (productor, Commons) o con prefijos en el texto (Scholaris 4.x)?
pub fn estilo_task_type(g: Option<&spdf::Space>) -> bool {
    g.map(|g| g.task_prefixes.as_ref().map(|t| t.to_string().contains("taskType=")).unwrap_or(false)).unwrap_or(true)
}

/* ---------------- El modelo falso de pruebas ---------------- */

#[allow(dead_code)]
fn fnv(units: &[u16]) -> u32 {
    let mut h: u32 = 0x811c9dc5;
    for &u in units {
        h ^= u as u32;
        h = h.wrapping_mul(0x0100_0193);
    }
    h
}

/// Igual que `FakeEmbedder` del simulacro web: hashing de palabras, normalizado.
#[allow(dead_code)]
pub fn falso(textos: &[String], dims: usize) -> Vec<Vec<f32>> {
    textos
        .iter()
        .map(|t| {
            let mut v = vec![0f32; dims];
            let plano: String = t.nfd().filter(|c| !unicode_normalization::char::is_combining_mark(*c)).collect::<String>().to_lowercase();
            for p in plano.split(|c: char| !c.is_alphanumeric()).filter(|s| !s.is_empty()) {
                let u: Vec<u16> = p.encode_utf16().collect();
                if u.len() < 3 {
                    continue;
                }
                let h = fnv(&u);
                v[(h as usize) % dims] += if h & 1 == 1 { 1.0 } else { -1.0 };
                let h2 = fnv(&u[..u.len().min(5)]);
                v[(h2 as usize) % dims] += 0.5;
            }
            let n = v.iter().map(|x| x * x).sum::<f32>().sqrt().max(f32::MIN_POSITIVE);
            let n = if n == 0.0 { 1.0 } else { n };
            v.iter_mut().for_each(|x| *x /= n);
            v
        })
        .collect()
}

/* ---------------- Gemini ---------------- */

fn agente() -> ureq::Agent {
    ureq::Agent::config_builder().http_status_as_error(false).timeout_global(Some(std::time::Duration::from_secs(120))).build().into()
}

fn pedir(clave: &str, ruta: &str, cuerpo: &Value) -> Result<ureq::http::Response<ureq::Body>, String> {
    let r = agente()
        .post(&format!("{BASE}/{ruta}"))
        .header("x-goog-api-key", clave)
        .header("content-type", "application/json")
        .send_json(cuerpo)
        .map_err(|e| format!("Gemini: {e}"))?;
    if !r.status().is_success() {
        let codigo = r.status().as_u16();
        let mut r = r;
        let msg = r.body_mut().read_json::<Value>().ok().and_then(|v| v.pointer("/error/message").and_then(|m| m.as_str()).map(String::from));
        return Err(format!("Gemini: {}", msg.unwrap_or_else(|| codigo.to_string())));
    }
    Ok(r)
}

pub fn gemini_vectores(clave: &str, textos: &[String], consulta: bool, dims: usize, task_type: bool, titulo: Option<&str>) -> Result<Vec<Vec<f32>>, String> {
    let pref = if task_type { "" } else if consulta { PREFIJO_CONSULTA } else { PREFIJO_DOCUMENTO };
    let mut out = Vec::with_capacity(textos.len());
    for lote in textos.chunks(100) {
        let reqs: Vec<Value> = lote
            .iter()
            .map(|t| {
                let t: String = t.chars().take(24_000).collect();
                let mut r = json!({ "model": format!("models/{MODELO_GEMINI_VECTORES}"), "content": { "parts": [{ "text": format!("{pref}{t}") }] }, "outputDimensionality": dims });
                if task_type {
                    r["taskType"] = json!(if consulta { "RETRIEVAL_QUERY" } else { "RETRIEVAL_DOCUMENT" });
                    if let (false, Some(ti)) = (consulta, titulo) {
                        r["title"] = json!(ti);
                    }
                }
                r
            })
            .collect();
        let mut r = pedir(clave, &format!("models/{MODELO_GEMINI_VECTORES}:batchEmbedContents"), &json!({ "requests": reqs }))?;
        let v: Value = r.body_mut().read_json().map_err(|e| e.to_string())?;
        for e in v["embeddings"].as_array().cloned().unwrap_or_default() {
            let mut x: Vec<f32> = e["values"].as_array().map(|a| a.iter().filter_map(|n| n.as_f64()).map(|n| n as f32).collect()).unwrap_or_default();
            let n = x.iter().map(|a| a * a).sum::<f32>().sqrt();
            if n > 0.0 {
                x.iter_mut().for_each(|a| *a /= n);
            }
            out.push(x);
        }
    }
    if out.len() != textos.len() {
        return Err(format!("Gemini devolvió {} vectores para {} textos", out.len(), textos.len()));
    }
    Ok(out)
}

pub fn gemini_generar(clave: &str, prompt: &str, o: &OpcionesGenerar, mut token: impl FnMut(&str)) -> Result<String, String> {
    let mut cuerpo = json!({
        "contents": [{ "role": "user", "parts": [{ "text": prompt }] }],
        "generationConfig": { "temperature": o.temperature.unwrap_or(0.2), "maxOutputTokens": o.max_tokens.unwrap_or(1200), "responseMimeType": "application/json" },
    });
    if let Some(s) = &o.system {
        cuerpo["systemInstruction"] = json!({ "parts": [{ "text": s }] });
    }
    let modelo = o.modelo.clone().unwrap_or_else(|| MODELO_GEMINI_TEXTO.into());
    let mut r = pedir(clave, &format!("models/{modelo}:streamGenerateContent?alt=sse"), &cuerpo)?;
    let lector = std::io::BufReader::new(r.body_mut().as_reader());
    let mut todo = String::new();
    for linea in lector.lines() {
        let linea = linea.map_err(|e| e.to_string())?;
        let Some(datos) = linea.strip_prefix("data:") else { continue };
        if let Ok(v) = serde_json::from_str::<Value>(datos.trim()) {
            for p in v.pointer("/candidates/0/content/parts").and_then(|p| p.as_array()).cloned().unwrap_or_default() {
                if let Some(t) = p["text"].as_str() {
                    todo.push_str(t);
                    token(t);
                }
            }
        }
    }
    Ok(todo)
}

const RELACIONES: [&str; 7] = ["APOYO_DIRECTO", "APLICACION_DE_MARCO", "CONTEXTO", "CONTRADICCION", "IMPOSIBLE_TEMPORAL", "OPINION_REFERIDA", "AFIRMACION_NEGATIVA"];

pub fn gemini_juzgar(clave: &str, afirmacion: &str, pasaje: &str) -> Result<Apoyo, String> {
    let cuerpo = json!({
        "contents": [{ "role": "user", "parts": [{ "text": format!("¿El PASAJE respalda la AFIRMACIÓN? Responde con la relación (una de {}) y la probabilidad (0-1) de que el pasaje la respalde directamente o por aplicación de su marco.\n\nAFIRMACIÓN: {afirmacion}\n\nPASAJE: {pasaje}", RELACIONES.join(", ")) }] }],
        "generationConfig": {
            "temperature": 0, "responseMimeType": "application/json",
            "responseSchema": { "type": "OBJECT", "properties": { "relacion": { "type": "STRING", "enum": RELACIONES }, "probabilidad": { "type": "NUMBER" } }, "required": ["relacion", "probabilidad"] }
        }
    });
    let mut r = pedir(clave, &format!("models/{MODELO_GEMINI_TEXTO}:generateContent"), &cuerpo)?;
    let v: Value = r.body_mut().read_json().map_err(|e| e.to_string())?;
    let t = v.pointer("/candidates/0/content/parts/0/text").and_then(|t| t.as_str()).unwrap_or("{}");
    let o: Value = serde_json::from_str(t).unwrap_or_default();
    Ok(Apoyo {
        supported: o["probabilidad"].as_f64().unwrap_or(0.0).clamp(0.0, 1.0) as f32,
        label: o["relacion"].as_str().unwrap_or("CONTEXTO").to_string(),
    })
}

/* ---------------- Generador y juez falsos (modo pruebas) ---------------- */

/// Devuelve en JSON la primera frase del primer pasaje del prompt.
pub fn falso_generar(prompt: &str, mut token: impl FnMut(&str)) -> String {
    let mut lineas = prompt.lines();
    let mut out = String::from("{\"respuesta\":[]}");
    while let Some(l) = lineas.next() {
        if let Some(rest) = l.strip_prefix("[P") {
            let id = format!("P{}", rest.split(']').next().unwrap_or("1"));
            if let Some(texto) = lineas.next() {
                let frase = texto.split_inclusive(['.', ';', ':']).next().unwrap_or(texto).trim().to_string();
                out = json!({ "respuesta": [{ "afirmacion": frase, "pasaje": id, "cita_literal": frase }] }).to_string();
            }
            break;
        }
    }
    for t in out.as_bytes().chunks(12) {
        token(&String::from_utf8_lossy(t));
    }
    out
}

pub fn falso_juzgar(afirmacion: &str, pasaje: &str) -> Apoyo {
    let palabras = |s: &str| -> std::collections::HashSet<String> {
        s.to_lowercase().split(|c: char| !c.is_alphanumeric()).filter(|w| w.chars().count() >= 3).map(String::from).collect()
    };
    let a = palabras(afirmacion);
    let b = palabras(pasaje);
    let s = if a.is_empty() { 0.0 } else { a.iter().filter(|w| b.contains(*w)).count() as f32 / a.len() as f32 };
    Apoyo { supported: s, label: if s > 0.6 { "APOYO_DIRECTO".into() } else { "CONTEXTO".into() } }
}

/* ---------------- Modelos locales con spdf-infer (llama.cpp) ---------------- */

#[cfg(not(target_os = "android"))]
pub mod local {
    use crate::tipos::{Apoyo, ModeloCatalogo, OpcionesGenerar};
    use spdf_infer::{Embed, Embedder, EmbedderOptions, FakeEmbedder, GenOptions, GenParams, Generator, Judge, Kind, ModelManager, Task};
    use std::collections::HashMap;
    use std::sync::{Arc, Mutex};

    pub const HAY: bool = true;

    /// Los modelos que el lector enseña: los de llama.cpp de esta plataforma, sin las variantes de referencia.
    fn visible(e: &spdf_infer::CatalogEntry) -> bool {
        e.engine == "llama.cpp" && e.published && !e.id.contains("bf16") && e.platforms.contains(&spdf_infer::manager::Platform::current())
    }

    pub struct Local {
        mm: ModelManager,
        incrustadores: Mutex<HashMap<String, Arc<dyn Embed>>>,
        generador: Mutex<Option<(String, Arc<Generator>)>>,
        juez: Mutex<Option<(String, Arc<Judge>)>>,
    }

    fn e<E: std::fmt::Display>(x: E) -> String {
        x.to_string()
    }

    /// De la fila de spdf-infer a la del crate spdf (mismas columnas, otros tipos).
    pub fn espacio_spdf(s: &spdf_infer::Space) -> spdf::Space {
        spdf::Space {
            id: s.id.clone(),
            provider: s.provider.clone(),
            model: s.model.clone(),
            version: s.version.clone(),
            dims: s.dims as i64,
            dtype: s.dtype.clone(),
            normalized: s.normalized,
            truncated_from: s.truncated_from.map(|x| x as i64),
            modalities: serde_json::json!(s.modalities),
            task_prefixes: s.task_prefixes.as_ref().map(|t| serde_json::json!(t)),
            created: None,
        }
    }
    pub fn espacio_infer(s: &spdf::Space) -> spdf_infer::Space {
        spdf_infer::Space {
            id: s.id.clone(),
            provider: s.provider.clone(),
            model: s.model.clone(),
            version: s.version.clone(),
            dims: s.dims as usize,
            dtype: s.dtype.clone(),
            normalized: s.normalized,
            truncated_from: s.truncated_from.map(|x| x as usize),
            modalities: s.modalities.as_array().map(|a| a.iter().filter_map(|v| v.as_str().map(String::from)).collect()).unwrap_or_default(),
            task_prefixes: s.task_prefixes.as_ref().and_then(|t| serde_json::from_value(t.clone()).ok()),
        }
    }
    /// Misma regla en los dos lados (models/COMPATIBILIDAD.md): «igual» o «aproximado» (misma versión base).
    pub fn compatible(guardado: &spdf::Space, consulta: &spdf::Space) -> bool {
        !matches!(spdf_infer::compat::check(&espacio_infer(guardado), &espacio_infer(consulta)), spdf_infer::compat::Compat::Incompatible { .. })
    }

    impl Local {
        pub fn nuevo(dir: std::path::PathBuf) -> Result<Self, String> {
            Ok(Local { mm: ModelManager::new(dir).map_err(e)?, incrustadores: Mutex::new(HashMap::new()), generador: Mutex::new(None), juez: Mutex::new(None) })
        }

        pub fn catalogo(&self) -> Vec<ModeloCatalogo> {
            let rec: Vec<String> = [Kind::Embed, Kind::Generate, Kind::Judge].into_iter().filter_map(|k| self.mm.recommend(k)).map(|c| c.id).collect();
            let mut v: Vec<ModeloCatalogo> = self
                .mm
                .catalog()
                .into_iter()
                .filter(visible)
                .map(|c| ModeloCatalogo {
                    descargado: self.mm.is_downloaded(&c.id),
                    recomendado: rec.contains(&c.id),
                    tipo: serde_json::to_value(c.kind).ok().and_then(|v| v.as_str().map(String::from)).unwrap_or_default(),
                    id: c.id,
                    nombre: c.name,
                    bytes: c.bytes,
                    licencia: c.license,
                    motor: c.engine,
                })
                .collect();
            v.sort_by(|a, b| b.recomendado.cmp(&a.recomendado).then(a.tipo.cmp(&b.tipo)).then(a.bytes.cmp(&b.bytes)));
            v
        }

        pub fn descargar(&self, id: &str, mut progreso: impl FnMut(u64, u64, &str)) -> Result<(), String> {
            self.mm.download(id, |p| progreso(p.overall_done, p.overall_total, &p.file)).map(|_| ()).map_err(e)
        }

        pub fn borrar(&self, id: &str) -> Result<(), String> {
            self.incrustadores.lock().unwrap().remove(id);
            self.mm.delete(id).map_err(e)
        }

        /// El modelo de un tipo: el recomendado si está descargado; si no, el primero descargado.
        fn elegido(&self, kind: Kind, pedido: Option<&str>) -> Option<String> {
            if let Some(p) = pedido {
                return Some(p.to_string());
            }
            let rec = self.mm.recommend(kind).map(|c| c.id);
            if let Some(r) = &rec {
                if self.mm.is_downloaded(r) {
                    return rec;
                }
            }
            self.mm.catalog().into_iter().filter(visible).find(|c| c.kinds.contains(&kind) && self.mm.is_downloaded(&c.id)).map(|c| c.id).or(rec)
        }

        pub fn hay_embed(&self) -> Option<String> {
            self.elegido(Kind::Embed, None).filter(|id| self.mm.is_downloaded(id))
        }

        pub fn incrustador(&self, motor: &str, modelo: Option<&str>) -> Result<Arc<dyn Embed>, String> {
            if motor == "prueba" {
                return Ok(Arc::new(FakeEmbedder::new(768)));
            }
            let id = self.elegido(Kind::Embed, modelo).ok_or("No hay modelo de vectores en el catálogo.")?;
            if !self.mm.is_downloaded(&id) {
                return Err("El modelo de vectores no está descargado.".into());
            }
            if let Some(x) = self.incrustadores.lock().unwrap().get(&id) {
                return Ok(x.clone());
            }
            let emb: Arc<dyn Embed> = Arc::new(Embedder::load(&self.mm, &id, EmbedderOptions { multimodal: false, ..Default::default() }).map_err(e)?);
            self.incrustadores.lock().unwrap().insert(id, emb.clone());
            Ok(emb)
        }

        pub fn espacio(&self, motor: &str, dims: usize) -> Option<spdf::Space> {
            if motor == "prueba" {
                return Some(espacio_spdf(&FakeEmbedder::new(768).space(Some(dims))));
            }
            // El espacio se declara sin cargar el modelo: mismos datos que Embedder::space.
            let id = self.hay_embed()?;
            let c = self.mm.entry(&id)?;
            let o = EmbedderOptions::default();
            let nativo = 768usize;
            Some(espacio_spdf(&spdf_infer::Space {
                id: format!("{}@{dims}", o.space_model),
                provider: "google".into(),
                model: o.space_model.clone(),
                version: c.space_version.clone().or(o.space_version.clone()),
                dims,
                dtype: "f32".into(),
                normalized: true,
                truncated_from: if dims < nativo { Some(nativo) } else { None },
                modalities: vec!["text".into()],
                task_prefixes: Some(spdf_infer::embed::embeddinggemma2_task_prefixes()),
            }))
        }

        pub fn vectores(&self, motor: &str, modelo: Option<&str>, textos: &[String], consulta: bool, titulo: Option<String>, dims: usize) -> Result<(spdf::Space, Vec<Vec<f32>>), String> {
            let inc = self.incrustador(motor, modelo)?;
            let refs: Vec<&str> = textos.iter().map(String::as_str).collect();
            let tarea = if consulta { Task::Query } else { Task::Document { title: titulo } };
            let v = inc.embed(&refs, tarea, Some(dims)).map_err(e)?;
            Ok((espacio_spdf(&inc.space(Some(dims))), v))
        }

        fn generador(&self, modelo: Option<&str>) -> Result<Arc<Generator>, String> {
            let id = self.elegido(Kind::Generate, modelo).ok_or("No hay modelo de lenguaje en el catálogo.")?;
            if !self.mm.is_downloaded(&id) {
                return Err("El modelo de lenguaje no está descargado.".into());
            }
            let mut g = self.generador.lock().unwrap();
            if let Some((k, x)) = g.as_ref() {
                if *k == id {
                    return Ok(x.clone());
                }
            }
            let x = Arc::new(Generator::load(&self.mm, &id, GenOptions::default()).map_err(e)?);
            *g = Some((id, x.clone()));
            Ok(x)
        }

        pub fn generar(&self, prompt: &str, o: &OpcionesGenerar, mut token: impl FnMut(&str)) -> Result<String, String> {
            let g = self.generador(o.modelo.as_deref())?;
            let p = GenParams {
                max_tokens: o.max_tokens.unwrap_or(700),
                temperature: o.temperature.unwrap_or(0.2),
                system: o.system.clone(),
                stop: o.stop.clone().unwrap_or_default(),
                ..Default::default()
            };
            let r = g.generate(prompt, &p, |t| {
                token(t);
                true
            });
            r.map(|s| s.text).map_err(e)
        }

        pub fn juzgar(&self, afirmacion: &str, pasaje: &str) -> Result<Apoyo, String> {
            // El juez por defecto es el propio Gemma 4 (logits sobre las etiquetas): si el generador
            // cargado puede hacer de juez, se usa ese, sin cargar otro modelo.
            let cargado = self.generador.lock().unwrap().as_ref().map(|(k, _)| k.clone());
            let id = match cargado.filter(|k| self.mm.entry(k).map(|c| c.kinds.contains(&Kind::Judge)).unwrap_or(false)) {
                Some(k) => k,
                None => self.elegido(Kind::Judge, None).ok_or("No hay modelo del juez en el catálogo.")?,
            };
            if !self.mm.is_downloaded(&id) {
                return Err("El modelo del juez no está descargado.".into());
            }
            let mut j = self.juez.lock().unwrap();
            let juez = match j.as_ref() {
                Some((k, x)) if *k == id => x.clone(),
                _ => {
                    let reuso = self.generador.lock().unwrap().as_ref().filter(|(k, _)| *k == id).map(|(_, g)| g.clone());
                    let x = Arc::new(match reuso {
                        Some(g) => {
                            // Con los pesos del generador, pero con la calibración del manifiesto (como Judge::load).
                            let mut j = Judge::new(g).map_err(e)?;
                            if let Some(c) = self.mm.entry(&id).and_then(|c| c.judge_calibration.clone()) {
                                j.calibration = c.choice;
                                j.support_calibration = c.noul;
                            }
                            j
                        }
                        None => Judge::load(&self.mm, &id).map_err(e)?,
                    });
                    *j = Some((id, x.clone()));
                    x
                }
            };
            let s = juez.support(afirmacion, pasaje).map_err(e)?;
            Ok(Apoyo { supported: s.supported, label: s.label.name().to_string() })
        }
    }
}

#[cfg(target_os = "android")]
pub mod local {
    pub const HAY: bool = false;
}
