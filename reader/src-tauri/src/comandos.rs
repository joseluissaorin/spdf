//! Los comandos que llama la interfaz (src/nucleo/tauri/nucleo-tauri.ts).
//! Todos son asíncronos y hacen el trabajo en un hilo aparte: SQLite, el disco
//! y la red nunca bloquean la ventana.

use crate::biblioteca::{self, entrada_de, escribir_atomico, sha256_fichero};
use crate::estado::{err, Estado, R};
use crate::ia;
use crate::tipos::*;
use serde_json::Value;
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::time::Instant;
use tauri::ipc::Channel;
use tauri::{AppHandle, Manager};

async fn bloq<T: Send + 'static>(app: AppHandle, f: impl FnOnce(&Estado) -> R<T> + Send + 'static) -> R<T> {
    tauri::async_runtime::spawn_blocking(move || {
        let st = app.state::<Estado>();
        f(&st)
    })
    .await
    .map_err(err)?
}

fn plataforma() -> &'static str {
    match std::env::consts::OS {
        "macos" => "macos",
        "windows" => "windows",
        "ios" => "ios",
        "android" => "android",
        _ => "linux",
    }
}

fn pruebas_permitidas() -> bool {
    cfg!(debug_assertions) || cfg!(feature = "pruebas") || std::env::var("SPDF_PRUEBAS").is_ok()
}

#[derive(serde::Serialize)]
pub struct Inicio {
    plataforma: &'static str,
    capacidades: Capacidades,
    /// Solo al medir (SPDF_MEDIR=1): consultas que la interfaz lanza sola al abrir un documento.
    consultas: Vec<String>,
}

/// La interfaz manda sus marcas (arranque, apertura) cuando se mide (SPDF_MEDIR=1).
#[tauri::command]
pub async fn medida(app: AppHandle, nombre: String, ms: f64, detalle: Option<String>) -> R<bool> {
    bloq(app, move |st| {
        crate::medir(&st.dir, &nombre, ms, detalle.as_deref().unwrap_or(""));
        Ok(std::env::var("SPDF_MEDIR").is_ok())
    })
    .await
}

#[tauri::command]
pub async fn iniciar(app: AppHandle, pruebas: bool) -> R<Inicio> {
    bloq(app, move |st| {
        if let Some(t0) = crate::INICIO.get() {
            crate::medir(&st.dir, "proceso_hasta_nucleo", t0.elapsed().as_secs_f64() * 1000.0, "");
        }
        let p = pruebas && pruebas_permitidas();
        *st.pruebas.lock().unwrap() = p;
        let movil = matches!(plataforma(), "ios" | "android");
        Ok(Inicio {
            plataforma: plataforma(),
            capacidades: Capacidades { ia_local: false, webgpu: false, llavero: crate::llavero::HAY_LLAVERO, escribir_en_fichero: !movil, pruebas: p },
            consultas: if std::env::var("SPDF_MEDIR").is_ok() {
                std::env::var("SPDF_MEDIR_CONSULTAS").unwrap_or_default().split('|').filter(|q| !q.is_empty()).map(String::from).collect()
            } else {
                Vec::new()
            },
        })
    })
    .await
}

#[tauri::command]
pub async fn ficheros_pendientes(app: AppHandle) -> R<Vec<String>> {
    bloq(app, |st| {
        *st.ui_lista.lock().unwrap() = true;
        let mut v = std::mem::take(&mut *st.pendientes.lock().unwrap());
        v.extend(std::mem::take(&mut *crate::ANTES_DE_ARRANCAR.lock().unwrap()));
        v.dedup();
        Ok(v)
    })
    .await
}

/* ------------------------------------------------------------------ */
/* Biblioteca                                                          */
/* ------------------------------------------------------------------ */

#[tauri::command]
pub async fn biblioteca(app: AppHandle) -> R<Vec<Entrada>> {
    bloq(app, |st| Ok(st.bib.lock().unwrap().entradas.clone())).await
}

