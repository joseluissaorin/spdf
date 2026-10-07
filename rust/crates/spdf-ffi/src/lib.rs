//! Stable C ABI over the `spdf` crate (header: `include/spdf.h`).
//!
//! Conventions:
//!
//! * every function returns an `int` status (`SPDF_OK` = 0) and writes its
//!   result through an out parameter;
//! * strings are UTF-8, NUL-terminated; strings returned by the library are
//!   owned by the caller and released with [`spdf_string_free`];
//! * complex values travel as JSON (the same shapes as the conformance
//!   protocol and the Rust types);
//! * on failure, [`spdf_last_error`] returns `{"status","code","message"}`
//!   for the calling thread (valid until the next call on that thread);
//! * documents are opaque handles ([`SpdfDoc`]) released with
//!   [`spdf_close`]. A handle may be used from one thread at a time.
#![allow(clippy::missing_safety_doc)]

use std::cell::RefCell;
use std::ffi::{c_char, c_int, CStr, CString};
use std::panic::{catch_unwind, AssertUnwindSafe};
use std::ptr;

use serde_json::{json, Value};
use spdf::{OpenOptions, Spdf, Target};

/// Success.
pub const SPDF_OK: c_int = 0;
/// A required argument is NULL or not valid UTF-8/JSON.
pub const SPDF_ERR_ARGUMENT: c_int = 1;
/// File or I/O error.
pub const SPDF_ERR_IO: c_int = 2;
/// The data is not a valid or supported SPDF (see the error code).
pub const SPDF_ERR_FORMAT: c_int = 3;
/// Something requested does not exist.
pub const SPDF_ERR_NOT_FOUND: c_int = 4;
/// Any other error (SQLite, internal).
pub const SPDF_ERR_OTHER: c_int = 5;
/// A Rust panic was caught at the boundary.
pub const SPDF_ERR_PANIC: c_int = 6;

/// An open SPDF document (opaque).
pub struct SpdfDoc {
    inner: Spdf,
}

thread_local! {
    static LAST_ERROR: RefCell<CString> = RefCell::new(CString::default());
}

fn set_error(status: c_int, code: Option<&str>, message: &str) {
    let v = json!({"status": status, "code": code, "message": message});
    let c = CString::new(v.to_string()).unwrap_or_default();
    LAST_ERROR.with(|e| *e.borrow_mut() = c);
}

fn clear_error() {
    LAST_ERROR.with(|e| *e.borrow_mut() = CString::default());
}

fn status_of(e: &spdf::Error) -> c_int {
    match e {
        spdf::Error::Io(_) => SPDF_ERR_IO,
        spdf::Error::NotFound(_) => SPDF_ERR_NOT_FOUND,
        spdf::Error::Json(_) | spdf::Error::InvalidUri(_) | spdf::Error::Invalid(_) => {
            SPDF_ERR_ARGUMENT
        }
        spdf::Error::Sqlite(_) => SPDF_ERR_OTHER,
        _ => SPDF_ERR_FORMAT,
    }
}

struct Fail(c_int, Option<String>, String);

impl From<spdf::Error> for Fail {
    fn from(e: spdf::Error) -> Self {
        Fail(status_of(&e), e.code().map(str::to_string), e.to_string())
    }
}

impl From<serde_json::Error> for Fail {
    fn from(e: serde_json::Error) -> Self {
        Fail(SPDF_ERR_ARGUMENT, None, format!("JSON: {e}"))
    }
}

fn arg(msg: &str) -> Fail {
    Fail(SPDF_ERR_ARGUMENT, None, msg.to_string())
}

/// Runs `f`, converting errors and panics into a status + last error.
fn guard(f: impl FnOnce() -> Result<(), Fail>) -> c_int {
    clear_error();
    match catch_unwind(AssertUnwindSafe(f)) {
        Ok(Ok(())) => SPDF_OK,
        Ok(Err(Fail(status, code, msg))) => {
            set_error(status, code.as_deref(), &msg);
            status
        }
        Err(_) => {
            set_error(SPDF_ERR_PANIC, None, "internal panic");
            SPDF_ERR_PANIC
        }
    }
}

