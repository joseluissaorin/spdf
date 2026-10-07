//! Multimodal projector (mmproj) through llama.cpp's mtmd library: images and audio become
//! rows of input embeddings for the text model.

use std::{ffi::CString, path::Path, ptr::NonNull};

use spdf_llama_sys as sys;

use crate::{
    llama::{backend_init, Model},
    Error, Result,
};

pub struct Mtmd {
    ptr: NonNull<sys::mtmd_context>,
    marker: String,
}
unsafe impl Send for Mtmd {}

impl Drop for Mtmd {
    fn drop(&mut self) {
        unsafe { sys::mtmd_free(self.ptr.as_ptr()) }
    }
}

/// A tokenized multimodal input: text chunks and encoded media chunks.
pub enum Piece {
    Text(Vec<i32>),
    /// `n_tokens` rows of `n_embd_inp` floats, already encoded.
    Media { rows: Vec<f32>, n_tokens: usize },
}

impl Mtmd {
    pub fn load(path: &Path, model: &Model, gpu: bool, image_max_tokens: i32, n_threads: Option<i32>) -> Result<Self> {
        backend_init();
        let c = CString::new(path.to_string_lossy().as_bytes()).map_err(|_| Error::msg("path has NUL"))?;
        let mut p = unsafe { sys::mtmd_context_params_default() };
        p.use_gpu = gpu && crate::llama::GPU_USABLE;
        p.print_timings = false;
        p.warmup = false;
        if image_max_tokens > 0 {
            p.image_max_tokens = image_max_tokens;
        }
        if let Some(t) = n_threads {
            p.n_threads = t;
        }
        let ptr = unsafe { sys::mtmd_init_from_file(c.as_ptr(), model.raw(), p) };
        let ptr = NonNull::new(ptr).ok_or_else(|| Error::Load(format!("could not load mmproj {}", path.display())))?;
        let marker = unsafe { std::ffi::CStr::from_ptr(sys::mtmd_get_marker(ptr.as_ptr())) }.to_string_lossy().into_owned();
        Ok(Self { ptr, marker })
    }

    pub fn supports_vision(&self) -> bool {
        unsafe { sys::mtmd_support_vision(self.ptr.as_ptr()) }
    }
    pub fn supports_audio(&self) -> bool {
        unsafe { sys::mtmd_support_audio(self.ptr.as_ptr()) }
    }

    /// Tokenizes `<media marker>` with one bitmap and encodes the media chunk.
    fn run(&mut self, bitmap: *mut sys::mtmd_bitmap, n_embd_inp: usize) -> Result<Vec<Piece>> {
        struct Guard(*mut sys::mtmd_bitmap, *mut sys::mtmd_input_chunks);
        impl Drop for Guard {
            fn drop(&mut self) {
                unsafe {
                    if !self.0.is_null() {
                        sys::mtmd_bitmap_free(self.0);
                    }
                    if !self.1.is_null() {
                        sys::mtmd_input_chunks_free(self.1);
                    }
                }
            }
        }
        if bitmap.is_null() {
            return Err(Error::Input("could not build the media bitmap".into()));
        }
        let chunks = unsafe { sys::mtmd_input_chunks_init() };
        let _g = Guard(bitmap, chunks);
        let text = CString::new(self.marker.as_bytes()).unwrap();
        let input = sys::mtmd_input_text { text: text.as_ptr(), text_len: self.marker.len(), add_special: true, parse_special: true };
        let bitmaps = [bitmap as *const sys::mtmd_bitmap];
        let rc = unsafe { sys::mtmd_tokenize(self.ptr.as_ptr(), chunks, &input, bitmaps.as_ptr(), 1) };
        if rc != 0 {
            return Err(Error::Input(format!("mtmd_tokenize failed ({rc})")));
        }
        let n = unsafe { sys::mtmd_input_chunks_size(chunks) };
        let mut out = Vec::with_capacity(n);
        for i in 0..n {
            let ch = unsafe { sys::mtmd_input_chunks_get(chunks, i) };
            let ty = unsafe { sys::mtmd_input_chunk_get_type(ch) };
            if ty == sys::MTMD_INPUT_CHUNK_TYPE_TEXT {
                let mut nt = 0usize;
                let toks = unsafe { sys::mtmd_input_chunk_get_tokens_text(ch, &mut nt) };
                out.push(Piece::Text(unsafe { std::slice::from_raw_parts(toks, nt) }.to_vec()));
            } else {
                let rc = unsafe { sys::mtmd_encode_chunk(self.ptr.as_ptr(), ch) };
                if rc != 0 {
                    return Err(Error::Inference(format!("mtmd_encode_chunk failed ({rc})")));
                }
                let n_tokens = unsafe { sys::mtmd_input_chunk_get_n_tokens(ch) };
                let p = unsafe { sys::mtmd_get_output_embd(self.ptr.as_ptr()) };
                let rows = unsafe { std::slice::from_raw_parts(p, n_tokens * n_embd_inp) }.to_vec();
                out.push(Piece::Media { rows, n_tokens });
            }
        }
        Ok(out)
    }

    /// RGB8 image (already resized by the caller if it wants reference preprocessing).
    pub fn image(&mut self, width: u32, height: u32, rgb: &[u8], n_embd_inp: usize) -> Result<Vec<Piece>> {
        if rgb.len() != (width * height * 3) as usize {
            return Err(Error::Input("RGB buffer size does not match width × height × 3".into()));
        }
        let bm = unsafe { sys::mtmd_bitmap_init(width, height, rgb.as_ptr()) };
        self.run(bm, n_embd_inp)
    }

    /// Mono PCM samples at the projector's sample rate (16 kHz for EmbeddingGemma 2).
    pub fn audio_pcm(&mut self, pcm: &[f32], n_embd_inp: usize) -> Result<Vec<Piece>> {
        let bm = unsafe { sys::mtmd_bitmap_init_from_audio(pcm.len(), pcm.as_ptr()) };
        self.run(bm, n_embd_inp)
    }

    /// Encoded media file (WAV/MP3/FLAC audio, or an image file) decoded by mtmd's helpers.
    pub fn file_bytes(&mut self, bytes: &[u8], n_embd_inp: usize) -> Result<Vec<Piece>> {
        let opt = unsafe { sys::mtmd_helper_init_opt_default() };
        let w = unsafe { sys::mtmd_helper_bitmap_init_from_buf(self.ptr.as_ptr(), bytes.as_ptr(), bytes.len(), false, opt) };
        self.run(w.bitmap, n_embd_inp)
    }

    pub fn sample_rate(&self) -> i32 {
        unsafe { sys::mtmd_get_audio_sample_rate(self.ptr.as_ptr()) }
    }
}
