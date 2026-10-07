//! Simple benchmarks (median of repeated runs), printed as a Markdown table.
//!
//! ```sh
//! cargo bench -p spdf                                  # synthetic 245-page book
//! SPDF_BENCH_BOOK=/path/to/book.spdf cargo bench -p spdf  # a real book (5.0 or 4.x)
//! ```
//!
//! The synthetic book is made of words taken from the public-domain texts of
//! the conformance suite; the 10 000-vector file uses deterministic
//! pseudo-random unit vectors of 768 dimensions in f32, f16 and i8.

use std::path::{Path, PathBuf};
use std::time::{Duration, Instant};

use serde_json::json;
use spdf::{Document, Fragment, OpenOptions, Space, Spdf, Target, Unit, Writer};

const DIMS: usize = 768;
const N_VECTORS: usize = 10_000;

struct Rng(u64);
impl Rng {
    fn next(&mut self) -> u64 {
        // xorshift64*
        self.0 ^= self.0 >> 12;
        self.0 ^= self.0 << 25;
        self.0 ^= self.0 >> 27;
        self.0.wrapping_mul(0x2545_F491_4F6C_DD1D)
    }
    fn unit(&mut self) -> f64 {
        (self.next() >> 11) as f64 / (1u64 << 53) as f64
    }
    fn gauss(&mut self) -> f32 {
        // Box-Muller
        let (u1, u2) = (self.unit().max(1e-12), self.unit());
        ((-2.0 * u1.ln()).sqrt() * (2.0 * std::f64::consts::PI * u2).cos()) as f32
    }
}

fn normalized(rng: &mut Rng) -> Vec<f32> {
    let mut v: Vec<f32> = (0..DIMS).map(|_| rng.gauss()).collect();
    let n = v.iter().map(|x| x * x).sum::<f32>().sqrt();
    v.iter_mut().for_each(|x| *x /= n);
    v
}

fn conformance() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../../conformance")
}

fn vocabulary() -> Vec<String> {
    let mut words = Vec::new();
    for name in [
        "quijote",
        "lazarillo",
        "darwin",
        "micrographia",
        "apolo11",
        "minimo",
    ] {
        let Ok(doc) = Spdf::open(conformance().join(format!("files/{name}.spdf"))) else {
            continue;
        };
        for f in doc.fragments().unwrap_or_default() {
            for w in f.text.split(|c: char| !c.is_alphanumeric()) {
                if w.chars().count() > 1 {
                    words.push(w.to_string());
                }
            }
        }
    }
    if words.is_empty() {
        words = "en un lugar de la mancha de cuyo nombre no quiero acordarme"
            .split(' ')
            .map(String::from)
            .collect();
    }
    words
}

fn document(id: &str, units: i64) -> Document {
    serde_json::from_value(json!({
        "id": id, "kind": "pdf",
        "metadata": {"type": "book", "title": "Synthetic benchmark book", "author": [{"family": "Bench"}], "issued": {"date-parts": [[1900]]}},
        "source_sha256": "0".repeat(64), "source_ref": null, "mime": "application/pdf", "bytes": 1, "unit_count": units,
        "duration": null, "created": "2026-10-07T00:00:00Z", "updated": "2026-10-07T00:00:00Z",
        "title": "Synthetic benchmark book", "authors": "Bench", "year": 1900, "language": "es", "rights": null
    }))
    .expect("document")
}