fn importar_uno(st: &Estado, ruta: &Path, nombre: &str, temporal: bool) -> ResultadoImport {
    let t0 = Instant::now();
    let r = (|| -> R<(Entrada, bool)> {
        let id = sha256_fichero(ruta).map_err(err)?;
        if let Some(e) = st.bib.lock().unwrap().entrada(&id) {
            return Ok((e.clone(), true));
        }
        // Abrirlo es validarlo lo suficiente: apertura segura, legado incluido.
        let doc = spdf::Spdf::open(ruta).map_err(err)?;
        let bytes = std::fs::metadata(ruta).map_err(err)?.len();
        let copiar = st.bib.lock().unwrap().copiar || temporal;
        let ruta_entrada = if copiar {
            let destino = st.dir.join("ficheros").join(format!("{id}.spdf"));
            std::fs::copy(ruta, &destino).map_err(err)?;
            None
        } else {
            Some(std::fs::canonicalize(ruta).unwrap_or_else(|_| ruta.to_path_buf()).to_string_lossy().into_owned())
        };
        let e = entrada_de(&id, nombre, bytes, ruta_entrada, &doc, None).map_err(err)?;
        let mut b = st.bib.lock().unwrap();
        b.entradas.insert(0, e.clone());
        b.guardar().map_err(err)?;
        Ok((e, false))
    })();
    crate::medir(&st.dir, "importar", t0.elapsed().as_secs_f64() * 1000.0, nombre);
    match r {
        Ok((e, repetido)) => ResultadoImport { nombre: nombre.into(), ok: true, entrada: Some(e), repetido, error: None },
        Err(e) => ResultadoImport { nombre: nombre.into(), ok: false, entrada: None, repetido: false, error: Some(e) },
    }
}

/// Android: un URI content:// (el «Abrir con» de otra app) se lee con el plugin fs y se copia a la app.
#[cfg(target_os = "android")]
fn importar_contenido(app: &AppHandle, st: &Estado, uri: &str) -> ResultadoImport {
    use std::io::Read;
    use tauri_plugin_fs::FsExt;
    let leido = (|| -> R<Vec<u8>> {
        let url = tauri::Url::parse(uri).map_err(err)?;
        let mut f = app.fs().open(tauri_plugin_fs::FilePath::Url(url), tauri_plugin_fs::OpenOptions::new().read(true).to_owned()).map_err(err)?;
        let mut v = Vec::new();
        f.read_to_end(&mut v).map_err(err)?;
        Ok(v)
    })();
    match leido {
        Ok(datos) => {
            let tmp = st.dir.join(format!(".import-{}.spdf", std::process::id()));
            if let Err(e) = std::fs::write(&tmp, &datos) {
                return ResultadoImport { nombre: uri.into(), ok: false, entrada: None, repetido: false, error: Some(e.to_string()) };
            }
            let r = importar_uno(st, &tmp, "documento.spdf", true);
            let _ = std::fs::remove_file(&tmp);
            r
        }
        Err(e) => ResultadoImport { nombre: uri.into(), ok: false, entrada: None, repetido: false, error: Some(e) },
    }
}
#[cfg(not(target_os = "android"))]
fn importar_contenido(_app: &AppHandle, _st: &Estado, uri: &str) -> ResultadoImport {
    ResultadoImport { nombre: uri.into(), ok: false, entrada: None, repetido: false, error: Some("URI de contenido no admitido en esta plataforma".into()) }
}

#[tauri::command]
pub async fn importar(app: AppHandle, rutas: Vec<String>, canal: Channel<Progreso>) -> R<Vec<ResultadoImport>> {
    let app_ = app.clone();
    bloq(app, move |st| {
        let total = rutas.len() as u64;
        let mut out = Vec::new();
        for (i, r) in rutas.iter().enumerate() {
            if r.starts_with("content://") {
                let _ = canal.send(Progreso { fase: "importar".into(), hecho: i as u64, total, detalle: None });
                out.push(importar_contenido(&app_, st, r));
                continue;
            }
            let p = PathBuf::from(percent_encoding::percent_decode_str(r.strip_prefix("file://").unwrap_or(r)).decode_utf8_lossy().into_owned());
            let nombre = p.file_name().and_then(|n| n.to_str()).unwrap_or("documento.spdf").to_string();
            let _ = canal.send(Progreso { fase: "importar".into(), hecho: i as u64, total, detalle: Some(nombre.clone()) });
            out.push(importar_uno(st, &p, &nombre, false));
        }
        Ok(out)
    })
    .await
}

#[tauri::command]
pub async fn importar_bytes(app: AppHandle, nombre: String, datos: Vec<u8>) -> R<Vec<ResultadoImport>> {
    bloq(app, move |st| {
        let tmp = st.dir.join(format!(".import-{}.spdf", std::process::id()));
        std::fs::write(&tmp, &datos).map_err(err)?;
        let r = importar_uno(st, &tmp, &nombre, true);
        let _ = std::fs::remove_file(&tmp);
        Ok(vec![r])
    })
    .await
}