unsafe fn str_arg<'a>(p: *const c_char, name: &str) -> Result<&'a str, Fail> {
    if p.is_null() {
        return Err(arg(&format!("`{name}` is NULL")));
    }
    // SAFETY: the caller passes a valid NUL-terminated string.
    unsafe { CStr::from_ptr(p) }
        .to_str()
        .map_err(|_| arg(&format!("`{name}` is not UTF-8")))
}

unsafe fn opt_str_arg<'a>(p: *const c_char, name: &str) -> Result<Option<&'a str>, Fail> {
    if p.is_null() {
        Ok(None)
    } else {
        // SAFETY: forwarded caller guarantee.
        unsafe { str_arg(p, name) }.map(Some)
    }
}

unsafe fn json_arg(p: *const c_char, name: &str) -> Result<Value, Fail> {
    // SAFETY: forwarded caller guarantee.
    let s = unsafe { str_arg(p, name) }?;
    serde_json::from_str(s).map_err(|e| arg(&format!("`{name}` is not JSON: {e}")))
}

unsafe fn opt_json_arg(p: *const c_char, name: &str) -> Result<Option<Value>, Fail> {
    if p.is_null() {
        return Ok(None);
    }
    // SAFETY: forwarded caller guarantee.
    let v = unsafe { json_arg(p, name) }?;
    Ok(if v.is_null() { None } else { Some(v) })
}

unsafe fn put_string(out: *mut *mut c_char, s: String) -> Result<(), Fail> {
    if out.is_null() {
        return Err(arg("output pointer is NULL"));
    }
    let c =
        CString::new(s).map_err(|_| Fail(SPDF_ERR_OTHER, None, "string contains NUL".into()))?;
    // SAFETY: `out` is a valid, writable pointer supplied by the caller.
    unsafe { *out = c.into_raw() };
    Ok(())
}

unsafe fn doc_ref<'a>(doc: *const SpdfDoc) -> Result<&'a Spdf, Fail> {
    if doc.is_null() {
        return Err(arg("document handle is NULL"));
    }
    // SAFETY: the handle was created by `spdf_open*` and not yet closed.
    Ok(unsafe { &(*doc).inner })
}

unsafe fn vector_arg<'a>(v: *const f32, dims: usize) -> Result<&'a [f32], Fail> {
    if v.is_null() {
        return Err(arg("vector is NULL"));
    }
    // SAFETY: the caller passes `dims` readable floats.
    Ok(unsafe { std::slice::from_raw_parts(v, dims) })
}

fn options(json: Option<Value>) -> Result<OpenOptions, Fail> {
    let mut o = OpenOptions::default();
    if let Some(v) = json {
        if let Some(n) = v.get("max_blob_bytes").and_then(Value::as_u64) {
            o.max_blob_bytes = usize::try_from(n).unwrap_or(usize::MAX);
        }
        if let Some(n) = v.get("max_decompressed_bytes").and_then(Value::as_u64) {
            o.max_decompressed_bytes = n;
        }
        if let Some(a) = v.get("known_extensions").and_then(Value::as_array) {
            o.known_extensions = a
                .iter()
                .filter_map(|x| x.as_str().map(str::to_string))
                .collect();
        }
        if let Some(b) = v.get("ignore_required_extensions").and_then(Value::as_bool) {
            o.ignore_required_extensions = b;
        }
    }
    Ok(o)
}

/// Library version (static string, do not free).
#[no_mangle]
pub extern "C" fn spdf_version() -> *const c_char {
    concat!(env!("CARGO_PKG_VERSION"), "\0").as_ptr().cast()
}

/// Last error of the calling thread as JSON `{"status","code","message"}`,
/// or an empty string. Valid until the next library call on this thread.
#[no_mangle]
pub extern "C" fn spdf_last_error() -> *const c_char {
    LAST_ERROR.with(|e| e.borrow().as_ptr())
}

/// Frees a string returned by the library. NULL is ignored.
#[no_mangle]
pub unsafe extern "C" fn spdf_string_free(s: *mut c_char) {
    if !s.is_null() {
        // SAFETY: `s` came from `CString::into_raw` in this library.
        drop(unsafe { CString::from_raw(s) });
    }
}

