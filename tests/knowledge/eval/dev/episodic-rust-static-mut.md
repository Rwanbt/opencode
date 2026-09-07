---
# SPDX-License-Identifier: MIT
# Copyright (c) 2026 Unifia contributors
unifia_schema: 1
unifia_id: "0190d2c0-7b00-7000-8000-000000000006"
unifia_type: "episodic"
unifia_lifecycle: "active"
unifia_created_at: "2026-04-17T00:00:00Z"
unifia_updated_at: "2026-04-17T00:00:00Z"
unifia_project_ref: "unifia"
unifia_supersedes: []
unifia_restrictions:
  remote_model: allow
  local_model: allow
unifia_tags:
  - "lang:rust"
  - "concurrency"
---

# Episodic: race on `static mut PROXY_PORT`

A previous version of the local server used `static mut PROXY_PORT: u16`
to choose a free port. Two concurrent binds were possible, creating a
race.

Fix: replace with `AtomicU16` + `compare_exchange`. Audit pass B.A6,
2026-04-17.