#[tauri::command]
pub async fn quitar(app: AppHandle, id: String) -> R<()> {
    bloq(app, move |st| {
        st.olvidar(&id);
        let mut b = st.bib.lock().unwrap();
        if let Some(e) = b.entrada(&id).cloned() {
            if e.ruta.is_none() {
                let _ = std::fs::remove_file(b.ruta_fichero(&e));
                let _ = std::fs::remove_file(b.ruta_anotaciones(&e));
            }
        }
        b.entradas.retain(|e| e.id != id);
        b.guardar().map_err(err)
    })
    .await
}

#[tauri::command]
pub async fn recordar_posicion(app: AppHandle, id: String, ord: i64) -> R<()> {
    bloq(app, move |st| {
        let mut b = st.bib.lock().unwrap();
        if let Some(e) = b.entradas.iter_mut().find(|e| e.id == id) {
            e.ultima_unidad = Some(ord);
            e.abierto = Some(biblioteca::ahora());
        }
        b.guardar().map_err(err)
    })
    .await
}

#[tauri::command]
pub async fn colecciones(app: AppHandle) -> R<Vec<Coleccion>> {
    bloq(app, |st| Ok(st.bib.lock().unwrap().colecciones.clone())).await
}

#[tauri::command]
pub async fn guardar_coleccion(app: AppHandle, c: Coleccion) -> R<()> {
    bloq(app, move |st| {
        let mut b = st.bib.lock().unwrap();
        b.colecciones.retain(|x| x.id != c.id);
        b.colecciones.push(c);
        b.guardar_colecciones().map_err(err)
    })
    .await
}

#[tauri::command]
pub async fn borrar_coleccion(app: AppHandle, id: String) -> R<()> {
    bloq(app, move |st| {
        let mut b = st.bib.lock().unwrap();
        b.colecciones.retain(|x| x.id != id);
        b.guardar_colecciones().map_err(err)
    })
    .await
}

/* ------------------------------------------------------------------ */
/* Un documento                                                        */
/* ------------------------------------------------------------------ */

#[tauri::command]
pub async fn abrir(app: AppHandle, id: String) -> R<Resumen> {
    bloq(app, move |st| {
        let t0 = Instant::now();
        let a = st.abierto(&id)?;
        crate::medir(&st.dir, "abrir_documento", t0.elapsed().as_secs_f64() * 1000.0, &a.documento.title.clone().unwrap_or_default());
        let doc = a.doc.lock().unwrap();
        let d = a.documento.clone();
        let medio = match (&d.source_ref, d.kind.as_str()) {
            (Some(r), "audio" | "video") => Some(Medio { referencia: r.clone(), mime: d.mime.clone() }),
            _ => None,
        };
        Ok(Resumen {
            entrada: id.clone(),
            version: doc.version().to_string(),
            legacy: doc.is_legacy(),
            meta: doc.meta().map_err(err)?,
            sections: doc.sections().map_err(err)?,
            spaces: doc.spaces().map_err(err)?,
            figuras: doc.figures().map_err(err)?.len(),
            fragmentos: doc.fragments().map_err(err)?.len(),
            extensions: doc.extensions().map_err(err)?,
            folios: a.unidades.iter().map(|u| u.printed.clone()).collect(),
            ids: a.unidades.iter().map(|u| u.id.clone()).collect(),
            medio,
            document: d,
        })
    })
    .await
}

#[tauri::command]
pub async fn unidades(app: AppHandle, id: String, desde: i64, hasta: i64) -> R<Vec<spdf::Unit>> {
    bloq(app, move |st| Ok(st.abierto(&id)?.unidades.iter().filter(|u| u.ord >= desde && u.ord <= hasta).cloned().collect())).await
}

#[tauri::command]
pub async fn fragmentos(app: AppHandle, id: String, unidad: Option<String>) -> R<Vec<spdf::Fragment>> {
    bloq(app, move |st| {
        let a = st.abierto(&id)?;
        let f = a.doc.lock().unwrap().fragments().map_err(err)?;
        Ok(match unidad {
            Some(u) => f.into_iter().filter(|x| x.unit == u).collect(),
            None => f,
        })
    })
    .await
}

#[tauri::command]
pub async fn figuras(app: AppHandle, id: String) -> R<Vec<spdf::Figure>> {
    bloq(app, move |st| st.abierto(&id)?.doc.lock().unwrap().figures().map_err(err)).await
}

