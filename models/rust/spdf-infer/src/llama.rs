//! Thin safe layer over the llama.cpp C API (only what spdf-infer needs).

use std::{
    ffi::{CStr, CString},
    path::Path,
    ptr::NonNull,
    sync::{Arc, Once},
};

use spdf_llama_sys as sys;

use crate::{Error, Result};

static INIT: Once = Once::new();

unsafe extern "C" fn quiet_log(level: sys::ggml_log_level, text: *const std::os::raw::c_char, _: *mut std::ffi::c_void) {
    // Keep llama.cpp quiet unless SPDF_INFER_LOG is set; errors always go to stderr.
    if level == sys::GGML_LOG_LEVEL_ERROR || std::env::var_os("SPDF_INFER_LOG").is_some() {
        if !text.is_null() {
            eprint!("{}", CStr::from_ptr(text).to_string_lossy());
        }
    }
}

/// The iOS simulator's emulated Metal returns wrong results for these models (measured: cosine
/// 0.80 instead of 0.86 on a reference pair), so the GPU is never used there; devices use Metal.
pub const GPU_USABLE: bool = !cfg!(any(target_abi = "sim", all(target_os = "ios", target_arch = "x86_64")));

/// Initialises the llama.cpp backends once per process.
pub fn backend_init() {
    INIT.call_once(|| unsafe {
        sys::llama_log_set(Some(quiet_log), std::ptr::null_mut());
        sys::mtmd_log_set(Some(quiet_log), std::ptr::null_mut());
        sys::mtmd_helper_log_set(Some(quiet_log), std::ptr::null_mut());
        sys::llama_backend_init();
    });
}

/// A loaded GGUF model (weights), shareable between contexts.
pub struct Model {
    ptr: NonNull<sys::llama_model>,
}
unsafe impl Send for Model {}
unsafe impl Sync for Model {}

impl Drop for Model {
    fn drop(&mut self) {
        unsafe { sys::llama_model_free(self.ptr.as_ptr()) }
    }
}

impl Model {
    pub fn load(path: &Path, gpu: bool) -> Result<Arc<Self>> {
        backend_init();
        let c = CString::new(path.to_string_lossy().as_bytes()).map_err(|_| Error::msg("path has NUL"))?;
        let mut p = unsafe { sys::llama_model_default_params() };
        p.n_gpu_layers = if gpu && GPU_USABLE { -1 } else { 0 };
        let ptr = unsafe { sys::llama_model_load_from_file(c.as_ptr(), p) };
        NonNull::new(ptr)
            .map(|ptr| Arc::new(Self { ptr }))
            .ok_or_else(|| Error::Load(format!("llama.cpp could not load {}", path.display())))
    }
    pub(crate) fn raw(&self) -> *mut sys::llama_model {
        self.ptr.as_ptr()
    }
    pub(crate) fn vocab(&self) -> *const sys::llama_vocab {
        unsafe { sys::llama_model_get_vocab(self.ptr.as_ptr()) }
    }
    pub fn n_embd(&self) -> usize {
        unsafe { sys::llama_model_n_embd(self.ptr.as_ptr()) as usize }
    }
    pub fn n_embd_inp(&self) -> usize {
        unsafe { sys::llama_model_n_embd_inp(self.ptr.as_ptr()) as usize }
    }
    pub fn n_embd_out(&self) -> usize {
        unsafe { sys::llama_model_n_embd_out(self.ptr.as_ptr()) as usize }
    }
    pub fn n_vocab(&self) -> usize {
        unsafe { sys::llama_vocab_n_tokens(self.vocab()) as usize }
    }
    pub fn size_bytes(&self) -> u64 {
        unsafe { sys::llama_model_size(self.ptr.as_ptr()) }
    }
    pub fn desc(&self) -> String {
        let mut buf = vec![0u8; 256];
        let n = unsafe { sys::llama_model_desc(self.ptr.as_ptr(), buf.as_mut_ptr() as *mut _, buf.len()) };
        buf.truncate(n.max(0) as usize);
        String::from_utf8_lossy(&buf).into_owned()
    }
    pub fn meta(&self, key: &str) -> Option<String> {
        let k = CString::new(key).ok()?;
        let mut buf = vec![0u8; 512];
        let n = unsafe { sys::llama_model_meta_val_str(self.ptr.as_ptr(), k.as_ptr(), buf.as_mut_ptr() as *mut _, buf.len()) };
        if n < 0 {
            return None;
        }
        buf.truncate((n as usize).min(buf.len() - 1));
        Some(String::from_utf8_lossy(&buf).into_owned())
    }
    pub fn architecture(&self) -> String {
        self.meta("general.architecture").unwrap_or_default()
    }

