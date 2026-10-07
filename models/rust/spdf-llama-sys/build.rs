//! Builds llama.cpp (static) + mtmd with CMake and generates bindings with bindgen.
//!
//! Source of llama.cpp, in this order:
//!   1. `LLAMA_CPP_DIR`: an existing checkout (offline builds, local patches);
//!   2. a cached checkout of the pinned commit in `$SPDF_LLAMA_CPP_CACHE`
//!      (default `~/.cache/spdf-models/src`), fetched with `git fetch --depth 1 <commit>`,
//!      which is verified by the commit hash itself.
//!
//! Backends: Metal on Apple targets (always), CPU everywhere, `vulkan` and `cuda` features.

use std::{
    env,
    path::{Path, PathBuf},
    process::Command,
};

/// llama.cpp master of 2026-10-07: first commits with EmbeddingGemma 2 (PR 30054, text+vision+audio).
const LLAMA_COMMIT: &str = "36a73916ee0cb3b457f356066afabd47cce68884";
const LLAMA_REPO: &str = "https://github.com/ggml-org/llama.cpp";

fn home() -> PathBuf {
    env::var_os("HOME").or_else(|| env::var_os("USERPROFILE")).map(PathBuf::from).unwrap_or_else(|| PathBuf::from("."))
}

fn git(dir: &Path, args: &[&str]) -> bool {
    Command::new("git").arg("-C").arg(dir).args(args).status().map(|s| s.success()).unwrap_or(false)
}

fn source_dir() -> PathBuf {
    println!("cargo:rerun-if-env-changed=LLAMA_CPP_DIR");
    println!("cargo:rerun-if-env-changed=SPDF_LLAMA_CPP_CACHE");
    if let Some(dir) = env::var_os("LLAMA_CPP_DIR") {
        let dir = PathBuf::from(dir);
        assert!(dir.join("include/llama.h").exists(), "LLAMA_CPP_DIR={} has no include/llama.h", dir.display());
        return dir;
    }
    let cache = env::var_os("SPDF_LLAMA_CPP_CACHE").map(PathBuf::from).unwrap_or_else(|| home().join(".cache/spdf-models/src"));
    let dir = cache.join(format!("llama.cpp-{}", &LLAMA_COMMIT[..12]));
    if dir.join("include/llama.h").exists() {
        return dir;
    }
    std::fs::create_dir_all(&cache).expect("create llama.cpp cache dir");
    // fetch into a temporary dir and rename, so concurrent builds (several targets) do not collide
    let tmp = cache.join(format!(".llama.cpp-{}-{}", &LLAMA_COMMIT[..12], std::process::id()));
    let _ = std::fs::remove_dir_all(&tmp);
    std::fs::create_dir_all(&tmp).unwrap();
    let ok = git(&tmp, &["init", "-q"])
        && git(&tmp, &["remote", "add", "origin", LLAMA_REPO])
        && git(&tmp, &["fetch", "-q", "--depth", "1", "origin", LLAMA_COMMIT])
        && git(&tmp, &["checkout", "-q", "--detach", "FETCH_HEAD"]);
    assert!(ok, "could not fetch llama.cpp {LLAMA_COMMIT}; set LLAMA_CPP_DIR to a checkout of that commit");
    let head = Command::new("git").arg("-C").arg(&tmp).args(["rev-parse", "HEAD"]).output().unwrap();
    assert_eq!(String::from_utf8_lossy(&head.stdout).trim(), LLAMA_COMMIT, "llama.cpp commit mismatch");
    if std::fs::rename(&tmp, &dir).is_err() {
        let _ = std::fs::remove_dir_all(&tmp); // another build won the race
    }
    dir
}

/// Minimum Android API level (24 = Tauri's default minSdk); SPDF_ANDROID_API overrides it.
fn android_api() -> String {
    println!("cargo:rerun-if-env-changed=SPDF_ANDROID_API");
    env::var("SPDF_ANDROID_API").unwrap_or_else(|_| "24".into())
}

