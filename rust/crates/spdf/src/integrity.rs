//! Integrity (contract §8): `content_sha256` and optional Ed25519 signature.
//!
//! * `content_sha256` = lowercase hex SHA-256 of the JCS serialization of the
//!   canonical dump without `meta.content_sha256`, `meta.signature` and
//!   `meta.signer`;
//! * `signature` = base64 (standard, padded) of the Ed25519 signature over
//!   the ASCII bytes `spdf-content-sha256:` + that hex;
//! * `signer` = `ed25519:` + base64 of the 32-byte public key.

use std::path::Path;

use base64::engine::general_purpose::STANDARD as B64;
use base64::Engine;
use ed25519_dalek::{Signature, Signer, SigningKey, Verifier, VerifyingKey};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha2::{Digest, Sha256};

use crate::canon;
use crate::error::{Error, Result};
use crate::reader::{hex, Spdf};

/// Domain-separation prefix of the signed message.
pub const SIGNATURE_PREFIX: &str = "spdf-content-sha256:";

/// Computes `content_sha256` from a canonical dump value.
pub fn content_sha256_of_dump(dump: &Value) -> String {
    let mut d = dump.clone();
    if let Some(Value::Object(meta)) = d.get_mut("meta") {
        meta.remove("content_sha256");
        meta.remove("signature");
        meta.remove("signer");
    }
    hex(&Sha256::digest(canon::to_string(&d).as_bytes()))
}

/// The message that is signed for a given content hash.
pub fn signed_message(content_sha256: &str) -> Vec<u8> {
    format!("{SIGNATURE_PREFIX}{content_sha256}").into_bytes()
}

/// An Ed25519 key pair for signing SPDF files.
#[derive(Clone)]
pub struct KeyPair {
    key: SigningKey,
}

impl KeyPair {
    /// Generates a new random key pair.
    pub fn generate() -> Result<Self> {
        let mut seed = [0u8; 32];
        getrandom::getrandom(&mut seed).map_err(|e| Error::Signature(e.to_string()))?;
        Ok(KeyPair {
            key: SigningKey::from_bytes(&seed),
        })
    }

    /// From a 32-byte seed.
    pub fn from_seed(seed: &[u8; 32]) -> Self {
        KeyPair {
            key: SigningKey::from_bytes(seed),
        }
    }

    /// From the base64 (or hex) text of a 32-byte seed, as written by
    /// [`KeyPair::secret_base64`].
    pub fn from_secret_text(s: &str) -> Result<Self> {
        let s = s.trim();
        let bytes = B64
            .decode(s)
            .ok()
            .filter(|b| b.len() == 32)
            .or_else(|| decode_hex(s).filter(|b| b.len() == 32))
            .ok_or_else(|| Error::Signature("secret key must be 32 bytes in base64 or hex".into()))?;
        let mut seed = [0u8; 32];
        seed.copy_from_slice(&bytes);
        Ok(Self::from_seed(&seed))
    }

    /// Seed as standard base64 (keep it secret).
    pub fn secret_base64(&self) -> String {
        B64.encode(self.key.to_bytes())
    }

    /// The `signer` value: `ed25519:<base64 public key>`.
    pub fn signer(&self) -> String {
        format!("ed25519:{}", B64.encode(self.key.verifying_key().to_bytes()))
    }

    /// Signs a content hash; returns the base64 signature.
    pub fn sign_hash(&self, content_sha256: &str) -> String {
        B64.encode(self.key.sign(&signed_message(content_sha256)).to_bytes())
    }
}

fn decode_hex(s: &str) -> Option<Vec<u8>> {
    if s.len() % 2 != 0 {
        return None;
    }
    (0..s.len())
        .step_by(2)
        .map(|i| u8::from_str_radix(s.get(i..i + 2)?, 16).ok())
        .collect()
}