/// Frees a byte buffer returned by the library. NULL is ignored.
#[no_mangle]
pub unsafe extern "C" fn spdf_bytes_free(data: *mut u8, len: usize) {
    if !data.is_null() {
        // SAFETY: `data`/`len` came from a boxed slice leaked by this library.
        drop(unsafe { Box::from_raw(ptr::slice_from_raw_parts_mut(data, len)) });
    }
}

/// Opens a file safely. `options_json` may be NULL or
/// `{"max_blob_bytes","max_decompressed_bytes","known_extensions","ignore_required_extensions"}`.
#[no_mangle]
pub unsafe extern "C" fn spdf_open(
    path: *const c_char,
    options_json: *const c_char,
    out: *mut *mut SpdfDoc,
) -> c_int {
    guard(|| {
        // SAFETY: caller guarantees valid pointers.
        let path = unsafe { str_arg(path, "path") }?;
        let opts = options(unsafe { opt_json_arg(options_json, "options_json") }?)?;
        if out.is_null() {
            return Err(arg("out is NULL"));
        }
        let doc = Spdf::open_with(path, &opts)?;
        // SAFETY: `out` is writable.
        unsafe { *out = Box::into_raw(Box::new(SpdfDoc { inner: doc })) };
        Ok(())
    })
}

/// Opens an SPDF held in memory (SQLite or gzip-wrapped SQLite).
#[no_mangle]
pub unsafe extern "C" fn spdf_open_bytes(
    data: *const u8,
    len: usize,
    options_json: *const c_char,
    out: *mut *mut SpdfDoc,
) -> c_int {
    guard(|| {
        if data.is_null() || out.is_null() {
            return Err(arg("data or out is NULL"));
        }
        // SAFETY: caller passes `len` readable bytes.
        let bytes = unsafe { std::slice::from_raw_parts(data, len) };
        let opts = options(unsafe { opt_json_arg(options_json, "options_json") }?)?;
        let doc = Spdf::from_bytes(bytes, &opts)?;
        // SAFETY: `out` is writable.
        unsafe { *out = Box::into_raw(Box::new(SpdfDoc { inner: doc })) };
        Ok(())
    })
}

/// Closes a document. NULL is ignored.
#[no_mangle]
pub unsafe extern "C" fn spdf_close(doc: *mut SpdfDoc) {
    if !doc.is_null() {
        // SAFETY: `doc` came from `spdf_open*`.
        drop(unsafe { Box::from_raw(doc) });
    }
}

/// Format version of an open document (`"5.0"`, `"4.1"`…); free with `spdf_string_free`.
#[no_mangle]
pub unsafe extern "C" fn spdf_doc_version(doc: *const SpdfDoc, out: *mut *mut c_char) -> c_int {
    guard(|| {
        let d = unsafe { doc_ref(doc) }?;
        unsafe { put_string(out, d.version().to_string()) }
    })
}

/// Validates a file; writes the §12 report as JSON. Returns `SPDF_OK` even
/// when the file is invalid (read `"valid"`).
#[no_mangle]
pub unsafe extern "C" fn spdf_validate(path: *const c_char, out_json: *mut *mut c_char) -> c_int {
    guard(|| {
        let path = unsafe { str_arg(path, "path") }?;
        let r = spdf::validate(path);
        unsafe { put_string(out_json, serde_json::to_string(&r)?) }
    })
}

/// Validates an in-memory file.
#[no_mangle]
pub unsafe extern "C" fn spdf_validate_bytes(
    data: *const u8,
    len: usize,
    out_json: *mut *mut c_char,
) -> c_int {
    guard(|| {
        if data.is_null() {
            return Err(arg("data is NULL"));
        }
        // SAFETY: caller passes `len` readable bytes.
        let bytes = unsafe { std::slice::from_raw_parts(data, len) };
        let r = spdf::validate_bytes(bytes);
        unsafe { put_string(out_json, serde_json::to_string(&r)?) }
    })
}