/// A 245-page book: ~380 words per page, 2 fragments per page, one 768-d space.
fn synthetic_book(path: &Path) {
    let vocab = vocabulary();
    let mut rng = Rng(0x5eed);
    let mut w = Writer::new().expect("writer");
    w.set_document(&document("book", 245)).expect("doc");
    let space = Space::new("bench", "toy", DIMS);
    w.add_space(&space).expect("space");
    let mut n = 0;
    for p in 1..=245i64 {
        let words: Vec<&str> = (0..380)
            .map(|_| {
                // Zipf-ish: favour the start of the vocabulary.
                let r = rng.unit();
                let i = ((r * r * r) * vocab.len() as f64) as usize;
                vocab[i.min(vocab.len() - 1)].as_str()
            })
            .collect();
        let text = words.join(" ");
        let anchor = json!({"type": "page", "physical": p, "printed": (p - 8).max(1).to_string()});
        let u: Unit = serde_json::from_value(json!({
            "id": format!("u{p}"), "document": "book", "ord": p, "anchor": anchor, "text": text,
            "notes": null, "header": null, "footer": null, "image": null, "thumbnail": null,
            "reader": "bench", "confidence": 1.0, "printed": (p - 8).max(1).to_string(), "t0": null, "t1": null, "words": null
        }))
        .expect("unit");
        w.add_unit(&u).expect("unit");
        for half in 0..2 {
            n += 1;
            let part = words[half * 190..(half + 1) * 190].join(" ");
            let f: Fragment = serde_json::from_value(json!({
                "n": n, "id": format!("f{n}"), "document": "book", "unit": format!("u{p}"), "ord": n,
                "text": part, "context": format!("Page {p}"), "section": ["Chapter"], "anchor": anchor,
                "anchor_end": null, "search_text": ""
            }))
            .expect("fragment");
            w.add_fragment(&f).expect("fragment");
            w.add_vector(
                Target::Fragment,
                &format!("f{n}"),
                &space.id,
                &normalized(&mut rng),
            )
            .expect("vector");
        }
    }
    w.write(path).expect("write");
}

/// 10 000 fragments with 768-d vectors in three compatible spaces.
fn vector_file(path: &Path) {
    let mut rng = Rng(0xfeed);
    let mut w = Writer::new().expect("writer");
    w.set_document(&document("vec", 1)).expect("doc");
    let u: Unit = serde_json::from_value(json!({
        "id": "u1", "document": "vec", "ord": 1, "anchor": {"type": "page", "physical": 1, "printed": "1"},
        "text": "", "notes": null, "header": null, "footer": null, "image": null, "thumbnail": null,
        "reader": "bench", "confidence": 1.0, "printed": "1", "t0": null, "t1": null, "words": null
    }))
    .expect("unit");
    w.add_unit(&u).expect("unit");
    let mut spaces = Vec::new();
    for dt in ["f32", "f16", "i8"] {
        let mut s = Space::new("bench", "toy", DIMS);
        if dt != "f32" {
            s.id = format!("toy@{DIMS}:{dt}");
            s.dtype = dt.into();
        }
        w.add_space(&s).expect("space");
        spaces.push(s.id);
    }
    for n in 1..=N_VECTORS {
        let f: Fragment = serde_json::from_value(json!({
            "n": n, "id": format!("f{n}"), "document": "vec", "unit": "u1", "ord": n,
            "text": format!("fragment {n}"), "context": "", "section": null,
            "anchor": {"type": "page", "physical": 1, "printed": "1"}, "anchor_end": null, "search_text": ""
        }))
        .expect("fragment");
        w.add_fragment(&f).expect("fragment");
        let v = normalized(&mut rng);
        for s in &spaces {
            w.add_vector(Target::Fragment, &format!("f{n}"), s, &v)
                .expect("vector");
        }
    }
    w.write(path).expect("write");
}

fn measure(name: &str, iters: usize, mut f: impl FnMut()) -> (String, Duration, Duration) {
    f(); // warm-up
    let mut times: Vec<Duration> = (0..iters)
        .map(|_| {
            let t = Instant::now();
            f();
            t.elapsed()
        })
        .collect();
    times.sort();
    let median = times[times.len() / 2];
    let p90 = times[(times.len() * 9 / 10).min(times.len() - 1)];
    (name.to_string(), median, p90)
}

fn fmt(d: Duration) -> String {
    let us = d.as_secs_f64() * 1e6;
    if us < 1000.0 {
        format!("{us:.0} µs")
    } else {
        format!("{:.2} ms", us / 1000.0)
    }
}

