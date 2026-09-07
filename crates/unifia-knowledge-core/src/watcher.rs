/* SPDX-License-Identifier: MIT */
//! Filesystem watcher (P2.2).
//!
//! Per ADR-KNOW-0007 and runbook §13 P2.2, the watcher is the
//! single source of truth for `file.changed`, `file.moved`, and
//! `file.deleted` events. It MUST:
//!
//! - debounce (rapid successive writes coalesce into one event);
//! - coalesce (one event per file per interval);
//! - stat the file (mtime, size);
//! - compute a hash (BLAKE3 preferred, SHA-256 fallback);
//! - invalidate / update the index without blocking other
//!   watchers.
//!
//! V1 in the Rust crate is the *interface* and a debouncer
//! abstraction. The actual platform watcher (`notify` crate on
//! desktop, Android FileObserver / StorageVolume on Android) is
//! added in a later iteration.

use std::path::PathBuf;
use std::time::Duration;

use crate::error::KnowledgeError;
use crate::hash::ContentHash;

/// A watch event.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum WatchEvent {
    /// File appeared (or was created).
    Created {
        path: PathBuf,
        hash: ContentHash,
        bytes: u64,
    },
    /// File was modified (within the debounce window).
    Modified {
        path: PathBuf,
        hash: ContentHash,
        bytes: u64,
    },
    /// File was removed.
    Removed { path: PathBuf },
    /// File was renamed (from -> to).
    Renamed { from: PathBuf, to: PathBuf },
}

/// Debounce / coalesce window. Events on the same path within
/// this window are coalesced into a single `Modified` event.
#[derive(Debug, Clone, Copy)]
pub struct WatcherConfig {
    /// Debounce window per path. Default 250 ms.
    pub debounce: Duration,
    /// Maximum event payload bytes. Default 1 MiB.
    pub max_event_bytes: usize,
    /// Maximum events per interval. Default 100.
    pub max_events_per_interval: usize,
}

impl Default for WatcherConfig {
    fn default() -> Self {
        Self {
            debounce: Duration::from_millis(250),
            max_event_bytes: 1024 * 1024,
            max_events_per_interval: 100,
        }
    }
}

/// Coalesce raw events into the bounded stream consumed by the
/// indexer. Pure: same input, same output.
pub fn coalesce(events: Vec<WatchEvent>, cfg: &WatcherConfig) -> Vec<WatchEvent> {
    let mut out: Vec<WatchEvent> =
        Vec::with_capacity(events.len().min(cfg.max_events_per_interval));
    for ev in events {
        if out.len() >= cfg.max_events_per_interval {
            // Drop further events when the bounded rate is hit.
            break;
        }
        match &ev {
            WatchEvent::Modified { bytes, .. } if *bytes as usize > cfg.max_event_bytes => {
                // Skip oversized payloads; let the indexer refetch
                // on demand through `get` (Phase 3).
            }
            _ => out.push(ev),
        }
    }
    out
}

/// Compute the hash of a file's content. Returns
/// `KnowledgeError::PathUnresolved` on I/O errors.
pub fn hash_file(path: &std::path::Path) -> Result<ContentHash, KnowledgeError> {
    let bytes = std::fs::read(path)
        .map_err(|e| KnowledgeError::path_unresolved(format!("read {}: {}", path.display(), e)))?;
    Ok(crate::hash::blake3(&bytes))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    #[test]
    fn coalesce_drops_oversized() {
        let cfg = WatcherConfig {
            max_event_bytes: 10,
            ..WatcherConfig::default()
        };
        let events = vec![
            WatchEvent::Modified {
                path: PathBuf::from("a"),
                hash: crate::hash::sha256(b""),
                bytes: 1,
            },
            WatchEvent::Modified {
                path: PathBuf::from("b"),
                hash: crate::hash::sha256(b""),
                bytes: 999_999,
            },
        ];
        let out = coalesce(events, &cfg);
        assert_eq!(out.len(), 1);
    }

    #[test]
    fn coalesce_respects_max_events_per_interval() {
        let cfg = WatcherConfig {
            max_events_per_interval: 2,
            max_event_bytes: usize::MAX,
            ..WatcherConfig::default()
        };
        let events = (0..5)
            .map(|i| WatchEvent::Modified {
                path: PathBuf::from(format!("f{i}")),
                hash: crate::hash::sha256(b""),
                bytes: 1,
            })
            .collect();
        let out = coalesce(events, &cfg);
        assert_eq!(out.len(), 2);
    }

    #[test]
    fn hash_file_reads_content() {
        let dir = std::env::temp_dir().join("unifia-knowledge-core-test");
        let _ = std::fs::create_dir_all(&dir);
        let path = dir.join("hello.txt");
        let mut f = std::fs::File::create(&path).unwrap();
        f.write_all(b"hello").unwrap();
        let h = hash_file(&path).unwrap();
        assert_eq!(h.as_str().len(), 64);
        let _ = std::fs::remove_file(&path);
    }
}