/// Canonical dump (§5) serialized with RFC 8785 (JCS).
#[no_mangle]
pub unsafe extern "C" fn spdf_dump(doc: *const SpdfDoc, out_json: *mut *mut c_char) -> c_int {
    guard(|| {
        let d = unsafe { doc_ref(doc) }?;
        unsafe { put_string(out_json, d.dump_canonical()?) }
    })
}

/// `spdf_meta` as a JSON object.
#[no_mangle]
pub unsafe extern "C" fn spdf_meta(doc: *const SpdfDoc, out_json: *mut *mut c_char) -> c_int {
    guard(|| {
        let d = unsafe { doc_ref(doc) }?;
        unsafe { put_string(out_json, serde_json::to_string(&d.meta()?)?) }
    })
}

/// The document row as JSON (metadata is the CSL-JSON item).
#[no_mangle]
pub unsafe extern "C" fn spdf_document(doc: *const SpdfDoc, out_json: *mut *mut c_char) -> c_int {
    guard(|| {
        let d = unsafe { doc_ref(doc) }?;
        unsafe { put_string(out_json, serde_json::to_string(&d.document()?)?) }
    })
}

/// Units as a JSON array (reading order).
#[no_mangle]
pub unsafe extern "C" fn spdf_units(doc: *const SpdfDoc, out_json: *mut *mut c_char) -> c_int {
    guard(|| {
        let d = unsafe { doc_ref(doc) }?;
        unsafe { put_string(out_json, serde_json::to_string(&d.units()?)?) }
    })
}

/// Fragments as a JSON array (by `n`).
#[no_mangle]
pub unsafe extern "C" fn spdf_fragments(doc: *const SpdfDoc, out_json: *mut *mut c_char) -> c_int {
    guard(|| {
        let d = unsafe { doc_ref(doc) }?;
        unsafe { put_string(out_json, serde_json::to_string(&d.fragments()?)?) }
    })
}

/// Sections, figures and spaces as one JSON object `{"sections","figures","spaces"}`.
#[no_mangle]
pub unsafe extern "C" fn spdf_structure(doc: *const SpdfDoc, out_json: *mut *mut c_char) -> c_int {
    guard(|| {
        let d = unsafe { doc_ref(doc) }?;
        let v = json!({"sections": d.sections()?, "figures": d.figures()?, "spaces": d.spaces()?});
        unsafe { put_string(out_json, v.to_string()) }
    })
}

/// Reads a blob (`key` or `blob:<key>`). Writes the bytes (free with
/// `spdf_bytes_free(data, len)`) and the media type (free with
/// `spdf_string_free`). Returns `SPDF_ERR_NOT_FOUND` if absent.
#[no_mangle]
pub unsafe extern "C" fn spdf_blob(
    doc: *const SpdfDoc,
    key: *const c_char,
    out_data: *mut *mut u8,
    out_len: *mut usize,
    out_mime: *mut *mut c_char,
) -> c_int {
    guard(|| {
        let d = unsafe { doc_ref(doc) }?;
        let key = unsafe { str_arg(key, "key") }?;
        if out_data.is_null() || out_len.is_null() {
            return Err(arg("out_data or out_len is NULL"));
        }
        let b = d
            .blob(key)?
            .ok_or_else(|| Fail(SPDF_ERR_NOT_FOUND, None, format!("no blob `{key}`")))?;
        if !out_mime.is_null() {
            unsafe { put_string(out_mime, b.mime.clone()) }?;
        }
        let boxed = b.data.into_boxed_slice();
        let len = boxed.len();
        let p = Box::into_raw(boxed) as *mut u8;
        // SAFETY: out pointers are writable.
        unsafe {
            *out_data = p;
            *out_len = len;
        }
        Ok(())
    })
}

fn hits_json(hits: &[spdf::SearchHit]) -> Result<String, Fail> {
    Ok(serde_json::to_string(hits)?)
}

/// Lexical search (reference algorithm). Results: JSON array of
/// `{fragment_id, score, via, anchor, anchor_uri}`.
#[no_mangle]
pub unsafe extern "C" fn spdf_search_lexical(
    doc: *const SpdfDoc,
    query: *const c_char,
    limit: u32,
    out_json: *mut *mut c_char,
) -> c_int {
    guard(|| {
        let d = unsafe { doc_ref(doc) }?;
        let q = unsafe { str_arg(query, "query") }?;
        let hits = d.search_lexical(q, limit as usize)?;
        unsafe { put_string(out_json, hits_json(&hits)?) }
    })
}