/// Verifies a base64 signature of `content_sha256` by `signer`
/// (`ed25519:<base64>`).
pub fn verify_signature(content_sha256: &str, signature_b64: &str, signer: &str) -> Result<()> {
    let pk = signer
        .strip_prefix("ed25519:")
        .ok_or_else(|| Error::Signature("signer must start with `ed25519:`".into()))?;
    let pk = B64
        .decode(pk.trim())
        .map_err(|e| Error::Signature(format!("bad signer key: {e}")))?;
    let pk: [u8; 32] = pk
        .try_into()
        .map_err(|_| Error::Signature("signer key must be 32 bytes".into()))?;
    let vk = VerifyingKey::from_bytes(&pk).map_err(|e| Error::Signature(e.to_string()))?;
    let sig = B64
        .decode(signature_b64.trim())
        .map_err(|e| Error::Signature(format!("bad signature: {e}")))?;
    let sig: [u8; 64] = sig
        .try_into()
        .map_err(|_| Error::Signature("signature must be 64 bytes".into()))?;
    vk.verify(&signed_message(content_sha256), &Signature::from_bytes(&sig))
        .map_err(|_| Error::Signature("signature does not verify".into()))
}

/// Result of [`Spdf::verify_integrity`].
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct IntegrityReport {
    /// Hash recomputed from the content.
    pub computed_sha256: String,
    /// `meta.content_sha256`, if present.
    pub stored_sha256: Option<String>,
    /// True if the stored hash is present and matches.
    pub hash_ok: bool,
    /// `meta.signer`, if present.
    pub signer: Option<String>,
    /// `Some(true)` if a signature is present and verifies, `Some(false)` if
    /// it does not, `None` if unsigned.
    pub signature_ok: Option<bool>,
    /// True if an expected signer was given and matches `meta.signer`.
    pub signer_trusted: Option<bool>,
}

impl Spdf {
    /// Recomputes `content_sha256` from the content.
    pub fn content_sha256(&self) -> Result<String> {
        Ok(content_sha256_of_dump(&self.dump()?))
    }

    /// Checks `content_sha256` and the signature. `expected_signer` (an
    /// `ed25519:<base64>` key) is compared with `meta.signer` if given.
    pub fn verify_integrity(&self, expected_signer: Option<&str>) -> Result<IntegrityReport> {
        let meta = self.meta()?;
        let computed = self.content_sha256()?;
        let stored = meta.get("content_sha256").cloned();
        let signer = meta.get("signer").cloned();
        let signature_ok = match (meta.get("signature"), &signer) {
            (Some(sig), Some(s)) => Some(verify_signature(&computed, sig, s).is_ok()),
            (Some(_), None) => Some(false),
            _ => None,
        };
        Ok(IntegrityReport {
            hash_ok: stored.as_deref() == Some(computed.as_str()),
            computed_sha256: computed,
            stored_sha256: stored,
            signer_trusted: expected_signer.map(|e| signer.as_deref() == Some(e.trim())),
            signer,
            signature_ok,
        })
    }
}

/// Writes a copy of a 5.0 file at `dst` with `content_sha256` and, if a key
/// is given, `signature` and `signer` set in `spdf_meta`.
pub fn seal(src: impl AsRef<Path>, dst: impl AsRef<Path>, key: Option<&KeyPair>) -> Result<IntegrityReport> {
    let doc = Spdf::open(src.as_ref())?;
    if doc.is_legacy() {
        return Err(Error::invalid("convert legacy files to 5.0 before sealing them"));
    }
    let mut w = crate::writer::Writer::from_spdf(&doc)?;
    drop(doc);
    w.seal(key);
    w.write(dst.as_ref())?;
    Spdf::open(dst.as_ref())?.verify_integrity(key.map(|k| k.signer()).as_deref())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sign_and_verify() {
        let k = KeyPair::from_seed(&[7u8; 32]);
        let h = "ab".repeat(32);
        let sig = k.sign_hash(&h);
        verify_signature(&h, &sig, &k.signer()).unwrap();
        assert!(verify_signature(&"cd".repeat(32), &sig, &k.signer()).is_err());
        let k2 = KeyPair::from_secret_text(&k.secret_base64()).unwrap();
        assert_eq!(k2.signer(), k.signer());
    }
}