#[tauri::command]
pub async fn procedencia(app: AppHandle, id: String) -> R<Vec<spdf::Provenance>> {
    bloq(app, move |st| st.abierto(&id)?.doc.lock().unwrap().provenance().map_err(err)).await
}

#[tauri::command]
pub async fn validar(app: AppHandle, id: String) -> R<spdf::ValidationReport> {
    bloq(app, move |st| {
        let ruta = {
            let b = st.bib.lock().unwrap();
            b.ruta_fichero(b.entrada(&id).ok_or("No está en la biblioteca.")?)
        };
        Ok(spdf::validate(&ruta))
    })
    .await
}

#[tauri::command]
pub async fn volcado(app: AppHandle, id: String) -> R<Value> {
    bloq(app, move |st| st.abierto(&id)?.doc.lock().unwrap().dump().map_err(err)).await
}

#[tauri::command]
pub async fn unidades_por_folio(app: AppHandle, id: String, folio: String) -> R<Vec<i64>> {
    bloq(app, move |st| {
        let f = folio.trim().trim_start_matches('[').trim_end_matches(']').to_lowercase();
        Ok(st.abierto(&id)?.unidades.iter().filter(|u| u.printed.as_deref().map(|p| p.to_lowercase() == f).unwrap_or(false)).map(|u| u.ord).collect())
    })
    .await
}

/* ------------------------------------------------------------------ */
/* Búsqueda                                                            */
/* ------------------------------------------------------------------ */

/// El vector de la consulta para algún espacio del documento, si hay un motor compatible.
fn vector_para(st: &Estado, espacios: &[spdf::Space], q: &str) -> Result<(spdf::Space, Vec<f32>), &'static str> {
    if espacios.is_empty() {
        return Err("sin-vectores");
    }
    let clave = st.clave.lock().unwrap().clone();
    let mut motores: Vec<&str> = Vec::new();
    if clave.is_some() {
        motores.push("gemini");
    }
    if *st.pruebas.lock().unwrap() {
        motores.push("prueba");
    }
    if motores.is_empty() {
        return Err("sin-modelo");
    }
    for e in espacios {
        for m in &motores {
            let Some(qs) = ia::espacio(m, e.dims as usize) else { continue };
            if !ia::compatible(e, &qs) {
                continue;
            }
            let k = format!("{}|{}|{q}", qs.id, m);
            if let Some(v) = st.consultas.lock().unwrap().get(&k) {
                return Ok((e.clone(), v.clone()));
            }
            let v = match *m {
                "gemini" => ia::gemini_vectores(clave.as_deref().unwrap_or(""), &[q.to_string()], true, e.dims as usize).ok().and_then(|mut v| v.pop()),
                _ => ia::falso(&[q.to_string()], e.dims as usize).pop(),
            };
            if let Some(v) = v {
                st.consultas.lock().unwrap().insert(k, v.clone());
                return Ok((e.clone(), v));
            }
        }
    }
    Err("incompatible")
}

fn buscar_en(st: &Estado, id: &str, p: &PeticionBusqueda, limite: usize) -> R<(Vec<Acierto>, String, Option<String>)> {
    let a = st.abierto(id)?;
    let doc = a.doc.lock().unwrap();
    let mut modo = p.modo.clone();
    let mut motivo = None;
    let mut hits = Vec::new();
    if modo != "lexica" {
        let espacios = doc.spaces().map_err(err)?;
        match vector_para(st, &espacios, &p.consulta) {
            Ok((e, v)) => {
                hits = if modo == "semantica" {
                    doc.search_vector(&e.id, &v, spdf::Target::Fragment, limite).map_err(err)?
                } else {
                    doc.search_hybrid(&p.consulta, &v, &e.id, limite).map_err(err)?
                }
            }
            Err(m) => {
                motivo = Some(m.to_string());
                modo = "lexica".into();
            }
        }
    }
    if modo == "lexica" {
        hits = doc.search_lexical(&p.consulta, limite).map_err(err)?;
    }
    let locale = spdf::Locale::parse(&p.lengua);
    let mut out = Vec::with_capacity(hits.len());
    for h in hits {
        let Some(f) = doc.fragment(&h.fragment_id).map_err(err)? else { continue };
        let cita = spdf::cite::cite_value(&h.anchor, f.anchor_end.as_ref(), &a.documento.metadata, locale);
        out.push(Acierto {
            n: f.n,
            score: h.score,
            via: h.via,
            folio: h.anchor.get("printed").and_then(|v| v.as_str()).map(String::from),
            anchor: h.anchor,
            anchor_uri: h.anchor_uri,
            documento: id.to_string(),
            texto: f.text,
            contexto: f.context,
            unidad_ord: *a.ord_de.get(&f.unit).unwrap_or(&1),
            cita,
            fragment_id: h.fragment_id,
        });
    }
    Ok((out, modo, motivo))
}