/// Vector search. `target` is `fragment` (default when NULL), `unit` or `figure`.
#[no_mangle]
pub unsafe extern "C" fn spdf_search_vector(
    doc: *const SpdfDoc,
    space: *const c_char,
    target: *const c_char,
    vec: *const f32,
    dims: usize,
    limit: u32,
    out_json: *mut *mut c_char,
) -> c_int {
    guard(|| {
        let d = unsafe { doc_ref(doc) }?;
        let space = unsafe { str_arg(space, "space") }?;
        let target = match unsafe { opt_str_arg(target, "target") }? {
            None => Target::Fragment,
            Some(t) => {
                Target::parse(t).ok_or_else(|| arg("target must be fragment, unit or figure"))?
            }
        };
        let v = unsafe { vector_arg(vec, dims) }?;
        let hits = d.search_vector(space, v, target, limit as usize)?;
        unsafe { put_string(out_json, hits_json(&hits)?) }
    })
}

/// Hybrid search (RRF, k = 10).
#[no_mangle]
pub unsafe extern "C" fn spdf_search_hybrid(
    doc: *const SpdfDoc,
    query: *const c_char,
    space: *const c_char,
    vec: *const f32,
    dims: usize,
    limit: u32,
    out_json: *mut *mut c_char,
) -> c_int {
    guard(|| {
        let d = unsafe { doc_ref(doc) }?;
        let q = unsafe { str_arg(query, "query") }?;
        let space = unsafe { str_arg(space, "space") }?;
        let v = unsafe { vector_arg(vec, dims) }?;
        let hits = d.search_hybrid(q, v, space, limit as usize)?;
        unsafe { put_string(out_json, hits_json(&hits)?) }
    })
}

/// Formats an anchor URI. `anchor_end_json` may be NULL.
#[no_mangle]
pub unsafe extern "C" fn spdf_anchor_uri_format(
    docref: *const c_char,
    anchor_json: *const c_char,
    anchor_end_json: *const c_char,
    out: *mut *mut c_char,
) -> c_int {
    guard(|| {
        let docref = unsafe { str_arg(docref, "docref") }?;
        let a = unsafe { json_arg(anchor_json, "anchor_json") }?;
        let e = unsafe { opt_json_arg(anchor_end_json, "anchor_end_json") }?;
        let uri = spdf::format_uri(docref, &a, e.as_ref())?;
        unsafe { put_string(out, uri) }
    })
}

/// Formats an anchor URI from a locator (`{"p":29,"f":"21",…}`).
#[no_mangle]
pub unsafe extern "C" fn spdf_anchor_uri_format_locator(
    docref: *const c_char,
    locator_json: *const c_char,
    out: *mut *mut c_char,
) -> c_int {
    guard(|| {
        let docref = unsafe { str_arg(docref, "docref") }?;
        let l = unsafe { json_arg(locator_json, "locator_json") }?;
        let u = spdf::AnchorUri {
            docref: docref.to_string(),
            locator: serde_json::from_value(l)?,
        };
        unsafe { put_string(out, u.to_string()) }
    })
}

/// Parses an anchor URI into `{"docref","locator"}`.
#[no_mangle]
pub unsafe extern "C" fn spdf_anchor_uri_parse(
    uri: *const c_char,
    out_json: *mut *mut c_char,
) -> c_int {
    guard(|| {
        let uri = unsafe { str_arg(uri, "uri") }?;
        let u = spdf::parse_uri(uri)?;
        unsafe { put_string(out_json, serde_json::to_string(&u)?) }
    })
}

