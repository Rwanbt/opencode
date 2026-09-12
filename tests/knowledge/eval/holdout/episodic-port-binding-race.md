---
# SPDX-License-Identifier: MIT
# Copyright (c) 2026 Unifia contributors
unifia_schema: 1
unifia_id: "0190d2c0-7b00-7000-9000-000000000006"
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
  - "concurrency"
  - "bind"
---

# Holdout episodic: race on shared port variable

The local proxy used a non-atomic shared variable to pick a free port.
Two threads could each observe the same value and try to bind it.

Resolution: switch to an atomic type and use the
compare-and-swap primitive to claim a port.
