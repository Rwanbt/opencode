/* SPDX-License-Identifier: MIT */
//! `ResolvedKnowledgePath` — single source of truth for knowledge
//! paths. Per ADR-KNOW-0007 and the runbook §13 P2.2, every
//! primitive (watcher, indexer, retrieval, hydration, mutation,
//! tools) consumes a `ResolvedKnowledgePath`.
//!
//! The path is:
//! - always relative to a knowledge root;
//! - always normalised (no `..`, no leading `/` on Unix, no
//!   drive letter on Windows, no trailing slash);
//! - always UTF-8 (via `camino::Utf8Path`);
//! - case-preserving but with a canonical-case representation
//!   when the platform supports it (HFS+, NTFS, case-sensitive
//!   filesystems all behave differently — the resolver records
//!   the observed casing).
//!
//! V1: we expose the normalised representation and the symlink
//! resolution result. The full case-canonicalisation is part of
//! Phase 2.2 (Spike filesystem).

use camino::{Utf8Path, Utf8PathBuf};
use serde::{Deserialize, Serialize};

/// A resolved knowledge path.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(transparent)]
pub struct ResolvedKnowledgePath(Utf8PathBuf);

impl ResolvedKnowledgePath {
    /// Try to build from a string locator. The locator must be
    /// relative, contain no `..`, no leading `/`, no drive
    /// letter, no trailing slash, and must be UTF-8.
    pub fn from_locator(locator: &str) -> Result<Self, crate::KnowledgeError> {
        if locator.is_empty() {
            return Err(crate::KnowledgeError::path_unresolved("empty locator"));
        }
        if locator.contains("..") {
            return Err(crate::KnowledgeError::path_unresolved(
                "locator contains '..'",
            ));
        }
        if locator.starts_with('/') {
            return Err(crate::KnowledgeError::path_unresolved(
                "locator is absolute",
            ));
        }
        // Windows drive letter: "C:\" or "C:/".
        if locator.chars().nth(1) == Some(':') {
            return Err(crate::KnowledgeError::path_unresolved(
                "locator has a Windows drive letter",
            ));
        }
        if locator.ends_with('/') && locator != "./" {
            return Err(crate::KnowledgeError::path_unresolved(
                "locator ends with '/'",
            ));
        }
        Ok(Self(Utf8PathBuf::from(locator)))
    }
    /// Join with a sub-locator.
    pub fn join(&self, sub: &str) -> Result<Self, crate::KnowledgeError> {
        if sub.is_empty() {
            return Err(crate::KnowledgeError::path_unresolved("empty sub-locator"));
        }
        if sub.starts_with('/') {
            return Err(crate::KnowledgeError::path_unresolved(
                "sub-locator is absolute",
            ));
        }
        let joined = self.0.join(sub);
        let normalised = joined.as_str().replace('\\', "/");
        if normalised.contains("..") {
            return Err(crate::KnowledgeError::path_unresolved(
                "join produced a '..' segment",
            ));
        }
        Ok(Self(Utf8PathBuf::from(normalised)))
    }
    /// Borrow the underlying path.
    pub fn as_path(&self) -> &Utf8Path {
        &self.0
    }
    /// Borrow the underlying string representation.
    pub fn as_str(&self) -> &str {
        self.0.as_str()
    }
    /// The file extension, if any.
    pub fn extension(&self) -> Option<&str> {
        self.0.extension()
    }
}

impl std::fmt::Display for ResolvedKnowledgePath {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(self.0.as_str())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn accepts_simple_locator() {
        let p = ResolvedKnowledgePath::from_locator("memory/decisions/x.md").unwrap();
        assert_eq!(p.as_str(), "memory/decisions/x.md");
        assert_eq!(p.extension(), Some("md"));
    }

    #[test]
    fn rejects_dotdot() {
        assert!(ResolvedKnowledgePath::from_locator("../escape").is_err());
        assert!(ResolvedKnowledgePath::from_locator("memory/../x").is_err());
    }

    #[test]
    fn rejects_absolute() {
        assert!(ResolvedKnowledgePath::from_locator("/etc/passwd").is_err());
    }

    #[test]
    fn rejects_drive_letter() {
        assert!(ResolvedKnowledgePath::from_locator("C:/Windows").is_err());
        assert!(ResolvedKnowledgePath::from_locator("D:\\path").is_err());
    }

    #[test]
    fn rejects_trailing_slash() {
        assert!(ResolvedKnowledgePath::from_locator("memory/").is_err());
    }

    #[test]
    fn join_appends() {
        let p = ResolvedKnowledgePath::from_locator("memory").unwrap();
        let q = p.join("decisions/x.md").unwrap();
        assert_eq!(q.as_str(), "memory/decisions/x.md");
    }

    #[test]
    fn join_rejects_dotdot() {
        let p = ResolvedKnowledgePath::from_locator("memory").unwrap();
        assert!(p.join("../escape").is_err());
    }

    #[test]
    fn join_rejects_absolute() {
        let p = ResolvedKnowledgePath::from_locator("memory").unwrap();
        assert!(p.join("/etc/passwd").is_err());
    }
}
