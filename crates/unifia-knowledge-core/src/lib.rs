/* SPDX-License-Identifier: MIT */
//! # unifia-knowledge-core
//!
//! Native Knowledge Core for the Sovereign Knowledge Core V1.
//!
//! Implements the Rust side of `NativeKnowledgePort` (per
//! ADR-KNOW-0007) and the local primitives that must not be
//! re-implemented in TypeScript:
//!
//! - [`hash`] — BLAKE3 / SHA-256 content hashing.
//! - [`path`] — `ResolvedKnowledgePath` with symlink / junction /
//!   UNC / case / Unicode containment.
//! - [`error`] — typed errors that round-trip through the TS
//!   port without leaking panics.
//!
//! Higher-level modules (FTS5, WAL, watcher, control store,
//! vector index) are added in subsequent phases.

#![deny(rust_2018_idioms)]
#![allow(missing_docs)]
#![allow(clippy::too_many_arguments)]

pub mod classb;
pub mod control_store;
pub mod error;
pub mod hash;
pub mod path;
pub mod wal;
pub mod watcher;

pub use classb::{gc, reachability_report, ClassB, ClassBEntry, GcResult, ReachabilityReport};
pub use control_store::{ControlEvent, ControlStore, EgressGrant, PolicyGrant};
pub use error::{KnowledgeError, KnowledgeErrorKind};
pub use hash::{ContentHash, HashAlgorithm};
pub use path::ResolvedKnowledgePath;
pub use wal::{plan_replay, ReplayPlan, Wal, WalEntry, WalKind};
pub use watcher::{coalesce, hash_file, WatchEvent, WatcherConfig};