fn main() {
    // `cargo test --benches` runs this with --bench too; skip the slow work there.
    if std::env::args().any(|a| a == "--list" || a == "--test") {
        return;
    }
    let tmp = std::env::temp_dir().join(format!("spdf-bench-{}", std::process::id()));
    std::fs::create_dir_all(&tmp).expect("tmp");
    let (book, label) = match std::env::var("SPDF_BENCH_BOOK") {
        Ok(p) => (PathBuf::from(p), "real book"),
        Err(_) => {
            let p = tmp.join("book.spdf");
            synthetic_book(&p);
            (p, "synthetic book")
        }
    };
    let opened = Spdf::open(&book).expect("open book");
    let legacy = opened.is_legacy();
    let book50 = if legacy {
        let p = tmp.join("book-50.spdf");
        spdf::convert_legacy(&book, &p).expect("convert");
        p
    } else {
        book.clone()
    };
    let doc = Spdf::open(&book50).expect("open 5.0");
    let units = doc.units().expect("units").len();
    let frags = doc.fragments().expect("fragments").len();
    let size = std::fs::metadata(&book).map(|m| m.len()).unwrap_or(0);
    let size50 = std::fs::metadata(&book50).map(|m| m.len()).unwrap_or(0);
    let vecs = tmp.join("vectors.spdf");
    let t = Instant::now();
    vector_file(&vecs);
    let build_vec = t.elapsed();
    let vdoc = Spdf::open(&vecs).expect("open vectors");
    let mut rng = Rng(0xabc);
    let q = normalized(&mut rng);
    let opts = OpenOptions::default();
    let book_bytes = std::fs::read(&book).expect("read");

    let mut rows = Vec::new();
    if legacy {
        rows.push(measure("open legacy 4.x (gzip, in memory)", 20, || {
            let d = Spdf::from_bytes(&book_bytes, &opts).expect("open");
            std::hint::black_box(d.version().len());
        }));
    }
    rows.push(measure("open 5.0 (file, safe checks)", 200, || {
        let d = Spdf::open(&book50).expect("open");
        std::hint::black_box(d.version().len());
    }));
    rows.push(measure("open 5.0 + document() + units()", 100, || {
        let d = Spdf::open(&book50).expect("open");
        std::hint::black_box(d.units().expect("units").len());
    }));
    for query in [
        "the",
        "medieval model",
        "\"the discarded image\"",
        "hidalgo lanza",
    ] {
        rows.push(measure(
            &format!("lexical `{query}` (limit 10)"),
            200,
            || {
                std::hint::black_box(doc.search_lexical(query, 10).expect("search").len());
            },
        ));
    }
    rows.push(measure("dump (canonical JCS string)", 20, || {
        std::hint::black_box(doc.dump_canonical().expect("dump").len());
    }));
    rows.push(measure("validate (incl. FTS integrity-check)", 10, || {
        std::hint::black_box(spdf::validate(&book50).valid);
    }));
    for (sp, label) in [
        (format!("toy@{DIMS}"), "f32"),
        (format!("toy@{DIMS}:i8"), "i8"),
    ] {
        rows.push(measure(
            &format!("vector 10 000 × {DIMS} {label}, cold (reads SQLite)"),
            20,
            || {
                vdoc.clear_vector_cache();
                std::hint::black_box(
                    vdoc.search_vector(&sp, &q, Target::Fragment, 10)
                        .expect("vector")
                        .len(),
                );
            },
        ));
    }
    for (sp, label) in [
        (format!("toy@{DIMS}"), "f32"),
        (format!("toy@{DIMS}:f16"), "f16"),
        (format!("toy@{DIMS}:i8"), "i8"),
    ] {
        rows.push(measure(
            &format!("vector 10 000 × {DIMS} {label}, warm (cached)"),
            20,
            || {
                std::hint::black_box(
                    vdoc.search_vector(&sp, &q, Target::Fragment, 10)
                        .expect("vector")
                        .len(),
                );
            },
        ));
    }
    rows.push(measure(
        &format!("hybrid 10 000 × {DIMS} f32 + lexical"),
        20,
        || {
            std::hint::black_box(
                vdoc.search_hybrid("fragment 42", &q, &format!("toy@{DIMS}"), 10)
                    .expect("hybrid")
                    .len(),
            );
        },
    ));
    rows.push(measure("dump of the 10 000-vector file", 5, || {
        std::hint::black_box(vdoc.dump_canonical().expect("dump").len());
    }));

    #[cfg(feature = "http")]
    let remote_report = remote_probe(&book50);
    #[cfg(not(feature = "http"))]
    let remote_report = String::new();

    println!(
        "\n{label}: {units} units, {frags} fragments, {:.1} MB ({}), 5.0 copy {:.1} MB",
        size as f64 / 1e6,
        if legacy { "legacy gzip" } else { "5.0" },
        size50 as f64 / 1e6
    );
    println!(
        "vector file: {N_VECTORS} fragments × {DIMS} dims × 3 dtypes, {:.1} MB, written in {}\n",
        std::fs::metadata(&vecs).map(|m| m.len()).unwrap_or(0) as f64 / 1e6,
        fmt(build_vec)
    );
    println!("| operation | median | p90 |\n|---|---:|---:|");
    for (n, m, p) in rows {
        println!("| {n} | {} | {} |", fmt(m), fmt(p));
    }
    if !remote_report.is_empty() {
        println!("\n{remote_report}");
    }
    if std::env::var("SPDF_BENCH_KEEP").is_err() {
        let _ = std::fs::remove_dir_all(&tmp);
    } else {
        eprintln!("kept {}", tmp.display());
    }
}

