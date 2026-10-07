//! Behaviour of the public API beyond the conformance cases: safe opening,
//! limits, writing, legacy conversion and integrity.

use std::io::Write;
use std::path::PathBuf;

use rusqlite::Connection;
use serde_json::json;
use spdf::{Error, OpenOptions, Spdf, Target, Writer};

fn conformance() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../../conformance")
}

fn tmp(name: &str) -> PathBuf {
    let dir = std::env::temp_dir().join(format!("spdf-rs-tests-{}", std::process::id()));
    std::fs::create_dir_all(&dir).expect("tmp dir");
    dir.join(name)
}

fn copy_writable(src: &str, name: &str) -> PathBuf {
    let dst = tmp(name);
    std::fs::copy(conformance().join(src), &dst).expect("copy");
    dst
}

#[test]
fn opening_is_read_only_and_query_only() {
    let doc = Spdf::open(conformance().join("files/minimo.spdf")).expect("open");
    let c = doc.connection();
    assert!(c.execute("DELETE FROM units", []).is_err());
    assert!(c.execute_batch("CREATE TABLE x(a)").is_err());
    let qo: i64 = c
        .query_row("PRAGMA query_only", [], |r| r.get(0))
        .expect("pragma");
    assert_eq!(qo, 1);
    let ts: i64 = c
        .query_row("PRAGMA trusted_schema", [], |r| r.get(0))
        .expect("pragma");
    assert_eq!(ts, 0);
    assert!(c
        .execute_batch("ATTACH DATABASE ':memory:' AS other")
        .is_err());
}

#[test]
fn triggers_and_views_are_refused() {
    for (name, sql) in [
        (
            "trigger.spdf",
            "CREATE TRIGGER t AFTER INSERT ON units BEGIN SELECT 1; END",
        ),
        ("view.spdf", "CREATE VIEW v AS SELECT id FROM units"),
    ] {
        let p = copy_writable("files/minimo.spdf", name);
        Connection::open(&p)
            .expect("rw")
            .execute_batch(sql)
            .expect("mutate");
        match Spdf::open(&p) {
            Err(Error::UnsafeSchema(m)) => assert!(!m.is_empty()),
            other => panic!("{name}: expected UnsafeSchema, got {other:?}"),
        }
    }
    // Legacy files carry exactly the three tolerated FTS triggers.
    let legacy = Spdf::open(conformance().join("legacy/garcilaso-4.1.spdf")).expect("legacy");
    assert!(legacy.is_legacy());
}

#[test]
fn unknown_required_extension_is_refused() {
    let p = copy_writable("files/minimo.spdf", "ext.spdf");
    Connection::open(&p)
        .expect("rw")
        .execute(
            "INSERT INTO extensions VALUES ('x_acme_secret', '1.0', 1)",
            [],
        )
        .expect("insert");
    match Spdf::open(&p) {
        Err(e @ Error::UnknownRequiredExtension(_)) => assert_eq!(e.code(), Some("E060")),
        other => panic!("expected E060, got {other:?}"),
    }
    let ok = Spdf::open_with(
        &p,
        &OpenOptions {
            known_extensions: vec!["x_acme_secret".into()],
            ..Default::default()
        },
    );
    assert!(ok.is_ok());
}

#[test]
fn blob_limit_is_enforced() {
    let src = Spdf::open(conformance().join("files/minimo.spdf")).expect("open");
    let mut w = Writer::from_spdf(&src).expect("writer");
    w.add_blob(
        "big.bin",
        "application/octet-stream",
        &vec![7u8; 2 * 1024 * 1024],
    )
    .expect("blob");
    let bytes = w.to_bytes().expect("bytes");
    let opts = OpenOptions {
        max_blob_bytes: 1024 * 1024,
        ..Default::default()
    };
    let doc = Spdf::from_bytes(&bytes, &opts).expect("open");
    assert!(doc.blob("big.bin").is_err());
    assert!(doc.blob("original.txt").expect("small blob").is_some());
    let doc = Spdf::open(conformance().join("files/minimo.spdf")).expect("open");
    let b = doc
        .resolve_image("blob:original.txt")
        .expect("blob")
        .expect("present");
    assert_eq!(b.data.len(), 273);
}

