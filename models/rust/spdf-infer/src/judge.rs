//! A Jev-style judge on a local generative model: an instruction, some content and candidate
//! labels in, one probability per label out.
//!
//! Method: the labels are listed as lettered options (A, B, C…), the model reads the prompt once,
//! and the probabilities are the softmax of the logits of the option letters at the first answer
//! position (one forward pass, no generation). Calibration: a temperature, and optionally a
//! content-free prior correction (Zhao et al., 2021) that removes the letter bias measured with
//! an empty input.

use std::{
    collections::HashMap,
    sync::{Arc, Mutex},
};

use serde::{Deserialize, Serialize};

use crate::{
    generate::{GenOptions, Generator, Message},
    manager::ModelManager,
    Error, Result,
};

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Label {
    pub name: String,
    pub description: Option<String>,
}

impl Label {
    pub fn new(name: impl Into<String>, description: impl Into<String>) -> Self {
        Self { name: name.into(), description: Some(description.into()) }
    }
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Calibration {
    /// Softmax temperature over the option logits (fitted on the SPDF judge bench).
    pub temperature: f32,
    /// Divide by the probabilities obtained with a content-free input.
    pub prior_correction: bool,
}

impl Default for Calibration {
    fn default() -> Self {
        Self { temperature: 1.0, prior_correction: false }
    }
}

/// Relations between a claim and a cited passage (Scholaris vocabulary).
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[allow(non_camel_case_types)]
pub enum Relation {
    APOYO_DIRECTO,
    APLICACION_DE_MARCO,
    CONTEXTO,
    CONTRADICCION,
    IMPOSIBLE_TEMPORAL,
    OPINION_REFERIDA,
    AFIRMACION_NEGATIVA,
}

impl Relation {
    pub const ALL: [Relation; 7] = [
        Relation::APOYO_DIRECTO,
        Relation::APLICACION_DE_MARCO,
        Relation::CONTEXTO,
        Relation::CONTRADICCION,
        Relation::IMPOSIBLE_TEMPORAL,
        Relation::OPINION_REFERIDA,
        Relation::AFIRMACION_NEGATIVA,
    ];
    pub fn name(&self) -> &'static str {
        match self {
            Relation::APOYO_DIRECTO => "APOYO_DIRECTO",
            Relation::APLICACION_DE_MARCO => "APLICACION_DE_MARCO",
            Relation::CONTEXTO => "CONTEXTO",
            Relation::CONTRADICCION => "CONTRADICCION",
            Relation::IMPOSIBLE_TEMPORAL => "IMPOSIBLE_TEMPORAL",
            Relation::OPINION_REFERIDA => "OPINION_REFERIDA",
            Relation::AFIRMACION_NEGATIVA => "AFIRMACION_NEGATIVA",
        }
    }
    /// Definitions given to the judge (the ones Scholaris gives Jev, plus the temporal one).
    pub fn description(&self) -> &'static str {
        match self {
            Relation::APOYO_DIRECTO => "The passage directly states the claim or logically entails it.",
            Relation::APLICACION_DE_MARCO => "The claim applies a concept or framework from the passage to a new domain the passage does not discuss.",
            Relation::CONTEXTO => "The passage is on the same topic and gives background, but does not establish this specific claim.",
            Relation::CONTRADICCION => "The passage states the opposite of the claim or gives a different fact, number, date or name.",
            Relation::IMPOSIBLE_TEMPORAL => "The source cannot speak about what the claim says because of chronology: it was written before the events, works or ideas the claim attributes to it.",
            Relation::OPINION_REFERIDA => "The claim reports someone's view, and the passage is where that view is stated or reported.",
            Relation::AFIRMACION_NEGATIVA => "The claim says something is absent or does not happen, while the passage only discusses what is present.",
        }
    }
    pub fn from_name(s: &str) -> Option<Self> {
        Self::ALL.iter().copied().find(|r| r.name() == s)
    }
}

/// Verdict on a claim–passage pair.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Support {
    /// Most probable relation.
    pub label: Relation,
    /// Probability of each relation (sums to 1).
    pub probs: Vec<(Relation, f32)>,
    /// Probability that the passage backs the claim (yes/no question).
    pub supported: f32,
}

/// Optional source metadata shown to the judge (helps with IMPOSIBLE_TEMPORAL).
#[derive(Clone, Debug, Default, Serialize, Deserialize)]
pub struct SourceInfo {
    pub author: Option<String>,
    pub title: Option<String>,
    pub year: Option<i32>,
}

