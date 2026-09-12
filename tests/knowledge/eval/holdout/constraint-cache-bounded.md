---
# SPDX-License-Identifier: MIT
# Copyright (c) 2026 Unifia contributors
unifia_schema: 1
unifia_id: "0190d2c0-7b00-7000-9000-000000000003"
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
  - "cache:bounded"
---

# Holdout constraint: long-lived caches must declare their eviction

Any in-process collection that grows with user activity must declare
its maximum size and an eviction policy. A plain `Set` is forbidden
for that role; the project requires a least-recently-used policy
backed by an explicit capacity and time-to-live.
