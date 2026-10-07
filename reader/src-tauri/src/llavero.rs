//! La clave de Gemini del usuario. Escritorio e iOS: en el llavero del sistema
//! (Llavero de macOS e iOS, Administrador de credenciales de Windows, Secret
//! Service en Linux). Android: no hay llavero en el crate `keyring`; la clave se
//! guarda en el almacenamiento privado de la app (inaccesible para otras apps),
//! y la interfaz lo dice así («en este dispositivo», no «en el llavero»).

use std::path::Path;

const SERVICIO: &str = "com.joseluissaorin.spdf-reader";
const CUENTA: &str = "gemini-api-key";

pub const HAY_LLAVERO: bool = !cfg!(target_os = "android");

#[cfg(not(target_os = "android"))]
pub fn leer(_dir: &Path) -> Option<String> {
    keyring::Entry::new(SERVICIO, CUENTA).ok()?.get_password().ok().filter(|s| !s.is_empty())
}
#[cfg(not(target_os = "android"))]
pub fn guardar(_dir: &Path, clave: &str) -> Result<(), String> {
    keyring::Entry::new(SERVICIO, CUENTA).and_then(|e| e.set_password(clave)).map_err(|e| format!("llavero: {e}"))
}
#[cfg(not(target_os = "android"))]
pub fn borrar(_dir: &Path) {
    if let Ok(e) = keyring::Entry::new(SERVICIO, CUENTA) {
        let _ = e.delete_credential();
    }
}

#[cfg(target_os = "android")]
pub fn leer(dir: &Path) -> Option<String> {
    std::fs::read_to_string(dir.join("clave-gemini")).ok().map(|s| s.trim().to_string()).filter(|s| !s.is_empty())
}
#[cfg(target_os = "android")]
pub fn guardar(dir: &Path, clave: &str) -> Result<(), String> {
    std::fs::write(dir.join("clave-gemini"), clave).map_err(|e| e.to_string())
}
#[cfg(target_os = "android")]
pub fn borrar(dir: &Path) {
    let _ = std::fs::remove_file(dir.join("clave-gemini"));
}
