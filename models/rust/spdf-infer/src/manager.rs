//! Model catalog, resumable downloads verified by SHA-256, and per-platform recommendation.
//!
//! The catalog is `models/manifest.json`, embedded at build time. Files live in
//! `<root>/<model id>/<file path>`; partial downloads in `<file>.part` are resumed with HTTP
//! `Range`. A file counts as present only after its SHA-256 matched (a `.ok` stamp records it).
//! `SPDF_MODELS_MIRROR` replaces `https://huggingface.co` in every URL (e.g. a local mirror).

use std::{
    collections::BTreeMap,
    fs,
    io::{Read, Write},
    path::{Path, PathBuf},
};

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

use crate::{judge::JudgeCalibration, Error, Result};

/// The manifest shipped with this crate (copy of models/manifest.json).
pub const MANIFEST_JSON: &str = include_str!("../../../manifest.json");

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Kind {
    Embed,
    Generate,
    Judge,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Platform {
    Macos,
    Ios,
    Windows,
    Linux,
    Android,
    Web,
}

impl Platform {
    pub fn current() -> Self {
        if cfg!(target_os = "ios") {
            Platform::Ios
        } else if cfg!(target_os = "macos") {
            Platform::Macos
        } else if cfg!(target_os = "android") {
            Platform::Android
        } else if cfg!(target_os = "windows") {
            Platform::Windows
        } else if cfg!(target_family = "wasm") {
            Platform::Web
        } else {
            Platform::Linux
        }
    }
    pub fn key(&self) -> &'static str {
        match self {
            Platform::Macos => "macos",
            Platform::Ios => "ios",
            Platform::Windows => "windows",
            Platform::Linux => "linux",
            Platform::Android => "android",
            Platform::Web => "web",
        }
    }
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct FileEntry {
    /// "model", "mmproj", "config", "tokenizer", "onnx", "onnx_data", "task"…
    pub role: String,
    /// Path inside the model directory.
    pub path: String,
    pub url: String,
    pub bytes: u64,
    pub sha256: String,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct CatalogEntry {
    pub id: String,
    pub name: String,
    /// Model family, e.g. "embeddinggemma-2", "gemma-4-e2b", "valen-0.8b".
    pub family: String,
    /// Main role.
    pub kind: Kind,
    /// Every role this entry can play (Gemma 4: generate + judge).
    pub kinds: Vec<Kind>,
    /// "llama.cpp", "transformers.js", "mediapipe", "onnxruntime", "mlx", "server".
    pub engine: String,
    pub format: String,
    pub license: String,
    pub license_url: Option<String>,
    /// Hugging Face repository and the pinned revision the URLs point at.
    pub source: String,
    pub revision: String,
    /// Total download size.
    pub bytes: u64,
    pub files: Vec<FileEntry>,
    pub modalities: Vec<String>,
    pub platforms: Vec<Platform>,
    /// Memory needed to run it comfortably (weights + context), in MiB.
    pub min_memory_mb: u64,
    /// `spaces.version` written by this embedder (models/COMPATIBILIDAD.md).
    #[serde(default)]
    pub space_version: Option<String>,
    /// Weight format inside the family (q4, q8, int8, fp16…) when the engine needs it.
    #[serde(default)]
    pub dtype: Option<String>,
    #[serde(default)]
    pub judge_calibration: Option<JudgeCalibration>,
    #[serde(default)]
    pub notes: Option<String>,
    /// false: the files are not on the server yet (build them locally, then `import_local`).
    #[serde(default = "yes")]
    pub published: bool,
}

fn yes() -> bool {
    true
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Manifest {
    pub spdf_models: u32,
    pub updated: String,
    pub models: Vec<CatalogEntry>,
    /// platform → kind → ids in order of preference (first that fits in memory wins).
    pub recommendations: BTreeMap<String, BTreeMap<String, Vec<String>>>,
}

impl Manifest {
    pub fn embedded() -> Result<Self> {
        Ok(serde_json::from_str(MANIFEST_JSON)?)
    }
}

#[derive(Clone, Debug)]
pub struct Progress {
    pub id: String,
    pub file: String,
    /// Bytes of this file on disk.
    pub done: u64,
    pub total: u64,
    /// Bytes of the whole model on disk.
    pub overall_done: u64,
    pub overall_total: u64,
}

pub struct ModelManager {
    root: PathBuf,
    manifest: Manifest,
    agent: ureq::Agent,
}

/// Total physical memory in bytes (0 if unknown).
pub fn total_memory() -> u64 {
    #[cfg(any(target_os = "macos", target_os = "ios"))]
    unsafe {
        let mut v: u64 = 0;
        let mut len = std::mem::size_of::<u64>();
        let name = b"hw.memsize\0";
        if libc::sysctlbyname(name.as_ptr() as *const _, &mut v as *mut u64 as *mut _, &mut len, std::ptr::null_mut(), 0) == 0 {
            return v;
        }
        0
    }
    #[cfg(any(target_os = "linux", target_os = "android"))]
    {
        let s = fs::read_to_string("/proc/meminfo").unwrap_or_default();
        s.lines()
            .find(|l| l.starts_with("MemTotal:"))
            .and_then(|l| l.split_whitespace().nth(1))
            .and_then(|k| k.parse::<u64>().ok())
            .map(|k| k * 1024)
            .unwrap_or(0)
    }
    #[cfg(target_os = "windows")]
    unsafe {
        use windows_sys::Win32::System::SystemInformation::{GlobalMemoryStatusEx, MEMORYSTATUSEX};
        let mut st: MEMORYSTATUSEX = std::mem::zeroed();
        st.dwLength = std::mem::size_of::<MEMORYSTATUSEX>() as u32;
        if GlobalMemoryStatusEx(&mut st) != 0 {
            return st.ullTotalPhys;
        }
        0
    }
    #[cfg(not(any(target_os = "macos", target_os = "ios", target_os = "linux", target_os = "android", target_os = "windows")))]
    {
        0
    }
}

fn sha256_file(p: &Path) -> Result<String> {
    let mut f = fs::File::open(p)?;
    let mut h = Sha256::new();
    let mut buf = vec![0u8; 1 << 20];
    loop {
        let n = f.read(&mut buf)?;
        if n == 0 {
            break;
        }
        h.update(&buf[..n]);
    }
    Ok(hex(&h.finalize()))
}

fn hex(b: &[u8]) -> String {
    b.iter().map(|x| format!("{x:02x}")).collect()
}

impl ModelManager {
    /// Uses the embedded manifest.
    pub fn new(root: impl Into<PathBuf>) -> Result<Self> {
        Self::with_manifest(root, Manifest::embedded()?)
    }

    pub fn with_manifest(root: impl Into<PathBuf>, manifest: Manifest) -> Result<Self> {
        let root = root.into();
        fs::create_dir_all(&root)?;
        let agent: ureq::Agent = ureq::Agent::config_builder()
            .timeout_connect(Some(std::time::Duration::from_secs(30)))
            .user_agent("spdf-infer/0.1 (+https://github.com/joseluissaorin/spdf)")
            .build()
            .into();
        Ok(Self { root, manifest, agent })
    }

    pub fn root(&self) -> &Path {
        &self.root
    }
    pub fn manifest(&self) -> &Manifest {
        &self.manifest
    }

    /// Entries usable by this native crate (llama.cpp GGUF, or a server), for any platform.
    pub fn catalog(&self) -> Vec<CatalogEntry> {
        self.manifest.models.iter().filter(|e| e.engine == "llama.cpp" || e.engine == "server").cloned().collect()
    }

    /// Every entry, web ones included.
    pub fn catalog_all(&self) -> &[CatalogEntry] {
        &self.manifest.models
    }

    pub fn entry(&self, id: &str) -> Option<&CatalogEntry> {
        self.manifest.models.iter().find(|e| e.id == id)
    }

    /// Recommended entry for this device: first preference whose memory fits in half the RAM.
    pub fn recommend(&self, kind: Kind) -> Option<CatalogEntry> {
        self.recommend_for(kind, Platform::current(), total_memory())
    }

    pub fn recommend_for(&self, kind: Kind, platform: Platform, mem_bytes: u64) -> Option<CatalogEntry> {
        let kind_key = serde_json::to_value(kind).ok()?.as_str()?.to_string();
        let prefs = self.manifest.recommendations.get(platform.key())?.get(&kind_key)?;
        let budget_mb = if mem_bytes == 0 { u64::MAX } else { mem_bytes / 2 / (1 << 20) };
        let mut last = None;
        for id in prefs {
            if let Some(e) = self.entry(id) {
                if e.min_memory_mb <= budget_mb {
                    return Some(e.clone());
                }
                last = Some(e.clone());
            }
        }
        last // nothing fits: the smallest (last) one, the caller decides
    }

    pub fn dir(&self, id: &str) -> PathBuf {
        self.root.join(id)
    }

    /// Path of the file with `role` of an entry (whether downloaded or not).
    pub fn file_path(&self, id: &str, role: &str) -> Option<PathBuf> {
        let e = self.entry(id)?;
        let f = e.files.iter().find(|f| f.role == role)?;
        Some(self.dir(id).join(&f.path))
    }

    /// Main path: the directory, or the file when the entry has a single one.
    pub fn path(&self, id: &str) -> Option<PathBuf> {
        let e = self.entry(id)?;
        if !self.is_downloaded(id) {
            return None;
        }
        Some(if e.files.len() == 1 { self.dir(id).join(&e.files[0].path) } else { self.dir(id) })
    }

    fn stamp(p: &Path) -> PathBuf {
        let mut s = p.as_os_str().to_owned();
        s.push(".ok");
        PathBuf::from(s)
    }

    fn file_ok(&self, id: &str, f: &FileEntry) -> bool {
        let p = self.dir(id).join(&f.path);
        let size_ok = fs::metadata(&p).map(|m| m.len() == f.bytes).unwrap_or(false);
        size_ok && fs::read_to_string(Self::stamp(&p)).map(|s| s.trim() == f.sha256).unwrap_or(false)
    }

    pub fn is_downloaded(&self, id: &str) -> bool {
        self.entry(id).map(|e| e.files.iter().all(|f| self.file_ok(id, f))).unwrap_or(false)
    }

    pub fn delete(&self, id: &str) -> Result<()> {
        if self.entry(id).is_none() {
            return Err(Error::NotFound(id.into()));
        }
        let d = self.dir(id);
        if d.exists() {
            fs::remove_dir_all(d)?;
        }
        Ok(())
    }

    fn url(&self, f: &FileEntry) -> String {
        match std::env::var("SPDF_MODELS_MIRROR") {
            Ok(m) if !m.is_empty() => f.url.replacen("https://huggingface.co", m.trim_end_matches('/'), 1),
            _ => f.url.clone(),
        }
    }

    /// Registers files built locally (e.g. by models/valen/export_onnx.py) for an entry: each one
    /// is copied from `src_dir` and must match the manifest's size and SHA-256.
    pub fn import_local(&self, id: &str, src_dir: &Path) -> Result<PathBuf> {
        let e = self.entry(id).ok_or_else(|| Error::NotFound(id.into()))?.clone();
        let dir = self.dir(id);
        fs::create_dir_all(&dir)?;
        for f in &e.files {
            let src = src_dir.join(&f.path);
            let actual = sha256_file(&src)?;
            if actual != f.sha256 {
                return Err(Error::Checksum { file: f.path.clone(), expected: f.sha256.clone(), actual });
            }
            let dest = dir.join(&f.path);
            if let Some(parent) = dest.parent() {
                fs::create_dir_all(parent)?;
            }
            fs::copy(&src, &dest)?;
            fs::write(Self::stamp(&dest), &f.sha256)?;
        }
        Ok(dir)
    }

    /// Downloads every file of an entry, resuming partial files and verifying SHA-256.
    pub fn download(&self, id: &str, mut progress: impl FnMut(Progress)) -> Result<PathBuf> {
        let e = self.entry(id).ok_or_else(|| Error::NotFound(id.into()))?.clone();
        if !e.published {
            return Err(Error::Unsupported(format!(
                "{id} is not published yet: build it locally (see the entry notes) and register it with import_local"
            )));
        }
        let dir = self.dir(id);
        fs::create_dir_all(&dir)?;
        let overall_total: u64 = e.files.iter().map(|f| f.bytes).sum();
        let mut overall_before = 0u64;
        for f in &e.files {
            if self.file_ok(id, f) {
                overall_before += f.bytes;
                progress(Progress { id: id.into(), file: f.path.clone(), done: f.bytes, total: f.bytes, overall_done: overall_before, overall_total });
                continue;
            }
            let dest = dir.join(&f.path);
            if let Some(parent) = dest.parent() {
                fs::create_dir_all(parent)?;
            }
            let mut part = dest.clone().into_os_string();
            part.push(".part");
            let part = PathBuf::from(part);
            // a complete file without stamp (e.g. copied by hand): verify instead of downloading
            if fs::metadata(&dest).map(|m| m.len() == f.bytes).unwrap_or(false) {
                fs::rename(&dest, &part)?;
            }
            let mut attempts = 0;
            loop {
                attempts += 1;
                match self.fetch_into(&part, f, id, overall_before, overall_total, &mut progress) {
                    Ok(()) => break,
                    Err(err) if attempts < 4 => {
                        std::thread::sleep(std::time::Duration::from_secs(2 * attempts));
                        let _ = err;
                    }
                    Err(err) => return Err(err),
                }
            }
            let actual = sha256_file(&part)?;
            if actual != f.sha256 {
                let _ = fs::remove_file(&part);
                return Err(Error::Checksum { file: f.path.clone(), expected: f.sha256.clone(), actual });
            }
            fs::rename(&part, &dest)?;
            fs::write(Self::stamp(&dest), &f.sha256)?;
            overall_before += f.bytes;
        }
        Ok(dir)
    }

    fn fetch_into(&self, part: &Path, f: &FileEntry, id: &str, before: u64, overall_total: u64, progress: &mut impl FnMut(Progress)) -> Result<()> {
        let have = fs::metadata(part).map(|m| m.len()).unwrap_or(0);
        if have == f.bytes {
            return Ok(());
        }
        if have > f.bytes {
            fs::remove_file(part)?;
        }
        let have = fs::metadata(part).map(|m| m.len()).unwrap_or(0);
        let mut req = self.agent.get(&self.url(f));
        if have > 0 {
            req = req.header("Range", format!("bytes={have}-"));
        }
        let resp = req.call().map_err(|e| Error::Download(format!("{}: {e}", f.path)))?;
        let status = resp.status().as_u16();
        let append = have > 0 && status == 206;
        let mut out = fs::OpenOptions::new().create(true).write(true).append(append).truncate(!append).open(part)?;
        let mut done = if append { have } else { 0 };
        let mut reader = resp.into_body().into_reader();
        let mut buf = vec![0u8; 1 << 20];
        let mut last_report = 0u64;
        loop {
            let n = reader.read(&mut buf).map_err(|e| Error::Download(format!("{}: {e}", f.path)))?;
            if n == 0 {
                break;
            }
            out.write_all(&buf[..n])?;
            done += n as u64;
            if done - last_report >= 4 << 20 || done == f.bytes {
                last_report = done;
                progress(Progress { id: id.into(), file: f.path.clone(), done, total: f.bytes, overall_done: before + done, overall_total });
            }
        }
        out.flush()?;
        if done != f.bytes {
            return Err(Error::Download(format!("{}: got {done} of {} bytes", f.path, f.bytes)));
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn embedded_manifest_parses_and_recommends() {
        let m = Manifest::embedded().unwrap();
        assert!(!m.models.is_empty());
        let dir = std::env::temp_dir().join("spdf-infer-test-mm");
        let mm = ModelManager::with_manifest(&dir, m).unwrap();
        for p in [Platform::Macos, Platform::Windows, Platform::Linux, Platform::Ios, Platform::Android] {
            let e = mm.recommend_for(Kind::Embed, p, 8 << 30).expect("embed recommendation");
            assert!(e.kinds.contains(&Kind::Embed));
        }
        for e in &mm.manifest().models {
            for f in &e.files {
                assert_eq!(f.sha256.len(), 64, "{} {}", e.id, f.path);
            }
        }
    }
}