/// Fusión por rango (RRF, k = 10) de las listas de varios documentos: ver src/util/fusion.ts.
fn fusionar(listas: Vec<Vec<Acierto>>, limite: usize) -> Vec<Acierto> {
    let mut todos: Vec<(f64, usize, Acierto)> = Vec::new();
    for (d, l) in listas.into_iter().enumerate() {
        for (i, a) in l.into_iter().enumerate() {
            todos.push((1.0 / (10.0 + i as f64 + 1.0), d, a));
        }
    }
    todos.sort_by(|x, y| {
        y.0.partial_cmp(&x.0)
            .unwrap_or(std::cmp::Ordering::Equal)
            .then(y.2.score.partial_cmp(&x.2.score).unwrap_or(std::cmp::Ordering::Equal))
            .then(x.1.cmp(&y.1))
            .then(x.2.n.cmp(&y.2.n))
    });
    todos.into_iter().take(limite).map(|t| t.2).collect()
}

#[tauri::command]
pub async fn buscar(app: AppHandle, p: PeticionBusqueda) -> R<ResultadoBusqueda> {
    bloq(app, move |st| {
        let t0 = Instant::now();
        let limite = p.limite.unwrap_or(30);
        let ids: Vec<String> = if p.ambito == "biblioteca" {
            st.bib.lock().unwrap().entradas.iter().map(|e| e.id.clone()).collect()
        } else {
            vec![p.ambito.clone()]
        };
        let mut listas = Vec::new();
        let mut avisos = Vec::new();
        let mut modo = p.modo.clone();
        for id in &ids {
            match buscar_en(st, id, &p, limite) {
                Ok((l, m, motivo)) => {
                    listas.push(l);
                    if let Some(x) = motivo {
                        avisos.push(Aviso { documento: id.clone(), motivo: x });
                    }
                    if ids.len() == 1 {
                        modo = m;
                    }
                }
                Err(e) => avisos.push(Aviso { documento: id.clone(), motivo: e }),
            }
        }
        if ids.len() > 1 && avisos.len() == ids.len() && p.modo != "lexica" {
            modo = "lexica".into();
        }
        let aciertos = if ids.len() == 1 { listas.pop().unwrap_or_default() } else { fusionar(listas, limite) };
        let ms = t0.elapsed().as_secs_f64() * 1000.0;
        crate::medir(&st.dir, if ids.len() == 1 { "buscar_documento" } else { "buscar_biblioteca" }, ms, &format!("{} · {} · {} aciertos · {} documentos", p.consulta, modo, aciertos.len(), ids.len()));
        Ok(ResultadoBusqueda { aciertos, modo, avisos, ms: ms.round() as u64 })
    })
    .await
}

/* ------------------------------------------------------------------ */
/* Citas y referencias                                                 */
/* ------------------------------------------------------------------ */

#[tauri::command]
pub async fn citar(app: AppHandle, id: String, ancla: Value, lengua: String, fin: Option<Value>) -> R<String> {
    bloq(app, move |st| {
        let a = st.abierto(&id)?;
        Ok(spdf::cite::cite_value(&ancla, fin.as_ref(), &a.documento.metadata, spdf::Locale::parse(&lengua)))
    })
    .await
}

#[tauri::command]
pub async fn uri_ancla(app: AppHandle, id: String, ancla: Value, fin: Option<Value>) -> R<String> {
    bloq(app, move |st| {
        let a = st.abierto(&id)?;
        spdf::format_uri(&a.documento.docref(), &ancla, fin.as_ref()).map_err(err)
    })
    .await
}

#[tauri::command]
pub async fn referencia(app: AppHandle, id: String, formato: String) -> R<String> {
    bloq(app, move |st| {
        let a = st.abierto(&id)?;
        Ok(if formato == "bibtex" {
            spdf::export::bibtex(&a.documento)
        } else {
            serde_json::to_string_pretty(&spdf::export::csl_json(&a.documento)).map_err(err)?
        })
    })
    .await
}

/* ------------------------------------------------------------------ */
/* Anotaciones y ficheros del usuario                                  */
/* ------------------------------------------------------------------ */