/// Writer-side encoding of `n` values in `dtype` (`f32`, `f16`, `i8`): f32
/// and f16 round to nearest even and overflow is an error (`E030`); i8 =
/// `clamp(round_half_away_from_zero(v × 127), −127, 127)`; an unknown dtype is
/// `E032`. The bytes are freed with `spdf_bytes_free(data, len)`.
#[no_mangle]
pub unsafe extern "C" fn spdf_quantize(
    values: *const f64,
    n: usize,
    dtype: *const c_char,
    out_data: *mut *mut u8,
    out_len: *mut usize,
) -> c_int {
    guard(|| {
        if (values.is_null() && n > 0) || out_data.is_null() || out_len.is_null() {
            return Err(arg("values, out_data or out_len is NULL"));
        }
        let dtype = unsafe { str_arg(dtype, "dtype") }?;
        let d = spdf::Dtype::parse(dtype).ok_or_else(|| {
            Fail(
                SPDF_ERR_FORMAT,
                Some("E032".into()),
                format!("unknown dtype `{dtype}`"),
            )
        })?;
        let vals: &[f64] = if n == 0 {
            &[]
        } else {
            // SAFETY: the caller passes `n` readable doubles.
            unsafe { std::slice::from_raw_parts(values, n) }
        };
        let bytes = spdf::vector::quantize(vals, d)?.into_boxed_slice();
        let len = bytes.len();
        // SAFETY: out pointers are writable.
        unsafe {
            *out_data = Box::into_raw(bytes) as *mut u8;
            *out_len = len;
        }
        Ok(())
    })
}

/// Units an anchor URI points at, as a JSON array (empty if the URI names
/// another document).
#[no_mangle]
pub unsafe extern "C" fn spdf_locate(
    doc: *const SpdfDoc,
    uri: *const c_char,
    out_json: *mut *mut c_char,
) -> c_int {
    guard(|| {
        let d = unsafe { doc_ref(doc) }?;
        let uri = unsafe { str_arg(uri, "uri") }?;
        unsafe { put_string(out_json, serde_json::to_string(&d.locate(uri)?)?) }
    })
}

/// Short citation from CSL metadata. `anchor_end_json` may be NULL;
/// `locale` is a BCP 47 tag (`es`, `en`…; NULL = `en`).
#[no_mangle]
pub unsafe extern "C" fn spdf_cite(
    metadata_json: *const c_char,
    anchor_json: *const c_char,
    anchor_end_json: *const c_char,
    locale: *const c_char,
    out: *mut *mut c_char,
) -> c_int {
    guard(|| {
        let md = unsafe { json_arg(metadata_json, "metadata_json") }?;
        let a = unsafe { json_arg(anchor_json, "anchor_json") }?;
        let e = unsafe { opt_json_arg(anchor_end_json, "anchor_end_json") }?;
        let loc = spdf::Locale::parse(unsafe { opt_str_arg(locale, "locale") }?.unwrap_or("en"));
        unsafe { put_string(out, spdf::cite::cite_value(&a, e.as_ref(), &md, loc)) }
    })
}

/// Short citation of an anchor in an open document.
#[no_mangle]
pub unsafe extern "C" fn spdf_doc_cite(
    doc: *const SpdfDoc,
    anchor_json: *const c_char,
    anchor_end_json: *const c_char,
    locale: *const c_char,
    out: *mut *mut c_char,
) -> c_int {
    guard(|| {
        let d = unsafe { doc_ref(doc) }?;
        let a = unsafe { json_arg(anchor_json, "anchor_json") }?;
        let e = unsafe { opt_json_arg(anchor_end_json, "anchor_end_json") }?;
        let loc = spdf::Locale::parse(unsafe { opt_str_arg(locale, "locale") }?.unwrap_or("en"));
        let md = d.document()?.metadata;
        unsafe { put_string(out, spdf::cite::cite_value(&a, e.as_ref(), &md, loc)) }
    })
}

/// CSL-JSON (array with one item) of the document.
#[no_mangle]
pub unsafe extern "C" fn spdf_export_csl_json(doc: *const SpdfDoc, out: *mut *mut c_char) -> c_int {
    guard(|| {
        let d = unsafe { doc_ref(doc) }?;
        unsafe { put_string(out, spdf::export::csl_json(&d.document()?).to_string()) }
    })
}

