//! Remote reading over HTTP range requests (feature `http`, experimental).
//!
//! An SPDF 5.0 file is an uncompressed SQLite database, so a reader can
//! search it without downloading it: this module registers a read-only
//! SQLite VFS (`spdf-http`) whose `xRead` fetches byte ranges with
//! `Range: bytes=a-b` and keeps them in a bounded block cache. Lexical
//! search typically touches a few dozen pages of the FTS index; a vector
//! search over a whole space still has to read every vector of that space.
//!
//! Servers that ignore `Range`, and gzip-wrapped legacy files, are downloaded
//! whole (bounded by [`OpenOptions::max_decompressed_bytes`]).
//!
//! ```no_run
//! let doc = spdf::remote::open_url("https://example.org/quijote.spdf", &Default::default(), &Default::default())?;
//! let hits = doc.search_lexical("hidalgo", 5)?;
//! # Ok::<(), spdf::Error>(())
//! ```

use std::collections::{HashMap, VecDeque};
use std::ffi::{c_char, c_int, c_void, CStr, CString};
use std::io::Read;
use std::sync::atomic::{AtomicI32, AtomicU64, Ordering};
use std::sync::{Arc, Mutex, Once, OnceLock};

use rusqlite::ffi;
use rusqlite::{Connection, OpenFlags};

use crate::error::{Error, Result};
use crate::reader::{connection_from_bytes, harden, OpenOptions, Origin, Spdf};

/// Name of the registered VFS.
pub const VFS_NAME: &str = "spdf-http";

/// Tuning for remote reading.
#[derive(Clone, Debug)]
pub struct RemoteOptions {
    /// Size of each fetched block (aligned). Default 64 KiB.
    pub block_size: u64,
    /// Maximum bytes kept in the block cache. Default 32 MiB.
    pub cache_bytes: u64,
    /// Extra request headers (e.g. authorization).
    pub headers: Vec<(String, String)>,
    /// Per-request timeout in seconds. Default 30.
    pub timeout_secs: u64,
}

impl Default for RemoteOptions {
    fn default() -> Self {
        RemoteOptions {
            block_size: 64 * 1024,
            cache_bytes: 32 * 1024 * 1024,
            headers: Vec::new(),
            timeout_secs: 30,
        }
    }
}

/// Counters of a remote source (for measuring how much was fetched).
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, serde::Serialize)]
pub struct RemoteStats {
    /// HTTP range requests made.
    pub requests: u64,
    /// Bytes downloaded.
    pub bytes: u64,
    /// Total size of the remote file.
    pub size: u64,
}

struct Source {
    url: String,
    size: u64,
    agent: ureq::Agent,
    headers: Vec<(String, String)>,
    block: u64,
    max_blocks: usize,
    cache: Mutex<Cache>,
    requests: AtomicU64,
    bytes: AtomicU64,
}

#[derive(Default)]
struct Cache {
    blocks: HashMap<u64, Arc<Vec<u8>>>,
    order: VecDeque<u64>,
}

impl Source {
    fn fetch(&self, from: u64, to_inclusive: u64) -> std::result::Result<Vec<u8>, String> {
        let mut req = self
            .agent
            .get(&self.url)
            .header("Range", format!("bytes={from}-{to_inclusive}"));
        for (k, v) in &self.headers {
            req = req.header(k.as_str(), v.as_str());
        }
        let mut resp = req.call().map_err(|e| e.to_string())?;
        if resp.status().as_u16() != 206 {
            return Err(format!(
                "server answered {} to a range request",
                resp.status()
            ));
        }
        let want = to_inclusive - from + 1;
        let data = resp
            .body_mut()
            .with_config()
            .limit(want + 1)
            .read_to_vec()
            .map_err(|e| e.to_string())?;
        self.requests.fetch_add(1, Ordering::Relaxed);
        self.bytes.fetch_add(data.len() as u64, Ordering::Relaxed);
        Ok(data)
    }

