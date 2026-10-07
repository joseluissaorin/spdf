//! Building a file from a canonical dump plus vector values and blob bytes
//! (the conformance `sources/*.json` form and the `roundtrip` case kind).

use base64::engine::general_purpose::STANDARD as B64;
use base64::Engine;
use serde_json::{Map, Value};

use crate::error::{Error, Result};
use crate::model::Target;
use crate::schema;
use crate::writer::Writer;

fn obj<'a>(v: &'a Value, what: &str) -> Result<&'a Map<String, Value>> {
    v.as_object()
        .ok_or_else(|| Error::invalid(format!("`{what}` must be an object")))
}

fn arr<'a>(v: Option<&'a Value>) -> &'a [Value] {
    v.and_then(Value::as_array).map(Vec::as_slice).unwrap_or(&[])
}

fn with_document(row: &Value, doc_id: &str) -> Result<Map<String, Value>> {
    let mut m = obj(row, "row")?.clone();
    m.entry("document").or_insert_with(|| Value::from(doc_id));
    Ok(m)
}

fn items_value(v: &[Value]) -> Value {
    Value::Array(v.to_vec())
}

fn space_dtype(dump: &Value, space: &str) -> crate::model::Dtype {
    arr(dump.get("spaces"))
        .iter()
        .find(|s| s.get("id").and_then(Value::as_str) == Some(space))
        .and_then(|s| s.get("dtype").and_then(Value::as_str))
        .and_then(crate::model::Dtype::parse)
        .unwrap_or(crate::model::Dtype::F32)
}

fn values_of(v: &Value) -> Option<Vec<f32>> {
    v.as_array()?
        .iter()
        .map(|x| x.as_f64().map(|f| f as f32))
        .collect()
}

