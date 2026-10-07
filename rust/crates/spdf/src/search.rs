//! Reference search (contract §6): lexical (FTS5 BM25, CJK route), vector
//! (brute force, f64) and hybrid (RRF, k = 10).

use std::collections::HashMap;

use serde_json::Value;

use crate::anchor::{Anchor, AnchorUri};
use crate::error::{Error, Result};
use crate::model::{Fragment, SearchHit, Target};
use crate::reader::Spdf;
use crate::schema;
use crate::text::ParsedQuery;
use crate::vector;

/// RRF constant of the reference hybrid search.
pub const RRF_K: f64 = 10.0;
/// Minimum depth of each list before fusion.
pub const HYBRID_MIN_DEPTH: usize = 50;

impl Spdf {
    fn hit_for_fragment(&self, f: &Fragment, docref: &str, score: f64, via: &[&str]) -> SearchHit {
        let anchor_uri = Anchor::from_value(&f.anchor)
            .map(|a| {
                let end = f
                    .anchor_end
                    .as_ref()
                    .filter(|v| !v.is_null())
                    .and_then(|v| Anchor::from_value(v).ok());
                AnchorUri::from_anchor(docref, &a, end.as_ref()).to_string()
            })
            .unwrap_or_else(|_| format!("spdf:{}", crate::anchor::percent_encode(docref)));
        SearchHit {
            fragment_id: f.id.clone(),
            score,
            via: via.iter().map(|s| s.to_string()).collect(),
            anchor: f.anchor.clone(),
            anchor_uri,
        }
    }

    fn docref(&self) -> String {
        self.document()
            .map(|d| d.docref())
            .unwrap_or_else(|_| "unknown".to_string())
    }

    /// Ranked fragment `n`s with scores for a lexical query (reference §6).
    pub(crate) fn lexical_ns(&self, query: &str, limit: usize) -> Result<Vec<(i64, f64)>> {
        let q = ParsedQuery::parse(query);
        let Some(m) = q.fts_match() else {
            return Ok(Vec::new());
        };
        let limit = i64::try_from(limit).unwrap_or(i64::MAX);
        if q.cjk {
            let all_long = q.terms.iter().all(|t| t.chars().count() >= 3);
            if self.has_trigram() && all_long {
                let sql = "SELECT rowid, bm25(fragments_fts_trigram) AS r FROM fragments_fts_trigram \
                           WHERE fragments_fts_trigram MATCH ?1 ORDER BY r, rowid LIMIT ?2";
                let mut st = self.conn.prepare(sql)?;
                let rows = st.query_map(rusqlite::params![m, limit], |r| {
                    Ok((r.get::<_, i64>(0)?, -r.get::<_, f64>(1)?))
                })?;
                return Ok(rows.collect::<std::result::Result<_, _>>()?);
            }
            return self.substring_ns(&q, limit);
        }
        let fts = self.fts_table();
        let sql = format!(
            "SELECT rowid, bm25({fts}, 1.0, 0.5, 0.5, 1.0) AS r FROM {fts} \
             WHERE {fts} MATCH ?1 ORDER BY r, rowid LIMIT ?2"
        );
        let mut st = self.conn.prepare(&sql)?;
        let rows = st.query_map(rusqlite::params![m, limit], |r| {
            Ok((r.get::<_, i64>(0)?, -r.get::<_, f64>(1)?))
        })?;
        Ok(rows.collect::<std::result::Result<_, _>>()?)
    }

    fn substring_ns(&self, q: &ParsedQuery, limit: i64) -> Result<Vec<(i64, f64)>> {
        let Some(table) = self.table_name("fragments") else {
            return Ok(Vec::new());
        };
        let nc = self.col_expr(&schema::FRAGMENTS, "n");
        let tc = self.col_expr(&schema::FRAGMENTS, "text");
        let hits: Vec<String> = (1..=q.terms.len())
            .map(|i| format!("(instr({tc}, ?{i}) > 0)"))
            .collect();
        let sum = hits.join(" + ");
        let cond = if q.phrases {
            format!("h = {}", q.terms.len())
        } else {
            "h > 0".to_string()
        };
        let sql = format!(
            "SELECT n, h FROM (SELECT {nc} AS n, ({sum}) AS h FROM \"{table}\") WHERE {cond} \
             ORDER BY h DESC, n LIMIT {limit}"
        );
        let mut st = self.conn.prepare(&sql)?;
        let params: Vec<&dyn rusqlite::ToSql> = q.terms.iter().map(|t| t as &dyn rusqlite::ToSql).collect();
        let rows = st.query_map(params.as_slice(), |r| {
            Ok((r.get::<_, i64>(0)?, r.get::<_, i64>(1)? as f64))
        })?;
        Ok(rows.collect::<std::result::Result<_, _>>()?)
    }