    /// Reads `buf.len()` bytes at `offset`; returns the number of bytes read
    /// (short at end of file).
    fn read_at(&self, offset: u64, buf: &mut [u8]) -> std::result::Result<usize, String> {
        if offset >= self.size || buf.is_empty() {
            return Ok(0);
        }
        let end = (offset + buf.len() as u64).min(self.size); // exclusive
        let first = offset / self.block;
        let last = (end - 1) / self.block;
        // Fetch missing blocks in contiguous runs.
        let missing: Vec<u64> = {
            let c = self
                .cache
                .lock()
                .map_err(|_| "cache poisoned".to_string())?;
            (first..=last)
                .filter(|b| !c.blocks.contains_key(b))
                .collect()
        };
        let mut i = 0;
        while i < missing.len() {
            let mut j = i;
            while j + 1 < missing.len() && missing[j + 1] == missing[j] + 1 {
                j += 1;
            }
            let from = missing[i] * self.block;
            let to = ((missing[j] + 1) * self.block).min(self.size) - 1;
            let data = self.fetch(from, to)?;
            if (data.len() as u64) < to - from + 1 {
                return Err("short range response".into());
            }
            let mut c = self
                .cache
                .lock()
                .map_err(|_| "cache poisoned".to_string())?;
            for (k, b) in (missing[i]..=missing[j]).enumerate() {
                let s = k * self.block as usize;
                let e = (s + self.block as usize).min(data.len());
                c.blocks.insert(b, Arc::new(data[s..e].to_vec()));
                c.order.push_back(b);
            }
            while c.blocks.len() > self.max_blocks.max(last as usize - first as usize + 1) {
                match c.order.pop_front() {
                    Some(old) if !(first..=last).contains(&old) => {
                        c.blocks.remove(&old);
                    }
                    Some(old) => c.order.push_back(old),
                    None => break,
                }
            }
            i = j + 1;
        }
        let c = self
            .cache
            .lock()
            .map_err(|_| "cache poisoned".to_string())?;
        let mut written = 0usize;
        let mut pos = offset;
        while pos < end {
            let b = pos / self.block;
            let block = c.blocks.get(&b).ok_or("block evicted")?;
            let within = (pos - b * self.block) as usize;
            let n = ((end - pos) as usize).min(block.len() - within);
            buf[written..written + n].copy_from_slice(&block[within..within + n]);
            written += n;
            pos += n as u64;
        }
        Ok(written)
    }
}

fn registry() -> &'static Mutex<HashMap<String, Arc<Source>>> {
    static R: OnceLock<Mutex<HashMap<String, Arc<Source>>>> = OnceLock::new();
    R.get_or_init(|| Mutex::new(HashMap::new()))
}

#[repr(C)]
struct FileHandle {
    base: ffi::sqlite3_file,
    source: *const Source,
}

static IO_METHODS: ffi::sqlite3_io_methods = ffi::sqlite3_io_methods {
    iVersion: 1,
    xClose: Some(x_close),
    xRead: Some(x_read),
    xWrite: Some(x_write),
    xTruncate: Some(x_truncate),
    xSync: Some(x_sync),
    xFileSize: Some(x_file_size),
    xLock: Some(x_lock),
    xUnlock: Some(x_lock),
    xCheckReservedLock: Some(x_check_reserved_lock),
    xFileControl: Some(x_file_control),
    xSectorSize: Some(x_sector_size),
    xDeviceCharacteristics: Some(x_device_characteristics),
    xShmMap: None,
    xShmLock: None,
    xShmBarrier: None,
    xShmUnmap: None,
    xFetch: None,
    xUnfetch: None,
};

