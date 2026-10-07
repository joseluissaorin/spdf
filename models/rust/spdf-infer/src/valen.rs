//! Valen-0.8B (Valen-Team, Apache 2.0) on onnxruntime: a native decision model, exported by
//! models/valen/export_onnx.py (Qwen3.5 backbone with hidden-state output + Mixer head).
//!
//! The prompt compiler is a port of Valen's shared-state compiler; models/valen checks the
//! Python port token for token against Valen's own code, and this one is checked against the
//! Python port with fixtures (tests below).

use std::{collections::BTreeMap, path::Path, sync::Mutex};

use ndarray::{Array2, Array3, Array4};
use ort::{session::Session, value::Tensor};
use serde::{Deserialize, Serialize};

use crate::{Error, Result};

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum QuestionType {
    Choice,
    Noul,
    Score,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Question {
    #[serde(rename = "type")]
    pub kind: QuestionType,
    pub instructions: String,
    /// choice: {key: description} (in order); score: descriptions, lowest first.
    #[serde(default)]
    pub criteria: Criteria,
}

#[derive(Clone, Debug, Default, Serialize, Deserialize)]
#[serde(untagged)]
pub enum Criteria {
    #[default]
    None,
    Map(Vec<(String, String)>),
    List(Vec<String>),
}

#[derive(Clone, Debug)]
pub struct Request {
    pub state: String,
    /// question id -> question, in order
    pub questions: Vec<(String, Question)>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Answer {
    #[serde(rename = "type")]
    pub kind: QuestionType,
    /// option key -> probability (noul: "true"/"false")
    pub probabilities: Vec<(String, f32)>,
    pub choice: Option<String>,
    pub noul: Option<f32>,
    pub score: Option<f32>,
}

const NOUL: [(&str, &str); 2] = [("true", "True / 是：满足问题中的条件。"), ("false", "False / 否：不满足问题中的条件。")];

pub fn candidates(q: &Question) -> Result<Vec<(String, String)>> {
    Ok(match (&q.kind, &q.criteria) {
        (QuestionType::Noul, _) => NOUL.iter().map(|(a, b)| (a.to_string(), b.to_string())).collect(),
        (QuestionType::Choice, Criteria::Map(m)) => m.clone(),
        (QuestionType::Score, Criteria::List(l)) => l.iter().enumerate().map(|(i, t)| (i.to_string(), t.clone())).collect(),
        _ => return Err(Error::Input("choice needs a map of criteria, score a list".into())),
    })
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct Readout {
    pub qid: String,
    pub kind: QuestionType,
    pub keys: Vec<String>,
    pub context: (usize, usize),
    pub instruction: (usize, usize),
    pub candidates: Vec<(usize, usize)>,
    pub decision: usize,
}

pub struct Compiler<'a> {
    tok: &'a tokenizers::Tokenizer,
    specials: Vec<String>,
}

impl<'a> Compiler<'a> {
    pub fn new(tok: &'a tokenizers::Tokenizer) -> Self {
        let specials = tok.get_added_tokens_decoder().values().filter(|t| t.special && t.content.len() > 1).map(|t| t.content.clone()).collect();
        Self { tok, specials }
    }

    fn check(&self, s: &str) -> Result<()> {
        match self.specials.iter().find(|t| s.contains(t.as_str())) {
            Some(t) => Err(Error::Input(format!("reserved control token in input: {t}"))),
            None => Ok(()),
        }
    }

    fn encode(&self, text: &str) -> Result<tokenizers::Encoding> {
        self.tok.encode_char_offsets(text, false).map_err(|e| Error::Inference(format!("tokenizer: {e}")))
    }

    /// (token ids, readouts) exactly as Valen's shared-state compiler builds them.
    pub fn compile(&self, req: &Request) -> Result<(Vec<u32>, Vec<Readout>)> {
        self.check(&req.state)?;
        let base = self.encode(&format!("<|im_start|>user\n{}<|im_end|>\n", req.state))?.get_ids().to_vec();
        let mut ids = base.clone();
        let append = |ids: &mut Vec<u32>, text: &str, span: Option<(usize, usize)>| -> Result<Option<(usize, usize)>> {
            let start = ids.len();
            let e = self.encode(text)?;
            ids.extend_from_slice(e.get_ids());
            let Some((s0, s1)) = span else { return Ok(None) };
            let idx: Vec<usize> = e.get_offsets().iter().enumerate().filter(|(_, (a, b))| *a < s1 && *b > s0).map(|(i, _)| i).collect();
            if idx.is_empty() {
                return Err(Error::Input("empty token span for decision role".into()));
            }
            Ok(Some((start + idx[0], start + idx[idx.len() - 1] + 1)))
        };
        let mut readouts = Vec::new();
        append(&mut ids, "<|im_start|>user\n", None)?;
        for (index, (qid, q)) in req.questions.iter().enumerate() {
            self.check(&q.instructions)?;
            let pairs = candidates(q)?;
            for (k, d) in &pairs {
                self.check(k)?;
                self.check(d)?;
            }
            let kind = match q.kind {
                QuestionType::Choice => "choice",
                QuestionType::Noul => "noul",
                QuestionType::Score => "score",
            };
            let prefix = format!("Question {}\nTask: {kind}\nQuestion: ", index + 1);
            let pc = prefix.chars().count();
            let ic = q.instructions.chars().count();
            let instruction = append(&mut ids, &format!("{prefix}{}\nCandidates:\n", q.instructions), Some((pc, pc + ic)))?.unwrap();
            let mut spans = Vec::new();
            for (key, desc) in &pairs {
                let p = if q.kind != QuestionType::Score { format!("{key}: ") } else { String::new() };
                let pl = p.chars().count();
                spans.push(append(&mut ids, &format!("{p}{desc}"), Some((pl, pl + desc.chars().count())))?.unwrap());
                append(&mut ids, "\n", None)?;
            }
            readouts.push(Readout {
                qid: qid.clone(),
                kind: q.kind.clone(),
                keys: pairs.iter().map(|(k, _)| k.clone()).collect(),
                context: (0, base.len()),
                instruction,
                candidates: spans,
                decision: 0,
            });
        }
        append(&mut ids, "<|im_end|>\n<|im_start|>assistant\n", None)?;
        for (index, r) in readouts.iter_mut().enumerate() {
            append(&mut ids, &format!("Question {} Decision:", index + 1), None)?;
            r.decision = ids.len() - 1;
            append(&mut ids, "\n", None)?;
        }
        Ok((ids, readouts))
    }
}

/// Softmax with temperature, and Valen's answer shape.
pub fn answer(kind: &QuestionType, keys: &[String], logits: &[f32], temperature: f32) -> Answer {
    let t = if temperature > 0.0 { temperature } else { 1.0 };
    let m = logits.iter().cloned().fold(f32::NEG_INFINITY, f32::max);
    let e: Vec<f64> = logits.iter().map(|z| (((z - m) / t) as f64).exp()).collect();
    let s: f64 = e.iter().sum();
    let p: Vec<f32> = e.iter().map(|x| (x / s) as f32).collect();
    let probabilities: Vec<(String, f32)> = keys.iter().cloned().zip(p.iter().cloned()).collect();
    let mode = p.iter().enumerate().max_by(|a, b| a.1.total_cmp(b.1)).map(|x| x.0).unwrap_or(0);
    match kind {
        QuestionType::Noul => Answer { kind: kind.clone(), noul: keys.iter().position(|k| k == "true").map(|i| p[i]), probabilities, choice: None, score: None },
        QuestionType::Choice => Answer { kind: kind.clone(), choice: Some(keys[mode].clone()), probabilities, noul: None, score: None },
        QuestionType::Score => Answer {
            kind: kind.clone(),
            score: Some(p.iter().enumerate().map(|(i, x)| i as f32 * x).sum()),
            probabilities,
            choice: None,
            noul: None,
        },
    }
}

pub struct ValenOnnx {
    backbone: Mutex<Session>,
    head: Mutex<Session>,
    tokenizer: tokenizers::Tokenizer,
    state_inputs: Vec<String>,
    hidden: usize,
}

fn ort_err<E: std::fmt::Display>(e: E) -> Error {
    Error::Inference(format!("onnxruntime: {e}"))
}

impl ValenOnnx {
    /// `dir` holds valen_backbone{,_int8,_q4}.onnx (+ data), valen_head.onnx and tokenizer.json.
    pub fn load(dir: &Path, variant: &str, threads: Option<usize>) -> Result<Self> {
        let name = if variant.is_empty() || variant == "fp32" { "valen_backbone.onnx".to_string() } else { format!("valen_backbone_{variant}.onnx") };
        let mk = |p: &Path| -> Result<Session> {
            let mut b = Session::builder().map_err(ort_err)?;
            if let Some(t) = threads {
                b = b.with_intra_threads(t).map_err(ort_err)?;
            }
            b.commit_from_file(p).map_err(ort_err)
        };
        let backbone = mk(&dir.join(&name))?;
        let head = mk(&dir.join("valen_head.onnx"))?;
        let tokenizer = tokenizers::Tokenizer::from_file(dir.join("tokenizer.json")).map_err(|e| Error::Load(format!("tokenizer: {e}")))?;
        let state_inputs = backbone.inputs().iter().map(|i| i.name().to_string()).filter(|n| n.starts_with("past_")).collect();
        Ok(Self { backbone: Mutex::new(backbone), head: Mutex::new(head), tokenizer, state_inputs, hidden: 1024 })
    }

    pub fn tokenizer(&self) -> &tokenizers::Tokenizer {
        &self.tokenizer
    }

    fn hidden_states(&self, ids: &[u32]) -> Result<Vec<f32>> {
        let n = ids.len();
        let mut inputs: Vec<(std::borrow::Cow<'static, str>, ort::session::SessionInputValue<'static>)> = vec![
            ("input_ids".into(), Tensor::from_array(Array2::from_shape_vec((1, n), ids.iter().map(|&x| x as i64).collect()).unwrap()).map_err(ort_err)?.into()),
            ("attention_mask".into(), Tensor::from_array(Array2::<i64>::ones((1, n))).map_err(ort_err)?.into()),
            ("position_ids".into(), Tensor::from_array(Array3::from_shape_fn((3, 1, n), |(_, _, k)| k as i64)).map_err(ort_err)?.into()),
        ];
        for name in &self.state_inputs {
            let v: ort::session::SessionInputValue<'static> = if name.starts_with("past_conv") {
                Tensor::from_array(Array3::<f32>::zeros((1, 6144, 4))).map_err(ort_err)?.into()
            } else if name.starts_with("past_recurrent") {
                Tensor::from_array(Array4::<f32>::zeros((1, 16, 128, 128))).map_err(ort_err)?.into()
            } else {
                Tensor::from_array(Array4::<f32>::zeros((1, 2, 0, 256))).map_err(ort_err)?.into()
            };
            inputs.push((name.clone().into(), v));
        }
        let mut s = self.backbone.lock().map_err(|_| Error::msg("poisoned lock"))?;
        let out = s.run(inputs).map_err(ort_err)?;
        let (_, data) = out["hidden_states"].try_extract_tensor::<f32>().map_err(ort_err)?;
        Ok(data.to_vec())
    }

    fn features(&self, h: &[f32], r: &Readout) -> Array3<f32> {
        let d = self.hidden;
        let mean = |a: usize, b: usize| -> Vec<f32> {
            let mut v = vec![0f32; d];
            for t in a..b {
                for j in 0..d {
                    v[j] += h[t * d + j];
                }
            }
            v.iter_mut().for_each(|x| *x /= (b - a) as f32);
            v
        };
        let ctx = mean(r.context.0, r.context.1);
        let ins = mean(r.instruction.0, r.instruction.1);
        let dec = &h[r.decision * d..(r.decision + 1) * d];
        let mut f = Array3::<f32>::zeros((r.candidates.len(), 4, d));
        for (i, &(a, b)) in r.candidates.iter().enumerate() {
            let c = mean(a, b);
            for j in 0..d {
                f[[i, 0, j]] = ctx[j];
                f[[i, 1, j]] = ins[j];
                f[[i, 2, j]] = c[j];
                f[[i, 3, j]] = dec[j];
            }
        }
        f
    }

    /// One shared-state forward pass, then the head for each question.
    pub fn predict(&self, req: &Request, temperature: f32) -> Result<(BTreeMap<String, Answer>, usize)> {
        let (ids, readouts) = Compiler::new(&self.tokenizer).compile(req)?;
        let h = self.hidden_states(&ids)?;
        let mut out = BTreeMap::new();
        let mut head = self.head.lock().map_err(|_| Error::msg("poisoned lock"))?;
        for r in &readouts {
            let f = self.features(&h, r);
            let res = head.run(ort::inputs!["features" => Tensor::from_array(f).map_err(ort_err)?]).map_err(ort_err)?;
            let (_, logits) = res["logits"].try_extract_tensor::<f32>().map_err(ort_err)?;
            out.insert(r.qid.clone(), answer(&r.kind, &r.keys, logits, temperature));
        }
        Ok((out, ids.len()))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Fixtures written by models/tools/fixtures.py from the Python port (itself checked against
    /// Valen's own compiler); skipped when the tokenizer is not in the local cache.
    #[test]
    fn compiler_matches_python_fixtures() {
        let fx = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../../web/test/fixtures/valen_compile.json");
        let tok = dirs_cache().join("valen-onnx/tokenizer.json");
        if !fx.exists() || !tok.exists() {
            eprintln!("skipped: no fixtures or tokenizer");
            return;
        }
        let tok = tokenizers::Tokenizer::from_file(tok).unwrap();
        let cases: Vec<serde_json::Value> = serde_json::from_str(&std::fs::read_to_string(fx).unwrap()).unwrap();
        for c in cases {
            let req = request_from_json(&c["request"]).unwrap();
            let (ids, rs) = Compiler::new(&tok).compile(&req).unwrap();
            let want: Vec<u32> = serde_json::from_value(c["ids"].clone()).unwrap();
            assert_eq!(ids, want, "ids for {}", c["name"]);
            for (r, w) in rs.iter().zip(c["readouts"].as_array().unwrap()) {
                assert_eq!(r.instruction, (w["instruction"][0].as_u64().unwrap() as usize, w["instruction"][1].as_u64().unwrap() as usize));
                assert_eq!(r.decision, w["decision"].as_u64().unwrap() as usize);
                let cands: Vec<(usize, usize)> = w["candidates"].as_array().unwrap().iter().map(|x| (x[0].as_u64().unwrap() as usize, x[1].as_u64().unwrap() as usize)).collect();
                assert_eq!(r.candidates, cands);
            }
        }
    }

    fn dirs_cache() -> std::path::PathBuf {
        std::env::var_os("SPDF_MODELS_CACHE").map(Into::into).unwrap_or_else(|| std::path::PathBuf::from(std::env::var_os("HOME").unwrap()).join(".cache/spdf-models"))
    }
}

/// Builds a request from Valen's JSON shape: {"state": "...", "questions": {id: {type, instructions, criteria}}}
/// (object key order is kept, as Valen's compiler does).
pub fn request_from_json(v: &serde_json::Value) -> Result<Request> {
    let state = v["state"].as_str().ok_or_else(|| Error::Input("state must be text".into()))?.to_string();
    let qs = v["questions"].as_object().ok_or_else(|| Error::Input("questions must be an object".into()))?;
    let mut questions = Vec::new();
    for (qid, q) in qs {
        let kind: QuestionType = serde_json::from_value(q["type"].clone())?;
        let criteria = match &q["criteria"] {
            serde_json::Value::Object(m) => Criteria::Map(m.iter().map(|(k, d)| (k.clone(), d.as_str().unwrap_or_default().to_string())).collect()),
            serde_json::Value::Array(a) => Criteria::List(a.iter().map(|d| d.as_str().unwrap_or_default().to_string()).collect()),
            _ => Criteria::None,
        };
        questions.push((qid.clone(), Question { kind, instructions: q["instructions"].as_str().unwrap_or_default().to_string(), criteria }));
    }
    Ok(Request { state, questions })
}
