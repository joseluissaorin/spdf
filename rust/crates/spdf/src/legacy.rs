//! Legacy SPDF 4.0/4.1 (Scholaris, Spanish identifiers) → 5.0 view (§7).

use serde_json::{json, Map, Value};

/// Maps a legacy anchor (`{"tipo":"pagina","fisica":10,…}`) to 5.0 names.
/// Unknown members are kept verbatim.
pub fn map_anchor(v: &Value) -> Value {
    let Value::Object(m) = v else {
        return v.clone();
    };
    let mut out = Map::new();
    for (k, val) in m {
        let (nk, nv) = match k.as_str() {
            "tipo" => (
                "type",
                Value::from(match val.as_str().unwrap_or("") {
                    "pagina" => "page",
                    "tiempo" => "time",
                    "seccion" => "section",
                    "diapositiva" => "slide",
                    "hoja" => "sheet",
                    "imagen" => "image",
                    other => other,
                })
                .clone(),
            ),
            "fisica" => ("physical", val.clone()),
            "impresa" => ("printed", val.clone()),
            "romana" => ("roman", val.clone()),
            "origen" => (
                "source",
                match val.as_str() {
                    Some("leido") => Value::from("read"),
                    Some("deducido") => Value::from("inferred"),
                    Some("ninguno") => Value::from("none"),
                    _ => val.clone(),
                },
            ),
            "confianza" => ("confidence", val.clone()),
            "hablante" => ("speaker", val.clone()),
            "ruta" => ("path", val.clone()),
            "parrafo" => ("paragraph", val.clone()),
            "hoja" => ("sheet", val.clone()),
            "filaDesde" => ("row_from", val.clone()),
            "filaHasta" => ("row_to", val.clone()),
            "consultada" => ("accessed", val.clone()),
            other => (other, val.clone()),
        };
        out.insert(nk.to_string(), nv);
    }
    Value::Object(out)
}

/// Maps the legacy anchor stored as text; invalid JSON is returned as a
/// JSON string so that callers can still report it.
pub fn map_anchor_text(s: &str) -> Value {
    match serde_json::from_str::<Value>(s) {
        Ok(v) => map_anchor(&v),
        Err(_) => Value::String(s.to_string()),
    }
}

/// `has(k)` of the reference: present, not null, not `""`, not `[]`.
fn has(m: &Map<String, Value>, k: &str) -> bool {
    match m.get(k) {
        None | Some(Value::Null) => false,
        Some(Value::String(s)) => !s.is_empty(),
        Some(Value::Array(a)) => !a.is_empty(),
        Some(_) => true,
    }
}

fn truthy(v: Option<&Value>) -> bool {
    match v {
        None | Some(Value::Null) | Some(Value::Bool(false)) => false,
        Some(Value::String(s)) => !s.is_empty(),
        Some(Value::Array(a)) => !a.is_empty(),
        Some(Value::Object(o)) => !o.is_empty(),
        Some(Value::Number(n)) => n.as_f64().map(|f| f != 0.0).unwrap_or(true),
        Some(Value::Bool(true)) => true,
    }
}

fn names(v: Option<&Value>) -> Vec<Value> {
    let Some(arr) = v.and_then(Value::as_array) else {
        return Vec::new();
    };
    arr.iter()
        .filter_map(|a| {
            let mut n = Map::new();
            if truthy(a.get("apellidos")) {
                n.insert("family".into(), a["apellidos"].clone());
            }
            if truthy(a.get("nombre")) {
                n.insert("given".into(), a["nombre"].clone());
            }
            if n.is_empty() {
                None
            } else {
                Some(Value::Object(n))
            }
        })
        .collect()
}

/// `^(-?\d{1,4})(?:-(\d{1,2})(?:-(\d{1,2}))?)?` on the trimmed string.
fn date_parts(iso: &str) -> Option<Vec<i64>> {
    let s = iso.trim();
    let b = s.as_bytes();
    let mut i = 0;
    let neg = b.first() == Some(&b'-');
    if neg {
        i = 1;
    }
    let digits = |from: usize, max: usize| -> usize {
        let mut k = from;
        while k < b.len() && k - from < max && b[k].is_ascii_digit() {
            k += 1;
        }
        k
    };
    let e = digits(i, 4);
    if e == i {
        return None;
    }
    let mut y: i64 = s[i..e].parse().ok()?;
    if neg {
        y = -y;
    }
    let mut out = vec![y];
    if b.get(e) == Some(&b'-') {
        let e2 = digits(e + 1, 2);
        if e2 > e + 1 {
            out.push(s[e + 1..e2].parse().ok()?);
            if b.get(e2) == Some(&b'-') {
                let e3 = digits(e2 + 1, 2);
                if e3 > e2 + 1 {
                    out.push(s[e2 + 1..e3].parse().ok()?);
                }
            }
        }
    }
    Some(out)
}