#[tauri::command]
pub async fn leer_anotaciones(app: AppHandle, id: String) -> R<Option<String>> {
    bloq(app, move |st| {
        let b = st.bib.lock().unwrap();
        let e = b.entrada(&id).ok_or("No está en la biblioteca.")?;
        Ok(std::fs::read_to_string(b.ruta_anotaciones(e)).ok())
    })
    .await
}

#[tauri::command]
pub async fn guardar_anotaciones(app: AppHandle, id: String, json: String) -> R<()> {
    bloq(app, move |st| {
        let b = st.bib.lock().unwrap();
        let e = b.entrada(&id).ok_or("No está en la biblioteca.")?;
        escribir_atomico(&b.ruta_anotaciones(e), json.as_bytes()).map_err(err)
    })
    .await
}

#[tauri::command]
pub async fn copiar_fichero(app: AppHandle, id: String, destino: String) -> R<()> {
    bloq(app, move |st| {
        let b = st.bib.lock().unwrap();
        let e = b.entrada(&id).ok_or("No está en la biblioteca.")?;
        std::fs::copy(b.ruta_fichero(e), destino).map(|_| ()).map_err(err)
    })
    .await
}

#[tauri::command]
pub async fn escribir_fichero(app: AppHandle, ruta: String, datos: Vec<u8>) -> R<()> {
    bloq(app, move |_| std::fs::write(ruta, datos).map_err(err)).await
}

/* ------------------------------------------------------------------ */
/* Modelos, clave e inteligencia                                       */
/* ------------------------------------------------------------------ */

#[tauri::command]
pub async fn modelos(app: AppHandle) -> R<Vec<ModeloCatalogo>> {
    bloq(app, |st| {
        let dir = st.dir.join("modelos");
        Ok(ia::catalogo(&|id| dir.join(id).exists()))
    })
    .await
}

#[tauri::command]
pub async fn descargar_modelo(app: AppHandle, id: String, canal: Channel<Progreso>) -> R<()> {
    let _ = canal;
    bloq(app, move |_| ia::descargar(&id)).await
}

#[tauri::command]
pub async fn borrar_modelo(app: AppHandle, id: String) -> R<()> {
    bloq(app, move |st| {
        let p = st.dir.join("modelos").join(&id);
        if p.is_dir() {
            std::fs::remove_dir_all(p).map_err(err)
        } else {
            let _ = std::fs::remove_file(p);
            Ok(())
        }
    })
    .await
}

#[tauri::command]
pub async fn estado_clave(app: AppHandle) -> R<&'static str> {
    bloq(app, |st| {
        Ok(match (st.clave.lock().unwrap().is_some(), *st.clave_persistida.lock().unwrap()) {
            (false, _) => "ninguna",
            (true, true) => "llavero",
            (true, false) => "memoria",
        })
    })
    .await
}

#[tauri::command]
pub async fn guardar_clave(app: AppHandle, clave: String, persistir: bool) -> R<()> {
    bloq(app, move |st| {
        let c = clave.trim().to_string();
        if persistir {
            crate::llavero::guardar(&st.dir, &c)?;
        } else {
            crate::llavero::borrar(&st.dir);
        }
        *st.clave.lock().unwrap() = Some(c).filter(|c| !c.is_empty());
        *st.clave_persistida.lock().unwrap() = persistir;
        st.consultas.lock().unwrap().clear();
        Ok(())
    })
    .await
}

#[tauri::command]
pub async fn borrar_clave(app: AppHandle) -> R<()> {
    bloq(app, |st| {
        crate::llavero::borrar(&st.dir);
        *st.clave.lock().unwrap() = None;
        *st.clave_persistida.lock().unwrap() = false;
        Ok(())
    })
    .await
}

#[tauri::command]
pub async fn espacio_de(app: AppHandle, motor: String, dims: usize, modelo: Option<String>) -> R<Option<spdf::Space>> {
    let _ = modelo;
    bloq(app, move |_| Ok(ia::espacio(&motor, dims))).await
}

fn incrustar(st: &Estado, motor: &str, textos: &[String], dims: usize) -> R<Vec<Vec<f32>>> {
    match motor {
        "gemini" => {
            let c = st.clave.lock().unwrap().clone().ok_or("Falta la clave de Gemini.")?;
            ia::gemini_vectores(&c, textos, false, dims)
        }
        "prueba" if *st.pruebas.lock().unwrap() => Ok(ia::falso(textos, dims)),
        "prueba" => Err("El modelo de pruebas solo existe en modo pruebas.".into()),
        _ => Err(ia::descargar("").unwrap_err()),
    }
}

