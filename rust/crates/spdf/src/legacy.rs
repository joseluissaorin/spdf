//! Legacy SPDF 4.0/4.1 (Scholaris, Spanish identifiers) → 5.0 view (§7).

use serde_json::{json, Map, Value};

/// Maps a legacy anchor (`{"tipo":"pagina","fisica":10,…}`) to 5.0 names.
/// Unknown members are kept verbatim. 5.0 anchors pass through unchanged.
pub fn map_anchor(v: &Value) -> Value {
    let Value::Object(m) = v else {
        return v.clone();
    };
    if !m.contains_key("tipo") {
        return v.clone();
    }
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

fn non_empty_str(v: Option<&Value>) -> Option<String> {
    match v {
        Some(Value::String(s)) if !s.trim().is_empty() => Some(s.clone()),
        Some(Value::Number(n)) => Some(n.to_string()),
        _ => None,
    }
}

fn person(p: &Value) -> Option<Value> {
    let m = p.as_object()?;
    let mut o = Map::new();
    if let Some(f) = non_empty_str(m.get("apellidos")) {
        o.insert("family".into(), Value::from(f));
    }
    if let Some(g) = non_empty_str(m.get("nombre")) {
        o.insert("given".into(), Value::from(g));
    }
    if o.is_empty() {
        None
    } else {
        Some(Value::Object(o))
    }
}

fn people(v: Option<&Value>) -> Option<Vec<Value>> {
    let a = v?.as_array()?;
    let out: Vec<Value> = a.iter().filter_map(person).collect();
    if out.is_empty() {
        None
    } else {
        Some(out)
    }
}

fn year_of(v: Option<&Value>) -> Option<i64> {
    match v? {
        Value::Number(n) => n.as_i64().or_else(|| n.as_f64().map(|f| f as i64)),
        Value::String(s) => s.trim().parse().ok(),
        _ => None,
    }
}

fn date_parts(iso: &str) -> Option<Vec<i64>> {
    let parts: Vec<i64> = iso
        .split('T')
        .next()?
        .split('-')
        .filter(|p| !p.is_empty())
        .map(|p| p.parse::<i64>())
        .collect::<Result<_, _>>()
        .ok()?;
    if parts.is_empty() || parts.len() > 3 {
        None
    } else {
        Some(parts)
    }
}

/// Default CSL `type` for a legacy document kind (`tipo`).
pub fn default_csl_type(legacy_kind: &str, has_journal: bool) -> &'static str {
    match legacy_kind {
        "audio" | "presentacion" | "slides" => "speech",
        "video" => "motion_picture",
        "web" => "webpage",
        "hoja" | "sheet" => "dataset",
        "imagen" | "fotos" | "image" | "photos" => "graphic",
        _ if has_journal => "article-journal",
        _ => "book",
    }
}