#[test]
fn gzip_bomb_is_bounded() {
    let mut enc = flate2::write::GzEncoder::new(Vec::new(), flate2::Compression::best());
    enc.write_all(&vec![0u8; 4 * 1024 * 1024]).expect("gz");
    let gz = enc.finish().expect("gz");
    let opts = OpenOptions {
        max_decompressed_bytes: 1024 * 1024,
        ..Default::default()
    };
    match Spdf::from_bytes(&gz, &opts) {
        Err(Error::TooLarge(_)) => {}
        other => panic!("expected TooLarge, got {other:?}"),
    }
}

#[test]
fn not_sqlite_and_not_spdf() {
    match Spdf::from_bytes(b"hello", &OpenOptions::default()) {
        Err(e) => assert_eq!(e.code(), Some("E001")),
        Ok(_) => panic!("accepted text"),
    }
    let p = tmp("plain.sqlite");
    let _ = std::fs::remove_file(&p);
    Connection::open(&p)
        .expect("db")
        .execute_batch("CREATE TABLE t(a)")
        .expect("t");
    match Spdf::open(&p) {
        Err(e) => assert_eq!(e.code(), Some("E002")),
        Ok(_) => panic!("accepted a non-SPDF database"),
    }
}

#[test]
fn gzip_wrapped_50_opens_with_warning() {
    let data = std::fs::read(conformance().join("files/minimo.spdf")).expect("read");
    let mut enc = flate2::write::GzEncoder::new(Vec::new(), flate2::Compression::default());
    enc.write_all(&data).expect("gz");
    let gz = enc.finish().expect("gz");
    let doc = Spdf::from_bytes(&gz, &OpenOptions::default()).expect("open");
    assert!(doc.was_gzip());
    let r = spdf::validate_bytes(&gz);
    assert!(r.valid);
    assert_eq!(r.warning_codes(), vec!["E003".to_string()]);
}

#[test]
fn legacy_conversion_gives_a_valid_50_file_with_the_same_content() {
    for name in ["garcilaso-4.1", "kennedy-4.0"] {
        let src = conformance().join(format!("legacy/{name}.spdf"));
        let dst = tmp(&format!("{name}-5.spdf"));
        spdf::convert_legacy(&src, &dst).expect("convert");
        let r = spdf::validate(&dst);
        assert!(r.valid, "{name}: {:?}", r.errors);
        assert!(r.warnings.is_empty(), "{name}: {:?}", r.warnings);
        let old = Spdf::open(&src).expect("old").dump().expect("dump");
        let new = Spdf::open(&dst).expect("new").dump().expect("dump");
        for k in [
            "document",
            "units",
            "sections",
            "fragments",
            "figures",
            "spaces",
            "vectors",
            "blobs",
            "provenance",
        ] {
            assert!(spdf::canon::equal(&old[k], &new[k]), "{name}: {k} differs");
        }
        assert_eq!(new["spdf_version"], "5.0");
        assert_eq!(new["meta"]["converted_from"], old["spdf_version"]);
        // Search works the same on both.
        let q = if name.starts_with("garcilaso") {
            "dulce lamentar"
        } else {
            "moon"
        };
        let a = Spdf::open(&src)
            .expect("old")
            .search_lexical(q, 5)
            .expect("search");
        let b = Spdf::open(&dst)
            .expect("new")
            .search_lexical(q, 5)
            .expect("search");
        assert!(!a.is_empty(), "{name}: no hits for {q}");
        assert_eq!(
            a.iter().map(|h| h.fragment_id.clone()).collect::<Vec<_>>(),
            b.iter().map(|h| h.fragment_id.clone()).collect::<Vec<_>>()
        );
    }
}