fn main() {
    let src = source_dir();
    let target = env::var("TARGET").unwrap();
    let apple = target.contains("apple");
    let ios = target.contains("apple-ios");
    let android = target.contains("android");
    let windows = target.contains("windows");
    let msvc = target.contains("msvc");

    let mut cfg = cmake::Config::new(&src);
    cfg.define("BUILD_SHARED_LIBS", "OFF")
        .define("LLAMA_BUILD_COMMON", "OFF")
        .define("LLAMA_BUILD_TESTS", "OFF")
        .define("LLAMA_BUILD_TOOLS", "OFF")
        .define("LLAMA_BUILD_EXAMPLES", "OFF")
        .define("LLAMA_BUILD_SERVER", "OFF")
        .define("LLAMA_BUILD_APP", "OFF")
        .define("LLAMA_BUILD_MTMD", "ON")
        .define("LLAMA_OPENSSL", "OFF")
        .define("LLAMA_CURL", "OFF")
        .define("LLAMA_ALL_WARNINGS", "OFF")
        .define("GGML_NATIVE", if cfg!(feature = "native") { "ON" } else { "OFF" })
        .define("GGML_OPENMP", if cfg!(feature = "openmp") { "ON" } else { "OFF" })
        .define("CMAKE_BUILD_TYPE", "Release")
        .profile("Release");
    if apple {
        cfg.define("GGML_METAL", "ON").define("GGML_METAL_EMBED_LIBRARY", "ON");
        cfg.define("GGML_BLAS", if ios { "OFF" } else { "ON" });
    } else {
        cfg.define("GGML_METAL", "OFF");
    }
    if ios {
        cfg.define("CMAKE_SYSTEM_NAME", "iOS");
        if target.contains("sim") || target.starts_with("x86_64") {
            cfg.define("CMAKE_OSX_SYSROOT", "iphonesimulator");
        } else {
            cfg.define("CMAKE_OSX_SYSROOT", "iphoneos");
        }
        cfg.define("CMAKE_OSX_ARCHITECTURES", if target.starts_with("x86_64") { "x86_64" } else { "arm64" });
        // keep llama.cpp and the final Rust link on the same minimum iOS (Tauri sets IPHONEOS_DEPLOYMENT_TARGET)
        println!("cargo:rerun-if-env-changed=IPHONEOS_DEPLOYMENT_TARGET");
        cfg.define("CMAKE_OSX_DEPLOYMENT_TARGET", env::var("IPHONEOS_DEPLOYMENT_TARGET").unwrap_or_else(|_| "16.4".into()));
    }
    if android {
        let ndk = env::var("ANDROID_NDK_HOME").or_else(|_| env::var("ANDROID_NDK_ROOT")).or_else(|_| env::var("NDK_HOME"))
            .expect("Android build: set ANDROID_NDK_HOME");
        let abi = match target.split('-').next().unwrap() {
            "aarch64" => "arm64-v8a",
            "armv7" => "armeabi-v7a",
            "x86_64" => "x86_64",
            "i686" => "x86",
            other => panic!("unsupported Android arch {other}"),
        };
        cfg.define("CMAKE_TOOLCHAIN_FILE", format!("{ndk}/build/cmake/android.toolchain.cmake"))
            .define("ANDROID_ABI", abi)
            .define("ANDROID_PLATFORM", format!("android-{}", android_api()))
            .define("ANDROID_STL", "c++_static");
        if abi == "arm64-v8a" && !cfg!(feature = "native") {
            // dotprod: every arm64 phone core since Cortex-A55/A75 (2017-18); big speed-up for Q8_0/Q4
            cfg.define("GGML_CPU_ARM_ARCH", "armv8.2-a+dotprod");
        }
    }
    if cfg!(feature = "vulkan") {
        cfg.define("GGML_VULKAN", "ON");
    }
    if cfg!(feature = "cuda") {
        cfg.define("GGML_CUDA", "ON");
    }
    if msvc {
        cfg.static_crt(false);
    }
    let dst = cfg.build();

    for sub in ["lib", "lib64"] {
        if dst.join(sub).exists() {
            println!("cargo:rustc-link-search=native={}", dst.join(sub).display());
        }
    }
    let mut libs = vec!["mtmd", "llama", "ggml", "ggml-base", "ggml-cpu"];
    if apple {
        libs.push("ggml-metal");
        if !ios {
            libs.push("ggml-blas");
        }
    }
    if cfg!(feature = "vulkan") {
        libs.push("ggml-vulkan");
    }
    if cfg!(feature = "cuda") {
        libs.push("ggml-cuda");
    }
    for l in &libs {
        println!("cargo:rustc-link-lib=static={l}");
    }
    // small vendored libraries mtmd links privately (vendor/hash, …): not installed by CMake
    let vendor = dst.join("build").join("vendor");
    if let Ok(rd) = std::fs::read_dir(&vendor) {
        for d in rd.flatten() {
            let dir = d.path();
            for cand in [dir.clone(), dir.join("Release")] {
                if let Ok(files) = std::fs::read_dir(&cand) {
                    for f in files.flatten() {
                        let name = f.file_name().to_string_lossy().to_string();
                        let lib = name.strip_prefix("lib").and_then(|n| n.strip_suffix(".a")).map(str::to_string)
                            .or_else(|| if msvc { name.strip_suffix(".lib").map(str::to_string) } else { None });
                        if let Some(lib) = lib {
                            println!("cargo:rustc-link-search=native={}", cand.display());
                            println!("cargo:rustc-link-lib=static={lib}");
                        }
                    }
                }
            }
        }
    }
    if apple {
        // Accelerate (vDSP) is used by ggml-cpu on every Apple platform, iOS included
        for fw in ["Foundation", "Metal", "MetalKit", "Accelerate"] {
            println!("cargo:rustc-link-lib=framework={fw}");
        }
        println!("cargo:rustc-link-lib=dylib=c++");
    } else if android {
        let ndk = env::var("ANDROID_NDK_HOME").or_else(|_| env::var("ANDROID_NDK_ROOT")).or_else(|_| env::var("NDK_HOME")).unwrap();
        let triple = match target.split('-').next().unwrap() {
            "aarch64" => "aarch64-linux-android",
            "armv7" => "arm-linux-androideabi",
            "x86_64" => "x86_64-linux-android",
            _ => "i686-linux-android",
        };
        // only the two C++ runtime archives: the generic sysroot dir also holds a static libc.a,
        // which the linker would prefer over the API-level libc.so (and the binary then crashes)
        if let Some(host) = std::fs::read_dir(PathBuf::from(&ndk).join("toolchains/llvm/prebuilt")).ok().and_then(|mut d| d.next()).and_then(|e| e.ok()) {
            let src = host.path().join("sysroot/usr/lib").join(triple);
            let dir = PathBuf::from(env::var("OUT_DIR").unwrap()).join("ndk-cxx");
            std::fs::create_dir_all(&dir).unwrap();
            for lib in ["libc++_static.a", "libc++abi.a"] {
                std::fs::copy(src.join(lib), dir.join(lib)).expect("copy NDK C++ runtime");
            }
            println!("cargo:rustc-link-search=native={}", dir.display());
        }
        println!("cargo:rustc-link-lib=static=c++_static");
        println!("cargo:rustc-link-lib=static=c++abi");
        println!("cargo:rustc-link-lib=dylib=log");
    } else if windows {
        // MSVC links its C++ runtime automatically
    } else {
        println!("cargo:rustc-link-lib=dylib=stdc++");
    }
    if cfg!(feature = "openmp") && !apple && !windows {
        println!("cargo:rustc-link-lib=dylib=gomp");
    }
    if cfg!(feature = "vulkan") {
        println!("cargo:rustc-link-lib=dylib={}", if windows { "vulkan-1" } else { "vulkan" });
        if let Ok(sdk) = env::var("VULKAN_SDK") {
            println!("cargo:rustc-link-search=native={sdk}/{}", if windows { "Lib" } else { "lib" });
        }
    }
    if cfg!(feature = "cuda") {
        if let Ok(cuda) = env::var("CUDA_PATH").or_else(|_| env::var("CUDA_HOME")) {
            println!("cargo:rustc-link-search=native={cuda}/{}", if windows { "lib/x64" } else { "lib64" });
        }
        for l in ["cudart", "cublas", "cublasLt", "cuda"] {
            println!("cargo:rustc-link-lib=dylib={l}");
        }
    }

    // bindings
    let mut b = bindgen::Builder::default()
        .header(src.join("include/llama.h").to_string_lossy())
        .header(src.join("tools/mtmd/mtmd.h").to_string_lossy())
        .header(src.join("tools/mtmd/mtmd-helper.h").to_string_lossy())
        .clang_arg(format!("-I{}", src.join("include").display()))
        .clang_arg(format!("-I{}", src.join("ggml/include").display()))
        .clang_arg(format!("-I{}", src.join("tools/mtmd").display()))
        .allowlist_function("llama_.*")
        .allowlist_function("mtmd_.*")
        .allowlist_function("ggml_backend_(load_all|dev_count|dev_get|dev_name|dev_description|dev_type)")
        .allowlist_function("ggml_log_.*")
        .allowlist_type("llama_.*")
        .allowlist_type("mtmd_.*")
        .allowlist_var("LLAMA_.*")
        .prepend_enum_name(false)
        .derive_default(true)
        .layout_tests(false);
    if ios {
        // bindgen parses with the host clang; point it at the target triple
        b = b.clang_arg(format!("--target={}", target.replace("aarch64-apple-ios-sim", "arm64-apple-ios-simulator")));
    }
    if android {
        // NDK r30+ headers refuse unversioned triples: use the same API level as the CMake build
        let t = target.replace("armv7-linux-androideabi", "armv7a-linux-androideabi");
        b = b.clang_arg(format!("--target={t}{}", android_api()));
    }
    if android {
        // ...and at the NDK sysroot, or it picks up the host's libc headers
        let ndk = env::var("ANDROID_NDK_HOME").or_else(|_| env::var("ANDROID_NDK_ROOT")).or_else(|_| env::var("NDK_HOME")).unwrap();
        let prebuilt = PathBuf::from(&ndk).join("toolchains/llvm/prebuilt");
        let host = std::fs::read_dir(&prebuilt).ok().and_then(|mut d| d.next()).and_then(|e| e.ok()).map(|e| e.path())
            .expect("NDK toolchains/llvm/prebuilt/<host> not found");
        b = b.clang_arg(format!("--sysroot={}", host.join("sysroot").display()));
    }
    let bindings = b.generate().expect("bindgen llama.cpp");
    let out = PathBuf::from(env::var("OUT_DIR").unwrap());
    bindings.write_to_file(out.join("bindings.rs")).unwrap();
    println!("cargo:rustc-env=SPDF_LLAMA_COMMIT={LLAMA_COMMIT}");
    println!("cargo:rerun-if-changed=build.rs");
}
