//! Typed errors.

use std::fmt;

/// Result alias used throughout the crate.
pub type Result<T, E = Error> = std::result::Result<T, E>;

/// Everything that can go wrong while reading, validating or writing SPDF.
///
/// Errors that correspond to a validation code of the contract (§12) report it
/// through [`Error::code`].
#[derive(Debug, thiserror::Error)]
#[non_exhaustive]
pub enum Error {
    /// Filesystem or stream error.
    #[error("I/O error: {0}")]
    Io(#[from] std::io::Error),
    /// Error reported by SQLite.
    #[error("SQLite error: {0}")]
    Sqlite(#[from] rusqlite::Error),
    /// JSON (de)serialization error.
    #[error("JSON error: {0}")]
    Json(#[from] serde_json::Error),
    /// The bytes are not an SQLite database (E001).
    #[error("not an SQLite database: {0}")]
    NotSqlite(String),
    /// SQLite, but not an SPDF this library understands (E002).
    #[error("not a supported SPDF file: {0}")]
    UnsupportedVersion(String),
    /// The schema contains triggers or views (E020).
    #[error("unsafe schema: {0}")]
    UnsafeSchema(String),
    /// A required extension is not supported by this reader (E060).
    #[error("unknown required extension: {0}")]
    UnknownRequiredExtension(String),
    /// A blob or decompressed stream exceeds the configured limit.
    #[error("too large: {0}")]
    TooLarge(String),
    /// An anchor is not valid (E040/E041).
    #[error("invalid anchor: {0}")]
    InvalidAnchor(String),
    /// An anchor URI cannot be parsed.
    #[error("invalid anchor URI: {0}")]
    InvalidUri(String),
    /// A vector has the wrong size, or a space is unknown (E030/E031).
    #[error("vector error: {0}")]
    Vector(String),
    /// Something requested does not exist.
    #[error("not found: {0}")]
    NotFound(String),
    /// Data does not satisfy the contract (writer side).
    #[error("invalid data: {0}")]
    Invalid(String),
    /// Signature creation or verification failed.
    #[error("signature error: {0}")]
    Signature(String),
    /// HTTP transport error (feature `http`).
    #[error("HTTP error: {0}")]
    Http(String),
}

impl Error {
    /// The contract validation code this error corresponds to, if any.
    pub fn code(&self) -> Option<&'static str> {
        Some(match self {
            Error::NotSqlite(_) => "E001",
            Error::UnsupportedVersion(_) => "E002",
            Error::UnsafeSchema(_) => "E020",
            Error::UnknownRequiredExtension(_) => "E060",
            Error::InvalidAnchor(_) => "E040",
            Error::Vector(_) => "E030",
            _ => return None,
        })
    }

    pub(crate) fn invalid(msg: impl fmt::Display) -> Self {
        Error::Invalid(msg.to_string())
    }
}