/// Opens the book through the HTTP range VFS from a local server and reports
/// how much is downloaded for opening and for a few lexical searches.
#[cfg(feature = "http")]
fn remote_probe(path: &Path) -> String {
    use std::io::{BufRead, BufReader, Write};
    let data = std::fs::read(path).expect("read");
    let size = data.len();
    let listener = std::net::TcpListener::bind("127.0.0.1:0").expect("bind");
    let addr = listener.local_addr().expect("addr");
    std::thread::spawn(move || {
        for stream in listener.incoming() {
            let Ok(mut stream) = stream else { continue };
            let data = data.clone();
            std::thread::spawn(move || {
                let Ok(c) = stream.try_clone() else { return };
                let mut reader = BufReader::new(c);
                loop {
                    let mut line = String::new();
                    if reader.read_line(&mut line).unwrap_or(0) == 0 {
                        return;
                    }
                    let mut range = (0usize, data.len() - 1);
                    loop {
                        let mut h = String::new();
                        if reader.read_line(&mut h).unwrap_or(0) == 0 {
                            return;
                        }
                        let h = h.trim_end().to_ascii_lowercase();
                        if h.is_empty() {
                            break;
                        }
                        if let Some(r) = h.strip_prefix("range: bytes=") {
                            if let Some((a, b)) = r.split_once('-') {
                                range = (
                                    a.parse().unwrap_or(0),
                                    b.parse().unwrap_or(data.len() - 1).min(data.len() - 1),
                                );
                            }
                        }
                    }
                    let body = &data[range.0..=range.1];
                    let mut r = format!(
                        "HTTP/1.1 206 Partial Content\r\nContent-Length: {}\r\nContent-Range: bytes {}-{}/{}\r\n\r\n",
                        body.len(), range.0, range.1, data.len()
                    ).into_bytes();
                    r.extend_from_slice(body);
                    if stream.write_all(&r).is_err() {
                        return;
                    }
                }
            });
        }
    });
    let url = format!("http://{addr}/book.spdf");
    let ropts = spdf::remote::RemoteOptions {
        block_size: 16 * 1024,
        ..Default::default()
    };
    let t = Instant::now();
    let doc = spdf::remote::open_url(&url, &OpenOptions::default(), &ropts).expect("remote");
    let open_t = t.elapsed();
    let after_open = spdf::remote::stats(&doc).expect("stats");
    let t = Instant::now();
    for q in [
        "the",
        "medieval model",
        "\"the discarded image\"",
        "hidalgo lanza",
    ] {
        std::hint::black_box(doc.search_lexical(q, 10).expect("search").len());
    }
    let search_t = t.elapsed();
    let after = spdf::remote::stats(&doc).expect("stats");
    format!(
        "remote (local HTTP server, 16 KiB blocks): open {} with {} requests / {:.0} KiB; \
         4 lexical searches {} with {} more requests / {:.0} KiB; file {:.1} MB",
        fmt(open_t),
        after_open.requests,
        after_open.bytes as f64 / 1024.0,
        fmt(search_t),
        after.requests - after_open.requests,
        (after.bytes - after_open.bytes) as f64 / 1024.0,
        size as f64 / 1e6
    )
}
