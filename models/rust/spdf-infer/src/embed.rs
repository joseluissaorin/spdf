//! Embeddings with EmbeddingGemma 2 (text, image, audio) on llama.cpp, plus a fake embedder for tests.

use std::{
    collections::BTreeMap,
    path::{Path, PathBuf},
    sync::{Arc, Mutex},
};

use serde::{Deserialize, Serialize};

use crate::{
    image as img,
    llama::{Context, ContextParams, Entry, Model},
    manager::ModelManager,
    mtmd::{Mtmd, Piece},
    Error, Result,
};

/// What the text is for. EmbeddingGemma 2 is trained with these instruction prefixes.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Task {
    /// Search query (asymmetric retrieval). Prefix `task: search result | query: `.
    Query,
    /// Corpus passage. Prefix `title: {title or none} | text: `.
    Document { title: Option<String> },
    QuestionAnswering,
    FactChecking,
    Classification,
    Clustering,
    Similarity,
    CodeRetrieval,
    /// No prefix (the caller already formatted the text).
    Raw,
}

impl Task {
    pub fn prefix(&self) -> String {
        match self {
            Task::Query => "task: search result | query: ".into(),
            Task::Document { title } => format!("title: {} | text: ", title.as_deref().filter(|t| !t.trim().is_empty()).unwrap_or("none")),
            Task::QuestionAnswering => "task: question answering | query: ".into(),
            Task::FactChecking => "task: fact checking | query: ".into(),
            Task::Classification => "task: classification | query: ".into(),
            Task::Clustering => "task: clustering | query: ".into(),
            Task::Similarity => "task: sentence similarity | query: ".into(),
            Task::CodeRetrieval => "task: code retrieval | query: ".into(),
            Task::Raw => String::new(),
        }
    }
    pub fn apply(&self, text: &str) -> String {
        format!("{}{}", self.prefix(), text)
    }
}

/// Canonical `task_prefixes` of an EmbeddingGemma 2 retrieval space (see models/COMPATIBILIDAD.md).
pub fn embeddinggemma2_task_prefixes() -> BTreeMap<String, String> {
    BTreeMap::from([
        ("document".to_string(), "title: {title} | text: ".to_string()),
        ("query".to_string(), "task: search result | query: ".to_string()),
    ])
}

/// A row of the SPDF `spaces` table (column names of the contract).
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct Space {
    pub id: String,
    pub provider: String,
    pub model: String,
    pub version: Option<String>,
    pub dims: usize,
    pub dtype: String,
    pub normalized: bool,
    pub truncated_from: Option<usize>,
    pub modalities: Vec<String>,
    pub task_prefixes: Option<BTreeMap<String, String>>,
}

impl Space {
    /// Same space with another storage dtype (`f32`, `f16`, `i8`): id gets the `:<dtype>` suffix.
    pub fn with_dtype(mut self, dtype: &str) -> Self {
        let base = self.id.split(':').next().unwrap_or(&self.id).to_string();
        self.id = if dtype == "f32" { base } else { format!("{base}:{dtype}") };
        self.dtype = dtype.into();
        self
    }
}

/// Anything that turns text into vectors of a declared space.
pub trait Embed: Send + Sync {
    /// L2-normalised vectors, truncated to `dims` (Matryoshka) and re-normalised if given.
    fn embed(&self, texts: &[&str], task: Task, dims: Option<usize>) -> Result<Vec<Vec<f32>>>;
    /// The space the vectors belong to, for `dims` (None = native).
    fn space(&self, dims: Option<usize>) -> Space;
}

/// Matryoshka truncation + L2 normalisation.
pub fn mrl(v: &[f32], dims: Option<usize>) -> Result<Vec<f32>> {
    let d = dims.unwrap_or(v.len());
    if d == 0 || d > v.len() {
        return Err(Error::Input(format!("dims {d} out of range (native {})", v.len())));
    }
    let mut out = v[..d].to_vec();
    let n = out.iter().map(|x| (*x as f64) * (*x as f64)).sum::<f64>().sqrt();
    if n > 0.0 {
        for x in &mut out {
            *x = (*x as f64 / n) as f32;
        }
    }
    Ok(out)
}