#[tauri::command]
pub async fn revectorizar(app: AppHandle, id: String, o: OpcionesRevectorizar, canal: Channel<Progreso>) -> R<Entrada> {
    bloq(app, move |st| {
        let mut espacio = ia::espacio(&o.motor, o.dims).ok_or_else(|| ia::descargar("").unwrap_err())?;
        espacio.created = Some(biblioteca::ahora());
        let (entrada, original) = {
            let b = st.bib.lock().unwrap();
            let e = b.entrada(&id).ok_or("No está en la biblioteca.")?.clone();
            let r = b.ruta_fichero(&e);
            (e, r)
        };
        let a = st.abierto(&id)?;
        let (frags, mut w) = {
            let doc = a.doc.lock().unwrap();
            (doc.fragments().map_err(err)?, spdf::Writer::from_spdf(&doc).map_err(err)?)
        };
        let total = frags.len() as u64;
        w.add_space(&espacio).map_err(err)?;
        let lote = if o.motor == "gemini" { 64 } else { 16 };
        for (i, parte) in frags.chunks(lote).enumerate() {
            let _ = canal.send(Progreso { fase: "vectores".into(), hecho: (i * lote) as u64, total, detalle: None });
            let textos: Vec<String> = parte.iter().map(|f| f.text.clone()).collect();
            let vs = incrustar(st, &o.motor, &textos, o.dims)?;
            for (f, v) in parte.iter().zip(vs) {
                w.add_vector(spdf::Target::Fragment, &f.id, &espacio.id, &v).map_err(err)?;
            }
        }
        let _ = canal.send(Progreso { fase: "escribir".into(), hecho: total, total, detalle: None });

        // Dónde se escribe: al lado del original (escritorio) o en la carpeta de la app.
        let copia_app = entrada.ruta.is_none();
        let base = entrada.nombre.trim_end_matches(".spdf").trim_end_matches(".gz").to_string();
        let destino: PathBuf = if o.destino == "fichero" {
            original.clone()
        } else if copia_app {
            st.dir.join("ficheros").join(format!(".nuevo-{}.spdf", std::process::id()))
        } else {
            let dir = original.parent().map(Path::to_path_buf).unwrap_or_else(|| st.dir.clone());
            let nombre = format!("{base} ({}).spdf", espacio.id.replace([':', '/'], "-"));
            dir.join(nombre)
        };
        let tmp = destino.with_extension("spdf.tmp");
        w.write(&tmp).map_err(err)?;
        // Siempre 5.0 válido: si no lo es, no se toca nada.
        let informe = spdf::validate(&tmp);
        if !informe.valid {
            let _ = std::fs::remove_file(&tmp);
            return Err(format!("El fichero revectorizado no es válido: {}", informe.errors.iter().map(|e| e.code.clone()).collect::<Vec<_>>().join(", ")));
        }
        let nuevo_id = sha256_fichero(&tmp).map_err(err)?;
        let final_ruta = if copia_app { st.dir.join("ficheros").join(format!("{nuevo_id}.spdf")) } else { destino.clone() };
        st.olvidar(&id);
        std::fs::rename(&tmp, &final_ruta).map_err(err)?;
        let doc = spdf::Spdf::open(&final_ruta).map_err(err)?;
        let bytes = std::fs::metadata(&final_ruta).map_err(err)?.len();
        let mut b = st.bib.lock().unwrap();
        let ruta = if copia_app { None } else { Some(final_ruta.to_string_lossy().into_owned()) };
        let nombre = if o.destino == "fichero" { entrada.nombre.clone() } else { final_ruta.file_name().and_then(|n| n.to_str()).map(String::from).unwrap_or(base) };
        let nombre = if copia_app && o.destino != "fichero" { format!("{} ({}).spdf", entrada.nombre.trim_end_matches(".spdf"), espacio.id) } else { nombre };
        let e = entrada_de(&nuevo_id, &nombre, bytes, ruta, &doc, if o.destino == "fichero" { Some(&entrada) } else { None }).map_err(err)?;
        if o.destino == "fichero" {
            // Las anotaciones siguen al fichero (en móvil van por id).
            if copia_app {
                let viejo = b.ruta_anotaciones(&entrada);
                if viejo.exists() {
                    let _ = std::fs::rename(&viejo, b.ruta_anotaciones(&e));
                }
                if original != final_ruta {
                    let _ = std::fs::remove_file(&original);
                }
            }
            let i = b.entradas.iter().position(|x| x.id == id).unwrap_or(0);
            b.entradas[i] = e.clone();
        } else {
            b.entradas.insert(0, e.clone());
        }
        b.guardar().map_err(err)?;
        let _ = canal.send(Progreso { fase: "hecho".into(), hecho: total, total, detalle: None });
        Ok(e)
    })
    .await
}