    /// Lexical search with the reference algorithm. Scores are `-bm25`
    /// (or the number of matching terms in the CJK substring fallback).
    pub fn search_lexical(&self, query: &str, limit: usize) -> Result<Vec<SearchHit>> {
        let ns = self.lexical_ns(query, limit)?;
        let frags = self.fragments_by_n(&ns.iter().map(|x| x.0).collect::<Vec<_>>())?;
        let docref = self.docref();
        Ok(ns
            .iter()
            .filter_map(|(n, s)| frags.get(n).map(|f| self.hit_for_fragment(f, &docref, *s, &["lexical"])))
            .collect())
    }

    /// Scores of every vector of `space`/`target` against `query`, sorted by
    /// score desc then fragment `n` / unit `ord` / figure `id`.
    pub(crate) fn vector_scores(&self, space: &str, query: &[f32], target: Target) -> Result<Vec<(String, f64)>> {
        let sp = self
            .space(space)?
            .ok_or_else(|| Error::Vector(format!("unknown space `{space}`")))?;
        let dtype = sp
            .dtype()
            .ok_or_else(|| Error::Vector(format!("unknown dtype `{}`", sp.dtype)))?;
        let dims = usize::try_from(sp.dims).map_err(|_| Error::Vector("negative dims".into()))?;
        if query.len() != dims {
            return Err(Error::Vector(format!(
                "query has {} dimensions, space `{space}` has {dims}",
                query.len()
            )));
        }
        let q: Vec<f64> = query.iter().map(|x| f64::from(*x)).collect();
        let mut scored: Vec<(String, f64)> = Vec::new();
        for (_, id, data) in self.raw_vectors(space, Some(target))? {
            let v = vector::decode_f64(&data, dtype, dims)?;
            let s = if sp.normalized {
                vector::dot(&q, &v)
            } else {
                vector::cosine(&q, &v)
            };
            scored.push((id, s));
        }
        // Tie-break keys per target.
        let keys: HashMap<String, (i64, String)> = match target {
            Target::Fragment => self
                .fragment_keys()?
                .into_iter()
                .map(|(id, n)| (id, (n, String::new())))
                .collect(),
            Target::Unit => self
                .units()?
                .into_iter()
                .map(|u| (u.id.clone(), (u.ord, String::new())))
                .collect(),
            Target::Figure => HashMap::new(),
        };
        scored.sort_by(|a, b| {
            b.1.partial_cmp(&a.1)
                .unwrap_or(std::cmp::Ordering::Equal)
                .then_with(|| {
                    let ka = keys.get(&a.0).cloned().unwrap_or((i64::MAX, a.0.clone()));
                    let kb = keys.get(&b.0).cloned().unwrap_or((i64::MAX, b.0.clone()));
                    ka.cmp(&kb)
                })
                .then_with(|| a.0.as_bytes().cmp(b.0.as_bytes()))
        });
        Ok(scored)
    }