#[derive(Clone, Debug)]
pub struct EmbedderOptions {
    /// Offload to the GPU (Metal, Vulkan, CUDA) when the build has it.
    pub gpu: bool,
    /// Load the multimodal projector (image/audio). Text-only saves ~550 MB (Q8_0).
    pub multimodal: bool,
    /// Vision soft-token budget (70, 140, 280, 560, 1120). 280 = reference.
    pub image_tokens: u32,
    /// Maximum tokens per input (the model has 8K).
    pub max_tokens: u32,
    pub n_threads: Option<i32>,
    /// Space metadata written by `space()`.
    pub space_model: String,
    pub space_version: Option<String>,
}

impl Default for EmbedderOptions {
    fn default() -> Self {
        Self {
            gpu: true,
            multimodal: true,
            image_tokens: 280,
            max_tokens: 2048,
            n_threads: None,
            space_model: "embeddinggemma-2".into(),
            space_version: Some(crate::EMBEDDINGGEMMA2_VERSION.into()),
        }
    }
}

struct Inner {
    ctx: Context,
    mtmd: Option<Mtmd>,
}

/// EmbeddingGemma 2 on llama.cpp (GGUF + optional mmproj).
pub struct Embedder {
    inner: Mutex<Inner>,
    model: Arc<Model>,
    opts: EmbedderOptions,
    native_dims: usize,
    pub model_path: PathBuf,
}

impl Embedder {
    /// Loads a catalog entry (downloaded beforehand with `ModelManager::download`).
    pub fn load(mm: &ModelManager, id: &str, opts: EmbedderOptions) -> Result<Self> {
        let e = mm.entry(id).ok_or_else(|| Error::NotFound(id.into()))?;
        let model = mm.file_path(id, "model").ok_or_else(|| Error::NotDownloaded(id.into()))?;
        let mmproj = if opts.multimodal { mm.file_path(id, "mmproj") } else { None };
        if !mm.is_downloaded(id) {
            return Err(Error::NotDownloaded(id.into()));
        }
        let mut opts = opts;
        if let Some(v) = &e.space_version {
            opts.space_version = Some(v.clone());
        }
        Self::from_files(&model, mmproj.as_deref(), opts)
    }

    pub fn from_files(model_path: &Path, mmproj: Option<&Path>, opts: EmbedderOptions) -> Result<Self> {
        let model = Model::load(model_path, opts.gpu)?;
        let n = opts.max_tokens.max(512);
        let ctx = Context::new(model.clone(), &ContextParams {
            n_ctx: n,
            n_batch: n,
            n_ubatch: n, // non-causal attention: one input must fit in one micro-batch
            n_seq_max: 1,
            embeddings: true,
            pooling_mean: true,
            n_threads: opts.n_threads,
        })?;
        let mtmd = match mmproj {
            Some(p) if opts.multimodal => Some(Mtmd::load(p, &model, opts.gpu, opts.image_tokens as i32, opts.n_threads)?),
            _ => None,
        };
        let native_dims = model.n_embd_out();
        Ok(Self { inner: Mutex::new(Inner { ctx, mtmd }), model, opts, native_dims, model_path: model_path.to_path_buf() })
    }

    pub fn native_dims(&self) -> usize {
        self.native_dims
    }