unsafe extern "C" fn x_close(f: *mut ffi::sqlite3_file) -> c_int {
    // SAFETY: SQLite passes the handle it allocated with szOsFile bytes.
    let h = unsafe { &mut *(f as *mut FileHandle) };
    if !h.source.is_null() {
        // SAFETY: created with Arc::into_raw in x_open.
        drop(unsafe { Arc::from_raw(h.source) });
        h.source = std::ptr::null();
    }
    ffi::SQLITE_OK
}

unsafe extern "C" fn x_read(
    f: *mut ffi::sqlite3_file,
    buf: *mut c_void,
    amt: c_int,
    off: ffi::sqlite3_int64,
) -> c_int {
    // SAFETY: handle and buffer come from SQLite.
    let h = unsafe { &*(f as *const FileHandle) };
    let Ok(len) = usize::try_from(amt) else {
        return ffi::SQLITE_IOERR_READ;
    };
    // SAFETY: SQLite gives a writable buffer of `amt` bytes.
    let out = unsafe { std::slice::from_raw_parts_mut(buf as *mut u8, len) };
    // SAFETY: the source outlives the handle (Arc held by it).
    let src = unsafe { &*h.source };
    let Ok(off) = u64::try_from(off) else {
        return ffi::SQLITE_IOERR_READ;
    };
    match std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| src.read_at(off, out))) {
        Ok(Ok(n)) if n == len => ffi::SQLITE_OK,
        Ok(Ok(n)) => {
            out[n..].fill(0);
            ffi::SQLITE_IOERR_SHORT_READ
        }
        _ => ffi::SQLITE_IOERR_READ,
    }
}

unsafe extern "C" fn x_write(
    _: *mut ffi::sqlite3_file,
    _: *const c_void,
    _: c_int,
    _: ffi::sqlite3_int64,
) -> c_int {
    ffi::SQLITE_READONLY
}

unsafe extern "C" fn x_truncate(_: *mut ffi::sqlite3_file, _: ffi::sqlite3_int64) -> c_int {
    ffi::SQLITE_READONLY
}

unsafe extern "C" fn x_sync(_: *mut ffi::sqlite3_file, _: c_int) -> c_int {
    ffi::SQLITE_OK
}

unsafe extern "C" fn x_file_size(
    f: *mut ffi::sqlite3_file,
    size: *mut ffi::sqlite3_int64,
) -> c_int {
    // SAFETY: valid handle and out pointer from SQLite.
    let h = unsafe { &*(f as *const FileHandle) };
    let src = unsafe { &*h.source };
    unsafe { *size = src.size as ffi::sqlite3_int64 };
    ffi::SQLITE_OK
}

unsafe extern "C" fn x_lock(_: *mut ffi::sqlite3_file, _: c_int) -> c_int {
    ffi::SQLITE_OK
}

unsafe extern "C" fn x_check_reserved_lock(_: *mut ffi::sqlite3_file, out: *mut c_int) -> c_int {
    // SAFETY: valid out pointer from SQLite.
    unsafe { *out = 0 };
    ffi::SQLITE_OK
}

unsafe extern "C" fn x_file_control(_: *mut ffi::sqlite3_file, _: c_int, _: *mut c_void) -> c_int {
    ffi::SQLITE_NOTFOUND
}

unsafe extern "C" fn x_sector_size(_: *mut ffi::sqlite3_file) -> c_int {
    4096
}

unsafe extern "C" fn x_device_characteristics(_: *mut ffi::sqlite3_file) -> c_int {
    ffi::SQLITE_IOCAP_IMMUTABLE
}

