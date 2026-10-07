//! El estado del núcleo: la biblioteca, los documentos abiertos (una caché
//! pequeña), la clave de Gemini en memoria y los ficheros que el sistema pidió
//! abrir antes de que la interfaz estuviera lista.

use crate::biblioteca::Biblioteca;
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};

pub struct Abierto {
    pub doc: Mutex<spdf::Spdf>,
    pub unidades: Vec<spdf::Unit>,
    pub ord_de: HashMap<String, i64>,
    pub documento: spdf::Document,
}

pub struct Estado {
    pub dir: PathBuf,
    pub bib: Mutex<Biblioteca>,
    pub abiertos: Mutex<Vec<(String, Arc<Abierto>)>>,
    pub clave: Mutex<Option<String>>,
    pub clave_persistida: Mutex<bool>,
    pub pendientes: Mutex<Vec<String>>,
    /// La interfaz ya ha recogido los pendientes: lo siguiente le llega por evento.
    pub ui_lista: Mutex<bool>,
    pub pruebas: Mutex<bool>,
    pub consultas: Mutex<HashMap<String, Vec<f32>>>,
}

pub type R<T> = Result<T, String>;

pub fn err<E: std::fmt::Display>(e: E) -> String {
    e.to_string()
}

impl Estado {
    pub fn nuevo(dir: PathBuf, copiar: bool) -> Self {
        let clave = crate::llavero::leer(&dir);
        let persistida = clave.is_some();
        Estado {
            bib: Mutex::new(Biblioteca::cargar(dir.clone(), copiar)),
            dir,
            abiertos: Mutex::new(Vec::new()),
            clave: Mutex::new(clave),
            clave_persistida: Mutex::new(persistida),
            pendientes: Mutex::new(Vec::new()),
            ui_lista: Mutex::new(false),
            pruebas: Mutex::new(false),
            consultas: Mutex::new(HashMap::new()),
        }
    }

    /// El documento abierto (de la caché o recién abierto), con sus unidades.
    pub fn abierto(&self, id: &str) -> R<Arc<Abierto>> {
        {
            let mut l = self.abiertos.lock().unwrap();
            if let Some(i) = l.iter().position(|(k, _)| k == id) {
                let par = l.remove(i);
                let a = par.1.clone();
                l.push(par);
                return Ok(a);
            }
        }
        let ruta = {
            let b = self.bib.lock().unwrap();
            let e = b.entrada(id).ok_or("El documento ya no está en la biblioteca.")?;
            b.ruta_fichero(e)
        };
        if !ruta.exists() {
            return Err(format!("No encuentro el fichero: {}", ruta.display()));
        }
        let doc = spdf::Spdf::open(&ruta).map_err(err)?;
        let unidades = doc.units().map_err(err)?;
        let documento = doc.document().map_err(err)?;
        let ord_de = unidades.iter().map(|u| (u.id.clone(), u.ord)).collect();
        let a = Arc::new(Abierto { doc: Mutex::new(doc), unidades, ord_de, documento });
        let mut l = self.abiertos.lock().unwrap();
        l.push((id.to_string(), a.clone()));
        while l.len() > 6 {
            l.remove(0);
        }
        Ok(a)
    }

    pub fn olvidar(&self, id: &str) {
        self.abiertos.lock().unwrap().retain(|(k, _)| k != id);
    }
}
