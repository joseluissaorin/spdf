//! Lector SPDF: el núcleo Rust de la aplicación Tauri 2 (escritorio y móvil).
//!
//! La interfaz es la misma que la web (React); aquí viven el formato (crate
//! `spdf`), la biblioteca en disco, el llavero, la inferencia y el protocolo
//! `spdf://` que sirve los blobs. Abrir con doble clic: macOS e iOS llegan por
//! `RunEvent::Opened`; Windows y Linux, por los argumentos del proceso.

mod biblioteca;
mod comandos;
mod estado;
mod ia;
mod llavero;
mod tipos;

use estado::Estado;
use tauri::{Emitter, Manager};

/// Rutas de .spdf entre los argumentos (Windows y Linux, «Abrir con…»).
fn rutas_de_argumentos() -> Vec<String> {
    std::env::args()
        .skip(1)
        .filter(|a| a.to_lowercase().ends_with(".spdf") || a.to_lowercase().ends_with(".spdf.gz"))
        .collect()
}

/// Ficheros que llegan antes de que exista el estado (doble clic con la app cerrada:
/// macOS entrega el evento antes de `setup`).
pub static ANTES_DE_ARRANCAR: std::sync::Mutex<Vec<String>> = std::sync::Mutex::new(Vec::new());

fn entregar(app: &tauri::AppHandle, rutas: Vec<String>) {
    if rutas.is_empty() {
        return;
    }
    // Si la interfaz ya escucha, le llega el evento; si no, las recoge al arrancar.
    match app.try_state::<Estado>() {
        Some(st) if *st.ui_lista.lock().unwrap() => {}
        Some(st) => st.pendientes.lock().unwrap().extend(rutas.iter().cloned()),
        None => ANTES_DE_ARRANCAR.lock().unwrap().extend(rutas.iter().cloned()),
    }
    let _ = app.emit("spdf://abrir", rutas);
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let constructor = tauri::Builder::default().plugin(tauri_plugin_dialog::init());
    #[cfg(target_os = "android")]
    let constructor = constructor.plugin(tauri_plugin_fs::init());
    let app = constructor
        .register_asynchronous_uri_scheme_protocol("spdf", |ctx, req, responder| {
            let app = ctx.app_handle().clone();
            std::thread::spawn(move || responder.respond(comandos::servir_blob(&app, &req)));
        })
        .setup(|app| {
            let dir = app.path().app_data_dir()?;
            std::fs::create_dir_all(&dir)?;
            let movil = cfg!(any(target_os = "ios", target_os = "android"));
            app.manage(Estado::nuevo(dir, movil));
            let mut rutas = rutas_de_argumentos();
            rutas.extend(std::mem::take(&mut *ANTES_DE_ARRANCAR.lock().unwrap()));
            if !rutas.is_empty() {
                app.state::<Estado>().pendientes.lock().unwrap().extend(rutas);
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            comandos::iniciar,
            comandos::ficheros_pendientes,
            comandos::biblioteca,
            comandos::importar,
            comandos::importar_bytes,
            comandos::quitar,
            comandos::recordar_posicion,
            comandos::colecciones,
            comandos::guardar_coleccion,
            comandos::borrar_coleccion,
            comandos::abrir,
            comandos::unidades,
            comandos::fragmentos,
            comandos::figuras,
            comandos::procedencia,
            comandos::validar,
            comandos::volcado,
            comandos::unidades_por_folio,
            comandos::buscar,
            comandos::citar,
            comandos::uri_ancla,
            comandos::referencia,
            comandos::leer_anotaciones,
            comandos::guardar_anotaciones,
            comandos::copiar_fichero,
            comandos::escribir_fichero,
            comandos::modelos,
            comandos::descargar_modelo,
            comandos::borrar_modelo,
            comandos::estado_clave,
            comandos::guardar_clave,
            comandos::borrar_clave,
            comandos::espacio_de,
            comandos::revectorizar,
            comandos::generar,
            comandos::juzgar,
        ])
        .build(tauri::generate_context!())
        .expect("no se pudo construir el Lector SPDF");

    app.run(|_app, _evento| {
        // macOS e iOS dan rutas file://; Android, URI content:// que se leen con el plugin fs.
        #[cfg(any(target_os = "macos", target_os = "ios", target_os = "android"))]
        if let tauri::RunEvent::Opened { urls } = _evento {
            let rutas: Vec<String> = urls
                .iter()
                .map(|u| u.to_file_path().map(|p| p.to_string_lossy().into_owned()).unwrap_or_else(|_| u.to_string()))
                .collect();
            entregar(_app, rutas);
        }
    });
}