    /// Tokenizes text. `add_special` adds BOS/EOS as the model wants; `parse_special` turns
    /// control-token text (e.g. `<|turn>`) into control tokens.
    pub fn tokenize(&self, text: &str, add_special: bool, parse_special: bool) -> Result<Vec<i32>> {
        let bytes = text.as_bytes();
        let mut out = vec![0i32; bytes.len() + 8];
        let mut n = unsafe {
            sys::llama_tokenize(self.vocab(), bytes.as_ptr() as *const _, bytes.len() as i32, out.as_mut_ptr(), out.len() as i32,
                add_special, parse_special)
        };
        if n < 0 {
            out.resize((-n) as usize, 0);
            n = unsafe {
                sys::llama_tokenize(self.vocab(), bytes.as_ptr() as *const _, bytes.len() as i32, out.as_mut_ptr(), out.len() as i32,
                    add_special, parse_special)
            };
        }
        if n < 0 {
            return Err(Error::msg("tokenization failed"));
        }
        out.truncate(n as usize);
        Ok(out)
    }

    /// Bytes of one token (may be a partial UTF-8 sequence).
    pub fn token_bytes(&self, token: i32, special: bool) -> Vec<u8> {
        let mut buf = vec![0u8; 64];
        let mut n = unsafe { sys::llama_token_to_piece(self.vocab(), token, buf.as_mut_ptr() as *mut _, buf.len() as i32, 0, special) };
        if n < 0 {
            buf.resize((-n) as usize, 0);
            n = unsafe { sys::llama_token_to_piece(self.vocab(), token, buf.as_mut_ptr() as *mut _, buf.len() as i32, 0, special) };
        }
        buf.truncate(n.max(0) as usize);
        buf
    }
    pub fn is_eog(&self, token: i32) -> bool {
        unsafe { sys::llama_vocab_is_eog(self.vocab(), token) }
    }
}

/// Inference context over a model (KV cache, outputs). Not thread-safe: wrap in a Mutex.
pub struct Context {
    ptr: NonNull<sys::llama_context>,
    pub model: Arc<Model>,
    batch: NonNull<sys::llama_batch_ext>,
    pub n_ctx: u32,
    pub n_batch: u32,
}
unsafe impl Send for Context {}

impl Drop for Context {
    fn drop(&mut self) {
        unsafe {
            sys::llama_batch_ext_free(self.batch.as_ptr());
            sys::llama_free(self.ptr.as_ptr());
        }
    }
}

#[derive(Clone, Debug)]
pub struct ContextParams {
    pub n_ctx: u32,
    pub n_batch: u32,
    pub n_ubatch: u32,
    pub n_seq_max: u32,
    pub embeddings: bool,
    pub pooling_mean: bool,
    pub n_threads: Option<i32>,
}

