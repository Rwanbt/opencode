/* SPDX-License-Identifier: MIT */
//! Class C (Local control state) — ControlStore (P2.5).
//!
//! Per ADR-KNOW-0004: device_id, PolicyGrants, EgressGrants,
//! DeclassificationGrants, MCP grants, mutation WAL,
//! control event log, locks, local UI state. Lives in OS app
//! data, never in Git, never in the vault.
//!
//! V1: an in-memory ControlStore with the four key stores
//! (device_id, policy grants, egress grants, control log).
//! Persistence to OS app data is a follow-up.

use std::collections::HashMap;

use serde::{Deserialize, Serialize};

use crate::error::KnowledgeError;

/// A PolicyGrant: an action the user has explicitly allowed.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct PolicyGrant {
    pub id: String,
    pub subject: String,
    pub action: String,
    pub granted_at: String,
    pub expires_at: Option<String>,
    pub revoked: bool,
}

/// An EgressGrant: a one-shot, hash-bound, destination-bound
/// declassification. After the first successful egress the
/// grant is consumed.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct EgressGrant {
    pub id: String,
    pub content_hash: String,
    pub destination: String,
    pub granted_at: String,
    pub consumed: bool,
}

/// A control event log entry.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ControlEvent {
    pub id: String,
    pub kind: String,
    pub timestamp: String,
    pub payload: String,
}

/// The ControlStore. Singleton per process; injected with
/// owner-identifiable scope (ADR-KNOW-0007).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ControlStore {
    device_id: String,
    policy_grants: HashMap<String, PolicyGrant>,
    egress_grants: HashMap<String, EgressGrant>,
    control_log: Vec<ControlEvent>,
}

impl ControlStore {
    /// New with a freshly generated device id.
    pub fn new(device_id: String) -> Result<Self, KnowledgeError> {
        if device_id.is_empty() {
            return Err(KnowledgeError::invariant_violated(
                "device_id must be non-empty",
            ));
        }
        Ok(Self {
            device_id,
            policy_grants: HashMap::new(),
            egress_grants: HashMap::new(),
            control_log: Vec::new(),
        })
    }

    pub fn device_id(&self) -> &str {
        &self.device_id
    }

    pub fn upsert_policy_grant(&mut self, g: PolicyGrant) -> Result<(), KnowledgeError> {
        if g.id.is_empty() {
            return Err(KnowledgeError::invariant_violated(
                "policy grant id required",
            ));
        }
        self.policy_grants.insert(g.id.clone(), g);
        Ok(())
    }

    pub fn policy_grant(&self, id: &str) -> Option<&PolicyGrant> {
        self.policy_grants.get(id)
    }

    pub fn revoke_policy_grant(&mut self, id: &str) -> bool {
        if let Some(g) = self.policy_grants.get_mut(id) {
            g.revoked = true;
            true
        } else {
            false
        }
    }

    pub fn upsert_egress_grant(&mut self, g: EgressGrant) -> Result<(), KnowledgeError> {
        if g.id.is_empty() {
            return Err(KnowledgeError::invariant_violated(
                "egress grant id required",
            ));
        }
        if g.content_hash.is_empty() || g.destination.is_empty() {
            return Err(KnowledgeError::invariant_violated(
                "egress grant requires content_hash and destination",
            ));
        }
        self.egress_grants.insert(g.id.clone(), g);
        Ok(())
    }

    pub fn egress_grant(&self, id: &str) -> Option<&EgressGrant> {
        self.egress_grants.get(id)
    }

    /// Consume an egress grant: mark as used, return true if it
    /// was valid and now consumed.
    pub fn consume_egress_grant(&mut self, id: &str) -> bool {
        if let Some(g) = self.egress_grants.get_mut(id) {
            if g.consumed {
                return false;
            }
            g.consumed = true;
            true
        } else {
            false
        }
    }

    /// Append a control event.
    pub fn append_event(&mut self, e: ControlEvent) {
        self.control_log.push(e);
    }

    /// Borrow the control log.
    pub fn control_log(&self) -> &[ControlEvent] {
        &self.control_log
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn new_rejects_empty_device_id() {
        assert!(ControlStore::new(String::new()).is_err());
    }

    #[test]
    fn device_id_roundtrip() {
        let s = ControlStore::new("dev-1".into()).unwrap();
        assert_eq!(s.device_id(), "dev-1");
    }

    #[test]
    fn policy_grant_lifecycle() {
        let mut s = ControlStore::new("dev-1".into()).unwrap();
        s.upsert_policy_grant(PolicyGrant {
            id: "g1".into(),
            subject: "user".into(),
            action: "read".into(),
            granted_at: "t".into(),
            expires_at: None,
            revoked: false,
        })
        .unwrap();
        assert!(s.policy_grant("g1").is_some());
        assert!(s.revoke_policy_grant("g1"));
        assert!(s.policy_grant("g1").unwrap().revoked);
    }

    #[test]
    fn egress_grant_one_shot() {
        let mut s = ControlStore::new("dev-1".into()).unwrap();
        s.upsert_egress_grant(EgressGrant {
            id: "e1".into(),
            content_hash: "h".into(),
            destination: "anthropic".into(),
            granted_at: "t".into(),
            consumed: false,
        })
        .unwrap();
        assert!(s.consume_egress_grant("e1"));
        // Second consume is a no-op.
        assert!(!s.consume_egress_grant("e1"));
    }

    #[test]
    fn control_log_appends() {
        let mut s = ControlStore::new("dev-1".into()).unwrap();
        s.append_event(ControlEvent {
            id: "1".into(),
            kind: "x".into(),
            timestamp: "t".into(),
            payload: "{}".into(),
        });
        assert_eq!(s.control_log().len(), 1);
    }
}
