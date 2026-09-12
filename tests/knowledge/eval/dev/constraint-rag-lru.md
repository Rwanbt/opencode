---
# SPDX-License-Identifier: MIT
# Copyright (c) 2026 Unifia contributors
unifia_schema: 1
unifia_id: "0190d2c0-7b00-7000-8000-000000000003"
unifia_type: "constraint"
unifia_lifecycle: "active"
unifia_created_at: "2026-08-29T00:00:00Z"
unifia_updated_at: "2026-08-29T00:00:00Z"
unifia_project_ref: "unifia"
unifia_supersedes: []
unifia_restrictions:
  remote_model: allow
  local_model: allow
unifia_tags:
  - "cache:lru"
  - "ttl:30min"
---

# Constraint: RAG indexed-dirs cache must be bounded

The set of indexed directories used by the RAG subsystem must be a
bounded LRU cache:

- capacity: 64 entries ;
- TTL: 30 minutes.

A plain `Set` is forbidden; it leaks memory over long sessions
(observed in audit pass B.1).
