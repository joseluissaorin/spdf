//! # spdf-infer
//!
//! Local inference for SPDF readers and producers, on llama.cpp (Metal on macOS and iOS,
//! Vulkan or CUDA on Windows and Linux, CPU everywhere, including Android):
//!
//! * [`Embedder`]: EmbeddingGemma 2 embeddings of text (with the right task prefix), images and
//!   audio, Matryoshka truncation to 512/256/128, and the [`Space`] row to store with them;
//! * [`Generator`]: Gemma 4 E2B/E4B generation with streaming;
//! * [`Judge`]: a Jev-style judge (instruction + candidate labels → probabilities) by scoring the
//!   label tokens with Gemma 4 logits, with simple calibration;
//! * [`ModelManager`]: catalog (embedded `models/manifest.json`), resumable downloads verified by
//!   SHA-256, and per-platform recommendation;
//! * [`compat`]: the rule that says when two spaces are "the same space" (models/COMPATIBILIDAD.md).
//!
//! Everything is blocking; call it from a worker thread (`spawn_blocking` in Tauri).

pub mod compat;
pub mod embed;
pub mod generate;
pub mod image;
pub mod judge;
pub mod llama;
pub mod manager;
pub mod mtmd;
#[cfg(feature = "gemini")]
pub mod gemini;
#[cfg(feature = "valen-onnx")]
pub mod valen;

pub use embed::{Embed, Embedder, EmbedderOptions, FakeEmbedder, Space, Task};
pub use generate::{GenOptions, GenParams, GenStats, Generator, Message, Role};
pub use judge::{Calibration, Judge, Label, Relation, Support};
pub use manager::{CatalogEntry, FileEntry, Kind, Manifest, ModelManager, Platform, Progress};

/// Revision of `google/embeddinggemma-2` all EmbeddingGemma 2 artefacts were converted from.
/// It is the `version` of the EmbeddingGemma 2 spaces (see models/COMPATIBILIDAD.md).
pub const EMBEDDINGGEMMA2_VERSION: &str = "914f7f89";

/// llama.cpp commit linked into this build.
pub const LLAMA_CPP_COMMIT: &str = spdf_llama_sys::LLAMA_COMMIT;

#[derive(Debug, thiserror::Error)]
pub enum Error {
    #[error("model not in the catalog: {0}")]
    NotFound(String),
    #[error("model not downloaded: {0}")]
    NotDownloaded(String),
    #[error("could not load: {0}")]
    Load(String),
    #[error("inference failed: {0}")]
    Inference(String),
    #[error("bad input: {0}")]
    Input(String),
    #[error("unsupported: {0}")]
    Unsupported(String),
    #[error("download failed: {0}")]
    Download(String),
    #[error("checksum mismatch for {file}: expected {expected}, got {actual}")]
    Checksum { file: String, expected: String, actual: String },
    #[error("io: {0}")]
    Io(#[from] std::io::Error),
    #[error("json: {0}")]
    Json(#[from] serde_json::Error),
    #[error("{0}")]
    Other(String),
}

impl Error {
    pub fn msg(s: impl Into<String>) -> Self {
        Error::Other(s.into())
    }
}

pub type Result<T> = std::result::Result<T, Error>;