/// See [`Writer::from_dump`].
pub(crate) fn writer_from_dump(src: &Value) -> Result<Writer> {
    // A sources file may wrap the dump: {"dump": {...}, "vector_data": ..., "blob_data": ...}
    let dump = src.get("dump").unwrap_or(src);
    let d = obj(dump, "dump")?;
    let mut w = Writer::new()?;
    if let Some(meta) = d.get("meta").and_then(Value::as_object) {
        for (k, v) in meta {
            let v = match v {
                Value::String(s) => s.clone(),
                other => other.to_string(),
            };
            w.meta_mut().insert(k.clone(), v);
        }
    }
    let doc = d
        .get("document")
        .filter(|v| !v.is_null())
        .ok_or_else(|| Error::invalid("dump has no document"))?;
    let doc_map = obj(doc, "document")?.clone();
    let doc_id = doc_map
        .get("id")
        .and_then(Value::as_str)
        .unwrap_or("")
        .to_string();
    w.set_document_id(&doc_id);
    insert(&w, &schema::DOCUMENTS, &doc_map)?;
    for (key, t) in [
        ("units", &schema::UNITS),
        ("sections", &schema::SECTIONS),
        ("fragments", &schema::FRAGMENTS),
        ("figures", &schema::FIGURES),
        ("provenance", &schema::PROVENANCE),
    ] {
        for row in arr(d.get(key)) {
            insert(&w, t, &with_document(row, &doc_id)?)?;
        }
    }
    for row in arr(d.get("spaces")) {
        insert(&w, &schema::SPACES, obj(row, "space")?)?;
    }
    for row in arr(d.get("extensions")) {
        insert(&w, &schema::EXTENSIONS, obj(row, "extension")?)?;
    }
    // Vector values.
    let mut vector_sets: Vec<(String, Value)> = Vec::new();
    if let Some(vd) = src.get("vector_data").and_then(Value::as_object) {
        for (space, items) in vd {
            vector_sets.push((space.clone(), items.clone()));
        }
    }
    if let Some(vs) = d.get("vectors").and_then(Value::as_object) {
        for (space, entry) in vs {
            if let Some(items) = entry.get("items") {
                vector_sets.push((space.clone(), items.clone()));
            }
        }
    }
    for (space, items) in vector_sets {
        for it in arr(Some(&items)) {
            let target = it
                .get("target")
                .and_then(Value::as_str)
                .and_then(Target::parse)
                .unwrap_or_default();
            let id = it
                .get("id")
                .and_then(Value::as_str)
                .ok_or_else(|| Error::invalid("vector item without id"))?;
            if let Some(b64) = it.get("data_base64").and_then(Value::as_str) {
                let data = B64
                    .decode(b64)
                    .map_err(|e| Error::invalid(format!("bad vector base64: {e}")))?;
                w.add_vector_raw(target, id, &space, &data)?;
            } else if let Some(vals) = it.get("values").and_then(Value::as_array) {
                // Sources carry the stored values: i8 as integers q, f32/f16 as numbers.
                let dtype = space_dtype(dump, &space);
                let data = match dtype {
                    crate::model::Dtype::I8 => vals
                        .iter()
                        .map(|v| {
                            v.as_i64()
                                .filter(|q| (-127..=127).contains(q))
                                .map(|q| q as i8 as u8)
                                .ok_or_else(|| Error::invalid(format!("i8 values are integers in [-127, 127], got {v}")))
                        })
                        .collect::<Result<Vec<u8>>>()?,
                    d => crate::vector::encode(&values_of(&items_value(vals)).unwrap_or_default(), d),
                };
                w.add_vector_raw(target, id, &space, &data)?;
            } else {
                return Err(Error::invalid(format!("vector `{id}` has no values")));
            }
        }
    }
    // Blob bytes.
    let blob_data = src.get("blob_data").and_then(Value::as_object);
    for b in arr(d.get("blobs")) {
        let key = b
            .get("key")
            .and_then(Value::as_str)
            .ok_or_else(|| Error::invalid("blob without key"))?;
        let mime = b.get("mime").and_then(Value::as_str).unwrap_or("application/octet-stream");
        let b64 = b
            .get("data_base64")
            .and_then(Value::as_str)
            .or_else(|| blob_data.and_then(|m| m.get(key)).and_then(Value::as_str));
        let Some(b64) = b64 else {
            return Err(Error::invalid(format!("blob `{key}` has no bytes in the input")));
        };
        let data = B64
            .decode(b64)
            .map_err(|e| Error::invalid(format!("bad blob base64: {e}")))?;
        w.add_blob(key, mime, &data)?;
    }
    if let Some(true) = d.get("fts").and_then(|f| f.get("trigram")).and_then(Value::as_bool) {
        w.enable_trigram(true);
    }
    Ok(w)
}

fn insert(w: &Writer, t: &schema::TableDef, row: &Map<String, Value>) -> Result<()> {
    let cols: Vec<&str> = t
        .columns
        .iter()
        .map(|c| c.0)
        .filter(|c| row.contains_key(*c))
        .collect();
    if cols.is_empty() {
        return Ok(());
    }
    let sql = format!(
        "INSERT INTO {} ({}) VALUES ({})",
        t.name,
        cols.iter().map(|c| format!("\"{c}\"")).collect::<Vec<_>>().join(", "),
        (1..=cols.len()).map(|i| format!("?{i}")).collect::<Vec<_>>().join(", ")
    );
    let json_cols = [
        "metadata",
        "rights",
        "anchor",
        "notes",
        "words",
        "section",
        "anchor_end",
        "modalities",
        "task_prefixes",
        "detail",
    ];
    let vals: Vec<rusqlite::types::Value> = cols
        .iter()
        .map(|c| {
            let v = &row[*c];
            use rusqlite::types::Value as S;
            match v {
                Value::Null => S::Null,
                _ if json_cols.contains(c) => S::Text(v.to_string()),
                Value::Bool(b) => S::Integer(i64::from(*b)),
                Value::Number(n) => match n.as_i64() {
                    Some(i) => S::Integer(i),
                    None => S::Real(n.as_f64().unwrap_or(0.0)),
                },
                Value::String(s) => S::Text(s.clone()),
                other => S::Text(other.to_string()),
            }
        })
        .collect();
    w.conn().execute(&sql, rusqlite::params_from_iter(vals))?;
    Ok(())
}