unsafe extern "C" fn x_open(
    _vfs: *mut ffi::sqlite3_vfs,
    name: *const c_char,
    file: *mut ffi::sqlite3_file,
    flags: c_int,
    out_flags: *mut c_int,
) -> c_int {
    // SAFETY: `file` points to szOsFile writable bytes.
    let h = unsafe { &mut *(file as *mut FileHandle) };
    h.base.pMethods = std::ptr::null();
    h.source = std::ptr::null();
    if name.is_null() || flags & ffi::SQLITE_OPEN_MAIN_DB == 0 {
        return ffi::SQLITE_CANTOPEN;
    }
    // SAFETY: SQLite passes a NUL-terminated name.
    let key = unsafe { CStr::from_ptr(name) }
        .to_string_lossy()
        .into_owned();
    let src = match registry().lock().ok().and_then(|r| r.get(&key).cloned()) {
        Some(s) => s,
        None => return ffi::SQLITE_CANTOPEN,
    };
    h.source = Arc::into_raw(src);
    h.base.pMethods = &IO_METHODS;
    if !out_flags.is_null() {
        // SAFETY: valid out pointer.
        unsafe { *out_flags = ffi::SQLITE_OPEN_READONLY | ffi::SQLITE_OPEN_MAIN_DB };
    }
    ffi::SQLITE_OK
}

unsafe extern "C" fn x_delete(_: *mut ffi::sqlite3_vfs, _: *const c_char, _: c_int) -> c_int {
    ffi::SQLITE_IOERR_DELETE
}

unsafe extern "C" fn x_access(
    _: *mut ffi::sqlite3_vfs,
    _: *const c_char,
    _: c_int,
    out: *mut c_int,
) -> c_int {
    // No journal, WAL or other side files exist.
    // SAFETY: valid out pointer.
    unsafe { *out = 0 };
    ffi::SQLITE_OK
}

unsafe extern "C" fn x_full_pathname(
    _: *mut ffi::sqlite3_vfs,
    name: *const c_char,
    n: c_int,
    out: *mut c_char,
) -> c_int {
    // SAFETY: NUL-terminated input, `n` writable bytes of output.
    let s = unsafe { CStr::from_ptr(name) }.to_bytes();
    let n = usize::try_from(n).unwrap_or(0);
    if s.len() + 1 > n {
        return ffi::SQLITE_CANTOPEN;
    }
    unsafe {
        std::ptr::copy_nonoverlapping(s.as_ptr() as *const c_char, out, s.len());
        *out.add(s.len()) = 0;
    }
    ffi::SQLITE_OK
}

fn default_vfs() -> *mut ffi::sqlite3_vfs {
    // SAFETY: returns the process default VFS (never freed).
    unsafe { ffi::sqlite3_vfs_find(std::ptr::null()) }
}

unsafe extern "C" fn x_randomness(_: *mut ffi::sqlite3_vfs, n: c_int, out: *mut c_char) -> c_int {
    let d = default_vfs();
    // SAFETY: forwarding to the default VFS with SQLite's own arguments.
    match unsafe { d.as_ref().and_then(|v| v.xRandomness) } {
        Some(f) => unsafe { f(d, n, out) },
        None => 0,
    }
}

unsafe extern "C" fn x_sleep(_: *mut ffi::sqlite3_vfs, us: c_int) -> c_int {
    std::thread::sleep(std::time::Duration::from_micros(
        u64::try_from(us).unwrap_or(0),
    ));
    us
}

unsafe extern "C" fn x_current_time(_: *mut ffi::sqlite3_vfs, out: *mut f64) -> c_int {
    let secs = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs_f64())
        .unwrap_or(0.0);
    // Julian day number.
    // SAFETY: valid out pointer.
    unsafe { *out = 2_440_587.5 + secs / 86_400.0 };
    ffi::SQLITE_OK
}

unsafe extern "C" fn x_get_last_error(_: *mut ffi::sqlite3_vfs, _: c_int, _: *mut c_char) -> c_int {
    0
}