    fn fragment_keys(&self) -> Result<Vec<(String, i64)>> {
        let Some(table) = self.table_name("fragments") else {
            return Ok(Vec::new());
        };
        let nc = self.col_expr(&schema::FRAGMENTS, "n");
        let ic = self.col_expr(&schema::FRAGMENTS, "id");
        let mut st = self.conn.prepare(&format!("SELECT {ic}, {nc} FROM \"{table}\""))?;
        let rows = st.query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, i64>(1)?)))?;
        Ok(rows.collect::<std::result::Result<_, _>>()?)
    }

    /// Vector search by brute force (dot product for normalized spaces,
    /// cosine otherwise). For `Target::Unit`/`Target::Figure`, hits carry the
    /// unit/figure id in `fragment_id`.
    pub fn search_vector(&self, space: &str, query: &[f32], target: Target, limit: usize) -> Result<Vec<SearchHit>> {
        let scored = self.vector_scores(space, query, target)?;
        let top: Vec<(String, f64)> = scored.into_iter().take(limit).collect();
        let docref = self.docref();
        match target {
            Target::Fragment => {
                let by_id: HashMap<String, Fragment> = self
                    .fragments()?
                    .into_iter()
                    .filter(|f| top.iter().any(|(id, _)| id == &f.id))
                    .map(|f| (f.id.clone(), f))
                    .collect();
                Ok(top
                    .iter()
                    .filter_map(|(id, s)| by_id.get(id).map(|f| self.hit_for_fragment(f, &docref, *s, &["vector"])))
                    .collect())
            }
            Target::Unit => {
                let units: HashMap<String, crate::model::Unit> =
                    self.units()?.into_iter().map(|u| (u.id.clone(), u)).collect();
                Ok(top
                    .iter()
                    .filter_map(|(id, s)| {
                        let u = units.get(id)?;
                        Some(self.hit_for_anchor(id, &u.anchor, &docref, *s))
                    })
                    .collect())
            }
            Target::Figure => {
                let figs: HashMap<String, crate::model::Figure> =
                    self.figures()?.into_iter().map(|f| (f.id.clone(), f)).collect();
                Ok(top
                    .iter()
                    .filter_map(|(id, s)| {
                        let f = figs.get(id)?;
                        Some(self.hit_for_anchor(id, &f.anchor, &docref, *s))
                    })
                    .collect())
            }
        }
    }

    fn hit_for_anchor(&self, id: &str, anchor: &Value, docref: &str, score: f64) -> SearchHit {
        let anchor_uri = Anchor::from_value(anchor)
            .map(|a| AnchorUri::from_anchor(docref, &a, None).to_string())
            .unwrap_or_else(|_| format!("spdf:{}", crate::anchor::percent_encode(docref)));
        SearchHit {
            fragment_id: id.to_string(),
            score,
            via: vec!["vector".into()],
            anchor: anchor.clone(),
            anchor_uri,
        }
    }

    /// Hybrid search: lexical and vector lists (target fragment) to depth
    /// `max(limit, 50)`, fused with reciprocal rank fusion (k = 10).
    pub fn search_hybrid(&self, query: &str, vector: &[f32], space: &str, limit: usize) -> Result<Vec<SearchHit>> {
        let depth = limit.max(HYBRID_MIN_DEPTH);
        let lex = self.lexical_ns(query, depth)?;
        let vec_ids: Vec<(String, f64)> = self
            .vector_scores(space, vector, Target::Fragment)?
            .into_iter()
            .take(depth)
            .collect();
        let keys: HashMap<String, i64> = self.fragment_keys()?.into_iter().collect();
        // n -> (score, lexical?, vector?)
        let mut fused: HashMap<i64, (f64, bool, bool)> = HashMap::new();
        for (rank, (n, _)) in lex.iter().enumerate() {
            let e = fused.entry(*n).or_insert((0.0, false, false));
            e.0 += 1.0 / (RRF_K + (rank + 1) as f64);
            e.1 = true;
        }
        for (rank, (id, _)) in vec_ids.iter().enumerate() {
            let Some(n) = keys.get(id) else { continue };
            let e = fused.entry(*n).or_insert((0.0, false, false));
            e.0 += 1.0 / (RRF_K + (rank + 1) as f64);
            e.2 = true;
        }
        let mut list: Vec<(i64, (f64, bool, bool))> = fused.into_iter().collect();
        list.sort_by(|a, b| {
            b.1 .0
                .partial_cmp(&a.1 .0)
                .unwrap_or(std::cmp::Ordering::Equal)
                .then(a.0.cmp(&b.0))
        });
        list.truncate(limit);
        let frags = self.fragments_by_n(&list.iter().map(|x| x.0).collect::<Vec<_>>())?;
        let docref = self.docref();
        Ok(list
            .iter()
            .filter_map(|(n, (s, l, v))| {
                let mut via = Vec::new();
                if *l {
                    via.push("lexical");
                }
                if *v {
                    via.push("vector");
                }
                frags.get(n).map(|f| self.hit_for_fragment(f, &docref, *s, &via))
            })
            .collect())
    }
}