/// Maps legacy `metadatos` (MetadatosDocumento) to a CSL-JSON item with the
/// `spdf` extension object. `legacy_kind` is the `documentos.tipo` value.
pub fn map_metadata(v: &Value, legacy_kind: &str) -> Value {
    let Some(m) = v.as_object() else {
        return v.clone();
    };
    // Already CSL? (a 5.0 item has `type` and no Spanish keys)
    if !m.contains_key("titulo") && m.contains_key("title") {
        return v.clone();
    }
    let mut o = Map::new();
    let mut ext = Map::new();
    let str_field = |k: &str| non_empty_str(m.get(k));

    let titulo = str_field("titulo");
    let subtitulo = str_field("subtitulo");
    match (&titulo, &subtitulo) {
        (Some(t), Some(s)) => {
            o.insert("title".into(), Value::from(format!("{t}: {s}")));
            o.insert("title-short".into(), Value::from(t.clone()));
            ext.insert("subtitle".into(), Value::from(s.clone()));
        }
        (Some(t), None) => {
            o.insert("title".into(), Value::from(t.clone()));
        }
        (None, Some(s)) => {
            o.insert("title".into(), Value::from(s.clone()));
            ext.insert("subtitle".into(), Value::from(s.clone()));
        }
        (None, None) => {}
    }
    if let Some(x) = str_field("tituloOriginal") {
        o.insert("original-title".into(), Value::from(x));
    }
    if let Some(a) = people(m.get("autores")) {
        o.insert("author".into(), Value::Array(a));
    }
    let mut orcid = Map::new();
    if let Some(arr) = m.get("autores").and_then(Value::as_array) {
        for p in arr {
            if let Some(id) = non_empty_str(p.get("orcid")) {
                let fam = non_empty_str(p.get("apellidos")).unwrap_or_default();
                let giv = non_empty_str(p.get("nombre")).unwrap_or_default();
                let key = if giv.is_empty() {
                    fam
                } else if fam.is_empty() {
                    giv
                } else {
                    format!("{fam}, {giv}")
                };
                orcid.insert(key, Value::from(id));
            }
        }
    }
    for (src, dst) in [
        ("editores", "editor"),
        ("traductores", "translator"),
        ("entrevistadores", "interviewer"),
    ] {
        if let Some(a) = people(m.get(src)) {
            o.insert(dst.into(), Value::Array(a));
        }
    }
    let anio = year_of(m.get("anio"));
    let fecha = str_field("fecha").and_then(|f| date_parts(&f));
    match (&fecha, anio) {
        (Some(parts), Some(y)) if parts[0] == y => {
            o.insert("issued".into(), json!({"date-parts": [parts]}));
        }
        (Some(parts), None) => {
            o.insert("issued".into(), json!({"date-parts": [parts]}));
        }
        (_, Some(y)) => {
            o.insert("issued".into(), json!({"date-parts": [[y]]}));
        }
        _ => {}
    }
    if let Some(y) = year_of(m.get("anioOriginal")) {
        o.insert("original-date".into(), json!({"date-parts": [[y]]}));
    }
    let revista = str_field("revista");
    for (src, dst) in [
        ("editorial", "publisher"),
        ("lugar", "publisher-place"),
        ("revista", "container-title"),
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
        if let Some(x) = str_field(src) {
            o.insert(dst.into(), Value::from(x));
        }
    }
    if revista.is_none() {
        if let Some(x) = str_field("contenedor") {
            o.insert("container-title".into(), Value::from(x));
        }
    }
    let csl_type = str_field("tipoCSL")
        .unwrap_or_else(|| default_csl_type(legacy_kind, revista.is_some()).to_string());
    o.insert("type".into(), Value::from(csl_type));
    if let Some(x) = str_field("idiomaOriginal") {
        ext.insert("original_language".into(), Value::from(x));
    }
    if let Some(sf) = m.get("sinFecha").and_then(Value::as_object) {
        let mut u = Map::new();
        if let Some(d) = sf.get("desde").filter(|v| !v.is_null()) {
            u.insert("from".into(), d.clone());
        }
        if let Some(h) = sf.get("hasta").filter(|v| !v.is_null()) {
            u.insert("to".into(), h.clone());
        }
        if let Some(f) = non_empty_str(sf.get("fundamento")) {
            u.insert("basis".into(), Value::from(f));
        }
        if !u.is_empty() {
            ext.insert("undated".into(), Value::Object(u));
        }
    }
    if let Some(pr) = m.get("procedencia").and_then(Value::as_object) {
        let mut out = Map::new();
        for (field, entry) in pr {
            let mapped = match entry.as_object() {
                Some(e) => {
                    let mut x = Map::new();
                    for (k, v) in e {
                        let nk = match k.as_str() {
                            "fuente" => "source",
                            "confianza" => "confidence",
                            other => other,
                        };
                        x.insert(nk.to_string(), v.clone());
                    }
                    Value::Object(x)
                }
                None => entry.clone(),
            };
            out.insert(field.clone(), mapped);
        }
        if !out.is_empty() {
            ext.insert("provenance".into(), Value::Object(out));
        }
    }
    if !orcid.is_empty() {
        ext.insert("orcid".into(), Value::Object(orcid));
    }
    if !ext.is_empty() {
        o.insert("spdf".into(), Value::Object(ext));
    }
    Value::Object(o)
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
        let a = map_anchor(&json!({"tipo":"pagina","fisica":3,"impresa":"xiv","romana":true,"origen":"deducido","confianza":0.5}));
        assert_eq!(a, json!({"type":"page","physical":3,"printed":"xiv","roman":true,"source":"inferred","confidence":0.5}));
        let h = map_anchor(&json!({"tipo":"hoja","hoja":"Datos","filaDesde":1,"filaHasta":4}));
        assert_eq!(h, json!({"type":"sheet","sheet":"Datos","row_from":1,"row_to":4}));
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
                           "provenance":{"titulo":{"source":"colofon","confidence":0.9}},"orcid":{"Foucault, Michel":"0000-1"}}})
        );
    }
}