fn register_vfs() -> Result<()> {
    static ONCE: Once = Once::new();
    static RC: AtomicI32 = AtomicI32::new(ffi::SQLITE_OK);
    ONCE.call_once(|| {
        let name = CString::new(VFS_NAME).unwrap_or_default();
        let vfs = Box::new(ffi::sqlite3_vfs {
            iVersion: 1,
            szOsFile: std::mem::size_of::<FileHandle>() as c_int,
            mxPathname: 1024,
            pNext: std::ptr::null_mut(),
            zName: name.into_raw(),
            pAppData: std::ptr::null_mut(),
            xOpen: Some(x_open),
            xDelete: Some(x_delete),
            xAccess: Some(x_access),
            xFullPathname: Some(x_full_pathname),
            xDlOpen: None,
            xDlError: None,
            xDlSym: None,
            xDlClose: None,
            xRandomness: Some(x_randomness),
            xSleep: Some(x_sleep),
            xCurrentTime: Some(x_current_time),
            xGetLastError: Some(x_get_last_error),
            xCurrentTimeInt64: None,
            xSetSystemCall: None,
            xGetSystemCall: None,
            xNextSystemCall: None,
        });
        // SAFETY: the VFS struct is leaked and lives for the whole process.
        let rc = unsafe { ffi::sqlite3_vfs_register(Box::into_raw(vfs), 0) };
        RC.store(rc, Ordering::SeqCst);
    });
    let rc = RC.load(Ordering::SeqCst);
    if rc == ffi::SQLITE_OK {
        Ok(())
    } else {
        Err(Error::Http(format!(
            "cannot register the HTTP VFS (SQLite code {rc})"
        )))
    }
}

fn agent(timeout: u64) -> ureq::Agent {
    ureq::Agent::config_builder()
        .timeout_global(Some(std::time::Duration::from_secs(timeout)))
        .http_status_as_error(false)
        .build()
        .into()
}

fn download_all(
    agent: &ureq::Agent,
    url: &str,
    headers: &[(String, String)],
    max: u64,
) -> Result<Vec<u8>> {
    let mut req = agent.get(url);
    for (k, v) in headers {
        req = req.header(k.as_str(), v.as_str());
    }
    let mut resp = req.call().map_err(|e| Error::Http(e.to_string()))?;
    if !resp.status().is_success() {
        return Err(Error::Http(format!("{url}: HTTP {}", resp.status())));
    }
    let mut out = Vec::new();
    resp.body_mut()
        .as_reader()
        .take(max.saturating_add(1))
        .read_to_end(&mut out)
        .map_err(|e| Error::Http(e.to_string()))?;
    if out.len() as u64 > max {
        return Err(Error::TooLarge(format!("{url} is larger than {max} bytes")));
    }
    Ok(out)
}

static COUNTER: AtomicU64 = AtomicU64::new(0);