pub const SUPPORT_TASK: &str = "Checking academic citations. Does the passage support the claim, so that a skeptical reader checking the citation would agree the source says it?";
pub const SUPPORT_YES: &str = "The passage states or clearly entails the claim.";
pub const SUPPORT_NO: &str = "The passage only shares the topic, says something different, or contradicts the claim.";
pub const RELATION_TASK: &str = "Checking academic citations. How does the passage relate to the claim?";
pub const RELEVANCE_TASK: &str = "Search relevance. How well does the passage answer the query?";

/// The 0-3 relevance rubric (same as Scholaris' judgments).
pub fn relevance_labels() -> [Label; 4] {
    [
        Label::new("0", "Irrelevant: unrelated to the query."),
        Label::new("1", "Related: same topic, but does not help answer the query."),
        Label::new("2", "Relevant: partially answers the query or gives useful evidence for it."),
        Label::new("3", "Highly relevant: directly and fully answers the query."),
    ]
}

pub fn support_labels() -> [Label; 2] {
    [Label::new("YES", SUPPORT_YES), Label::new("NO", SUPPORT_NO)]
}

pub fn relation_labels() -> Vec<Label> {
    Relation::ALL.iter().map(|r| Label::new(r.name(), r.description())).collect()
}

const SYSTEM: &str = "You are a careful, skeptical judge. Read the task, the content and the options, and choose the single best option. Answer with the letter of that option only.";

enum Engine {
    /// A generative model scored by the logits of the option letters.
    Gemma { gen: Arc<Generator>, letters: Vec<i32> },
    /// Valen, a native decision model (onnxruntime).
    #[cfg(feature = "valen-onnx")]
    Valen(crate::valen::ValenOnnx),
}

/// Valen reads plain questions: drop the "Checking academic citations." style framing.
#[cfg(feature = "valen-onnx")]
fn valen_question(task: &str) -> String {
    match task {
        SUPPORT_TASK => "Does the passage support the claim, so that a skeptical reader checking the citation would agree the source says it?".into(),
        RELATION_TASK => "How does the passage relate to the claim?".into(),
        RELEVANCE_TASK => "How well does the passage answer the search query?".into(),
        t => t.to_string(),
    }
}

pub struct Judge {
    engine: Engine,
    pub calibration: Calibration,
    /// Calibration of the yes/no support question (fitted separately from the relation choice).
    pub support_calibration: Calibration,
    priors: Mutex<HashMap<String, Vec<f32>>>,
}

impl Judge {
    /// Loads a judge from the catalog: Gemma 4 GGUF (llama.cpp) or, with the `valen-onnx`
    /// feature, Valen ONNX (onnxruntime).
    pub fn load(mm: &ModelManager, id: &str) -> Result<Self> {
        let e = mm.entry(id).ok_or_else(|| Error::NotFound(id.into()))?.clone();
        let mut j = if e.engine == "onnxruntime" {
            #[cfg(feature = "valen-onnx")]
            {
                if !mm.is_downloaded(id) {
                    return Err(Error::NotDownloaded(id.into()));
                }
                Self::valen(crate::valen::ValenOnnx::load(&mm.dir(id), e.dtype.as_deref().unwrap_or("int8"), None)?)
            }
            #[cfg(not(feature = "valen-onnx"))]
            return Err(Error::Unsupported(format!("{id} needs spdf-infer built with the valen-onnx feature")));
        } else {
            Self::new(Arc::new(Generator::load(mm, id, GenOptions { n_ctx: 8192, ..Default::default() })?))?
        };
        if let Some(c) = mm.entry(id).and_then(|e| e.judge_calibration.clone()) {
            j.calibration = c.choice;
            j.support_calibration = c.noul;
        }
        Ok(j)
    }

    /// Builds a judge on a loaded generator (the weights are shared, not copied).
    pub fn new(gen: Arc<Generator>) -> Result<Self> {
        let mut letters = Vec::new();
        for c in 'A'..='Z' {
            let t = gen.model().tokenize(&c.to_string(), false, false)?;
            if t.len() != 1 {
                return Err(Error::Unsupported(format!("option letter {c} is not a single token for this model")));
            }
            letters.push(t[0]);
        }
        Ok(Self {
            engine: Engine::Gemma { gen, letters },
            calibration: Calibration::default(),
            support_calibration: Calibration::default(),
            priors: Mutex::new(HashMap::new()),
        })
    }

    /// A judge on Valen (ONNX).
    #[cfg(feature = "valen-onnx")]
    pub fn valen(v: crate::valen::ValenOnnx) -> Self {
        Self { engine: Engine::Valen(v), calibration: Calibration::default(), support_calibration: Calibration::default(), priors: Mutex::new(HashMap::new()) }
    }

