//! La biblioteca en disco: un índice JSON en la carpeta de datos de la app.
//!
//! - Escritorio: los .spdf se quedan donde están (la entrada guarda su ruta);
//!   las anotaciones van al lado, en el fichero hermano `<nombre>.spdfa.json`,
//!   y si esa carpeta no se puede escribir, a la carpeta de la app.
//! - Móvil: el sistema da los ficheros prestados (iOS «Abrir con», Android
//!   «compartir»), así que se copian a `ficheros/<id>.spdf` y las anotaciones
//!   van a su lado.

use crate::tipos::{Coleccion, Entrada};
use sha2::{Digest, Sha256};
use std::fs;
use std::io::Read;
use std::path::{Path, PathBuf};

pub struct Biblioteca {
    pub dir: PathBuf,
    pub entradas: Vec<Entrada>,
    pub colecciones: Vec<Coleccion>,
    pub copiar: bool,
}

fn leer_json<T: serde::de::DeserializeOwned + Default>(p: &Path) -> T {
    fs::read(p).ok().and_then(|b| serde_json::from_slice(&b).ok()).unwrap_or_default()
}

/// Escribe de forma atómica: a un temporal y luego se renombra.
pub fn escribir_atomico(p: &Path, datos: &[u8]) -> std::io::Result<()> {
    let tmp = p.with_extension(format!("{}.tmp", p.extension().and_then(|e| e.to_str()).unwrap_or("x")));
    fs::write(&tmp, datos)?;
    fs::rename(&tmp, p)
}

pub fn sha256_fichero(p: &Path) -> std::io::Result<String> {
    let mut f = fs::File::open(p)?;
    let mut h = Sha256::new();
    let mut buf = vec![0u8; 1 << 20];
    loop {
        let n = f.read(&mut buf)?;
        if n == 0 {
            break;
        }
        h.update(&buf[..n]);
    }
    Ok(hex(&h.finalize()))
}

pub fn hex(b: &[u8]) -> String {
    b.iter().map(|x| format!("{x:02x}")).collect()
}

pub fn ahora() -> String {
    spdf::now_utc()
}

impl Biblioteca {
    pub fn cargar(dir: PathBuf, copiar: bool) -> Self {
        let _ = fs::create_dir_all(dir.join("ficheros"));
        let _ = fs::create_dir_all(dir.join("anotaciones"));
        Biblioteca {
            entradas: leer_json(&dir.join("biblioteca.json")),
            colecciones: leer_json(&dir.join("colecciones.json")),
            dir,
            copiar,
        }
    }

    pub fn guardar(&self) -> std::io::Result<()> {
        escribir_atomico(&self.dir.join("biblioteca.json"), &serde_json::to_vec_pretty(&self.entradas).unwrap_or_default())
    }

    pub fn guardar_colecciones(&self) -> std::io::Result<()> {
        escribir_atomico(&self.dir.join("colecciones.json"), &serde_json::to_vec_pretty(&self.colecciones).unwrap_or_default())
    }

    pub fn entrada(&self, id: &str) -> Option<&Entrada> {
        self.entradas.iter().find(|e| e.id == id)
    }

    /// Dónde está el .spdf de una entrada.
    pub fn ruta_fichero(&self, e: &Entrada) -> PathBuf {
        match &e.ruta {
            Some(r) => PathBuf::from(r),
            None => self.dir.join("ficheros").join(format!("{}.spdf", e.id)),
        }
    }

    /// El fichero hermano de anotaciones (o su sitio en la carpeta de la app si al lado no se puede escribir).
    pub fn ruta_anotaciones(&self, e: &Entrada) -> PathBuf {
        if let Some(r) = &e.ruta {
            let p = Path::new(r);
            let base = p.file_stem().and_then(|s| s.to_str()).unwrap_or("documento");
            let base = base.strip_suffix(".spdf").unwrap_or(base);
            if let Some(dir) = p.parent() {
                let hermano = dir.join(format!("{base}.spdfa.json"));
                if hermano.exists() || carpeta_escribible(dir) {
                    return hermano;
                }
            }
        }
        if e.ruta.is_none() {
            return self.dir.join("ficheros").join(format!("{}.spdfa.json", e.id));
        }
        self.dir.join("anotaciones").join(format!("{}.spdfa.json", e.id))
    }
}

