/* SPDX-License-Identifier: MIT */
//! Class B (Portable metadata) — copy-on-write (P2.4).
//!
//! Per ADR-KNOW-0003, Class B holds identities, aliases, and
//! minimal provenance that must travel with the note. GC runs
//! only in an Admin Task under exclusive lock with reachability
//! re-validated.
//!
//! V1: in-memory data structure + reachability computation. The
//! filesystem I/O for the sidecar is added in a follow-up.

use std::collections::{HashMap, HashSet};

use serde::{Deserialize, Serialize};

use crate::error::KnowledgeError;

/// A Class B entry: a portable alias or external stable
/// identity. Carried in `.unifia/portable/<id>.json`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ClassBEntry {
    /// Portable id (e.g. ADR-0017, or an external ticket id).
    pub alias: String,
    /// Target locator in the vault.
    pub locator: String,
    /// Optional external source (commit, URL, DOI).
    pub external_source: Option<String>,
    /// Revision counter. Increments on every copy-on-write.
    pub revision: u64,
}

/// Class B is a map from alias to entry. Multiple aliases can
/// point to the same locator.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct ClassB {
    by_alias: HashMap<String, ClassBEntry>,
    next_revision: u64,
}

impl ClassB {
    /// New, empty Class B.
    pub fn new() -> Self {
        Self::default()
    }

    /// Look up an alias.
    pub fn lookup(&self, alias: &str) -> Option<&ClassBEntry> {
        self.by_alias.get(alias)
    }

    /// Add or update an alias (copy-on-write).
    pub fn upsert(
        &mut self,
        alias: String,
        locator: String,
        external_source: Option<String>,
    ) -> Result<&ClassBEntry, KnowledgeError> {
        if alias.is_empty() {
            return Err(KnowledgeError::invariant_violated(
                "alias must be non-empty",
            ));
        }
        if locator.is_empty() {
            return Err(KnowledgeError::invariant_violated(
                "locator must be non-empty",
            ));
        }
        self.next_revision = self
            .next_revision
            .checked_add(1)
            .ok_or_else(|| KnowledgeError::invariant_violated("Class B revision overflow"))?;
        let revision = self.next_revision;
        let entry = ClassBEntry {
            alias: alias.clone(),
            locator,
            external_source,
            revision,
        };
        self.by_alias.insert(alias.clone(), entry);
        Ok(self.by_alias.get(&alias).expect("just inserted"))
    }

    /// Number of entries.
    pub fn len(&self) -> usize {
        self.by_alias.len()
    }

    /// True if empty.
    pub fn is_empty(&self) -> bool {
        self.by_alias.is_empty()
    }

    /// All aliases, in insertion order.
    pub fn aliases(&self) -> Vec<String> {
        self.by_alias.keys().cloned().collect()
    }
}

/// Reachability report for GC.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ReachabilityReport {
    /// Locators currently reachable from Class A.
    pub reachable: HashSet<String>,
    /// Locators known to Class B but not reachable from A.
    pub orphans: Vec<String>,
    /// Locators known to Class A but missing from Class B.
    pub missing_from_b: Vec<String>,
}

/// Compute a reachability report given the set of locators known
/// to Class A and the Class B.
pub fn reachability_report(class_a_locators: &HashSet<String>, b: &ClassB) -> ReachabilityReport {
    let mut b_locators: HashSet<String> = HashSet::new();
    for e in b.by_alias.values() {
        b_locators.insert(e.locator.clone());
    }
    let reachable: HashSet<String> = class_a_locators
        .intersection(&b_locators)
        .cloned()
        .collect();
    let orphans: Vec<String> = b_locators.difference(class_a_locators).cloned().collect();
    let missing_from_b: Vec<String> = class_a_locators.difference(&b_locators).cloned().collect();
    ReachabilityReport {
        reachable,
        orphans,
        missing_from_b,
    }
}

/// Result of a GC pass.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct GcResult {
    /// Number of orphans removed.
    pub removed: usize,
    /// Aliases that survived (not orphans).
    pub kept: usize,
}

/// GC: remove orphans. Pure: returns a new `ClassB` and a
/// `GcResult`. The caller is responsible for writing the new
/// state under exclusive lock.
pub fn gc(b: &ClassB, report: &ReachabilityReport) -> (ClassB, GcResult) {
    let mut next = b.clone();
    let mut removed = 0usize;
    let orphan_set: HashSet<String> = report.orphans.iter().cloned().collect();
    let to_drop: Vec<String> = b
        .by_alias
        .iter()
        .filter(|(_, e)| orphan_set.contains(&e.locator))
        .map(|(alias, _)| alias.clone())
        .collect();
    for alias in to_drop {
        next.by_alias.remove(&alias);
        removed += 1;
    }
    let kept = next.by_alias.len();
    (next, GcResult { removed, kept })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn set(items: &[&str]) -> HashSet<String> {
        items.iter().map(|s| s.to_string()).collect()
    }

    #[test]
    fn empty_classb_is_empty() {
        let b = ClassB::new();
        assert!(b.is_empty());
        assert_eq!(b.len(), 0);
    }

    #[test]
    fn upsert_rejects_empty_alias() {
        let mut b = ClassB::new();
        assert!(b.upsert("".into(), "x.md".into(), None).is_err());
    }

    #[test]
    fn upsert_rejects_empty_locator() {
        let mut b = ClassB::new();
        assert!(b.upsert("a".into(), "".into(), None).is_err());
    }

    #[test]
    fn upsert_increments_revision() {
        let mut b = ClassB::new();
        let e1 = b.upsert("a".into(), "x.md".into(), None).unwrap().clone();
        let e2 = b.upsert("a".into(), "x.md".into(), None).unwrap().clone();
        assert_eq!(e1.revision, 1);
        assert_eq!(e2.revision, 2);
    }

    #[test]
    fn reachability_finds_orphans() {
        let mut b = ClassB::new();
        b.upsert("a".into(), "alive.md".into(), None).unwrap();
        b.upsert("b".into(), "orphan.md".into(), None).unwrap();
        let r = reachability_report(&set(&["alive.md", "other.md"]), &b);
        assert_eq!(r.reachable.len(), 1);
        assert_eq!(r.orphans, vec!["orphan.md".to_string()]);
    }

    #[test]
    fn gc_removes_orphans() {
        let mut b = ClassB::new();
        b.upsert("a".into(), "alive.md".into(), None).unwrap();
        b.upsert("b".into(), "orphan.md".into(), None).unwrap();
        let r = reachability_report(&set(&["alive.md"]), &b);
        let (b2, res) = gc(&b, &r);
        assert_eq!(res.removed, 1);
        assert_eq!(res.kept, 1);
        assert!(b2.lookup("b").is_none());
    }
}
