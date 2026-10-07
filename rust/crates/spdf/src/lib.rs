//! # spdf
//!
//! Reference implementation of **SPDF** (*Semantic Processed Document
//! Format*) 5.0: documents that have been read once and can be cited forever.
//! Every passage carries its exact anchor (printed page, folio, second of a
//! recording, slide, verse), so a citation can only print what the source
//! says.
//!
//! An SPDF file is an SQLite 3 database. This crate bundles SQLite (with
//! FTS5) so that every platform searches with the same engine, and opens
//! files defensively: read-only, `query_only`, `trusted_schema=OFF`,
//! `SQLITE_DBCONFIG_DEFENSIVE`, no extensions, no triggers or views (except
//! the three FTS triggers tolerated in legacy 4.x files), bounded blob and
//! gzip sizes.
//!
//! What it does:
//!
//! * read 5.0 and legacy 4.0/4.1 files (gzip-wrapped, Spanish schema) through
//!   one 5.0 view — [`Spdf`];
//! * validate with the contract codes — [`validate`];
//! * canonical JSON dump, byte-stable (RFC 8785) — [`Spdf::dump_canonical`];
//! * reference search: lexical (FTS5 BM25), vector (f32/f16/i8) and hybrid
//!   (RRF, k = 10) — [`Spdf::search_lexical`], [`Spdf::search_vector`],
//!   [`Spdf::search_hybrid`];
//! * anchors and `spdf:` URIs, offsets in code points — [`anchor`], [`text`];
//! * short citations (es/en) and CSL-JSON/BibTeX export — [`cite()`], [`export`];
//! * writing 5.0 files and converting 4.x — [`Writer`], [`convert_legacy`];
//! * integrity: `content_sha256` and Ed25519 signatures — [`integrity`];
//! * sidecars: annotations (`.spdfa.json`) and collections (`.spdfl.json`) — [`sidecar`];
//! * with the `http` feature, reading remote files by HTTP range requests
//!   (experimental) — `remote`.
//!
//! ```no_run
//! use spdf::{Spdf, Locale};
//!
//! let doc = Spdf::open("vigilar-y-castigar.spdf")?;
//! let meta = doc.document()?;
//! for hit in doc.search_lexical("panóptico", 3)? {
//!     let anchor = spdf::Anchor::from_value(&hit.anchor)?;
//!     println!("{}  {}", spdf::cite(&anchor, &meta, Locale::Es), hit.anchor_uri);
//! }
//! # Ok::<(), spdf::Error>(())
//! ```

#![deny(missing_docs)]
#![forbid(unsafe_op_in_unsafe_fn)]

pub mod anchor;
pub mod canon;
pub mod cite;
pub mod conformance;
mod dump;
mod error;
pub mod export;
pub mod integrity;
pub mod legacy;
mod model;
mod reader;
pub mod schema;
mod search;
pub mod sidecar;
mod sources;
pub mod text;
mod validate;
pub mod vector;
mod writer;

#[cfg(feature = "http")]
pub mod remote;

pub use anchor::{format_uri, parse_uri, Anchor, AnchorKind, AnchorUri, Locator, Region};
pub use cite::{cite, cite_range, Locale};
pub use error::{Error, Result};
pub use integrity::{IntegrityReport, KeyPair};
pub use model::{
    Blob, BlobInfo, Document, Dtype, Extension, Figure, Fragment, Provenance, SearchHit, Section,
    Space, Target, Unit, Vector,
};
pub use reader::{Flavor, OpenOptions, Spdf, DEFAULT_MAX_BLOB, DEFAULT_MAX_DECOMPRESSED};
pub use search::{HYBRID_MIN_DEPTH, RRF_K};
pub use validate::{check_anchor_value, validate, validate_bytes, Issue, ValidationReport};
pub use writer::{convert_legacy, now_utc, Writer, GENERATOR};

/// Version of this implementation.
pub const VERSION: &str = env!("CARGO_PKG_VERSION");
