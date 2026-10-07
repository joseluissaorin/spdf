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
            let mut s = spdf::Space::new("google", MODELO_GEMINI_VECTORES, dims);
            s.task_prefixes = Some(json!({ "query": PREFIJO_CONSULTA, "document": PREFIJO_DOCUMENTO }));
            Some(s)
        }
        _ => None,
    }
}

/// ¿Sirve un vector de consulta del espacio `q` para los vectores guardados en `g`?
/// La regla del contrato (§2), más una excepción: los SPDF 4.x de Scholaris con
/// `gemini-embedding-2` no declaran prefijos, pero se codificaron con los mismos.
pub fn compatible(g: &spdf::Space, q: &spdf::Space) -> bool {
    if g.compatible_with(q) {
        return true;
    }
    g.model == MODELO_GEMINI_VECTORES && q.model == MODELO_GEMINI_VECTORES && g.dims == q.dims && g.task_prefixes.is_none()
}

/* ---------------- El modelo falso de pruebas ---------------- */

fn fnv(units: &[u16]) -> u32 {
    let mut h: u32 = 0x811c9dc5;
    for &u in units {
        h ^= u as u32;
        h = h.wrapping_mul(0x0100_0193);
    }
    h
}

/// Igual que `FakeEmbedder` del simulacro web: hashing de palabras, normalizado.
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

pub fn gemini_vectores(clave: &str, textos: &[String], consulta: bool, dims: usize) -> Result<Vec<Vec<f32>>, String> {
    let pref = if consulta { PREFIJO_CONSULTA } else { PREFIJO_DOCUMENTO };
    let mut out = Vec::with_capacity(textos.len());
    for lote in textos.chunks(100) {
        let reqs: Vec<Value> = lote
            .iter()
            .map(|t| {
                let t: String = t.chars().take(24_000).collect();
                json!({ "model": format!("models/{MODELO_GEMINI_VECTORES}"), "content": { "parts": [{ "text": format!("{pref}{t}") }] }, "outputDimensionality": dims })
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