    /// The generator behind a Gemma judge (None for Valen).
    pub fn generator(&self) -> Option<&Arc<Generator>> {
        match &self.engine {
            Engine::Gemma { gen, .. } => Some(gen),
            #[cfg(feature = "valen-onnx")]
            Engine::Valen(_) => None,
        }
    }

    pub fn engine_name(&self) -> &'static str {
        match &self.engine {
            Engine::Gemma { .. } => "gemma-logits",
            #[cfg(feature = "valen-onnx")]
            Engine::Valen(_) => "valen",
        }
    }

    fn prompt(task: &str, content: &str, labels: &[Label]) -> String {
        let mut s = String::new();
        s.push_str("Task: ");
        s.push_str(task.trim());
        s.push_str("\n\n<content>\n");
        s.push_str(content.trim());
        s.push_str("\n</content>\n\nOptions:\n");
        for (i, l) in labels.iter().enumerate() {
            let letter = (b'A' + i as u8) as char;
            match &l.description {
                Some(d) => s.push_str(&format!("{letter}) {}: {}\n", l.name, d)),
                None => s.push_str(&format!("{letter}) {}\n", l.name)),
            }
        }
        s.push_str("\nAnswer with one letter.");
        s
    }

    /// Raw logits of the option letters (no softmax, no calibration).
    pub fn option_logits(&self, task: &str, content: &str, labels: &[Label]) -> Result<Vec<f32>> {
        self.raw_scores(task, content, labels)
    }

    /// Option scores: letter logits (Gemma) or log-probabilities of a choice question (Valen).
    fn raw_scores(&self, task: &str, content: &str, labels: &[Label]) -> Result<Vec<f32>> {
        if labels.is_empty() || labels.len() > 26 {
            return Err(Error::Input("between 1 and 26 labels".into()));
        }
        match &self.engine {
            Engine::Gemma { gen, letters } => {
                let msgs = [Message::system(SYSTEM), Message::user(Self::prompt(task, content, labels))];
                let logits = gen.next_token_logits(&msgs, "")?;
                Ok(labels.iter().enumerate().map(|(i, _)| logits[letters[i] as usize]).collect())
            }
            #[cfg(feature = "valen-onnx")]
            Engine::Valen(v) => {
                use crate::valen::{Criteria, Question, QuestionType, Request};
                let (yes_no, crit) = if labels.len() == 2 && labels[0].name == "YES" && labels[1].name == "NO" {
                    (true, Criteria::None)
                } else {
                    (false, Criteria::Map(labels.iter().map(|l| (l.name.clone(), l.description.clone().unwrap_or_else(|| l.name.clone()))).collect()))
                };
                let q = Question { kind: if yes_no { QuestionType::Noul } else { QuestionType::Choice }, instructions: valen_question(task), criteria: crit };
                let (ans, _) = v.predict(&Request { state: content.to_string(), questions: vec![("q".into(), q)] }, 1.0)?;
                let a = &ans["q"];
                Ok(if yes_no {
                    let y = a.noul.unwrap_or(0.5).clamp(1e-9, 1.0 - 1e-9);
                    vec![y.ln(), (1.0 - y).ln()]
                } else {
                    a.probabilities.iter().map(|(_, p)| p.max(1e-12).ln()).collect()
                })
            }
        }
    }

    fn softmax(logits: &[f32], t: f32) -> Vec<f32> {
        let t = if t > 0.0 { t } else { 1.0 };
        let m = logits.iter().cloned().fold(f32::NEG_INFINITY, f32::max);
        let e: Vec<f64> = logits.iter().map(|l| (((l - m) / t) as f64).exp()).collect();
        let s: f64 = e.iter().sum();
        e.iter().map(|x| (x / s) as f32).collect()
    }

    fn calibrated(&self, task: &str, content: &str, labels: &[Label], cal: &Calibration) -> Result<Vec<f32>> {
        let mut p = Self::softmax(&self.raw_scores(task, content, labels)?, cal.temperature);
        if cal.prior_correction {
            let key = format!("{task}\u{1}{}", labels.iter().map(|l| l.name.as_str()).collect::<Vec<_>>().join("\u{1}"));
            let prior = {
                let cached = self.priors.lock().unwrap().get(&key).cloned();
                match cached {
                    Some(p) => p,
                    None => {
                        let p = Self::softmax(&self.raw_scores(task, "N/A", labels)?, cal.temperature);
                        self.priors.lock().unwrap().insert(key, p.clone());
                        p
                    }
                }
            };
            for (x, q) in p.iter_mut().zip(&prior) {
                *x /= q.max(1e-6);
            }
            let s: f32 = p.iter().sum();
            p.iter_mut().for_each(|x| *x /= s);
        }
        Ok(p)
    }

    /// Generic decision: probabilities for each label, in the given order.
    pub fn classify(&self, instruction: &str, content: &str, labels: &[Label]) -> Result<Vec<(String, f32)>> {
        let p = self.calibrated(instruction, content, labels, &self.calibration)?;
        Ok(labels.iter().map(|l| l.name.clone()).zip(p).collect())
    }

    /// Yes/no question: probability of "yes".
    pub fn yes_no(&self, question: &str, content: &str, yes: &str, no: &str) -> Result<f32> {
        let labels = [Label::new("YES", yes), Label::new("NO", no)];
        Ok(self.calibrated(question, content, &labels, &self.support_calibration)?[0])
    }

    /// Content shown to the judge for a claim–passage pair.
    pub fn pair_content(claim: &str, passage: &str, source: Option<&SourceInfo>) -> String {
        let mut s = String::new();
        if let Some(src) = source {
            let mut parts = vec![];
            if let Some(a) = &src.author {
                parts.push(a.clone());
            }
            if let Some(t) = &src.title {
                parts.push(t.clone());
            }
            if let Some(y) = src.year {
                parts.push(y.to_string());
            }
            if !parts.is_empty() {
                s.push_str(&format!("Source: {}\n", parts.join(", ")));
            }
        }
        s.push_str(&format!("Claim: {}\nPassage: {}", claim.trim(), passage.trim()));
        s
    }

    /// Does this passage back this claim? Relation probabilities plus P(supported).
    pub fn support(&self, claim: &str, passage: &str) -> Result<Support> {
        self.support_with(claim, passage, None)
    }

    pub fn support_with(&self, claim: &str, passage: &str, source: Option<&SourceInfo>) -> Result<Support> {
        let content = Self::pair_content(claim, passage, source);
        let supported = self.yes_no(SUPPORT_TASK, &content, SUPPORT_YES, SUPPORT_NO)?;
        let p = self.calibrated(RELATION_TASK, &content, &relation_labels(), &self.calibration)?;
        let probs: Vec<(Relation, f32)> = Relation::ALL.iter().copied().zip(p).collect();
        let label = probs.iter().max_by(|a, b| a.1.total_cmp(&b.1)).map(|x| x.0).unwrap();
        Ok(Support { label, probs, supported })
    }

    pub fn relevance_content(query: &str, passage: &str) -> String {
        format!("Query: {}\nPassage: {}", query.trim(), passage.trim())
    }

    /// Relevance of a passage to a search query in [0, 1] (expected grade of a 0–3 rubric / 3).
    pub fn relevance(&self, query: &str, passage: &str) -> Result<f32> {
        #[cfg(feature = "valen-onnx")]
        if let Engine::Valen(v) = &self.engine {
            use crate::valen::{Criteria, Question, QuestionType, Request};
            let q = Question {
                kind: QuestionType::Score,
                instructions: valen_question(RELEVANCE_TASK),
                criteria: Criteria::List(relevance_labels().iter().map(|l| l.description.clone().unwrap()).collect()),
            };
            let (ans, _) = v.predict(&Request { state: Self::relevance_content(query, passage), questions: vec![("q".into(), q)] }, self.calibration.temperature)?;
            return Ok(ans["q"].score.unwrap_or(0.0) / 3.0);
        }
        let content = Self::relevance_content(query, passage);
        let p = self.calibrated(RELEVANCE_TASK, &content, &relevance_labels(), &self.calibration)?;
        Ok(p.iter().enumerate().map(|(i, x)| i as f32 * x).sum::<f32>() / 3.0)
    }
}

/// Calibration stored in the manifest for a judge model.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct JudgeCalibration {
    pub choice: Calibration,
    pub noul: Calibration,
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn softmax_temperature() {
        let p = Judge::softmax(&[2.0, 0.0], 1.0);
        assert!((p[0] - 0.8808).abs() < 1e-3);
        let q = Judge::softmax(&[2.0, 0.0], 2.0);
        assert!(q[0] < p[0]);
    }
    #[test]
    fn prompt_lists_letters() {
        let s = Judge::prompt("T", "C", &[Label::new("x", "d1"), Label { name: "y".into(), description: None }]);
        assert!(s.contains("A) x: d1\nB) y\n"));
    }
}
