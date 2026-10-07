//! Lo que viaja entre el núcleo Rust y la interfaz. Los nombres de los campos
//! son los de `src/nucleo/nucleo.ts` y `src/nucleo/tipos.ts`: las filas del
//! SPDF (Document, Unit, Fragment…) pasan tal cual las serializa el crate `spdf`.

use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Entrada {
    /// SHA-256 del fichero .spdf tal como está.
    pub id: String,
    /// SHA-256 del original (documents.source_sha256).
    pub source_sha256: String,
    pub nombre: String,
    pub titulo: String,
    pub autores: String,
    pub anio: Option<i64>,
    pub tipo: String,
    pub version: String,
    pub legacy: bool,
    pub unidades: i64,
    pub bytes: u64,
    pub espacios: Vec<String>,
    /// Escritorio: el fichero se queda donde está. Móvil: se copia a la carpeta de la app.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub ruta: Option<String>,
    pub anadido: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub abierto: Option<String>,
    #[serde(rename = "ultimaUnidad", skip_serializing_if = "Option::is_none")]
    pub ultima_unidad: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub miniatura: Option<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Coleccion {
    pub id: String,
    pub nombre: String,
    pub items: Vec<String>,
}

#[derive(Clone, Debug, Serialize)]
pub struct ResultadoImport {
    pub nombre: String,
    pub ok: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub entrada: Option<Entrada>,
    #[serde(skip_serializing_if = "std::ops::Not::not")]
    pub repetido: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

#[derive(Clone, Debug, Serialize)]
pub struct Medio {
    #[serde(rename = "ref")]
    pub referencia: String,
    pub mime: String,
}

#[derive(Clone, Debug, Serialize)]
pub struct Resumen {
    pub entrada: String,
    pub version: String,
    pub legacy: bool,
    pub meta: std::collections::BTreeMap<String, String>,
    pub document: spdf::Document,
    pub sections: Vec<spdf::Section>,
    pub spaces: Vec<spdf::Space>,
    pub figuras: usize,
    pub fragmentos: usize,
    pub extensions: Vec<spdf::Extension>,
    pub folios: Vec<Option<String>>,
    pub ids: Vec<String>,
    pub medio: Option<Medio>,
}

#[derive(Clone, Debug, Serialize)]
pub struct Acierto {
    pub fragment_id: String,
    pub n: i64,
    pub score: f64,
    pub via: Vec<String>,
    pub anchor: Value,
    pub anchor_uri: String,
    pub documento: String,
    pub texto: String,
    pub contexto: String,
    pub unidad_ord: i64,
    pub folio: Option<String>,
    pub cita: String,
}

#[derive(Clone, Debug, Deserialize)]
pub struct PeticionBusqueda {
    pub ambito: String,
    pub consulta: String,
    pub modo: String,
    pub limite: Option<usize>,
    pub lengua: String,
}

#[derive(Clone, Debug, Serialize)]
pub struct Aviso {
    pub documento: String,
    pub motivo: String,
}

#[derive(Clone, Debug, Serialize)]
pub struct ResultadoBusqueda {
    pub aciertos: Vec<Acierto>,
    pub modo: String,
    pub avisos: Vec<Aviso>,
    pub ms: u64,
}

#[derive(Clone, Debug, Serialize)]
pub struct Progreso {
    pub fase: String,
    pub hecho: u64,
    pub total: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub detalle: Option<String>,
}

#[derive(Clone, Debug, Serialize)]
pub struct ModeloCatalogo {
    pub id: String,
    pub nombre: String,
    pub tipo: String,
    pub bytes: u64,
    pub licencia: String,
    pub descargado: bool,
    pub recomendado: bool,
    pub motor: String,
}

#[derive(Clone, Debug, Deserialize)]
#[allow(dead_code)]
pub struct OpcionesRevectorizar {
    pub motor: String,
    pub modelo: Option<String>,
    pub dims: usize,
    pub destino: String,
}

#[derive(Clone, Debug, Deserialize)]
#[allow(dead_code)]
pub struct OpcionesGenerar {
    pub motor: String,
    pub modelo: Option<String>,
    pub max_tokens: Option<u32>,
    pub temperature: Option<f32>,
    pub system: Option<String>,
    pub stop: Option<Vec<String>>,
}

#[derive(Clone, Debug, Serialize)]
pub struct Apoyo {
    pub supported: f32,
    pub label: String,
}

#[derive(Clone, Debug, Serialize)]
pub struct Capacidades {
    #[serde(rename = "iaLocal")]
    pub ia_local: bool,
    pub webgpu: bool,
    pub llavero: bool,
    #[serde(rename = "escribirEnFichero")]
    pub escribir_en_fichero: bool,
    pub pruebas: bool,
}
