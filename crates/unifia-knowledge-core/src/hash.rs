/* SPDX-License-Identifier: MIT */
//! Content hashing for knowledge documents.
//!
//! Per ADR-KNOW-0001, every managed note has a `versionHash` and
//! a `hashAlgorithm`. V1 prefers BLAKE3 (faster on Android, no
//! known patent issues) and falls back to SHA-256 when BLAKE3 is
//! not compiled in.

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

/// Hash algorithm of a content hash.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum HashAlgorithm {
    /// BLAKE3.
    Blake3,
    /// SHA-256.
    Sha256,
}

/// A content hash (lowercase hex, 64 chars).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(transparent)]
pub struct ContentHash(String);

impl ContentHash {
    /// Construct from a 64-char lowercase hex string. Returns
    /// `KnowledgeError::InvariantViolated` if the input is wrong.
    pub fn from_hex(hex: &str) -> Result<Self, crate::KnowledgeError> {
        if hex.len() != 64
            || !hex
                .chars()
                .all(|c| c.is_ascii_hexdigit() && !c.is_ascii_uppercase())
        {
            return Err(crate::KnowledgeError::invariant_violated(
                "ContentHash must be a 64-char lowercase hex string",
            ));
        }
        Ok(Self(hex.to_string()))
    }
    /// Borrow the hex string.
    pub fn as_str(&self) -> &str {
        &self.0
    }
}

impl std::fmt::Display for ContentHash {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(&self.0)
    }
}

/// Hash a UTF-8 string with SHA-256 (always available).
pub fn sha256(input: &[u8]) -> ContentHash {
    let mut hasher = Sha256::new();
    hasher.update(input);
    let out = hasher.finalize();
    ContentHash(hex_lower(&out))
}

/// Hash a UTF-8 string with BLAKE3 (when the `blake3` feature is
/// on; this function is always available because `blake3` is in
/// the default `dependencies` table of the manifest).
pub fn blake3(input: &[u8]) -> ContentHash {
    let hash = blake3::hash(input);
    ContentHash(hex_lower(hash.as_bytes()))
}

fn hex_lower(bytes: &[u8]) -> String {
    const HEX: &[u8; 16] = b"0123456789abcdef";
    let mut out = String::with_capacity(bytes.len() * 2);
    for b in bytes {
        out.push(HEX[(b >> 4) as usize] as char);
        out.push(HEX[(b & 0x0f) as usize] as char);
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sha256_known_vector() {
        // SHA-256("") = e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855
        let h = sha256(b"");
        assert_eq!(
            h.as_str(),
            "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
        );
    }

    #[test]
    fn blake3_known_vector() {
        // BLAKE3("") = af1349b9f5f9a1a6a0404dea36dcc9499bcb25c9adc112b7cc9a93cae41f3262
        let h = blake3(b"");
        assert_eq!(
            h.as_str(),
            "af1349b9f5f9a1a6a0404dea36dcc9499bcb25c9adc112b7cc9a93cae41f3262"
        );
    }

    #[test]
    fn rejects_non_lowercase() {
        let r = ContentHash::from_hex(
            "AF1349b9f5f9a1a6a0404dea36dcc9499bcb25c9adc112b7cc9a93cae41f3262",
        );
        assert!(r.is_err());
    }

    #[test]
    fn rejects_wrong_length() {
        let r = ContentHash::from_hex("abc");
        assert!(r.is_err());
    }

    #[test]
    fn accepts_lowercase_64() {
        let r = ContentHash::from_hex(&"a".repeat(64));
        assert!(r.is_ok());
    }
}
