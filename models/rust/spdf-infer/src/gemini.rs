//! Gemini with the user's own key (bring your own key): embeddings and streamed generation over
//! the public REST API. The key travels in the `x-goog-api-key` header (never in the URL) and is
//! never stored by this crate; the app keeps it in the system keychain.

use std::io::{BufRead, BufReader};

use serde_json::{json, Value};

use crate::{
    embed::{mrl, Embed, Space, Task},
    generate::{GenParams, GenStats, Message, Role},
    Error, Result,
};

const API: &str = "https://generativelanguage.googleapis.com/v1beta";

fn agent() -> ureq::Agent {
    ureq::Agent::config_builder()
        .timeout_global(Some(std::time::Duration::from_secs(300)))
        .http_status_as_error(false)
        .build()
        .into()
}

fn check(status: u16, body: &str) -> Result<()> {
    if (200..300).contains(&status) {
        return Ok(());
    }
    let msg = serde_json::from_str::<Value>(body).ok().and_then(|v| v["error"]["message"].as_str().map(str::to_string)).unwrap_or_else(|| body.chars().take(200).collect());
    Err(Error::Inference(format!("Gemini HTTP {status}: {msg}")))
}

/// Gemini embeddings (`gemini-embedding-001` by default; 3072 dims with Matryoshka cuts).
pub struct GeminiEmbedder {
    key: String,
    pub model: String,
    pub native_dims: usize,
    agent: ureq::Agent,
}

impl GeminiEmbedder {
    pub fn new(key: impl Into<String>, model: Option<&str>) -> Self {
        let model = model.unwrap_or("gemini-embedding-001").to_string();
        let native_dims = if model.starts_with("gemini-embedding-001") { 3072 } else { 3072 };
        Self { key: key.into(), model, native_dims, agent: agent() }
    }

    fn task_type(task: &Task) -> &'static str {
        match task {
            Task::Query => "RETRIEVAL_QUERY",
            Task::Document { .. } => "RETRIEVAL_DOCUMENT",
            Task::QuestionAnswering => "QUESTION_ANSWERING",
            Task::FactChecking => "FACT_VERIFICATION",
            Task::Classification => "CLASSIFICATION",
            Task::Clustering => "CLUSTERING",
            Task::Similarity => "SEMANTIC_SIMILARITY",
            Task::CodeRetrieval => "CODE_RETRIEVAL_QUERY",
            Task::Raw => "TASK_TYPE_UNSPECIFIED",
        }
    }
}

impl Embed for GeminiEmbedder {
    fn embed(&self, texts: &[&str], task: Task, dims: Option<usize>) -> Result<Vec<Vec<f32>>> {
        let mut out = Vec::with_capacity(texts.len());
        for chunk in texts.chunks(100) {
            let reqs: Vec<Value> = chunk
                .iter()
                .map(|t| {
                    let mut r = json!({"model": format!("models/{}", self.model), "content": {"parts": [{"text": t}]},
                                       "taskType": Self::task_type(&task)});
                    if let Some(d) = dims {
                        r["outputDimensionality"] = json!(d);
                    }
                    if let Task::Document { title: Some(title) } = &task {
                        r["title"] = json!(title);
                    }
                    r
                })
                .collect();
            let mut resp = self
                .agent
                .post(&format!("{API}/models/{}:batchEmbedContents", self.model))
                .header("x-goog-api-key", &self.key)
                .header("Content-Type", "application/json")
                .send(json!({"requests": reqs}).to_string())
                .map_err(|e| Error::Inference(format!("Gemini: {e}")))?;
            let status = resp.status().as_u16();
            let body = resp.body_mut().read_to_string().map_err(|e| Error::Inference(format!("Gemini: {e}")))?;
            check(status, &body)?;
            let v: Value = serde_json::from_str(&body)?;
            for e in v["embeddings"].as_array().ok_or_else(|| Error::Inference("Gemini: no embeddings".into()))? {
                let vals: Vec<f32> = e["values"].as_array().unwrap_or(&vec![]).iter().map(|x| x.as_f64().unwrap_or(0.0) as f32).collect();
                out.push(mrl(&vals, None)?); // reduced dimensions come back unnormalised
            }
        }
        Ok(out)
    }

