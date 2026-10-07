// Evita la consola extra en Windows al compilar en modo release. NO QUITAR.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    lector_spdf_lib::run()
}