    fn run_entries(inner: &mut Inner, entries: &[Entry<'_>]) -> Result<Vec<f32>> {
        if entries.len() > inner.ctx.n_ctx as usize {
            return Err(Error::Input(format!("input of {} tokens exceeds the context ({})", entries.len(), inner.ctx.n_ctx)));
        }
        inner.ctx.clear();
        inner.ctx.decode(entries, 0, 0, |_| true)?;
        inner.ctx.pooled_embedding(0)
    }

    fn embed_one(&self, text: &str) -> Result<Vec<f32>> {
        let mut toks = self.model.tokenize(text, true, false)?;
        let max = self.opts.max_tokens as usize;
        if toks.len() > max {
            // keep BOS … and the final EOS, like a truncating tokenizer would
            let eos = *toks.last().unwrap();
            toks.truncate(max - 1);
            toks.push(eos);
        }
        let entries: Vec<Entry> = toks.iter().map(|t| Entry::Token(*t)).collect();
        let mut inner = self.inner.lock().map_err(|_| Error::msg("poisoned lock"))?;
        Self::run_entries(&mut inner, &entries)
    }

    fn embed_pieces(&self, pieces: Vec<Piece>) -> Result<Vec<f32>> {
        let n_embd = self.model.n_embd_inp();
        let mut entries: Vec<Entry> = Vec::new();
        for p in &pieces {
            match p {
                Piece::Text(t) => entries.extend(t.iter().map(|t| Entry::Token(*t))),
                Piece::Media { rows, n_tokens } => {
                    for i in 0..*n_tokens {
                        entries.push(Entry::Embd(&rows[i * n_embd..(i + 1) * n_embd]));
                    }
                }
            }
        }
        let mut inner = self.inner.lock().map_err(|_| Error::msg("poisoned lock"))?;
        Self::run_entries(&mut inner, &entries)
    }

    /// Image file bytes (PNG, JPEG, WebP…). Resized like the reference processor first.
    pub fn embed_image(&self, bytes: &[u8], dims: Option<usize>) -> Result<Vec<f32>> {
        let decoded = img::decode(bytes)?;
        self.embed_image_rgb(&decoded, dims)
    }

    /// Decoded RGB8 image.
    pub fn embed_image_rgb(&self, image: &img::Rgb, dims: Option<usize>) -> Result<Vec<f32>> {
        let pre = img::preprocess(image, self.opts.image_tokens);
        let pieces = {
            let mut inner = self.inner.lock().map_err(|_| Error::msg("poisoned lock"))?;
            let m = inner.mtmd.as_mut().ok_or_else(|| Error::Unsupported("image input needs the mmproj (multimodal: true)".into()))?;
            m.image(pre.width, pre.height, &pre.data, self.model.n_embd_inp())?
        };
        mrl(&self.embed_pieces(pieces)?, dims)
    }

    /// Mono PCM at 16 kHz, f32 in [-1, 1].
    pub fn embed_audio(&self, pcm16k: &[f32], dims: Option<usize>) -> Result<Vec<f32>> {
        let pieces = {
            let mut inner = self.inner.lock().map_err(|_| Error::msg("poisoned lock"))?;
            let m = inner.mtmd.as_mut().ok_or_else(|| Error::Unsupported("audio input needs the mmproj (multimodal: true)".into()))?;
            m.audio_pcm(pcm16k, self.model.n_embd_inp())?
        };
        mrl(&self.embed_pieces(pieces)?, dims)
    }

    /// Audio file bytes (WAV, MP3, FLAC), decoded and resampled to 16 kHz by llama.cpp.
    pub fn embed_audio_file(&self, bytes: &[u8], dims: Option<usize>) -> Result<Vec<f32>> {
        let pieces = {
            let mut inner = self.inner.lock().map_err(|_| Error::msg("poisoned lock"))?;
            let m = inner.mtmd.as_mut().ok_or_else(|| Error::Unsupported("audio input needs the mmproj (multimodal: true)".into()))?;
            m.file_bytes(bytes, self.model.n_embd_inp())?
        };
        mrl(&self.embed_pieces(pieces)?, dims)
    }

    pub fn modalities(&self) -> Vec<String> {
        let inner = self.inner.lock().unwrap();
        let mut m = vec!["text".to_string()];
        if let Some(mt) = &inner.mtmd {
            if mt.supports_vision() {
                m.push("image".into());
            }
            if mt.supports_audio() {
                m.push("audio".into());
            }
        }
        m
    }
}

impl Embed for Embedder {
    fn embed(&self, texts: &[&str], task: Task, dims: Option<usize>) -> Result<Vec<Vec<f32>>> {
        texts.iter().map(|t| mrl(&self.embed_one(&task.apply(t))?, dims)).collect()
    }