impl Context {
    pub fn new(model: Arc<Model>, cp: &ContextParams) -> Result<Self> {
        let mut p = unsafe { sys::llama_context_default_params() };
        p.n_ctx = cp.n_ctx;
        p.n_batch = cp.n_batch;
        p.n_ubatch = cp.n_ubatch;
        p.n_seq_max = cp.n_seq_max;
        p.embeddings = cp.embeddings;
        if cp.embeddings {
            p.pooling_type = if cp.pooling_mean { sys::LLAMA_POOLING_TYPE_MEAN } else { sys::LLAMA_POOLING_TYPE_NONE };
        }
        p.no_perf = true;
        if let Some(t) = cp.n_threads {
            p.n_threads = t;
            p.n_threads_batch = t;
        }
        let ptr = unsafe { sys::llama_init_from_model(model.raw(), p) };
        let ptr = NonNull::new(ptr).ok_or_else(|| Error::Load("llama.cpp could not create a context".into()))?;
        let batch = unsafe { sys::llama_batch_ext_init(ptr.as_ptr()) };
        let batch = NonNull::new(batch).ok_or_else(|| Error::msg("llama_batch_ext_init failed"))?;
        let n_ctx = unsafe { sys::llama_n_ctx(ptr.as_ptr()) };
        Ok(Self { ptr, model, batch, n_ctx, n_batch: cp.n_batch })
    }
    pub(crate) fn raw(&self) -> *mut sys::llama_context {
        self.ptr.as_ptr()
    }

    /// Clears the KV cache / recurrent state.
    pub fn clear(&mut self) {
        unsafe {
            let mem = sys::llama_get_memory(self.ptr.as_ptr());
            if !mem.is_null() {
                sys::llama_memory_clear(mem, true);
            }
        }
    }

    /// Removes cached positions >= `p0` of sequence 0 (to reuse a common prompt prefix).
    pub fn truncate(&mut self, p0: i32) -> bool {
        unsafe {
            let mem = sys::llama_get_memory(self.ptr.as_ptr());
            !mem.is_null() && sys::llama_memory_seq_rm(mem, 0, p0, -1)
        }
    }