#[test]
fn writer_round_trip_and_reader_api() {
    let src = Spdf::open(conformance().join("files/darwin.spdf")).expect("open");
    let mut w = Writer::from_spdf(&src).expect("writer");
    let bytes = w.to_bytes().expect("bytes");
    let copy = Spdf::from_bytes(&bytes, &OpenOptions::default()).expect("reopen");
    assert_eq!(copy.dump().expect("dump"), src.dump().expect("dump"));
    assert!(spdf::validate_bytes(&bytes).valid);

    // Typed accessors.
    let units = copy.units().expect("units");
    assert!(!units.is_empty());
    assert_eq!(
        copy.unit_by_ord(1).expect("ord").map(|u| u.id),
        Some(units[0].id.clone())
    );
    if let Some(p) = &units[0].printed {
        assert!(copy.unit_by_printed(p).expect("printed").is_some());
    }
    let f = &copy.fragments().expect("fragments")[0];
    assert_eq!(copy.fragment(&f.id).expect("frag").as_ref(), Some(f));
    for sp in copy.spaces().expect("spaces") {
        let vs = copy
            .vectors(&sp.id, Some(Target::Fragment))
            .expect("vectors");
        assert!(vs.iter().all(|v| v.values.len() as i64 == sp.dims));
    }
    let csl = spdf::export::csl_json(&copy.document().expect("doc"));
    assert_eq!(csl[0]["id"], "darwin1859");
    assert!(csl[0].get("spdf").is_none());
    assert!(spdf::export::bibtex(&copy.document().expect("doc")).starts_with('@'));
}

#[test]
fn writer_quantizes_and_rejects_bad_vectors() {
    let mut w = Writer::new().expect("writer");
    let doc: spdf::Document = serde_json::from_value(json!({
        "id": "d", "kind": "document", "metadata": {"type": "book", "title": "T"},
        "source_sha256": "00", "source_ref": null, "mime": "text/plain", "bytes": 1, "unit_count": 1,
        "duration": null, "created": "2026-10-07T00:00:00Z", "updated": "2026-10-07T00:00:00Z",
        "title": "T", "authors": null, "year": null, "language": "es", "rights": null
    }))
    .expect("doc");
    w.set_document(&doc).expect("set");
    let mut sp = spdf::Space::new("local", "toy", 4);
    sp.id = "toy@4:i8".into();
    sp.dtype = "i8".into();
    w.add_space(&sp).expect("space");
    assert!(w
        .add_vector(Target::Fragment, "f1", "toy@4:i8", &[0.1, 0.2])
        .is_err());
    assert!(w
        .add_vector(Target::Fragment, "f1", "nope", &[0.0; 4])
        .is_err());
    w.add_vector(Target::Fragment, "f1", "toy@4:i8", &[0.5, -0.5, 1.0, 2.0])
        .expect("vec");
    let bytes = w.to_bytes().expect("bytes");
    let d = Spdf::from_bytes(&bytes, &OpenOptions::default()).expect("open");
    let v = d.vectors("toy@4:i8", None).expect("vectors");
    assert_eq!(v[0].values, vec![64.0 / 127.0, -64.0 / 127.0, 1.0, 1.0]);
}

#[test]
fn sealing_and_signatures() {
    let key = spdf::KeyPair::from_seed(&[42u8; 32]);
    let src = conformance().join("files/minimo.spdf");
    let dst = tmp("minimo-signed.spdf");
    let r = spdf::integrity::seal(&src, &dst, Some(&key)).expect("seal");
    assert!(r.hash_ok);
    assert_eq!(r.signature_ok, Some(true));
    assert_eq!(r.signer_trusted, Some(true));
    let v = spdf::validate(&dst);
    assert!(v.valid, "{:?}", v.errors);
    // Tampering is detected.
    let bad = tmp("minimo-tampered.spdf");
    std::fs::copy(&dst, &bad).expect("copy");
    Connection::open(&bad)
        .expect("rw")
        .execute(
            "UPDATE spdf_meta SET value = 'core semantic' WHERE key = 'profile'",
            [],
        )
        .expect("tamper");
    let v = spdf::validate(&bad);
    assert_eq!(v.error_codes(), vec!["E081".to_string()]);
    // The conformance file signed with the public test key verifies.
    let q = Spdf::open(conformance().join("files/quijote.spdf")).expect("open");
    let manifest: serde_json::Value =
        serde_json::from_slice(&std::fs::read(conformance().join("manifest.json")).expect("m"))
            .expect("json");
    let r = q
        .verify_integrity(manifest["test_public_key"].as_str())
        .expect("verify");
    assert!(r.hash_ok && r.signature_ok == Some(true) && r.signer_trusted == Some(true));
}