/// Default CSL `type` of a legacy document: `tipoCSL`, else `article-journal`
/// if there is a journal, else by `tipo`, else `book`.
pub fn default_csl_type(legacy_kind: &str, m: &Map<String, Value>) -> Value {
    if truthy(m.get("tipoCSL")) {
        return m["tipoCSL"].clone();
    }
    if truthy(m.get("revista")) {
        return Value::from("article-journal");
    }
    Value::from(match legacy_kind {
        "audio" | "presentacion" => "speech",
        "video" => "motion_picture",
        "web" => "webpage",
        "hoja" => "dataset",
        "imagen" | "fotos" => "graphic",
        _ => "book",
    })
}

/// Legacy metadata field → CSL (or `spdf.`) name, for `procedencia` keys.
pub fn legacy_field(k: &str) -> &str {
    match k {
        "titulo" => "title",
        "subtitulo" => "subtitle",
        "tituloOriginal" => "original-title",
        "autores" => "author",
        "editores" => "editor",
        "traductores" => "translator",
        "entrevistadores" => "interviewer",
        "anio" | "fecha" => "issued",
        "anioOriginal" => "original-date",
        "editorial" => "publisher",
        "lugar" => "publisher-place",
        "revista" | "contenedor" => "container-title",
        "coleccion" => "collection-title",
        "volumen" => "volume",
        "numero" => "issue",
        "paginas" => "page",
        "edicion" => "edition",
        "doi" => "DOI",
        "isbn" => "ISBN",
        "url" => "URL",
        "idioma" => "language",
        "tipoCSL" => "type",
        "resumen" => "abstract",
        "idiomaOriginal" => "original_language",
        "sinFecha" => "undated",
        other => other,
    }
}

fn provenance_source(v: &Value) -> Value {
    match v.as_str() {
        Some("lectura") => Value::from("reading"),
        Some("usuario") => Value::from("user"),
        Some("colofon") => Value::from("colophon"),
        Some("impresores") => Value::from("printers"),
        _ => v.clone(),
    }
}

/// Maps legacy `metadatos` (MetadatosDocumento) to a CSL-JSON item with the
/// `spdf` extension object (§7). `legacy_kind` is the `documentos.tipo` value.
pub fn map_metadata(v: &Value, legacy_kind: &str) -> Value {
    let Some(m) = v.as_object() else {
        return v.clone();
    };
    let mut item = Map::new();
    let mut ext = Map::new();
    item.insert("type".into(), default_csl_type(legacy_kind, m));
    let title = match m.get("titulo") {
        Some(t) if truthy(Some(t)) => t
            .as_str()
            .map(str::to_string)
            .unwrap_or_else(|| t.to_string()),
        _ => String::new(),
    };
    if has(m, "subtitulo") {
        let sub = &m["subtitulo"];
        let sub_s = sub
            .as_str()
            .map(str::to_string)
            .unwrap_or_else(|| sub.to_string());
        item.insert("title".into(), Value::from(format!("{title}: {sub_s}")));
        item.insert("title-short".into(), Value::from(title));
        ext.insert("subtitle".into(), sub.clone());
    } else {
        item.insert("title".into(), Value::from(title));
    }
    if has(m, "tituloOriginal") {
        item.insert("original-title".into(), m["tituloOriginal"].clone());
    }
    let mut orcid = Map::new();
    for (src, dst) in [
        ("autores", "author"),
        ("editores", "editor"),
        ("traductores", "translator"),
        ("entrevistadores", "interviewer"),
    ] {
        let n = names(m.get(src));
        if !n.is_empty() {
            item.insert(dst.into(), Value::Array(n));
        }
        if let Some(arr) = m.get(src).and_then(Value::as_array) {
            for a in arr {
                if truthy(a.get("orcid")) {
                    let fam = a.get("apellidos").and_then(Value::as_str).unwrap_or("");
                    let key = if truthy(a.get("nombre")) {
                        format!(
                            "{fam}, {}",
                            a.get("nombre").and_then(Value::as_str).unwrap_or("")
                        )
                    } else {
                        fam.to_string()
                    };
                    orcid.insert(key, a["orcid"].clone());
                }
            }
        }
    }
    let fecha = if has(m, "fecha") {
        m["fecha"].as_str().and_then(date_parts)
    } else {
        None
    };
    let anio_matches = |parts: &Vec<i64>| match m.get("anio") {
        Some(Value::Number(n)) => n.as_f64() == Some(parts[0] as f64),
        _ => false,
    };
    match fecha {
        Some(parts) if !has(m, "anio") || anio_matches(&parts) => {
            item.insert("issued".into(), json!({"date-parts": [parts]}));
        }
        _ if has(m, "anio") => {
            item.insert(
                "issued".into(),
                json!({"date-parts": [[m["anio"].clone()]]}),
            );
        }
        _ => {}
    }
    if has(m, "anioOriginal") {
        item.insert(
            "original-date".into(),
            json!({"date-parts": [[m["anioOriginal"].clone()]]}),
        );
    }
    for (src, dst) in [
        ("editorial", "publisher"),
        ("lugar", "publisher-place"),
        ("coleccion", "collection-title"),
        ("volumen", "volume"),
        ("numero", "issue"),
        ("paginas", "page"),
        ("edicion", "edition"),
        ("doi", "DOI"),
        ("isbn", "ISBN"),
        ("url", "URL"),
        ("idioma", "language"),
        ("resumen", "abstract"),
    ] {
        if has(m, src) {
            item.insert(dst.into(), m[src].clone());
        }
    }
    if has(m, "revista") {
        item.insert("container-title".into(), m["revista"].clone());
    } else if has(m, "contenedor") {
        item.insert("container-title".into(), m["contenedor"].clone());
    }
    if has(m, "idiomaOriginal") {
        ext.insert("original_language".into(), m["idiomaOriginal"].clone());
    }
    if has(m, "sinFecha") {
        let sf = &m["sinFecha"];
        let mut u = Map::new();
        if let Some(d) = sf.get("desde").filter(|v| !v.is_null()) {
            u.insert("from".into(), d.clone());
        }
        if let Some(h) = sf.get("hasta").filter(|v| !v.is_null()) {
            u.insert("to".into(), h.clone());
        }
        if truthy(sf.get("fundamento")) {
            u.insert("basis".into(), sf["fundamento"].clone());
        }
        ext.insert("undated".into(), Value::Object(u));
    }
    if has(m, "procedencia") {
        let mut prov = Map::new();
        if let Some(p) = m["procedencia"].as_object() {
            for (campo, v) in p {
                let mut x = Map::new();
                x.insert(
                    "source".into(),
                    provenance_source(v.get("fuente").unwrap_or(&Value::Null)),
                );
                x.insert(
                    "confidence".into(),
                    v.get("confianza").cloned().unwrap_or(Value::Null),
                );
                prov.insert(legacy_field(campo).to_string(), Value::Object(x));
            }
        }
        ext.insert("provenance".into(), Value::Object(prov));
    }
    if !orcid.is_empty() {
        ext.insert("orcid".into(), Value::Object(orcid));
    }
    if !ext.is_empty() {
        item.insert("spdf".into(), Value::Object(ext));
    }
    Value::Object(item)
}

