//! onnxruntime (Rust `ort`) engine for the SPDF models bench.
//!
//! spdf-bench-ort <onnx dir> <dtype suffix: "" | _quantized | _q4> <inputs dir> [--threads N]
//!
//! Reads the tensors that `ort_py.py --dump-inputs` wrote (reference preprocessing), runs the
//! three graphs (text model, vision encoder, audio encoder) and prints one JSON line per item:
//! {"mod","id","cls","ms","ms_model","vec"}. Load time is reported on the first line.

use std::{collections::BTreeMap, fs::File, path::PathBuf, time::Instant};

use anyhow::{Context, Result};
use ndarray::{Array2, ArrayD};
use ndarray_npy::NpzReader;
use ort::{
    session::{builder::GraphOptimizationLevel, Session},
    value::Tensor,
};

fn session(path: PathBuf, threads: usize) -> Result<Session> {
    let e = |e: ort::Error<ort::session::builder::SessionBuilder>| anyhow::anyhow!(e.to_string());
    let mut b = Session::builder()?.with_optimization_level(GraphOptimizationLevel::Level3).map_err(e)?;
    if threads > 0 {
        b = b.with_intra_threads(threads).map_err(e)?;
    }
    b.commit_from_file(&path).with_context(|| format!("loading {}", path.display()))
}

fn main() -> Result<()> {
    let args: Vec<String> = std::env::args().collect();
    let onnx = PathBuf::from(&args[1]);
    let sfx = args[2].clone();
    let inputs = PathBuf::from(&args[3]);
    let threads = args.iter().position(|a| a == "--threads").map(|i| args[i + 1].parse().unwrap()).unwrap_or(0);

    let t0 = Instant::now();
    let mut text = session(onnx.join(format!("model{sfx}.onnx")), threads)?;
    let mut vision = session(onnx.join(format!("vision_encoder{sfx}.onnx")), threads)?;
    let mut audio = session(onnx.join(format!("audio_encoder{sfx}.onnx")), threads)?;
    println!("{}", serde_json::json!({"load_ms": t0.elapsed().as_secs_f64() * 1000.0}));

    let mut files: Vec<PathBuf> = std::fs::read_dir(&inputs)?.filter_map(|e| e.ok().map(|e| e.path())).collect();
    files.sort();
    // modality order: text, image, audio; warm-up on the first of each
    let order = |p: &PathBuf| {
        let n = p.file_name().unwrap().to_string_lossy().to_string();
        (if n.starts_with("text__") { 0 } else if n.starts_with("image__") { 1 } else { 2 }, n)
    };
    files.sort_by_key(order);
    let mut warmed = BTreeMap::new();
    for f in &files {
        let name = f.file_stem().unwrap().to_string_lossy().to_string();
        let (modality, id) = name.split_once("__").unwrap();
        let mut npz = NpzReader::new(File::open(f)?)?;
        let get_i64 = |npz: &mut NpzReader<File>, k: &str| -> Result<ArrayD<i64>> { Ok(npz.by_name(&format!("{k}.npy"))?) };
        let ids = get_i64(&mut npz, "input_ids")?;
        let mask = get_i64(&mut npz, "attention_mask")?;
        let mut run = || -> Result<(Vec<f32>, f64)> {
            let t = Instant::now();
            let empty = || Tensor::from_array(Array2::<f32>::zeros((0, 512)));
            let (img, aud) = match modality {
                "image" => {
                    let pv: ArrayD<f32> = npz.by_name("pixel_values.npy")?;
                    let pp: ArrayD<i64> = npz.by_name("pixel_position_ids.npy")?;
                    let out = vision.run(ort::inputs!["pixel_values" => Tensor::from_array(pv)?, "pixel_position_ids" => Tensor::from_array(pp)?])?;
                    let f = out[0].try_extract_array::<f32>()?.to_owned();
                    (Some(f), None)
                }
                "audio" => {
                    let feats: ArrayD<f32> = npz.by_name("input_features.npy")?;
                    let m: ArrayD<bool> = npz.by_name("input_features_mask.npy")?;
                    let out = audio.run(ort::inputs!["input_features" => Tensor::from_array(feats)?, "input_features_mask" => Tensor::from_array(m)?])?;
                    let f = out[0].try_extract_array::<f32>()?.to_owned();
                    (None, Some(f))
                }
                _ => (None, None),
            };
            let img_t: Tensor<f32> = match img { Some(f) => Tensor::from_array(f)?, None => empty()? };
            let aud_t: Tensor<f32> = match aud { Some(f) => Tensor::from_array(f)?, None => empty()? };
            let out = text.run(ort::inputs![
                "input_ids" => Tensor::from_array(ids.clone())?,
                "attention_mask" => Tensor::from_array(mask.clone())?,
                "image_features" => img_t,
                "video_features" => empty()?,
                "audio_features" => aud_t,
            ])?;
            let v = out["sentence_embedding"].try_extract_array::<f32>()?;
            let vec: Vec<f32> = v.iter().copied().collect();
            Ok((vec, t.elapsed().as_secs_f64() * 1000.0))
        };
        if !warmed.contains_key(modality) {
            run()?;
            warmed.insert(modality.to_string(), true);
        }
        let (vec, ms) = run()?;
        println!("{}", serde_json::json!({"mod": modality, "id": id, "ms": ms, "ms_model": ms, "vec": vec}));
    }
    Ok(())
}