#[test]
fn anchors_and_citations_from_search_hits() {
    let doc = Spdf::open(conformance().join("files/quijote.spdf")).expect("open");
    let meta = doc.document().expect("doc");
    let hits = doc.search_lexical("hidalgo", 3).expect("search");
    assert!(!hits.is_empty());
    for h in &hits {
        let a = spdf::Anchor::from_value(&h.anchor).expect("anchor");
        let c = spdf::cite(&a, &meta, spdf::Locale::Es);
        assert!(c.starts_with("(Cervantes Saavedra, 1605"), "{c}");
        let u = spdf::parse_uri(&h.anchor_uri).expect("uri");
        assert_eq!(u.docref, meta.docref());
        assert_eq!(u.to_string(), h.anchor_uri);
        // The URI resolves to the unit where the fragment starts.
        let frag = doc.fragment(&h.fragment_id).expect("frag").expect("exists");
        let units = doc.locate(&h.anchor_uri).expect("locate");
        assert!(
            units.iter().any(|x| x.id == frag.unit),
            "{} -> {:?}",
            h.anchor_uri,
            units
        );
    }
    assert!(doc.locate("spdf:sha256-00#p=1").expect("locate").is_empty());
}

#[test]
fn sidecars() {
    let path = conformance().join("files/quijote.spdf");
    let doc = Spdf::open(&path).expect("open");
    let frags = doc.fragments().expect("fragments");
    let f = frags
        .iter()
        .find(|f| f.anchor.get("chars").is_some())
        .unwrap_or(&frags[0]);
    let a =
        spdf::sidecar::annotation(&doc, f, Some("Nota"), &Default::default()).expect("annotation");
    assert_eq!(a["motivation"], "commenting");
    let uri = spdf::sidecar::annotation_uri(&a).expect("uri");
    assert!(doc
        .locate(&uri)
        .expect("locate")
        .iter()
        .any(|u| u.id == f.unit));
    let quote = &a["target"]["selector"][1];
    assert_eq!(quote["type"], "TextQuoteSelector");
    assert!(!quote["exact"].as_str().unwrap_or("").is_empty());
    let p = tmp("notes.spdfa.json");
    spdf::sidecar::write_annotations(&p, std::slice::from_ref(&a), Some("Notas")).expect("write");
    assert_eq!(spdf::sidecar::read_annotations(&p).expect("read"), vec![a]);

    let mut lib = spdf::sidecar::Library::new("Fuentes");
    lib.add_file(&path, None).expect("add");
    lib.add_file(
        conformance().join("legacy/garcilaso-4.1.spdf"),
        Some("https://example.org/g.spdf"),
    )
    .expect("add");
    let lp = tmp("lib.spdfl.json");
    lib.write(&lp).expect("write");
    let back = spdf::sidecar::Library::read(&lp).expect("read");
    assert_eq!(back, lib);
    assert_eq!(
        back.items[0].sha256,
        doc.document().expect("doc").source_sha256
    );
}

#[test]
fn handles_can_move_between_threads() {
    fn send<T: Send>() {}
    send::<Spdf>();
    send::<Writer>();
    send::<spdf::ValidationReport>();
    let doc = Spdf::open(conformance().join("files/minimo.spdf")).expect("open");
    let n = std::thread::spawn(move || doc.units().expect("units").len())
        .join()
        .expect("thread");
    assert_eq!(n, 2);
}
