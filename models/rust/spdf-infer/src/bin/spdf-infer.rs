//! `spdf-infer` command line: catalog, downloads, and the bench/eval entry points.
//!
//!   spdf-infer catalog
//!   spdf-infer download <id> [--root DIR]
//!   spdf-infer embed --model M.gguf [--mmproj P.gguf] (--text T [--task query|document] | --image F | --audio F) [--dims N]
//!   spdf-infer bench-embed --model M.gguf [--mmproj P.gguf] --corpus DIR --media DIR [--cpu]
//!   spdf-infer generate --model M.gguf --prompt P [--max-tokens N] [--temp T]
//!   spdf-infer bench-gen --model M.gguf [--prompt-tokens N] [--gen-tokens N] [--cpu]
//!   spdf-infer judge --model M.gguf --claim C --passage P
//!   spdf-infer judge-eval --model M.gguf --input pairs.jsonl     (one JSON per line, see models/bench/judges)
//!
//! Bench subcommands print one JSON object per line on stdout.

use std::{
    collections::HashMap,
    io::{BufRead, Write},
    path::PathBuf,
    sync::Arc,
    time::Instant,
};

use serde_json::{json, Value};
use spdf_infer::{
    judge::SourceInfo, Embed, Embedder, EmbedderOptions, GenOptions, GenParams, Generator, Judge, ModelManager, Task,
};

fn args() -> (String, HashMap<String, String>, Vec<String>) {
    let mut it = std::env::args().skip(1);
    let cmd = it.next().unwrap_or_default();
    let mut kv = HashMap::new();
    let mut pos = vec![];
    let rest: Vec<String> = it.collect();
    let mut i = 0;
    while i < rest.len() {
        if let Some(k) = rest[i].strip_prefix("--") {
            if i + 1 < rest.len() && !rest[i + 1].starts_with("--") {
                kv.insert(k.to_string(), rest[i + 1].clone());
                i += 2;
            } else {
                kv.insert(k.to_string(), "true".into());
                i += 1;
            }
        } else {
            pos.push(rest[i].clone());
            i += 1;
        }
    }
    (cmd, kv, pos)
}

fn default_root() -> PathBuf {
    std::env::var_os("SPDF_MODELS_DIR")
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from(std::env::var_os("HOME").unwrap_or_default()).join(".cache/spdf-models/store"))
}

