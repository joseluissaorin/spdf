//! Text generation with Gemma 4 (E2B/E4B) on llama.cpp, streamed token by token.

use std::{
    path::Path,
    sync::{Arc, Mutex},
    time::Instant,
};

use serde::{Deserialize, Serialize};

use crate::{
    llama::{Context, ContextParams, Entry, Model, Sampler, Utf8Stream},
    manager::ModelManager,
    Error, Result,
};

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Role {
    System,
    User,
    Assistant,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Message {
    pub role: Role,
    pub content: String,
}

impl Message {
    pub fn system(s: impl Into<String>) -> Self {
        Self { role: Role::System, content: s.into() }
    }
    pub fn user(s: impl Into<String>) -> Self {
        Self { role: Role::User, content: s.into() }
    }
    pub fn assistant(s: impl Into<String>) -> Self {
        Self { role: Role::Assistant, content: s.into() }
    }
}

#[derive(Clone, Debug)]
pub struct GenOptions {
    pub gpu: bool,
    /// Context window in tokens (prompt + answer).
    pub n_ctx: u32,
    pub n_threads: Option<i32>,
}

impl Default for GenOptions {
    fn default() -> Self {
        // phones: 4096 tokens keeps Gemma 4 E2B within ~4.4 GB resident (measured); desktops: 8192
        Self { gpu: true, n_ctx: if cfg!(any(target_os = "ios", target_os = "android")) { 4096 } else { 8192 }, n_threads: None }
    }
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct GenParams {
    pub max_tokens: u32,
    /// 0 = greedy.
    pub temperature: f32,
    pub top_k: i32,
    pub top_p: f32,
    pub min_p: f32,
    pub seed: u32,
    /// Generation stops before any of these strings.
    pub stop: Vec<String>,
    /// Optional system prompt for `generate()`.
    pub system: Option<String>,
}

impl Default for GenParams {
    fn default() -> Self {
        // Gemma 4 recommended sampling (GGUF metadata): top_k 64, top_p 0.95, temperature 1.0
        Self { max_tokens: 512, temperature: 1.0, top_k: 64, top_p: 0.95, min_p: 0.0, seed: 0xC0FFEE, stop: vec![], system: None }
    }
}

#[derive(Clone, Debug, Default, Serialize, Deserialize)]
pub struct GenStats {
    pub text: String,
    pub prompt_tokens: usize,
    pub generated_tokens: usize,
    pub prompt_ms: f64,
    pub gen_ms: f64,
    /// Generation speed (tokens per second, excluding the prompt).
    pub tokens_per_s: f64,
    /// Prompt processing speed (tokens per second).
    pub prompt_tokens_per_s: f64,
    /// "eog", "max_tokens", "stop" or "callback".
    pub stop_reason: String,
}

/// Formats a conversation with the chat format of the model family.
pub fn format_chat(arch: &str, messages: &[Message], add_generation_prompt: bool) -> String {
    let mut s = String::new();
    match arch {
        // Gemma 4 (rendered from the GGUF Jinja template with enable_thinking = false)
        a if a.starts_with("gemma4") => {
            s.push_str("<bos>");
            for m in messages {
                let role = match m.role {
                    Role::System => "system",
                    Role::User => "user",
                    Role::Assistant => "model",
                };
                s.push_str(&format!("<|turn>{role}\n{}<turn|>\n", m.content.trim()));
            }
            if add_generation_prompt {
                s.push_str("<|turn>model\n");
            }
        }
        // Gemma 2/3 family
        a if a.starts_with("gemma") => {
            s.push_str("<bos>");
            let mut pending_system = String::new();
            for m in messages {
                match m.role {
                    Role::System => pending_system = format!("{}\n\n", m.content.trim()),
                    Role::User => {
                        s.push_str(&format!("<start_of_turn>user\n{}{}<end_of_turn>\n", pending_system, m.content.trim()));
                        pending_system.clear();
                    }
                    Role::Assistant => s.push_str(&format!("<start_of_turn>model\n{}<end_of_turn>\n", m.content.trim())),
                }
            }
            if add_generation_prompt {
                s.push_str("<start_of_turn>model\n");
            }
        }
        // ChatML (Qwen and others)
        _ => {
            for m in messages {
                let role = match m.role {
                    Role::System => "system",
                    Role::User => "user",
                    Role::Assistant => "assistant",
                };
                s.push_str(&format!("<|im_start|>{role}\n{}<|im_end|>\n", m.content));
            }
            if add_generation_prompt {
                s.push_str("<|im_start|>assistant\n");
            }
        }
    }
    s
}

pub(crate) struct GenInner {
    pub ctx: Context,
    /// Tokens currently in the KV cache (for prefix reuse).
    pub cached: Vec<i32>,
}

/// Gemma 4 (or any chat GGUF) loaded for generation and scoring.
pub struct Generator {
    pub(crate) model: Arc<Model>,
    pub(crate) inner: Mutex<GenInner>,
    arch: String,
}

impl Generator {
    pub fn load(mm: &ModelManager, id: &str, opts: GenOptions) -> Result<Self> {
        if !mm.is_downloaded(id) {
            return Err(Error::NotDownloaded(id.into()));
        }
        let p = mm.file_path(id, "model").ok_or_else(|| Error::NotFound(id.into()))?;
        Self::from_file(&p, opts)
    }

    pub fn from_file(path: &Path, opts: GenOptions) -> Result<Self> {
        let model = Model::load(path, opts.gpu)?;
        let ctx = Context::new(model.clone(), &ContextParams {
            n_ctx: opts.n_ctx,
            n_batch: 512,
            n_ubatch: 512,
            n_seq_max: 1,
            embeddings: false,
            pooling_mean: false,
            n_threads: opts.n_threads,
        })?;
        let arch = model.architecture();
        Ok(Self { model, inner: Mutex::new(GenInner { ctx, cached: vec![] }), arch })
    }

    pub fn architecture(&self) -> &str {
        &self.arch
    }

    pub fn format(&self, messages: &[Message], add_generation_prompt: bool) -> String {
        format_chat(&self.arch, messages, add_generation_prompt)
    }

    pub fn tokenize_prompt(&self, formatted: &str) -> Result<Vec<i32>> {
        // the formatted prompt already carries <bos>
        self.model.tokenize(formatted, false, true)
    }

    /// Evaluates `tokens` reusing the longest cached prefix; logits of the last token are ready.
    pub(crate) fn prefill(inner: &mut GenInner, tokens: &[i32]) -> Result<()> {
        if tokens.len() >= inner.ctx.n_ctx as usize {
            return Err(Error::Input(format!("prompt of {} tokens does not fit the context ({})", tokens.len(), inner.ctx.n_ctx)));
        }
        let mut common = inner.cached.iter().zip(tokens).take_while(|(a, b)| a == b).count();
        if common == tokens.len() {
            common -= 1; // re-evaluate the last token to get fresh logits
        }
        if common == 0 || !inner.ctx.truncate(common as i32) {
            inner.ctx.clear();
            common = 0;
        }
        let rest: Vec<Entry> = tokens[common..].iter().map(|t| Entry::Token(*t)).collect();
        let last = rest.len() - 1;
        inner.ctx.decode(&rest, 0, common as i32, |i| i == last)?;
        inner.cached = tokens.to_vec();
        Ok(())
    }

    /// Chat completion, streaming text pieces to `on_token` (return false to stop).
    pub fn chat(&self, messages: &[Message], params: &GenParams, mut on_token: impl FnMut(&str) -> bool) -> Result<GenStats> {
        let prompt = self.format(messages, true);
        let tokens = self.tokenize_prompt(&prompt)?;
        let mut inner = self.inner.lock().map_err(|_| Error::msg("poisoned lock"))?;
        let t0 = Instant::now();
        Self::prefill(&mut inner, &tokens)?;
        let prompt_ms = t0.elapsed().as_secs_f64() * 1000.0;
        let mut sampler = Sampler::new(params.temperature, params.top_k, params.top_p, params.min_p, params.seed);
        let mut utf8 = Utf8Stream::default();
        let mut text = String::new();
        let mut emitted = 0usize; // bytes of `text` already passed to the callback
        let mut n_gen = 0usize;
        let mut reason = "max_tokens".to_string();
        let t1 = Instant::now();
        let max_stop = params.stop.iter().map(|s| s.len()).max().unwrap_or(0);
        while n_gen < params.max_tokens as usize {
            let tok = sampler.sample(&inner.ctx, -1);
            n_gen += 1;
            if self.model.is_eog(tok) {
                reason = "eog".into();
                break;
            }
            text.push_str(&utf8.push(&self.model.token_bytes(tok, false)));
            if let Some(pos) = params.stop.iter().filter_map(|s| text.find(s.as_str())).min() {
                text.truncate(pos);
                if text.len() > emitted && !on_token(&text[emitted..]) {
                    reason = "callback".into();
                } else {
                    reason = "stop".into();
                }
                emitted = text.len();
                break;
            }
            // hold back what could still become a stop string
            let mut safe = text.len().saturating_sub(max_stop);
            while !text.is_char_boundary(safe) {
                safe -= 1;
            }
            if safe > emitted {
                if !on_token(&text[emitted..safe]) {
                    reason = "callback".into();
                    emitted = safe;
                    break;
                }
                emitted = safe;
            }
            let pos = (inner.cached.len()) as i32;
            inner.ctx.decode(&[Entry::Token(tok)], 0, pos, |_| true)?;
            inner.cached.push(tok);
        }
        text.push_str(&utf8.finish());
        if reason != "callback" && text.len() > emitted {
            on_token(&text[emitted..]);
        }
        let gen_ms = t1.elapsed().as_secs_f64() * 1000.0;
        Ok(GenStats {
            prompt_tokens: tokens.len(),
            generated_tokens: n_gen,
            prompt_ms,
            gen_ms,
            tokens_per_s: if gen_ms > 0.0 { n_gen as f64 / (gen_ms / 1000.0) } else { 0.0 },
            prompt_tokens_per_s: if prompt_ms > 0.0 { tokens.len() as f64 / (prompt_ms / 1000.0) } else { 0.0 },
            stop_reason: reason,
            text,
        })
    }

    /// Single-turn generation (optional system prompt in `params.system`).
    pub fn generate(&self, prompt: &str, params: &GenParams, on_token: impl FnMut(&str) -> bool) -> Result<GenStats> {
        let mut msgs = vec![];
        if let Some(s) = &params.system {
            msgs.push(Message::system(s.clone()));
        }
        msgs.push(Message::user(prompt));
        self.chat(&msgs, params, on_token)
    }

    /// Logits of the next token after `messages` + the opening of the model turn + `prefix`.
    pub fn next_token_logits(&self, messages: &[Message], prefix: &str) -> Result<Vec<f32>> {
        let prompt = format!("{}{}", self.format(messages, true), prefix);
        let tokens = self.tokenize_prompt(&prompt)?;
        let mut inner = self.inner.lock().map_err(|_| Error::msg("poisoned lock"))?;
        Self::prefill(&mut inner, &tokens)?;
        Ok(inner.ctx.logits_ith(-1)?.to_vec())
    }

    pub fn model(&self) -> &Model {
        &self.model
    }
}
