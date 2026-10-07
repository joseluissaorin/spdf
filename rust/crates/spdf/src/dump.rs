//! Canonical JSON dump (contract §5), the conformance oracle.

use std::collections::BTreeMap;

use serde_json::{Map, Value};
use sha2::{Digest, Sha256};

use crate::canon;
use crate::error::Result;
use crate::reader::{hex, Flavor, Spdf};
use crate::schema::{self, TableDef};

fn without(mut m: Map<String, Value>, k: &str) -> Value {
    m.remove(k);
    Value::Object(m)
}

impl Spdf {
    fn dump_rows(&self, t: &TableDef, cols: &[&str], order: &str) -> Result<Vec<Value>> {
        Ok(self
            .rows(t, cols, None, order)?
            .into_iter()
            .map(Value::Object)
            .collect())
    }

    /// The canonical dump as a JSON value (numbers rounded to 6 decimals).
    ///
    /// Legacy files are dumped through the 5.0 view, with `"legacy": true`.
    pub fn dump(&self) -> Result<Value> {
        let mut out = Map::new();
        let meta = self.meta()?;
        let version = match self.flavor {
            Flavor::V5 => meta
                .get("spdf_version")
                .cloned()
                .map(Value::from)
                .unwrap_or(Value::Null),
            Flavor::Legacy => Value::from(self.version.clone()),
        };
        out.insert("spdf_version".into(), version);
        if self.flavor == Flavor::Legacy {
            out.insert("legacy".into(), Value::Bool(true));
        }
        let meta_obj: Map<String, Value> = meta
            .into_iter()
            .map(|(k, v)| (k, Value::String(v)))
            .collect();
        out.insert("meta".into(), Value::Object(meta_obj));

        let mut fts = Map::new();
        fts.insert(
            "tokenizer".into(),
            self.info
                .fts_tokenizer(self.fts_table())
                .map(Value::String)
                .unwrap_or(Value::Null),
        );
        fts.insert("trigram".into(), Value::Bool(self.has_trigram()));
        out.insert("fts".into(), Value::Object(fts));

        out.insert(
            "document".into(),
            match self.document_row()? {
                Some(m) => Value::Object(m),
                None => Value::Null,
            },
        );

        let unit_cols: Vec<&str> = schema::UNITS.columns.iter().map(|c| c.0).collect();
        let units: Vec<Value> = self
            .rows(&schema::UNITS, &unit_cols, None, "ord, id")?
            .into_iter()
            .map(|m| without(m, "document"))
            .collect();
        out.insert("units".into(), Value::Array(units));

        let sec_cols: Vec<&str> = schema::SECTIONS.columns.iter().map(|c| c.0).collect();
        let sections: Vec<Value> = self
            .rows(&schema::SECTIONS, &sec_cols, None, "id")?
            .into_iter()
            .map(|m| without(m, "document"))
            .collect();
        out.insert("sections".into(), Value::Array(sections));

        let frag_cols: Vec<&str> = schema::FRAGMENTS.columns.iter().map(|c| c.0).collect();
        let fragments: Vec<Value> = self
            .rows(&schema::FRAGMENTS, &frag_cols, None, "n")?
            .into_iter()
            .map(|m| without(m, "document"))
            .collect();
        out.insert("fragments".into(), Value::Array(fragments));

        let fig_cols: Vec<&str> = schema::FIGURES.columns.iter().map(|c| c.0).collect();
        let figures: Vec<Value> = self
            .rows(&schema::FIGURES, &fig_cols, None, "id")?
            .into_iter()
            .map(|m| without(m, "document"))
            .collect();
        out.insert("figures".into(), Value::Array(figures));

        let sp_cols: Vec<&str> = schema::SPACES.columns.iter().map(|c| c.0).collect();
        out.insert(
            "spaces".into(),
            Value::Array(self.dump_rows(&schema::SPACES, &sp_cols, "id")?),
        );

        out.insert("vectors".into(), Value::Object(self.vector_digests()?));

        let blobs: Vec<Value> = self
            .computed_blob_hashes()?
            .into_iter()
            .map(|(key, mime, bytes, sha)| {
                let mut m = Map::new();
                m.insert("key".into(), Value::from(key));
                m.insert("mime".into(), Value::from(mime));
                m.insert("bytes".into(), Value::from(bytes));
                m.insert("sha256".into(), Value::from(sha));
                Value::Object(m)
            })
            .collect();
        out.insert("blobs".into(), Value::Array(blobs));

        let prov_cols: Vec<&str> = schema::PROVENANCE.columns.iter().map(|c| c.0).collect();
        // Sorted by the UTF-8 bytes of each entry's JCS form (draft 1.1).
        let mut prov: Vec<(String, Value)> = self
            .rows(&schema::PROVENANCE, &prov_cols, None, "")?
            .into_iter()
            .map(|m| {
                let v = canon::normalize(&without(m, "document"));
                (canon::to_string(&v), v)
            })
            .collect();
        prov.sort_by(|a, b| a.0.as_bytes().cmp(b.0.as_bytes()));
        let prov: Vec<Value> = prov.into_iter().map(|(_, v)| v).collect();
        out.insert("provenance".into(), Value::Array(prov));

        let ext = if self.has_table("extensions") {
            self.dump_rows(
                &schema::EXTENSIONS,
                &["name", "version", "required"],
                "name",
            )?
        } else {
            Vec::new()
        };
        out.insert("extensions".into(), Value::Array(ext));

        Ok(canon::normalize(&Value::Object(out)))
    }

