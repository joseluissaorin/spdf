package spdf

import (
	"strconv"
	"strings"
)

// Legacy 4.x → 5.0 mapping of the JSON stored in TEXT columns (contract §7).

var legacyAnchorKeys = map[string]string{
	"tipo": "type", "fisica": "physical", "impresa": "printed", "romana": "roman",
	"origen": "source", "confianza": "confidence", "hablante": "speaker", "ruta": "path",
	"parrafo": "paragraph", "hoja": "sheet", "filaDesde": "row_from", "filaHasta": "row_to",
	"consultada": "accessed", "region": "region",
}

var legacyAnchorTypes = map[string]string{
	"pagina": "page", "tiempo": "time", "seccion": "section", "diapositiva": "slide",
	"hoja": "sheet", "web": "web", "imagen": "image",
}

var legacyAnchorSources = map[string]string{
	"leido": "read", "deducido": "inferred", "epub": "epub", "ninguno": "none",
}

// MapLegacyAnchor converts a legacy (Spanish) anchor object to 5.0.
func MapLegacyAnchor(v any) any {
	m, ok := v.(map[string]any)
	if !ok {
		return v
	}
	out := make(map[string]any, len(m))
	for k, val := range m {
		nk := k
		if mapped, ok := legacyAnchorKeys[k]; ok {
			nk = mapped
		}
		switch nk {
		case "type":
			if s, ok := val.(string); ok {
				if t, ok := legacyAnchorTypes[s]; ok {
					val = t
				}
			}
		case "source":
			if s, ok := val.(string); ok {
				if t, ok := legacyAnchorSources[s]; ok {
					val = t
				}
			}
		}
		out[nk] = val
	}
	return out
}

// legacy metadata keys mapped one-to-one onto CSL variables.
var legacyMetaSimple = map[string]string{
	"tituloOriginal": "original-title",
	"editorial":      "publisher",
	"lugar":          "publisher-place",
	"revista":        "container-title",
	"coleccion":      "collection-title",
	"volumen":        "volume",
	"numero":         "issue",
	"paginas":        "page",
	"edicion":        "edition",
	"doi":            "DOI",
	"isbn":           "ISBN",
	"url":            "URL",
	"idioma":         "language",
	"tipoCSL":        "type",
	"resumen":        "abstract",
}

var legacyNameLists = map[string]string{
	"autores": "author", "editores": "editor", "traductores": "translator", "entrevistadores": "interviewer",
}

var legacyProvKeys = map[string]string{"fuente": "source", "confianza": "confidence"}

// default CSL type of a legacy document without tipoCSL, by legacy kind.
var legacyDefaultCSLType = map[string]string{
	"audio": "speech", "video": "motion_picture", "web": "webpage", "presentacion": "speech",
	"hoja": "dataset", "imagen": "graphic", "fotos": "graphic",
}

func isEmptyValue(v any) bool {
	switch t := v.(type) {
	case nil:
		return true
	case string:
		return t == ""
	case []any:
		return len(t) == 0
	case map[string]any:
		return len(t) == 0
	}
	return false
}

// MapLegacyMetadata converts legacy MetadatosDocumento JSON to a CSL-JSON item
// with the "spdf" extension object. legacyKind is documentos.tipo (it decides
// the CSL type when tipoCSL is absent).
func MapLegacyMetadata(v any, legacyKind string) any {
	m, ok := v.(map[string]any)
	if !ok {
		return v
	}
	out := map[string]any{}
	ext := map[string]any{}
	orcid := map[string]any{}
	set := func(k string, val any) {
		if !isEmptyValue(val) {
			out[k] = val
		}
	}
	titulo, _ := m["titulo"].(string)
	set("title", m["titulo"])
	if sub, ok := m["subtitulo"].(string); ok && sub != "" {
		if titulo != "" {
			out["title"] = titulo + ": " + sub
			out["title-short"] = titulo
		} else {
			out["title"] = sub
		}
		ext["subtitle"] = sub
	}
	for _, k := range []string{"autores", "editores", "traductores", "entrevistadores"} {
		csl := legacyNameLists[k]
		list, ok := m[k].([]any)
		if !ok {
			continue
		}
		names := make([]any, 0, len(list))
		for _, e := range list {
			p, ok := e.(map[string]any)
			if !ok {
				continue
			}
			name := map[string]any{}
			family, _ := p["apellidos"].(string)
			given, _ := p["nombre"].(string)
			if family != "" {
				name["family"] = family
			}
			if given != "" {
				name["given"] = given
			}
			if o, ok := p["orcid"].(string); ok && o != "" {
				key := family
				if given != "" {
					key = family + ", " + given
				}
				orcid[key] = o
			}
			if len(name) > 0 {
				names = append(names, name)
			}
		}
		set(csl, names)
	}
	anio, hasAnio := asInt(m["anio"])
	if hasAnio {
		out["issued"] = map[string]any{"date-parts": []any{[]any{anio}}}
	}
	if y, ok := asInt(m["anioOriginal"]); ok {
		out["original-date"] = map[string]any{"date-parts": []any{[]any{y}}}
	}
	if fecha, ok := m["fecha"].(string); ok && fecha != "" {
		if dp := isoDateParts(fecha); dp != nil {
			if !hasAnio || dp[0].(int64) == anio {
				out["issued"] = map[string]any{"date-parts": []any{dp}}
			}
		}
	}
	for k, csl := range legacyMetaSimple {
		set(csl, m[k])
	}
	if isEmptyValue(m["revista"]) {
		set("container-title", m["contenedor"])
	}
	if _, ok := out["type"]; !ok {
		switch {
		case legacyDefaultCSLType[legacyKind] != "":
			out["type"] = legacyDefaultCSLType[legacyKind]
		case !isEmptyValue(m["revista"]):
			out["type"] = "article-journal"
		default:
			out["type"] = "book"
		}
	}
	if lo := m["idiomaOriginal"]; !isEmptyValue(lo) {
		ext["original_language"] = lo
	}
	if sf, ok := m["sinFecha"].(map[string]any); ok {
		u := map[string]any{}
		for from, to := range map[string]string{"desde": "from", "hasta": "to", "fundamento": "basis"} {
			if val, ok := sf[from]; ok && !isEmptyValue(val) {
				u[to] = val
			}
		}
		if len(u) > 0 {
			ext["undated"] = u
		}
	}
	if pr, ok := m["procedencia"].(map[string]any); ok && len(pr) > 0 {
		prov := map[string]any{}
		for field, val := range pr {
			if e, ok := val.(map[string]any); ok {
				ne := map[string]any{}
				for k, x := range e {
					nk := k
					if mk, ok := legacyProvKeys[k]; ok {
						nk = mk
					}
					ne[nk] = x
				}
				prov[field] = ne
			} else {
				prov[field] = val
			}
		}
		ext["provenance"] = prov
	}
	if len(orcid) > 0 {
		ext["orcid"] = orcid
	}
	if len(ext) > 0 {
		out["spdf"] = ext
	}
	return out
}

// isoDateParts turns "1977-03-20" (or "1977-03", "1977") into CSL date-parts.
func isoDateParts(s string) []any {
	s = strings.TrimSpace(s)
	if i := strings.IndexAny(s, "T "); i > 0 {
		s = s[:i]
	}
	parts := strings.Split(s, "-")
	if len(parts) == 0 || len(parts) > 3 {
		return nil
	}
	out := make([]any, 0, len(parts))
	for _, p := range parts {
		n, err := strconv.ParseInt(p, 10, 64)
		if err != nil {
			return nil
		}
		out = append(out, n)
	}
	return out
}
