//! End to end, as an app uses the crate: catalog, recommendation, verified resumable downloads,
//! embeddings (text, image, audio, Matryoshka), streamed generation and the judge.
//!
//!   cargo run --release -p spdf-infer --example e2e -- --root DIR [--media DIR] [--cpu] [--skip-gen]
//!       [--embed ID] [--gen ID] [--valen-dir DIR]
//!
//! Prints one JSON line per step. SPDF_MODELS_MIRROR can point the downloads at a mirror.

use std::{path::PathBuf, sync::Arc, time::Instant};

use serde_json::json;
use spdf_infer::{
    compat, Embed, Embedder, EmbedderOptions, GenOptions, GenParams, Generator, Judge, Kind, ModelManager, Platform, Task,
};

fn arg(name: &str) -> Option<String> {
    let a: Vec<String> = std::env::args().collect();
    a.iter().position(|x| x == name).and_then(|i| a.get(i + 1).cloned())
}
fn flag(name: &str) -> bool {
    std::env::args().any(|x| x == name)
}

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let root = PathBuf::from(arg("--root").unwrap_or_else(|| "spdf-models-e2e".into()));
    let gpu = !flag("--cpu");
    let mm = ModelManager::new(&root)?;
    let step = |name: &str, t: Instant, extra: serde_json::Value| {
        println!("{}", json!({"step": name, "ms": (t.elapsed().as_secs_f64() * 1000.0).round(), "info": extra}));
    };
    println!("{}", json!({"platform": Platform::current(), "memory_gb": spdf_infer::manager::total_memory() >> 30,
        "llama_cpp": spdf_infer::LLAMA_CPP_COMMIT,
        "recommended": {"embed": mm.recommend(Kind::Embed).map(|e| e.id), "generate": mm.recommend(Kind::Generate).map(|e| e.id),
                        "judge": mm.recommend(Kind::Judge).map(|e| e.id)}}));

    // ---- embeddings
    let embed_id = arg("--embed").unwrap_or_else(|| "embeddinggemma-2-gguf-q8_0".into());
    let t = Instant::now();
    let mut last = 0u64;
    mm.download(&embed_id, |p| {
        if p.overall_done - last > 200_000_000 || p.overall_done == p.overall_total {
            last = p.overall_done;
            eprintln!("  {} {}/{} MB", p.id, p.overall_done >> 20, p.overall_total >> 20);
        }
    })?;
    step("download embed", t, json!({"id": embed_id, "verified": mm.is_downloaded(&embed_id)}));
    let t = Instant::now();
    let e = Embedder::load(&mm, &embed_id, EmbedderOptions { gpu, ..Default::default() })?;
    step("Embedder::load", t, json!({"modalities": e.modalities()}));
    let t = Instant::now();
    let q = e.embed(&["¿Quién es Dulcinea del Toboso?"], Task::Query, None)?.remove(0);
    let docs = e.embed(&["Dulcinea del Toboso es la dama imaginaria de don Quijote.", "La fotosíntesis transforma la luz en energía química."],
        Task::Document { title: None }, None)?;
    let dot = |a: &[f32], b: &[f32]| a.iter().zip(b).map(|(x, y)| x * y).sum::<f32>();
    step("embed text", t, json!({"dims": q.len(), "scores": [dot(&q, &docs[0]), dot(&q, &docs[1])], "space": e.space(None)}));
    let q256 = e.embed(&["¿Quién es Dulcinea del Toboso?"], Task::Query, Some(256))?.remove(0);
    let sp = e.space(Some(256));
    println!("{}", json!({"step": "MRL 256", "dims": q256.len(), "space": sp.id, "compatible_with_768": compat::is_compatible(&sp, &e.space(None))}));
    if let Some(media) = arg("--media").map(PathBuf::from) {
        if e.modalities().contains(&"image".to_string()) {
            let t = Instant::now();
            let v = e.embed_image(&std::fs::read(media.join("images/aic-61603.jpg"))?, None)?;
            step("embed image", t, json!({"dims": v.len()}));
            let t = Instant::now();
            let a = e.embed_audio_file(&std::fs::read(media.join("audio/don_quijote_vol1_0706_librivox-0.wav"))?, None)?;
            step("embed audio (10 s WAV)", t, json!({"dims": a.len()}));
        }
    }
    drop(e);

    // ---- generation and judge (Gemma 4)
    if !flag("--skip-gen") {
        let gen_id = arg("--gen").unwrap_or_else(|| "gemma-4-e2b-it-gguf-q4_k_m".into());
        let t = Instant::now();
        mm.download(&gen_id, |_| {})?;
        step("download generate", t, json!({"id": gen_id, "verified": mm.is_downloaded(&gen_id)}));
        let t = Instant::now();
        let g = Arc::new(Generator::load(&mm, &gen_id, GenOptions { gpu, n_ctx: 4096, ..Default::default() })?);
        step("Generator::load", t, json!({}));
        let t = Instant::now();
        let mut chunks = 0;
        let s = g.generate("¿Quién escribió el Quijote? Responde en una frase.", &GenParams { max_tokens: 60, temperature: 0.0, ..Default::default() },
            |_| {
                chunks += 1;
                true
            })?;
        step("generate (streamed)", t, json!({"text": s.text, "chunks": chunks, "tokens": s.generated_tokens, "tok_s": s.tokens_per_s,
            "prompt_tok_s": s.prompt_tokens_per_s}));
        let j = Judge::new(g.clone())?.calibrated_for(mm.entry(&gen_id).unwrap());
        let t = Instant::now();
        let sup = j.support("Cervantes llama Rocinante al caballo de don Quijote.",
            "…y así, después de muchos nombres que formó, borró y quitó, al fin le vino a llamar Rocinante, nombre a su parecer alto, sonoro y significativo.")?;
        step("judge support (Gemma 4)", t, json!({"label": sup.label, "supported": sup.supported}));
        let t = Instant::now();
        let rel = j.relevance("el caballo de don Quijote", "…al fin le vino a llamar Rocinante…")?;
        step("judge relevance (Gemma 4)", t, json!({"relevance": rel}));
    }

    // ---- Valen (feature valen-onnx; files built locally until they are published)
    #[cfg(feature = "valen-onnx")]
    if let Some(dir) = arg("--valen-dir") {
        let t = Instant::now();
        mm.import_local("valen-0.8b-onnx-int8", std::path::Path::new(&dir))?;
        step("import_local valen", t, json!({"verified": mm.is_downloaded("valen-0.8b-onnx-int8")}));
        let t = Instant::now();
        let j = Judge::load(&mm, "valen-0.8b-onnx-int8")?;
        step("Judge::load (Valen)", t, json!({"engine": j.engine_name()}));
        let t = Instant::now();
        let sup = j.support("Cervantes llama Rocinante al caballo de don Quijote.",
            "…y así, después de muchos nombres que formó, borró y quitó, al fin le vino a llamar Rocinante, nombre a su parecer alto, sonoro y significativo.")?;
        step("judge support (Valen)", t, json!({"label": sup.label, "supported": sup.supported}));
    }
    println!("{}", json!({"done": true}));
    Ok(())
}