    /// `{"<space>": {"count", "sha256"}}` over the raw vector blobs.
    fn vector_digests(&self) -> Result<Map<String, Value>> {
        let mut out = Map::new();
        let Some(table) = self.table_name("vectors") else {
            return Ok(out);
        };
        let tc = self.col_expr(&schema::VECTORS, "target");
        let ic = self.col_expr(&schema::VECTORS, "id");
        let sc = self.col_expr(&schema::VECTORS, "space");
        let dc = self.col_expr(&schema::VECTORS, "data");
        let sql = format!("SELECT {sc}, {tc}, {ic}, {dc} FROM \"{table}\"");
        let mut st = self.conn.prepare(&sql)?;
        let mut rows = st.query([])?;
        let mut groups: BTreeMap<String, Vec<(String, String, Vec<u8>)>> = BTreeMap::new();
        while let Some(r) = rows.next()? {
            let space: String = r.get::<_, Option<String>>(0)?.unwrap_or_default();
            let mut target: String = r.get::<_, Option<String>>(1)?.unwrap_or_default();
            if self.is_legacy() {
                target = schema::legacy_target(&target).to_string();
            }
            let id: String = r.get::<_, Option<String>>(2)?.unwrap_or_default();
            let data = match r.get_ref(3)? {
                rusqlite::types::ValueRef::Blob(b) | rusqlite::types::ValueRef::Text(b) => {
                    b.to_vec()
                }
                _ => Vec::new(),
            };
            groups.entry(space).or_default().push((target, id, data));
        }
        for (space, mut v) in groups {
            v.sort_by(|a, b| {
                (a.0.as_bytes(), a.1.as_bytes()).cmp(&(b.0.as_bytes(), b.1.as_bytes()))
            });
            let mut h = Sha256::new();
            for (_, _, d) in &v {
                h.update(d);
            }
            let mut m = Map::new();
            m.insert("count".into(), Value::from(v.len()));
            m.insert("sha256".into(), Value::from(hex(&h.finalize())));
            out.insert(space, Value::Object(m));
        }
        Ok(out)
    }

    /// The canonical dump serialized with RFC 8785 (JCS).
    pub fn dump_canonical(&self) -> Result<String> {
        Ok(canon::to_string(&self.dump()?))
    }
}