#[tauri::command]
pub async fn generar(app: AppHandle, prompt: String, o: OpcionesGenerar, canal: Channel<String>) -> R<String> {
    bloq(app, move |st| match o.motor.as_str() {
        "gemini" => {
            let c = st.clave.lock().unwrap().clone().ok_or("Falta la clave de Gemini.")?;
            ia::gemini_generar(&c, &prompt, &o, |t| {
                let _ = canal.send(t.to_string());
            })
        }
        "prueba" if *st.pruebas.lock().unwrap() => Ok(ia::falso_generar(&prompt, |t| {
            let _ = canal.send(t.to_string());
        })),
        _ => Err(ia::descargar("").unwrap_err()),
    })
    .await
}

#[tauri::command]
pub async fn juzgar(app: AppHandle, afirmacion: String, pasaje: String, motor: String) -> R<Apoyo> {
    bloq(app, move |st| match motor.as_str() {
        "gemini" => {
            let c = st.clave.lock().unwrap().clone().ok_or("Falta la clave de Gemini.")?;
            ia::gemini_juzgar(&c, &afirmacion, &pasaje)
        }
        "prueba" => Ok(ia::falso_juzgar(&afirmacion, &pasaje)),
        _ => Err(ia::descargar("").unwrap_err()),
    })
    .await
}

/* ------------------------------------------------------------------ */
/* El protocolo spdf:// (blobs con rangos HTTP)                        */
/* ------------------------------------------------------------------ */

pub fn servir_blob(app: &AppHandle, req: &tauri::http::Request<Vec<u8>>) -> tauri::http::Response<Vec<u8>> {
    use tauri::http::{header, Response, StatusCode};
    let respuesta = |code: StatusCode, msg: &str| Response::builder().status(code).header(header::CONTENT_TYPE, "text/plain; charset=utf-8").body(msg.as_bytes().to_vec()).unwrap();
    // convertFileSrc codifica la ruta entera (también la barra): se decodifica antes de partirla,
    // y la clave, que la interfaz ya había codificado, otra vez después.
    let ruta = percent_encoding::percent_decode_str(req.uri().path().trim_start_matches('/')).decode_utf8_lossy().into_owned();
    let Some((id, clave)) = ruta.split_once('/') else { return respuesta(StatusCode::BAD_REQUEST, "ruta") };
    let clave = percent_encoding::percent_decode_str(clave).decode_utf8_lossy().into_owned();
    let st = app.state::<Estado>();
    let blob = st.abierto(id).and_then(|a| a.doc.lock().unwrap().resolve_image(&format!("blob:{clave}")).map_err(err));
    let Ok(Some(b)) = blob else { return respuesta(StatusCode::NOT_FOUND, "no está") };
    let total = b.data.len();
    let rango = req.headers().get(header::RANGE).and_then(|v| v.to_str().ok()).and_then(|v| v.strip_prefix("bytes=")).and_then(|v| {
        let (a, z) = v.split_once('-')?;
        let a: usize = a.parse().ok()?;
        let z: usize = if z.is_empty() { total.saturating_sub(1) } else { z.parse().ok()? };
        (a <= z && a < total).then_some((a, z.min(total - 1)))
    });
    let base = Response::builder().header(header::CONTENT_TYPE, b.mime.as_str()).header(header::ACCEPT_RANGES, "bytes").header(header::ACCESS_CONTROL_ALLOW_ORIGIN, "*").header(header::CACHE_CONTROL, "max-age=31536000, immutable");
    match rango {
        Some((a, z)) => base
            .status(StatusCode::PARTIAL_CONTENT)
            .header(header::CONTENT_RANGE, format!("bytes {a}-{z}/{total}"))
            .header(header::CONTENT_LENGTH, (z - a + 1).to_string())
            .body(b.data[a..=z].to_vec())
            .unwrap(),
        None => base.status(StatusCode::OK).header(header::CONTENT_LENGTH, total.to_string()).body(b.data).unwrap(),
    }
}

#[allow(dead_code)]
fn _usa(_: HashMap<(), ()>) {}