fn task_of(s: Option<&String>) -> Task {
    match s.map(|s| s.as_str()) {
        Some("query") => Task::Query,
        Some("raw") => Task::Raw,
        Some("fact") => Task::FactChecking,
        Some("qa") => Task::QuestionAnswering,
        Some("similarity") => Task::Similarity,
        _ => Task::Document { title: None },
    }
}

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let (cmd, kv, pos) = args();
    let gpu = !kv.contains_key("cpu");
    match cmd.as_str() {
        "catalog" => {
            let mm = ModelManager::new(kv.get("root").map(PathBuf::from).unwrap_or_else(default_root))?;
            println!("{}", serde_json::to_string_pretty(mm.catalog_all())?);
        }
        "download" => {
            let mm = ModelManager::new(kv.get("root").map(PathBuf::from).unwrap_or_else(default_root))?;
            let id = pos.first().ok_or("download <id>")?;
            let p = mm.download(id, |p| {
                eprint!("\r{} {} {:.1}/{:.1} MB   ", p.id, p.file, p.overall_done as f64 / 1e6, p.overall_total as f64 / 1e6);
            })?;
            eprintln!();
            println!("{}", p.display());
        }
        "embed" => {
            let e = Embedder::from_files(
                &PathBuf::from(&kv["model"]),
                kv.get("mmproj").map(PathBuf::from).as_deref(),
                EmbedderOptions { gpu, multimodal: kv.contains_key("mmproj"), ..Default::default() },
            )?;
            let dims = kv.get("dims").map(|d| d.parse()).transpose()?;
            let v = if let Some(t) = kv.get("text") {
                e.embed(&[t.as_str()], task_of(kv.get("task")), dims)?.remove(0)
            } else if let Some(f) = kv.get("image") {
                e.embed_image(&std::fs::read(f)?, dims)?
            } else if let Some(f) = kv.get("audio") {
                e.embed_audio_file(&std::fs::read(f)?, dims)?
            } else {
                return Err("--text, --image or --audio".into());
            };
            println!("{}", json!({"space": e.space(dims), "vec": v}));
        }
        "bench-embed" => {
            let corpus = PathBuf::from(&kv["corpus"]);
            let media = PathBuf::from(&kv["media"]);
            let t0 = Instant::now();
            let e = Embedder::from_files(
                &PathBuf::from(&kv["model"]),
                kv.get("mmproj").map(PathBuf::from).as_deref(),
                EmbedderOptions { gpu, multimodal: kv.contains_key("mmproj"), max_tokens: 2048, ..Default::default() },
            )?;
            println!("{}", json!({"load_ms": t0.elapsed().as_secs_f64() * 1000.0, "llama_cpp": spdf_infer::LLAMA_CPP_COMMIT}));
            let out = std::io::stdout();
            let mut out = out.lock();
            let texts = std::fs::read_to_string(corpus.join("texts.jsonl"))?;
            let items: Vec<Value> = texts.lines().filter(|l| !l.trim().is_empty()).map(serde_json::from_str).collect::<Result<_, _>>()?;
            let embed_text = |it: &Value| {
                let task = if it["kind"] == "query" { Task::Query } else { Task::Document { title: None } };
                e.embed(&[it["text"].as_str().unwrap()], task, None).map(|mut v| v.remove(0))
            };
            if let Some(first) = items.first() {
                embed_text(first)?;
            }
            for it in &items {
                let t = Instant::now();
                let v = embed_text(it)?;
                let ms = t.elapsed().as_secs_f64() * 1000.0;
                writeln!(out, "{}", json!({"mod": "text", "id": it["id"], "cls": format!("text_{}", it["length"].as_str().unwrap()), "ms": ms, "ms_model": ms, "vec": v}))?;
            }
            if kv.contains_key("mmproj") {
                let imgs: Vec<Value> = serde_json::from_str(&std::fs::read_to_string(corpus.join("images.json"))?)?;
                let mut warm = true;
                for it in &imgs {
                    let bytes = std::fs::read(media.join("images").join(it["file"].as_str().unwrap()))?;
                    if warm {
                        e.embed_image(&bytes, None)?;
                        warm = false;
                    }
                    let t = Instant::now();
                    let v = e.embed_image(&bytes, None)?;
                    let ms = t.elapsed().as_secs_f64() * 1000.0;
                    writeln!(out, "{}", json!({"mod": "image", "id": it["id"], "cls": "image", "ms": ms, "ms_model": ms, "vec": v}))?;
                }
                let auds: Vec<Value> = serde_json::from_str(&std::fs::read_to_string(corpus.join("audio.json"))?)?;
                let mut warm = true;
                for it in &auds {
                    let bytes = std::fs::read(media.join("audio").join(it["file"].as_str().unwrap()))?;
                    if warm {
                        e.embed_audio_file(&bytes, None)?;
                        warm = false;
                    }
                    let t = Instant::now();
                    let v = e.embed_audio_file(&bytes, None)?;
                    let ms = t.elapsed().as_secs_f64() * 1000.0;
                    writeln!(out, "{}", json!({"mod": "audio", "id": it["id"], "cls": "audio_10s", "ms": ms, "ms_model": ms, "vec": v}))?;
                }
            }
            writeln!(out, "{}", json!({"done": true}))?;
        }
        "generate" => {
            let g = Generator::from_file(&PathBuf::from(&kv["model"]), GenOptions { gpu, ..Default::default() })?;
            let params = GenParams {
                max_tokens: kv.get("max-tokens").map(|s| s.parse()).transpose()?.unwrap_or(256),
                temperature: kv.get("temp").map(|s| s.parse()).transpose()?.unwrap_or(1.0),
                ..Default::default()
            };
            let stats = g.generate(&kv["prompt"], &params, |t| {
                print!("{t}");
                std::io::stdout().flush().ok();
                true
            })?;
            println!();
            eprintln!("{}", json!({"prompt_tokens": stats.prompt_tokens, "generated_tokens": stats.generated_tokens,
                "tokens_per_s": stats.tokens_per_s, "prompt_tokens_per_s": stats.prompt_tokens_per_s, "stop": stats.stop_reason}));
        }
        "bench-gen" => {
            let t0 = Instant::now();
            let n_prompt: usize = kv.get("prompt-tokens").map(|s| s.parse()).transpose()?.unwrap_or(512);
            let n_gen: u32 = kv.get("gen-tokens").map(|s| s.parse()).transpose()?.unwrap_or(256);
            let g = Generator::from_file(&PathBuf::from(&kv["model"]), GenOptions { gpu, n_ctx: 4096, ..Default::default() })?;
            println!("{}", json!({"load_ms": t0.elapsed().as_secs_f64() * 1000.0}));
            // a public-domain prompt of the requested size (Cervantes), then a fixed instruction
            let base = "En un lugar de la Mancha, de cuyo nombre no quiero acordarme, no ha mucho tiempo que vivía un hidalgo de los de lanza en astillero, adarga antigua, rocín flaco y galgo corredor. ";
            let mut text = String::new();
            while g.tokenize_prompt(&text)?.len() < n_prompt.saturating_sub(40) {
                text.push_str(base);
            }
            let prompt = format!("{text}\n\nWrite a long, detailed essay in English about the passage above.");
            for run in 0..3 {
                let params = GenParams { max_tokens: n_gen, temperature: 0.0, stop: vec![], ..Default::default() };
                // a fresh prompt each run (different suffix) so the prefix cache does not hide prompt processing
                let p = format!("{prompt} (run {run})");
                let s = g.generate(&p, &params, |_| true)?;
                println!("{}", json!({"run": run, "prompt_tokens": s.prompt_tokens, "generated_tokens": s.generated_tokens,
                    "prompt_ms": s.prompt_ms, "gen_ms": s.gen_ms, "pp_tok_s": s.prompt_tokens_per_s, "tg_tok_s": s.tokens_per_s, "stop": s.stop_reason}));
                // clear the cache between runs
                g.generate("x", &GenParams { max_tokens: 1, temperature: 0.0, ..Default::default() }, |_| true)?;
            }
        }
        "judge" => {
            let g = Arc::new(Generator::from_file(&PathBuf::from(&kv["model"]), GenOptions { gpu, ..Default::default() })?);
            let j = Judge::new(g)?;
            let s = j.support(&kv["claim"], &kv["passage"])?;
            println!("{}", serde_json::to_string_pretty(&s)?);
        }
        "judge-eval" => {
            // input lines: {"id","kind":"support"|"relevance","claim"|"query","passage","source":{…}}
            // output: raw option logits per question (calibration is fitted offline), plus the
            // content-free logits once (for prior correction).
            use spdf_infer::judge::{relation_labels, relevance_labels, support_labels, RELATION_TASK, RELEVANCE_TASK, SUPPORT_TASK};
            let g = Arc::new(Generator::from_file(&PathBuf::from(&kv["model"]), GenOptions { gpu, n_ctx: 8192, ..Default::default() })?);
            let j = Judge::new(g)?;
            let out = std::io::stdout();
            let mut out = out.lock();
            writeln!(out, "{}", json!({"priors": {
                "support": j.option_logits(SUPPORT_TASK, "N/A", &support_labels())?,
                "relation": j.option_logits(RELATION_TASK, "N/A", &relation_labels())?,
                "relevance": j.option_logits(RELEVANCE_TASK, "N/A", &relevance_labels())?}}))?;
            let f = std::fs::File::open(&kv["input"])?;
            for line in std::io::BufReader::new(f).lines() {
                let line = line?;
                if line.trim().is_empty() {
                    continue;
                }
                let it: Value = serde_json::from_str(&line)?;
                let t = Instant::now();
                let r = if it["kind"] == "relevance" {
                    let c = Judge::relevance_content(it["query"].as_str().unwrap(), it["passage"].as_str().unwrap());
                    json!({"relevance_logits": j.option_logits(RELEVANCE_TASK, &c, &relevance_labels())?})
                } else {
                    let src: Option<SourceInfo> = serde_json::from_value(it["source"].clone()).ok();
                    let c = Judge::pair_content(it["claim"].as_str().unwrap(), it["passage"].as_str().unwrap(), src.as_ref());
                    json!({"support_logits": j.option_logits(SUPPORT_TASK, &c, &support_labels())?,
                           "relation_logits": j.option_logits(RELATION_TASK, &c, &relation_labels())?})
                };
                writeln!(out, "{}", json!({"id": it["id"], "ms": t.elapsed().as_secs_f64() * 1000.0, "result": r}))?;
                out.flush()?;
            }
        }
        _ => {
            eprintln!("usage: spdf-infer catalog | download <id> | embed | bench-embed | generate | bench-gen | judge | judge-eval");
            std::process::exit(2);
        }
    }
    Ok(())
}
