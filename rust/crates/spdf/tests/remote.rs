//! Remote reading through the HTTP range VFS, against a tiny local server.
#![cfg(feature = "http")]

use std::io::{BufRead, BufReader, Write};
use std::net::TcpListener;
use std::path::PathBuf;

fn conformance() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../../conformance")
}

/// Serves `data` on 127.0.0.1 with `Range` support (or without, if
/// `ranges` is false). Returns the URL.
fn serve(data: Vec<u8>, ranges: bool) -> String {
    let listener = TcpListener::bind("127.0.0.1:0").expect("bind");
    let addr = listener.local_addr().expect("addr");
    std::thread::spawn(move || {
        for stream in listener.incoming() {
            let Ok(mut stream) = stream else { continue };
            let data = data.clone();
            std::thread::spawn(move || {
                let Ok(clone) = stream.try_clone() else {
                    return;
                };
                let mut reader = BufReader::new(clone);
                loop {
                    let mut range: Option<(usize, usize)> = None;
                    let mut line = String::new();
                    if reader.read_line(&mut line).unwrap_or(0) == 0 {
                        return;
                    }
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
                                let a: usize = a.parse().unwrap_or(0);
                                let b: usize =
                                    b.parse().unwrap_or(data.len() - 1).min(data.len() - 1);
                                range = Some((a, b));
                            }
                        }
                    }
                    let resp = match (range, ranges) {
                        (Some((a, b)), true) => {
                            let body = &data[a..=b];
                            let mut r = format!(
                                "HTTP/1.1 206 Partial Content\r\nContent-Length: {}\r\nContent-Range: bytes {a}-{b}/{}\r\nAccept-Ranges: bytes\r\n\r\n",
                                body.len(),
                                data.len()
                            )
                            .into_bytes();
                            r.extend_from_slice(body);
                            r
                        }
                        _ => {
                            let mut r = format!(
                                "HTTP/1.1 200 OK\r\nContent-Length: {}\r\n\r\n",
                                data.len()
                            )
                            .into_bytes();
                            r.extend_from_slice(&data);
                            r
                        }
                    };
                    if stream.write_all(&resp).is_err() {
                        return;
                    }
                }
            });
        }
    });
    format!("http://{addr}/doc.spdf")
}

#[test]
fn remote_matches_local() {
    let path = conformance().join("files/quijote.spdf");
    let local = spdf::Spdf::open(&path).expect("local");
    let data = std::fs::read(&path).expect("read");
    let url = serve(data.clone(), true);
    let ropts = spdf::remote::RemoteOptions {
        block_size: 4096,
        ..Default::default()
    };
    let remote = spdf::remote::open_url(&url, &Default::default(), &ropts).expect("remote");
    assert_eq!(remote.url(), Some(url.as_str()));
    assert_eq!(
        remote.dump_canonical().expect("dump"),
        local.dump_canonical().expect("dump")
    );
    let a = remote.search_lexical("hidalgo", 5).expect("search");
    let b = local.search_lexical("hidalgo", 5).expect("search");
    assert_eq!(a, b);
    let stats = spdf::remote::stats(&remote).expect("stats");
    assert_eq!(stats.size, data.len() as u64);
    assert!(stats.requests >= 1);
}

#[test]
fn server_without_ranges_downloads_whole_file() {
    let path = conformance().join("legacy/garcilaso-4.1.spdf");
    let data = std::fs::read(&path).expect("read");
    let url = serve(data, false);
    let doc = spdf::remote::open_url(&url, &Default::default(), &Default::default()).expect("open");
    assert!(doc.is_legacy());
    assert!(spdf::remote::stats(&doc).is_none());
}
