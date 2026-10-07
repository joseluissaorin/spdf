package spdf

import (
	"fmt"
	"regexp"
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

// Legacy metadata keys copied verbatim onto CSL variables.
var legacyMetaSimple = [][2]string{
	{"editorial", "publisher"}, {"lugar", "publisher-place"}, {"coleccion", "collection-title"},
	{"volumen", "volume"}, {"numero", "issue"}, {"paginas", "page"}, {"edicion", "edition"},
	{"doi", "DOI"}, {"isbn", "ISBN"}, {"url", "URL"}, {"idioma", "language"}, {"resumen", "abstract"},
}

var legacyNameLists = [][2]string{
	{"autores", "author"}, {"editores", "editor"}, {"traductores", "translator"}, {"entrevistadores", "interviewer"},
}

// Legacy field names (keys of «procedencia») → 5.0 names.
var legacyFieldNames = map[string]string{
	"titulo": "title", "subtitulo": "subtitle", "tituloOriginal": "original-title", "autores": "author",
	"editores": "editor", "traductores": "translator", "entrevistadores": "interviewer", "anio": "issued",
	"anioOriginal": "original-date", "editorial": "publisher", "lugar": "publisher-place",
	"revista": "container-title", "contenedor": "container-title", "coleccion": "collection-title",
	"volumen": "volume", "numero": "issue", "paginas": "page", "edicion": "edition", "doi": "DOI",
	"isbn": "ISBN", "url": "URL", "idioma": "language", "tipoCSL": "type", "resumen": "abstract",
	"idiomaOriginal": "original_language", "fecha": "issued", "sinFecha": "undated",
}

// Legacy provenance sources («fuente») → 5.0.
var legacyProvenanceSources = map[string]string{
	"lectura": "reading", "usuario": "user", "colofon": "colophon", "impresores": "printers",
}

// Legacy modalities → 5.0.
var legacyModalities = map[string]string{"texto": "text", "imagen": "image", "audio": "audio", "video": "video", "pdf": "pdf"}

// default CSL type of a legacy document without tipoCSL, by legacy kind.
var legacyDefaultCSLType = map[string]string{
	"audio": "speech", "video": "motion_picture", "web": "webpage", "presentacion": "speech",
	"hoja": "dataset", "imagen": "graphic", "fotos": "graphic",
}

// legacyHas: present, not null, not "" and not [].
func legacyHas(m map[string]any, k string) bool {
	v, ok := m[k]
	if !ok || v == nil {
		return false
	}
	switch t := v.(type) {
	case string:
		return t != ""
	case []any:
		return len(t) > 0
	}
	return true
}

func truthyString(v any) (string, bool) {
	s, ok := v.(string)
	return s, ok && s != ""
}

// MapLegacyMetadata converts legacy MetadatosDocumento JSON to a CSL-JSON item
// with the "spdf" extension object (contract §7). legacyKind is documentos.tipo.
func MapLegacyMetadata(v any, legacyKind string) any {
	m, ok := v.(map[string]any)
	if !ok {
		return v
	}
	item := map[string]any{}
	ext := map[string]any{}
	// type
	switch {
	case legacyTruthy(m["tipoCSL"]):
		item["type"] = m["tipoCSL"]
	case legacyTruthy(m["revista"]):
		item["type"] = "article-journal"
	default:
		if t, ok := legacyDefaultCSLType[legacyKind]; ok {
			item["type"] = t
		} else {
			item["type"] = "book"
		}
	}
	title := ""
	if s, ok := m["titulo"].(string); ok {
		title = s
	}
	if legacyHas(m, "subtitulo") {
		sub := fmt.Sprint(m["subtitulo"])
		if s, ok := m["subtitulo"].(string); ok {
			sub = s
		}
		item["title"] = title + ": " + sub
		item["title-short"] = title
		ext["subtitle"] = m["subtitulo"]
	} else {
		item["title"] = title
	}
	if legacyHas(m, "tituloOriginal") {
		item["original-title"] = m["tituloOriginal"]
	}
	orcid := map[string]any{}
	for _, pair := range legacyNameLists {
		list, _ := m[pair[0]].([]any)
		names := []any{}
		for _, e := range list {
			p, ok := e.(map[string]any)
			if !ok {
				continue
			}
			n := map[string]any{}
			if legacyTruthy(p["apellidos"]) {
				n["family"] = p["apellidos"]
			}
			if legacyTruthy(p["nombre"]) {
				n["given"] = p["nombre"]
			}
			if len(n) > 0 {
				names = append(names, n)
			}
			if legacyTruthy(p["orcid"]) {
				key, _ := p["apellidos"].(string)
				if g, ok := truthyString(p["nombre"]); ok {
					key += ", " + g
				}
				orcid[key] = p["orcid"]
			}
		}
		if len(names) > 0 {
			item[pair[1]] = names
		}
	}
	var fecha []any
	if legacyHas(m, "fecha") {
		if s, ok := m["fecha"].(string); ok {
			fecha = isoDateParts(s)
		}
	}
	if fecha != nil && (!legacyHas(m, "anio") || JSONEqual(fecha[0], m["anio"])) {
		item["issued"] = map[string]any{"date-parts": []any{fecha}}
	} else if legacyHas(m, "anio") {
		item["issued"] = map[string]any{"date-parts": []any{[]any{m["anio"]}}}
	}
	if legacyHas(m, "anioOriginal") {
		item["original-date"] = map[string]any{"date-parts": []any{[]any{m["anioOriginal"]}}}
	}
	for _, pair := range legacyMetaSimple {
		if legacyHas(m, pair[0]) {
			item[pair[1]] = m[pair[0]]
		}
	}
	if legacyHas(m, "revista") {
		item["container-title"] = m["revista"]
	} else if legacyHas(m, "contenedor") {
		item["container-title"] = m["contenedor"]
	}
	if legacyHas(m, "idiomaOriginal") {
		ext["original_language"] = m["idiomaOriginal"]
	}
	if legacyHas(m, "sinFecha") {
		u := map[string]any{}
		if sf, ok := m["sinFecha"].(map[string]any); ok {
			if d, ok := sf["desde"]; ok && d != nil {
				u["from"] = d
			}
			if h, ok := sf["hasta"]; ok && h != nil {
				u["to"] = h
			}
			if legacyTruthy(sf["fundamento"]) {
				u["basis"] = sf["fundamento"]
			}
		}
		ext["undated"] = u
	}
	if legacyHas(m, "procedencia") {
		prov := map[string]any{}
		if pr, ok := m["procedencia"].(map[string]any); ok {
			for field, val := range pr {
				key := field
				if mk, ok := legacyFieldNames[field]; ok {
					key = mk
				}
				e, _ := val.(map[string]any)
				src := e["fuente"]
				if s, ok := src.(string); ok {
					if ms, ok := legacyProvenanceSources[s]; ok {
						src = ms
					}
				}
				prov[key] = map[string]any{"source": src, "confidence": e["confianza"]}
			}
		}
		ext["provenance"] = prov
	}
	if len(orcid) > 0 {
		ext["orcid"] = orcid
	}
	if len(ext) > 0 {
		item["spdf"] = ext
	}
	return item
}

// legacyTruthy mirrors a truthiness test on JSON values.
func legacyTruthy(v any) bool {
	switch t := v.(type) {
	case nil:
		return false
	case bool:
		return t
	case string:
		return t != ""
	case int64:
		return t != 0
	case float64:
		return t != 0
	case []any:
		return len(t) > 0
	case map[string]any:
		return len(t) > 0
	}
	return true
}

var isoDateRe = regexp.MustCompile(`^(-?\d{1,4})(?:-(\d{1,2})(?:-(\d{1,2}))?)?`)

// isoDateParts turns "1977-03-20" (or "1977-03", "1977", "-0350") into CSL date-parts.
func isoDateParts(s string) []any {
	m := isoDateRe.FindStringSubmatch(strings.TrimSpace(s))
	if m == nil {
		return nil
	}
	var out []any
	for _, g := range m[1:] {
		if g == "" {
			continue
		}
		n, err := strconv.ParseInt(g, 10, 64)
		if err != nil {
			return nil
		}
		out = append(out, n)
	}
	return out
}