/// Maps legacy modality names (`texto`, `imagen`) to 5.0 (`text`, `image`).
pub fn map_modalities(v: &Value) -> Value {
    match v {
        Value::Array(a) => Value::Array(
            a.iter()
                .map(|x| match x.as_str() {
                    Some("texto") => Value::from("text"),
                    Some("imagen") => Value::from("image"),
                    _ => x.clone(),
                })
                .collect(),
        ),
        other => other.clone(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn anchors() {
        let a = map_anchor(
            &json!({"tipo":"pagina","fisica":3,"impresa":"xiv","romana":true,"origen":"deducido","confianza":0.5}),
        );
        assert_eq!(
            a,
            json!({"type":"page","physical":3,"printed":"xiv","roman":true,"source":"inferred","confidence":0.5})
        );
        let h = map_anchor(&json!({"tipo":"hoja","hoja":"Datos","filaDesde":1,"filaHasta":4}));
        assert_eq!(
            h,
            json!({"type":"sheet","sheet":"Datos","row_from":1,"row_to":4})
        );
    }

    #[test]
    fn metadata() {
        let m = map_metadata(
            &json!({"titulo":"Vigilar y castigar","subtitulo":"Nacimiento de la prisión","autores":[{"nombre":"Michel","apellidos":"Foucault","orcid":"0000-1"}],"anio":1975,"editorial":"Siglo XXI","sinFecha":{"desde":1600,"hasta":1610,"fundamento":"impresor"},"procedencia":{"titulo":{"fuente":"colofon","confianza":0.9}},"vacio":""}),
            "pdf",
        );
        assert_eq!(
            m,
            json!({"title":"Vigilar y castigar: Nacimiento de la prisión","title-short":"Vigilar y castigar",
                   "author":[{"family":"Foucault","given":"Michel"}],"issued":{"date-parts":[[1975]]},
                   "publisher":"Siglo XXI","type":"book",
                   "spdf":{"subtitle":"Nacimiento de la prisión","undated":{"from":1600,"to":1610,"basis":"impresor"},
                           "provenance":{"title":{"source":"colophon","confidence":0.9}},"orcid":{"Foucault, Michel":"0000-1"}}})
        );
    }
}
