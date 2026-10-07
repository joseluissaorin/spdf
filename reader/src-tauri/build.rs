fn main() {
    enlazar_runtime_de_clang();
    // llama.cpp (ggml) usa vDSP de Accelerate también en iOS; spdf-llama-sys solo lo enlaza en macOS.
    if std::env::var("CARGO_CFG_TARGET_OS").as_deref() == Ok("ios") {
        println!("cargo:rustc-link-lib=framework=Accelerate");
    }
    tauri_build::build()
}

/// llama.cpp (Metal) usa `@available(...)`, que clang compila como llamadas a
/// `__isPlatformVersionAtLeast` de compiler-rt; rustc enlaza con `-nodefaultlibs` y no lo
/// trae. Se enlaza aquí la biblioteca del runtime de clang de la plataforma de destino.
fn enlazar_runtime_de_clang() {
    // Solo macOS: en iOS el enlace final lo hace Xcode con clang, que ya trae compiler-rt (y rustc no
    // sabe meter el .a universal de compiler-rt dentro de la biblioteca estática).
    let os = std::env::var("CARGO_CFG_TARGET_OS").unwrap_or_default();
    if os != "macos" {
        return;
    }
    let simulador = std::env::var("TARGET").map(|t| t.ends_with("-sim") || t.starts_with("x86_64-apple-ios")).unwrap_or(false);
    let lib = match (os.as_str(), simulador) {
        ("macos", _) => "clang_rt.osx",
        ("ios", true) => "clang_rt.iossim",
        _ => "clang_rt.ios",
    };
    let Ok(salida) = std::process::Command::new("xcrun").args(["clang", "--print-resource-dir"]).output() else { return };
    let dir = String::from_utf8_lossy(&salida.stdout).trim().to_string();
    if dir.is_empty() {
        return;
    }
    println!("cargo:rustc-link-search=native={dir}/lib/darwin");
    println!("cargo:rustc-link-lib=static={lib}");
}
