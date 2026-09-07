---
# SPDX-License-Identifier: MIT
# Copyright (c) 2026 Unifia contributors
unifia_schema: 1
unifia_id: "0190d2c0-7b00-7000-9000-000000000002"
unifia_type: "failure"
unifia_lifecycle: "active"
unifia_created_at: "2026-08-29T00:00:00Z"
unifia_updated_at: "2026-08-29T00:00:00Z"
unifia_project_ref: "unifia"
unifia_supersedes: []
unifia_restrictions:
  remote_model: allow
  local_model: allow
unifia_tags:
  - "build:android"
  - "cli:bundle"
---

# Holdout failure: mobile CLI binary embedded in APK is stale

The Tauri Android build pipeline only refreshes the bundled CLI binary
on the first compile. Subsequent rebuilds keep the previous binary
inside the APK, even when the source has changed.

Workaround: force a clean rebuild before assembling the APK. The
single source of truth for the bundling script is the project
`scripts/` directory; do not introduce a second divergent path.