    fn space(&self, dims: Option<usize>) -> Space {
        let d = dims.unwrap_or(self.native_dims);
        Space {
            id: format!("{}@{}", self.opts.space_model, d),
            provider: "google".into(),
            model: self.opts.space_model.clone(),
            version: self.opts.space_version.clone(),
            dims: d,
            dtype: "f32".into(),
            normalized: true,
            truncated_from: if d < self.native_dims { Some(self.native_dims) } else { None },
            modalities: self.modalities(),
            task_prefixes: Some(embeddinggemma2_task_prefixes()),
        }
    }
}

/// Deterministic, download-free embedder for end-to-end tests. Similar texts do NOT get similar
/// vectors: it only exercises plumbing (spaces, storage, search).
pub struct FakeEmbedder {
    pub dims: usize,
}

impl FakeEmbedder {
    pub fn new(dims: usize) -> Self {
        Self { dims }
    }
    fn vec_for(&self, s: &str) -> Vec<f32> {
        // FNV-1a seed, then splitmix64 stream
        let mut h: u64 = 0xcbf29ce484222325;
        for b in s.as_bytes() {
            h ^= *b as u64;
            h = h.wrapping_mul(0x100000001b3);
        }
        let mut v = Vec::with_capacity(self.dims);
        for _ in 0..self.dims {
            h = h.wrapping_add(0x9e3779b97f4a7c15);
            let mut z = h;
            z = (z ^ (z >> 30)).wrapping_mul(0xbf58476d1ce4e5b9);
            z = (z ^ (z >> 27)).wrapping_mul(0x94d049bb133111eb);
            z ^= z >> 31;
            v.push(((z >> 11) as f64 / (1u64 << 53) as f64 * 2.0 - 1.0) as f32);
        }
        v
    }
}

impl Embed for FakeEmbedder {
    fn embed(&self, texts: &[&str], task: Task, dims: Option<usize>) -> Result<Vec<Vec<f32>>> {
        texts.iter().map(|t| mrl(&self.vec_for(&task.apply(t)), dims)).collect()
    }
    fn space(&self, dims: Option<usize>) -> Space {
        let d = dims.unwrap_or(self.dims);
        Space {
            id: format!("spdf-fake@{d}"),
            provider: "spdf".into(),
            model: "spdf-fake".into(),
            version: Some("1".into()),
            dims: d,
            dtype: "f32".into(),
            normalized: true,
            truncated_from: if d < self.dims { Some(self.dims) } else { None },
            modalities: vec!["text".into()],
            task_prefixes: Some(embeddinggemma2_task_prefixes()),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn prefixes() {
        assert_eq!(Task::Query.apply("x"), "task: search result | query: x");
        assert_eq!(Task::Document { title: None }.apply("x"), "title: none | text: x");
        assert_eq!(Task::Document { title: Some("Quijote".into()) }.apply("x"), "title: Quijote | text: x");
    }

    #[test]
    fn mrl_renormalises() {
        let v = mrl(&[3.0, 4.0, 12.0], Some(2)).unwrap();
        assert!((v[0] - 0.6).abs() < 1e-6 && (v[1] - 0.8).abs() < 1e-6);
    }

    #[test]
    fn fake_is_deterministic_and_normalised() {
        let f = FakeEmbedder::new(64);
        let a = f.embed(&["hola"], Task::Query, None).unwrap();
        let b = f.embed(&["hola"], Task::Query, None).unwrap();
        assert_eq!(a, b);
        let n: f32 = a[0].iter().map(|x| x * x).sum();
        assert!((n - 1.0).abs() < 1e-5);
        assert_eq!(f.space(Some(32)).id, "spdf-fake@32");
        assert_eq!(f.space(Some(32)).truncated_from, Some(64));
    }
}

#[cfg(test)]
mod fixture_tests {
    use super::*;
    #[test]
    fn fake_matches_fixtures() {
        let fx = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../../web/test/fixtures/fake.json");
        let cases: Vec<serde_json::Value> = serde_json::from_str(&std::fs::read_to_string(fx).unwrap()).unwrap();
        for c in cases {
            let f = FakeEmbedder::new(c["dims"].as_u64().unwrap() as usize);
            let v = f.embed(&[c["text"].as_str().unwrap()], Task::Document { title: None }, None).unwrap().remove(0);
            for (a, b) in v.iter().zip(c["vec"].as_array().unwrap()) {
                assert!((*a as f64 - b.as_f64().unwrap()).abs() < 1e-6);
            }
        }
    }
}