/// Opens a remote SPDF by HTTP range requests (falls back to a full
/// download for servers without `Range` support and for gzip files).
pub fn open_url(url: &str, opts: &OpenOptions, ropts: &RemoteOptions) -> Result<Spdf> {
    let agent = agent(ropts.timeout_secs);
    // Probe the first 100 bytes: header, size and range support.
    let mut req = agent.get(url).header("Range", "bytes=0-99");
    for (k, v) in &ropts.headers {
        req = req.header(k.as_str(), v.as_str());
    }
    let mut resp = req.call().map_err(|e| Error::Http(e.to_string()))?;
    let status = resp.status().as_u16();
    if status == 200 {
        drop(resp);
        let bytes = download_all(&agent, url, &ropts.headers, opts.max_decompressed_bytes)?;
        let gzip = bytes.len() >= 2 && bytes[0] == 0x1f && bytes[1] == 0x8b;
        let conn = connection_from_bytes(bytes, opts)?;
        return Spdf::from_connection(conn, gzip, Origin::Remote(url.to_string()), opts);
    }
    if status != 206 {
        return Err(Error::Http(format!("{url}: HTTP {status}")));
    }
    let size = resp
        .headers()
        .get("content-range")
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.rsplit('/').next())
        .and_then(|v| v.trim().parse::<u64>().ok())
        .ok_or_else(|| Error::Http("range response without a total size".into()))?;
    let head = resp
        .body_mut()
        .with_config()
        .limit(1024)
        .read_to_vec()
        .map_err(|e| Error::Http(e.to_string()))?;
    if head.len() >= 2 && head[0] == 0x1f && head[1] == 0x8b {
        let bytes = download_all(&agent, url, &ropts.headers, opts.max_decompressed_bytes)?;
        let conn = connection_from_bytes(bytes, opts)?;
        return Spdf::from_connection(conn, true, Origin::Remote(url.to_string()), opts);
    }
    if head.len() < 16 || &head[..16] != crate::reader::SQLITE_MAGIC {
        return Err(Error::NotSqlite(format!(
            "{url} does not start with the SQLite header"
        )));
    }
    if head.len() > 19 && (head[18] == 2 || head[19] == 2) {
        // WAL-mode files cannot be read through an immutable VFS.
        let bytes = download_all(&agent, url, &ropts.headers, opts.max_decompressed_bytes)?;
        let conn = connection_from_bytes(bytes, opts)?;
        return Spdf::from_connection(conn, false, Origin::Remote(url.to_string()), opts);
    }
    register_vfs()?;
    let block = ropts.block_size.max(4096);
    let src = Arc::new(Source {
        url: url.to_string(),
        size,
        agent,
        headers: ropts.headers.clone(),
        block,
        max_blocks: usize::try_from((ropts.cache_bytes / block).max(4)).unwrap_or(usize::MAX),
        cache: Mutex::new(Cache::default()),
        requests: AtomicU64::new(1),
        bytes: AtomicU64::new(head.len() as u64),
    });
    let key = format!("spdf-http-{}", COUNTER.fetch_add(1, Ordering::Relaxed));
    registry()
        .lock()
        .map_err(|_| Error::Http("registry poisoned".into()))?
        .insert(key.clone(), src);
    let conn = Connection::open_with_flags_and_vfs(
        &key,
        OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_NO_MUTEX,
        VFS_NAME,
    );
    let conn = match conn {
        Ok(c) => c,
        Err(e) => {
            if let Ok(mut r) = registry().lock() {
                r.remove(&key);
            }
            return Err(e.into());
        }
    };
    conn.pragma_update(None, "temp_store", "MEMORY")?;
    harden(&conn, opts)?;
    let doc = Spdf::from_connection(conn, false, Origin::Remote(url.to_string()), opts);
    // The open connection holds its own Arc; drop the registry entry.
    if let Ok(mut r) = registry().lock() {
        r.remove(&key);
    }
    doc
}

/// Bytes and requests fetched so far by a document opened with [`open_url`]
/// through the VFS (`None` for local or fully downloaded documents).
pub fn stats(doc: &Spdf) -> Option<RemoteStats> {
    let Origin::Remote(_) = &doc.origin else {
        return None;
    };
    // The handle is reachable through the connection's file pointer.
    let mut file: *mut ffi::sqlite3_file = std::ptr::null_mut();
    let main = CString::new("main").ok()?;
    // SAFETY: valid connection; SQLITE_FCNTL_FILE_POINTER writes a sqlite3_file*.
    let rc = unsafe {
        ffi::sqlite3_file_control(
            doc.conn.handle(),
            main.as_ptr(),
            ffi::SQLITE_FCNTL_FILE_POINTER,
            &mut file as *mut *mut ffi::sqlite3_file as *mut c_void,
        )
    };
    if rc != ffi::SQLITE_OK || file.is_null() {
        return None;
    }
    // SAFETY: only our VFS's files have IO_METHODS.
    unsafe {
        if !std::ptr::eq((*file).pMethods, &IO_METHODS) {
            return None;
        }
        let h = &*(file as *const FileHandle);
        let s = &*h.source;
        Some(RemoteStats {
            requests: s.requests.load(Ordering::Relaxed),
            bytes: s.bytes.load(Ordering::Relaxed),
            size: s.size,
        })
    }
}
