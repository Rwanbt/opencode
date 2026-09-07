/* SPDX-License-Identifier: MIT */
//! Typed errors for the Knowledge Core.
//!
//! All errors round-trip through the TypeScript port as a
//! `KnowledgeError` (see ADR-KNOW-0007). Panics never cross the
//! boundary; the Rust side converts any unrecoverable state to
//! `KnowledgeError::Internal` with an opaque message.

use serde::{Deserialize, Serialize};
use thiserror::Error;

/// Kind of a knowledge error.
///
/// Mirrors the 11 kinds of `KnowledgeError` declared in the
/// `knowledge/errors` TypeScript module of the
/// `@unifia/contracts` package. The JSON shape MUST stay in
/// sync with the TypeScript schema.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum KnowledgeErrorKind {
    /// Egress denied by policy.
    EgressDenied,
    /// Path resolution failed (symlink, junction, UNC, case).
    PathUnresolved,
    /// CAS precondition failed (expected vs observed version hash).
    CasMismatch,
    /// Native call exceeded its bound.
    BoundExceeded,
    /// Native call exceeded its deadline.
    DeadlineExceeded,
    /// Cancellation requested before completion.
    Cancelled,
    /// Mutation refused by policy (e.g. delete of an active note).
    MutationRefused,
    /// Index not built; cold start degraded mode.
    IndexUnavailable,
    /// Source registry returned an inconsistency.
    SourceInconsistent,
    /// An invariant was violated; the system is in a degraded state.
    InvariantViolated,
    /// Internal error; the message is opaque to the user.
    Internal,
}

/// Knowledge error.
#[derive(Debug, Clone, Serialize, Deserialize, Error)]
#[error("{message}")]
pub struct KnowledgeError {
    /// Kind of the error.
    pub kind: KnowledgeErrorKind,
    /// Human-readable message (opaque to the user for `Internal`).
    pub message: String,
}

impl KnowledgeError {
    /// Build an internal error with a message. The message is
    /// opaque; never put secrets or paths here.
    pub fn internal(message: impl Into<String>) -> Self {
        Self {
            kind: KnowledgeErrorKind::Internal,
            message: message.into(),
        }
    }
    /// Build a path-unresolved error.
    pub fn path_unresolved(message: impl Into<String>) -> Self {
        Self {
            kind: KnowledgeErrorKind::PathUnresolved,
            message: message.into(),
        }
    }
    /// Build a CAS-mismatch error.
    pub fn cas_mismatch(message: impl Into<String>) -> Self {
        Self {
            kind: KnowledgeErrorKind::CasMismatch,
            message: message.into(),
        }
    }
    /// Build a bound-exceeded error.
    pub fn bound_exceeded(message: impl Into<String>) -> Self {
        Self {
            kind: KnowledgeErrorKind::BoundExceeded,
            message: message.into(),
        }
    }
    /// Build a deadline-exceeded error.
    pub fn deadline_exceeded(message: impl Into<String>) -> Self {
        Self {
            kind: KnowledgeErrorKind::DeadlineExceeded,
            message: message.into(),
        }
    }
    /// Build a cancelled error.
    pub fn cancelled(message: impl Into<String>) -> Self {
        Self {
            kind: KnowledgeErrorKind::Cancelled,
            message: message.into(),
        }
    }
    /// Build a mutation-refused error.
    pub fn mutation_refused(message: impl Into<String>) -> Self {
        Self {
            kind: KnowledgeErrorKind::MutationRefused,
            message: message.into(),
        }
    }
    /// Build an index-unavailable error.
    pub fn index_unavailable(message: impl Into<String>) -> Self {
        Self {
            kind: KnowledgeErrorKind::IndexUnavailable,
            message: message.into(),
        }
    }
    /// Build a source-inconsistent error.
    pub fn source_inconsistent(message: impl Into<String>) -> Self {
        Self {
            kind: KnowledgeErrorKind::SourceInconsistent,
            message: message.into(),
        }
    }
    /// Build an invariant-violated error.
    pub fn invariant_violated(message: impl Into<String>) -> Self {
        Self {
            kind: KnowledgeErrorKind::InvariantViolated,
            message: message.into(),
        }
    }
    /// Build an egress-denied error.
    pub fn egress_denied(message: impl Into<String>) -> Self {
        Self {
            kind: KnowledgeErrorKind::EgressDenied,
            message: message.into(),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn serde_roundtrip_egress_denied() {
        let err = KnowledgeError::egress_denied("remote model denied");
        let s = serde_json::to_string(&err).unwrap();
        assert_eq!(
            s,
            "{\"kind\":\"egress_denied\",\"message\":\"remote model denied\"}"
        );
        let back: KnowledgeError = serde_json::from_str(&s).unwrap();
        assert_eq!(back.kind, KnowledgeErrorKind::EgressDenied);
        assert_eq!(back.message, "remote model denied");
    }

    #[test]
    fn all_kinds_serialise_in_snake_case() {
        for (kind, name) in [
            (KnowledgeErrorKind::EgressDenied, "egress_denied"),
            (KnowledgeErrorKind::PathUnresolved, "path_unresolved"),
            (KnowledgeErrorKind::CasMismatch, "cas_mismatch"),
            (KnowledgeErrorKind::BoundExceeded, "bound_exceeded"),
            (KnowledgeErrorKind::DeadlineExceeded, "deadline_exceeded"),
            (KnowledgeErrorKind::Cancelled, "cancelled"),
            (KnowledgeErrorKind::MutationRefused, "mutation_refused"),
            (KnowledgeErrorKind::IndexUnavailable, "index_unavailable"),
            (
                KnowledgeErrorKind::SourceInconsistent,
                "source_inconsistent",
            ),
            (KnowledgeErrorKind::InvariantViolated, "invariant_violated"),
            (KnowledgeErrorKind::Internal, "internal"),
        ] {
            let err = KnowledgeError {
                kind,
                message: "x".to_string(),
            };
            let s = serde_json::to_string(&err).unwrap();
            assert!(s.contains(&format!("\"kind\":\"{name}\"")));
        }
    }
}