fn carpeta_escribible(dir: &Path) -> bool {
    let prueba = dir.join(format!(".spdf-lector-{}", std::process::id()));
    match fs::write(&prueba, b"") {
        Ok(()) => {
            let _ = fs::remove_file(prueba);
            true
        }
        Err(_) => false,
    }
}

/// Construye la entrada de biblioteca de un documento abierto.
pub fn entrada_de(id: &str, nombre: &str, bytes: u64, ruta: Option<String>, doc: &spdf::Spdf, previa: Option<&Entrada>) -> spdf::Result<Entrada> {
    let d = doc.document()?;
    let md = &d.metadata;
    let titulo = md.get("title").and_then(|v| v.as_str()).map(String::from).or(d.title.clone()).unwrap_or_else(|| nombre.to_string());
    let autores = md
        .get("author")
        .and_then(|a| a.as_array())
        .map(|a| {
            a.iter()
                .map(|p| {
                    p.get("literal").and_then(|v| v.as_str()).map(String::from).unwrap_or_else(|| {
                        [p.get("given"), p.get("family")]
                            .iter()
                            .filter_map(|x| x.and_then(|v| v.as_str()))
                            .collect::<Vec<_>>()
                            .join(" ")
                    })
                })
                .collect::<Vec<_>>()
                .join("; ")
        })
        .filter(|s| !s.is_empty())
        .or(d.authors.clone())
        .unwrap_or_default();
    let anio = md
        .pointer("/issued/date-parts/0/0")
        .and_then(|v| v.as_i64().or_else(|| v.as_str().and_then(|s| s.parse().ok())))
        .or(d.year);
    let espacios = doc.spaces()?.into_iter().map(|s| s.id).collect();
    let miniatura = miniatura_de(doc).unwrap_or(None);
    Ok(Entrada {
        id: id.to_string(),
        source_sha256: d.source_sha256.clone(),
        nombre: nombre.to_string(),
        titulo,
        autores,
        anio,
        tipo: d.kind.clone(),
        version: doc.version().to_string(),
        legacy: doc.is_legacy(),
        unidades: d.unit_count,
        bytes,
        espacios,
        ruta,
        anadido: previa.map(|p| p.anadido.clone()).unwrap_or_else(ahora),
        abierto: previa.and_then(|p| p.abierto.clone()),
        ultima_unidad: previa.and_then(|p| p.ultima_unidad),
        miniatura,
    })
}

/// La miniatura de la primera unidad, como data: URL, si es pequeña.
fn miniatura_de(doc: &spdf::Spdf) -> spdf::Result<Option<String>> {
    let Some(u) = doc.unit_by_ord(1)? else { return Ok(None) };
    let r = u.thumbnail.clone().or(u.image.clone());
    let Some(r) = r else { return Ok(None) };
    let Some(b) = doc.resolve_image(&r)? else { return Ok(None) };
    if b.data.len() > 96_000 {
        return Ok(None);
    }
    use base64_lite::encode;
    Ok(Some(format!("data:{};base64,{}", b.mime, encode(&b.data))))
}

/// Base64 estándar, sin dependencias (solo para las miniaturas).
mod base64_lite {
    const T: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    pub fn encode(b: &[u8]) -> String {
        let mut s = String::with_capacity(b.len().div_ceil(3) * 4);
        for c in b.chunks(3) {
            let n = (c[0] as u32) << 16 | (*c.get(1).unwrap_or(&0) as u32) << 8 | *c.get(2).unwrap_or(&0) as u32;
            s.push(T[(n >> 18) as usize & 63] as char);
            s.push(T[(n >> 12) as usize & 63] as char);
            s.push(if c.len() > 1 { T[(n >> 6) as usize & 63] as char } else { '=' });
            s.push(if c.len() > 2 { T[n as usize & 63] as char } else { '=' });
        }
        s
    }
}