/// BibTeX entry of the document.
#[no_mangle]
pub unsafe extern "C" fn spdf_export_bibtex(doc: *const SpdfDoc, out: *mut *mut c_char) -> c_int {
    guard(|| {
        let d = unsafe { doc_ref(doc) }?;
        unsafe { put_string(out, spdf::export::bibtex(&d.document()?)) }
    })
}

/// Builds a 5.0 file at `path` from a canonical dump or a conformance source
/// (dump + `vectors.<space>.items` + `blobs[].data_base64`).
#[no_mangle]
pub unsafe extern "C" fn spdf_write_from_dump(
    dump_json: *const c_char,
    path: *const c_char,
) -> c_int {
    guard(|| {
        let v = unsafe { json_arg(dump_json, "dump_json") }?;
        let path = unsafe { str_arg(path, "path") }?;
        let mut w = spdf::Writer::from_dump(&v)?;
        w.write(path)?;
        Ok(())
    })
}

/// Converts a legacy 4.x file to 5.0.
#[no_mangle]
pub unsafe extern "C" fn spdf_convert_legacy(src: *const c_char, dst: *const c_char) -> c_int {
    guard(|| {
        let src = unsafe { str_arg(src, "src") }?;
        let dst = unsafe { str_arg(dst, "dst") }?;
        spdf::convert_legacy(src, dst)?;
        Ok(())
    })
}

/// Recomputes `content_sha256` and checks the signature; writes
/// `{"computed_sha256","stored_sha256","hash_ok","signer","signature_ok","signer_trusted"}`.
/// `expected_signer` (`ed25519:<base64>`) may be NULL.
#[no_mangle]
pub unsafe extern "C" fn spdf_verify(
    doc: *const SpdfDoc,
    expected_signer: *const c_char,
    out_json: *mut *mut c_char,
) -> c_int {
    guard(|| {
        let d = unsafe { doc_ref(doc) }?;
        let s = unsafe { opt_str_arg(expected_signer, "expected_signer") }?;
        let r = d.verify_integrity(s)?;
        unsafe { put_string(out_json, serde_json::to_string(&r)?) }
    })
}

/// Runs the conformance suite in `dir` and writes the protocol report.
#[no_mangle]
pub unsafe extern "C" fn spdf_conformance_run(
    dir: *const c_char,
    out_json: *mut *mut c_char,
) -> c_int {
    guard(|| {
        let dir = unsafe { str_arg(dir, "dir") }?;
        let r = spdf::conformance::run_dir(dir, None)?;
        unsafe { put_string(out_json, serde_json::to_string(&r)?) }
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn uri_and_cite_roundtrip() {
        unsafe {
            let docref = CString::new("doc-1").unwrap();
            let anchor = CString::new(r#"{"type":"page","physical":3,"printed":"1"}"#).unwrap();
            let mut out: *mut c_char = ptr::null_mut();
            assert_eq!(
                spdf_anchor_uri_format(docref.as_ptr(), anchor.as_ptr(), ptr::null(), &mut out),
                SPDF_OK
            );
            let uri = CStr::from_ptr(out).to_str().unwrap().to_string();
            spdf_string_free(out);
            assert_eq!(uri, "spdf:doc-1#p=3&f=1");
            let md =
                CString::new(r#"{"type":"book","title":"T","author":[{"family":"A"}]}"#).unwrap();
            let es = CString::new("es").unwrap();
            assert_eq!(
                spdf_cite(
                    md.as_ptr(),
                    anchor.as_ptr(),
                    ptr::null(),
                    es.as_ptr(),
                    &mut out
                ),
                SPDF_OK
            );
            assert_eq!(CStr::from_ptr(out).to_str().unwrap(), "(A, s. f., p. 1)");
            spdf_string_free(out);
            let bad = CString::new("http://x").unwrap();
            assert_ne!(spdf_anchor_uri_parse(bad.as_ptr(), &mut out), SPDF_OK);
            let err = CStr::from_ptr(spdf_last_error()).to_str().unwrap();
            assert!(err.contains("spdf:"));
            assert_eq!(
                spdf_open(ptr::null(), ptr::null(), ptr::null_mut()),
                SPDF_ERR_ARGUMENT
            );
        }
    }
}