    fn space(&self, dims: Option<usize>) -> Space {
        let d = dims.unwrap_or(self.native_dims);
        Space {
            id: format!("{}@{d}", self.model),
            provider: "google".into(),
            model: self.model.clone(),
            version: None,
            dims: d,
            dtype: "f32".into(),
            normalized: true,
            truncated_from: if d < self.native_dims { Some(self.native_dims) } else { None },
            modalities: vec!["text".into()],
            // Gemini takes a task type instead of a text prefix; recorded so spaces compare honestly
            task_prefixes: Some([("document".to_string(), "task_type:RETRIEVAL_DOCUMENT".to_string()), ("query".to_string(), "task_type:RETRIEVAL_QUERY".to_string())].into_iter().collect()),
        }
    }
}

/// Gemini generation, streamed (server-sent events).
pub struct GeminiGenerator {
    key: String,
    pub model: String,
    agent: ureq::Agent,
}

impl GeminiGenerator {
    pub fn new(key: impl Into<String>, model: Option<&str>) -> Self {
        Self { key: key.into(), model: model.unwrap_or("gemini-flash-latest").to_string(), agent: agent() }
    }

    pub fn chat(&self, messages: &[Message], params: &GenParams, mut on_token: impl FnMut(&str) -> bool) -> Result<GenStats> {
        let system: Vec<&str> = messages.iter().filter(|m| m.role == Role::System).map(|m| m.content.as_str()).collect();
        let contents: Vec<Value> = messages
            .iter()
            .filter(|m| m.role != Role::System)
            .map(|m| json!({"role": if m.role == Role::Assistant { "model" } else { "user" }, "parts": [{"text": m.content}]}))
            .collect();
        let mut body = json!({"contents": contents, "generationConfig": {
            "maxOutputTokens": params.max_tokens, "temperature": params.temperature, "topP": params.top_p, "topK": params.top_k,
            "stopSequences": params.stop}});
        if !system.is_empty() || params.system.is_some() {
            let s = params.system.clone().into_iter().chain(system.iter().map(|s| s.to_string())).collect::<Vec<_>>().join("\n\n");
            body["systemInstruction"] = json!({"parts": [{"text": s}]});
        }
        let t0 = std::time::Instant::now();
        let resp = self
            .agent
            .post(&format!("{API}/models/{}:streamGenerateContent?alt=sse", self.model))
            .header("x-goog-api-key", &self.key)
            .header("Content-Type", "application/json")
            .send(body.to_string())
            .map_err(|e| Error::Inference(format!("Gemini: {e}")))?;
        let status = resp.status().as_u16();
        let reader = BufReader::new(resp.into_body().into_reader());
        if !(200..300).contains(&status) {
            let text: String = reader.lines().map_while(|l| l.ok()).collect::<Vec<_>>().join("\n");
            check(status, &text)?;
            unreachable!("check() fails on non-2xx");
        }
        let mut stats = GenStats { stop_reason: "eog".into(), ..Default::default() };
        let mut first = None;
        for line in reader.lines() {
            let line = line?;
            let Some(data) = line.strip_prefix("data:") else { continue };
            let v: Value = match serde_json::from_str(data.trim()) {
                Ok(v) => v,
                Err(_) => continue,
            };
            if let Some(parts) = v["candidates"][0]["content"]["parts"].as_array() {
                for p in parts {
                    if let Some(t) = p["text"].as_str() {
                        first.get_or_insert_with(std::time::Instant::now);
                        stats.text.push_str(t);
                        if !on_token(t) {
                            stats.stop_reason = "callback".into();
                            break;
                        }
                    }
                }
            }
            if let Some(u) = v.get("usageMetadata") {
                stats.prompt_tokens = u["promptTokenCount"].as_u64().unwrap_or(0) as usize;
                stats.generated_tokens = u["candidatesTokenCount"].as_u64().unwrap_or(0) as usize;
            }
            if v["candidates"][0]["finishReason"] == "MAX_TOKENS" {
                stats.stop_reason = "max_tokens".into();
            }
            if stats.stop_reason == "callback" {
                break;
            }
        }
        let first = first.unwrap_or_else(std::time::Instant::now);
        stats.prompt_ms = (first - t0).as_secs_f64() * 1000.0;
        stats.gen_ms = first.elapsed().as_secs_f64() * 1000.0;
        stats.tokens_per_s = if stats.gen_ms > 0.0 { stats.generated_tokens as f64 / (stats.gen_ms / 1000.0) } else { 0.0 };
        Ok(stats)
    }

    pub fn generate(&self, prompt: &str, params: &GenParams, on_token: impl FnMut(&str) -> bool) -> Result<GenStats> {
        self.chat(&[Message::user(prompt)], params, on_token)
    }
}
