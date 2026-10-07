package spdf

import (
	"bytes"
	"compress/gzip"
	"crypto/ed25519"
	"database/sql"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func ptr[T any](v T) *T { return &v }

func buildSample(t *testing.T, dir string) string {
	t.Helper()
	path := filepath.Join(dir, "sample.spdf")
	w, err := Create(path, &WriterOptions{Generator: "test/1"})
	if err != nil {
		t.Fatal(err)
	}
	must := func(err error) {
		t.Helper()
		if err != nil {
			t.Fatal(err)
		}
	}
	must(w.SetDocument(Document{
		ID: "doc1", Kind: "pdf", Mime: "application/pdf", Bytes: 10,
		SourceSHA256: strings.Repeat("ab", 32), Created: "2026-10-07T00:00:00Z",
		Metadata: map[string]any{"type": "book", "title": "Don Quijote: primera parte",
			"author":   []any{map[string]any{"family": "Cervantes", "given": "Miguel de"}},
			"issued":   map[string]any{"date-parts": []any{[]any{int64(1605)}}},
			"language": "es"},
		Title: ptr("Don Quijote"),
	}))
	must(w.AddUnit(Unit{ID: "u1", Anchor: Anchor{"type": "page", "physical": int64(1), "printed": "1", "source": "read"}, Text: "En un lugar de la Mancha, de cuyo nombre no quiero acordarme", Reader: "test"}))
	must(w.AddUnit(Unit{ID: "u2", Anchor: Anchor{"type": "page", "physical": int64(2), "printed": nil}, Text: "Canción del caballero", Reader: "test"}))
	must(w.AddFragment(Fragment{ID: "f1", Unit: "u1", Text: "En un lugar de la Mancha, de cuyo nombre no quiero acordarme", Anchor: Anchor{"type": "page", "physical": int64(1), "printed": "1", "chars": []any{int64(0), int64(24)}}}))
	must(w.AddFragment(Fragment{ID: "f2", Unit: "u2", Text: "Canción del caballero", Anchor: Anchor{"type": "page", "physical": int64(2), "printed": nil}}))
	must(w.AddSpace(SpaceDef{ID: "toy@3", Provider: "test", Model: "toy", Dims: 3}))
	must(w.AddVector("fragment", "f1", "toy@3", []float32{1, 0, 0}))
	must(w.AddVector("fragment", "f2", "toy@3", []float32{0, 1, 0}))
	must(w.AddBlob("img", "image/png", []byte{1, 2, 3}))
	must(w.AddProvenance(ProvenanceEntry{Stage: "read", At: "2026-10-07T00:00:00Z", Detail: map[string]any{"pages": int64(2)}}))
	must(w.Close())
	return path
}

func TestWriteReadValidate(t *testing.T) {
	dir := t.TempDir()
	path := buildSample(t, dir)
	res := Validate(path, nil)
	if !res.Valid {
		t.Fatalf("invalid: %+v", res)
	}
	f, err := Open(path, nil)
	if err != nil {
		t.Fatal(err)
	}
	defer f.Close()
	d, err := f.Dump()
	if err != nil {
		t.Fatal(err)
	}
	js := string(CanonicalJSON(d))
	if !strings.Contains(js, `"spdf_version":"5.0"`) || !strings.Contains(js, `"tokenizer":"unicode61 remove_diacritics 2"`) {
		t.Fatalf("dump: %s", js)
	}
	hits, err := f.SearchLexical("cancion", 5)
	if err != nil || len(hits) != 1 || hits[0].ID != "f2" {
		t.Fatalf("lexical: %+v %v", hits, err)
	}
	vh, err := f.SearchVector([]float64{0.9, 0.1, 0}, "toy@3", "", 5)
	if err != nil || len(vh) != 2 || vh[0].ID != "f1" {
		t.Fatalf("vector: %+v %v", vh, err)
	}
	hy, err := f.SearchHybrid("caballero", []float64{1, 0, 0}, "toy@3", 5)
	if err != nil || len(hy) != 2 {
		t.Fatalf("hybrid: %+v %v", hy, err)
	}
	if !strings.HasPrefix(hits[0].AnchorURI, "spdf:sha256-abab") || !strings.HasSuffix(hits[0].AnchorURI, "#p=2") {
		t.Fatalf("uri: %s", hits[0].AnchorURI)
	}
	c, _ := f.Cite(hits[0].Anchor, nil, "es")
	if c != "(Cervantes, 1605, s. p.)" {
		t.Fatalf("cite: %s", c)
	}
	bib, _ := f.ExportBibTeX()
	if !strings.Contains(bib, "@book{cervantes1605,") {
		t.Fatalf("bibtex: %s", bib)
	}
}

func TestRejectTrigger(t *testing.T) {
	dir := t.TempDir()
	path := buildSample(t, dir)
	db, err := sql.Open("sqlite", path)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec("CREATE TRIGGER evil AFTER INSERT ON units BEGIN SELECT 1; END"); err != nil {
		t.Fatal(err)
	}
	db.Close()
	if _, err := Open(path, nil); err == nil || !strings.Contains(err.Error(), "E020") {
		t.Fatalf("expected E020, got %v", err)
	}
	res := Validate(path, nil)
	if res.Valid || res.ErrorCodes()[0] != "E020" {
		t.Fatalf("validate: %+v", res)
	}
}

func TestGzipLegacy(t *testing.T) {
	dir := t.TempDir()
	raw := filepath.Join(dir, "legacy.sqlite")
	db, err := sql.Open("sqlite", raw)
	if err != nil {
		t.Fatal(err)
	}
	stmts := []string{
		`CREATE TABLE spdf (clave TEXT PRIMARY KEY, valor TEXT NOT NULL)`,
		`CREATE TABLE documentos (id TEXT PRIMARY KEY, tipo TEXT NOT NULL, metadatos TEXT NOT NULL, estado TEXT NOT NULL DEFAULT 'pendiente', huella TEXT NOT NULL, original TEXT NOT NULL, mime TEXT NOT NULL, bytes INTEGER NOT NULL, unidades INTEGER NOT NULL DEFAULT 0, duracion REAL, creado TEXT NOT NULL, actualizado TEXT NOT NULL, bibliotecas TEXT NOT NULL DEFAULT '[]', titulo TEXT, autores TEXT, anio INTEGER, idioma TEXT)`,
		`CREATE TABLE unidades (id TEXT PRIMARY KEY, documento TEXT NOT NULL, orden INTEGER NOT NULL, ancla TEXT NOT NULL, texto TEXT NOT NULL DEFAULT '', notas TEXT, cabecera TEXT, pie TEXT, imagen TEXT, miniatura TEXT, lector TEXT NOT NULL, confianza REAL NOT NULL DEFAULT 1, impresa TEXT, t0 REAL, t1 REAL, palabras TEXT)`,
		`CREATE TABLE secciones (id TEXT PRIMARY KEY, documento TEXT NOT NULL, padre TEXT, nivel INTEGER NOT NULL, titulo TEXT NOT NULL, unidad_desde TEXT NOT NULL, unidad_hasta TEXT, resumen TEXT)`,
		`CREATE TABLE fragmentos (n INTEGER PRIMARY KEY, id TEXT NOT NULL UNIQUE, documento TEXT NOT NULL, unidad TEXT NOT NULL, orden INTEGER NOT NULL, texto TEXT NOT NULL, contexto TEXT NOT NULL DEFAULT '', seccion TEXT, ancla TEXT NOT NULL, ancla_fin TEXT, texto_busqueda TEXT)`,
		`CREATE VIRTUAL TABLE fragmentos_fts USING fts5(texto, contexto, seccion, texto_busqueda, content='fragmentos', content_rowid='n', tokenize='unicode61 remove_diacritics 2')`,
		`CREATE TRIGGER fragmentos_ai AFTER INSERT ON fragmentos BEGIN INSERT INTO fragmentos_fts(rowid, texto, contexto, seccion, texto_busqueda) VALUES (new.n, new.texto, new.contexto, new.seccion, new.texto_busqueda); END`,
		`CREATE TABLE figuras (id TEXT PRIMARY KEY, documento TEXT NOT NULL, unidad TEXT NOT NULL, imagen TEXT NOT NULL, pie TEXT, descripcion TEXT, ancla TEXT NOT NULL)`,
		`CREATE TABLE espacios (id TEXT PRIMARY KEY, proveedor TEXT NOT NULL, modelo TEXT NOT NULL, version TEXT, dims INTEGER NOT NULL, normalizado INTEGER NOT NULL DEFAULT 1, modalidades TEXT NOT NULL, creado TEXT)`,
		`CREATE TABLE vectores (objetivo TEXT NOT NULL, id TEXT NOT NULL, espacio TEXT NOT NULL, documento TEXT NOT NULL, valores BLOB NOT NULL, PRIMARY KEY (objetivo, id, espacio))`,
		`CREATE TABLE blobs (clave TEXT PRIMARY KEY, mime TEXT NOT NULL, datos BLOB NOT NULL)`,
		`CREATE TABLE procedencia (documento TEXT NOT NULL, fase TEXT NOT NULL, proveedor TEXT, detalle TEXT, ms INTEGER, cuando TEXT NOT NULL)`,
		`PRAGMA user_version = 410`,
		`INSERT INTO spdf VALUES ('spdf_version','4.1'), ('creado','2026-01-01T00:00:00Z'), ('generador','scholaris-nube/spdf 0.2')`,
		`INSERT INTO documentos (id, tipo, metadatos, huella, original, mime, bytes, unidades, creado, actualizado, titulo, anio) VALUES ('d', 'pdf_escaneado', '{"titulo":"Arte","subtitulo":"nuevo","autores":[{"nombre":"Lope","apellidos":"de Vega"}],"anio":1609}', 'cd', 'orig', 'application/pdf', 5, 1, '2026', '2026', 'Arte', 1609)`,
		`INSERT INTO blobs VALUES ('orig', 'application/pdf', x'0102')`,
		`INSERT INTO unidades (id, documento, orden, ancla, texto, lector) VALUES ('u0', 'd', 0, '{"tipo":"pagina","fisica":1,"impresa":"3","romana":false,"origen":"deducido","confianza":0.5}', 'Arte nuevo de hacer comedias', 'x')`,
		`INSERT INTO fragmentos (n, id, documento, unidad, orden, texto, ancla, texto_busqueda) VALUES (1, 'f', 'd', 'u0', 0, 'Arte nuevo de hacer comedias', '{"tipo":"pagina","fisica":1,"impresa":"3","romana":false,"origen":"deducido","confianza":0.5}', '')`,
	}
	for _, s := range stmts {
		if _, err := db.Exec(s); err != nil {
			t.Fatal(s, err)
		}
	}
	db.Close()
	data, _ := os.ReadFile(raw)
	var buf bytes.Buffer
	zw := gzip.NewWriter(&buf)
	zw.Write(data)
	zw.Close()
	gz := filepath.Join(dir, "legacy.spdf")
	os.WriteFile(gz, buf.Bytes(), 0o644)

	f, err := Open(gz, nil)
	if err != nil {
		t.Fatal(err)
	}
	defer f.Close()
	if !f.IsLegacy() || f.Version() != "4.1" {
		t.Fatalf("version %s", f.Version())
	}
	d, err := f.Dump()
	if err != nil {
		t.Fatal(err)
	}
	doc := d["document"].(map[string]any)
	if doc["kind"] != "scanned_pdf" || doc["source_ref"] != "blob:orig" {
		t.Fatalf("doc: %v", doc)
	}
	md := doc["metadata"].(map[string]any)
	if md["title"] != "Arte: nuevo" || md["title-short"] != "Arte" || md["type"] != "book" {
		t.Fatalf("metadata: %v", md)
	}
	u := d["units"].([]any)[0].(map[string]any)
	if u["ord"] != int64(1) || u["anchor"].(map[string]any)["source"] != "inferred" {
		t.Fatalf("unit: %v", u)
	}
	if d["meta"].(map[string]any)["created"] != "2026-01-01T00:00:00Z" {
		t.Fatalf("meta: %v", d["meta"])
	}
	hits, err := f.SearchLexical("comedias", 3)
	if err != nil || len(hits) != 1 {
		t.Fatalf("legacy search: %v %v", hits, err)
	}
	c, _ := f.Cite(hits[0].Anchor, nil, "es")
	if c != "(de Vega, 1609, p. [3])" {
		t.Fatalf("cite: %s", c)
	}
	res := Validate(gz, nil)
	if !res.Valid || len(res.WarningCodes()) == 0 || res.WarningCodes()[0] != "W110" {
		t.Fatalf("legacy validate: %+v", res)
	}
}

func TestURIRoundTrip(t *testing.T) {
	a := Anchor{"type": "section", "path": []any{"Capítulo 3", "3.2 El panóptico/torre"}, "paragraph": int64(4), "printed": "145",
		"chars": []any{int64(118), int64(301)}, "region": map[string]any{"x": 0.125, "y": 0.2, "w": 0.3, "h": 0.1}}
	uri := AnchorURI("sha256-00ff", a, nil)
	want := "spdf:sha256-00ff#f=145&s=Cap%C3%ADtulo%203/3.2%20El%20pan%C3%B3ptico%2Ftorre&para=4&char=118,301&xywh=percent:12.5,20,30,10"
	if uri != want {
		t.Fatalf("got  %s\nwant %s", uri, want)
	}
	ref, loc, err := ParseURI(uri)
	if err != nil || ref != "sha256-00ff" {
		t.Fatal(err)
	}
	if FormatURI(ref, loc) != uri {
		t.Fatalf("round trip: %s", FormatURI(ref, loc))
	}
}

func TestCompileLexical(t *testing.T) {
	cases := map[string]string{
		`En un lugar de la Mancha`:   `"En" OR "un" OR "lugar" OR "de" OR "la" OR "Mancha"`,
		`«lugar de la» mancha "x y"`: `"lugar de la" AND "x y"`,
		`canción Cancion`:            `"canción"`,
		`"abierta sin cierre`:        `"abierta" OR "sin" OR "cierre"`,
	}
	for q, want := range cases {
		if got := CompileLexical(q).Match; got != want {
			t.Errorf("%q: got %s want %s", q, got, want)
		}
	}
}

func TestCanonical(t *testing.T) {
	v, _ := ParseJSON(`{"b":1.0,"a":[0.1234567,1e-7,-0.0,1e21,"é "],"c":null}`)
	got := string(CanonicalJSON(v))
	want := "{\"a\":[0.123457,0,0,1e+21,\"é \"],\"b\":1,\"c\":null}"
	if got != want {
		t.Fatalf("got %s want %s", got, want)
	}
}

func TestCiteRules(t *testing.T) {
	md := map[string]any{"title": "Obra: sub", "author": []any{map[string]any{"family": "Pérez"}, map[string]any{"family": "Iglesias"}},
		"issued": map[string]any{"date-parts": []any{[]any{int64(-350)}}}}
	if c := Cite(Anchor{"type": "time", "t0": 4160.5, "t1": 4170.0}, nil, md, "es"); c != "(Pérez e Iglesias, 350 a. C., 1:09:20)" {
		t.Fatal(c)
	}
	if c := Cite(Anchor{"type": "page", "physical": int64(3), "printed": "1r", "foliation": "leaf"}, Anchor{"type": "page", "physical": int64(4), "printed": "2v", "foliation": "leaf"}, map[string]any{"title": "Obra: sub"}, "en"); c != "(Obra, n.d., fols. 1r-2v)" {
		t.Fatal(c)
	}
}

func TestWriterSealsAndSigns(t *testing.T) {
	dir := t.TempDir()
	seed := make([]byte, ed25519.SeedSize)
	for i := range seed {
		seed[i] = byte(i)
	}
	key := ed25519.NewKeyFromSeed(seed)
	path := filepath.Join(dir, "signed.spdf")
	w, err := Create(path, &WriterOptions{Generator: "test/1", SigningKey: key})
	if err != nil {
		t.Fatal(err)
	}
	if err := w.SetDocument(Document{ID: "d", Kind: "document", Mime: "text/plain", Bytes: 1, SourceSHA256: strings.Repeat("0", 64),
		Created: "2026-10-07T00:00:00Z", Metadata: map[string]any{"type": "book", "title": "Firmado"}}); err != nil {
		t.Fatal(err)
	}
	if err := w.AddUnit(Unit{ID: "u1", Anchor: Anchor{"type": "page", "physical": int64(1), "printed": "1"}, Text: "Hola", Reader: "test"}); err != nil {
		t.Fatal(err)
	}
	if err := w.Close(); err != nil {
		t.Fatal(err)
	}
	res := Validate(path, nil)
	if !res.Valid {
		t.Fatalf("signed file invalid: %+v", res)
	}
	f, _ := Open(path, nil)
	defer f.Close()
	meta, _ := f.Meta()
	sum, _ := f.ContentSHA256()
	if meta["content_sha256"] != sum || !strings.HasPrefix(meta["signer"], "ed25519:") || meta["signature"] == "" {
		t.Fatalf("meta: %v", meta)
	}
	// Tampering with the signature must give E082.
	if !verifySignature(sum, meta["signature"], meta["signer"]) {
		t.Fatal("signature does not verify")
	}
	if verifySignature(strings.Repeat("0", 64), meta["signature"], meta["signer"]) {
		t.Fatal("signature verifies for another hash")
	}
}