    /// Decodes a sequence of entries (tokens or embedding rows) starting at position `pos0`,
    /// in chunks of `n_batch`. Outputs are requested for the entries where `output(i)` is true.
    pub fn decode(&mut self, entries: &[Entry<'_>], seq: i32, pos0: i32, output: impl Fn(usize) -> bool) -> Result<()> {
        let mut i = 0usize;
        while i < entries.len() {
            let end = (i + self.n_batch as usize).min(entries.len());
            unsafe { sys::llama_batch_ext_clear(self.batch.as_ptr()) };
            for (k, e) in entries[i..end].iter().enumerate() {
                let idx = match e {
                    Entry::Token(t) => unsafe { sys::llama_batch_ext_add_token(self.batch.as_ptr(), seq, *t) },
                    Entry::Embd(row) => unsafe {
                        sys::llama_batch_ext_add_embd(self.batch.as_ptr(), seq, sys::llama_embd { data: row.as_ptr(), n_rows: 1, n_embd: row.len() })
                    },
                };
                if idx < 0 {
                    return Err(Error::Inference(format!("batch add failed ({idx})")));
                }
                let p = pos0 + (i + k) as i32;
                let pos = [p, p, p, p];
                unsafe {
                    sys::llama_batch_ext_set_pos(self.batch.as_ptr(), idx, pos.as_ptr());
                    if output(i + k) {
                        sys::llama_batch_ext_set_output_logits(self.batch.as_ptr(), idx, true);
                    }
                }
            }
            let rc = unsafe { sys::llama_process(self.ptr.as_ptr(), sys::LLAMA_PROCESS_TYPE_DECODE, self.batch.as_ptr()) };
            if rc != 0 {
                return Err(Error::Inference(format!("llama_process returned {rc}")));
            }
            i = end;
        }
        // decode only enqueues GPU work: wait for it, so timings and the next read are honest
        unsafe { sys::llama_synchronize(self.ptr.as_ptr()) };
        Ok(())
    }

    /// Pooled embedding of a sequence (after decode with pooling=mean).
    pub fn pooled_embedding(&self, seq: i32) -> Result<Vec<f32>> {
        let n = self.model.n_embd_out();
        let p = unsafe { sys::llama_get_embeddings_seq(self.ptr.as_ptr(), seq) };
        if p.is_null() {
            return Err(Error::Inference("no pooled embedding".into()));
        }
        Ok(unsafe { std::slice::from_raw_parts(p, n) }.to_vec())
    }

    /// Hidden state (embedding output, pooling none) of the i-th output of the last decode.
    pub fn embedding_ith(&self, i: i32) -> Result<&[f32]> {
        let n = self.model.n_embd_out();
        let p = unsafe { sys::llama_get_embeddings_ith(self.ptr.as_ptr(), i) };
        if p.is_null() {
            return Err(Error::Inference(format!("no embedding for output {i}")));
        }
        Ok(unsafe { std::slice::from_raw_parts(p, n) })
    }

    /// Logits of the i-th output of the last decode (-1 = last).
    pub fn logits_ith(&self, i: i32) -> Result<&[f32]> {
        let n = self.model.n_vocab();
        let p = unsafe { sys::llama_get_logits_ith(self.ptr.as_ptr(), i) };
        if p.is_null() {
            return Err(Error::Inference(format!("no logits for output {i}")));
        }
        Ok(unsafe { std::slice::from_raw_parts(p, n) })
    }
}

/// One input position: a token id or an embedding row (from a vision/audio encoder).
pub enum Entry<'a> {
    Token(i32),
    Embd(&'a [f32]),
}

/// Sampler chain (top-k, top-p, temperature, then random draw; greedy if temperature <= 0).
pub struct Sampler {
    ptr: NonNull<sys::llama_sampler>,
}
unsafe impl Send for Sampler {}
impl Drop for Sampler {
    fn drop(&mut self) {
        unsafe { sys::llama_sampler_free(self.ptr.as_ptr()) }
    }
}
impl Sampler {
    pub fn new(temperature: f32, top_k: i32, top_p: f32, min_p: f32, seed: u32) -> Self {
        unsafe {
            let chain = sys::llama_sampler_chain_init(sys::llama_sampler_chain_default_params());
            if temperature <= 0.0 {
                sys::llama_sampler_chain_add(chain, sys::llama_sampler_init_greedy());
            } else {
                if top_k > 0 {
                    sys::llama_sampler_chain_add(chain, sys::llama_sampler_init_top_k(top_k));
                }
                if top_p < 1.0 {
                    sys::llama_sampler_chain_add(chain, sys::llama_sampler_init_top_p(top_p, 1));
                }
                if min_p > 0.0 {
                    sys::llama_sampler_chain_add(chain, sys::llama_sampler_init_min_p(min_p, 1));
                }
                sys::llama_sampler_chain_add(chain, sys::llama_sampler_init_temp(temperature));
                sys::llama_sampler_chain_add(chain, sys::llama_sampler_init_dist(seed));
            }
            Self { ptr: NonNull::new(chain).expect("sampler chain") }
        }
    }
    /// Samples from the output `idx` of the last decode and accepts the token.
    pub fn sample(&mut self, ctx: &Context, idx: i32) -> i32 {
        unsafe { sys::llama_sampler_sample(self.ptr.as_ptr(), ctx.raw(), idx) }
    }
}

/// Accumulates token bytes and yields only complete UTF-8 text.
#[derive(Default)]
pub struct Utf8Stream {
    pending: Vec<u8>,
}
impl Utf8Stream {
    pub fn push(&mut self, bytes: &[u8]) -> String {
        self.pending.extend_from_slice(bytes);
        match std::str::from_utf8(&self.pending) {
            Ok(s) => {
                let s = s.to_owned();
                self.pending.clear();
                s
            }
            Err(e) => {
                let valid = e.valid_up_to();
                if e.error_len().is_some() {
                    // invalid bytes (not just incomplete): emit lossy and reset
                    let s = String::from_utf8_lossy(&self.pending).into_owned();
                    self.pending.clear();
                    return s;
                }
                let s = String::from_utf8_lossy(&self.pending[..valid]).into_owned();
                self.pending.drain(..valid);
                s
            }
        }
    }
    pub fn finish(&mut self) -> String {
        let s = String::from_utf8_lossy(&self.pending).into_owned();
        self.pending.clear();
        s
    }
}
