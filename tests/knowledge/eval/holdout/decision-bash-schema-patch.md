---
# SPDX-License-Identifier: MIT
# Copyright (c) 2026 Unifia contributors
unifia_schema: 1
unifia_id: "0190d2c0-7b00-7000-9000-000000000001"
unifia_type: "decision"
unifia_lifecycle: "active"
unifia_created_at: "2026-08-29T00:00:00Z"
unifia_updated_at: "2026-08-29T00:00:00Z"
unifia_project_ref: "unifia"
unifia_supersedes: []
unifia_restrictions:
  remote_model: allow
  local_model: allow
unifia_tags:
  - "tool:bash"
  - "schema"
---

# Holdout decision: bash tool schema must be strict

The bash tool JSON schema must reject calls that omit the `description`
field. Calls that include the legacy `dry_run` key must be tolerated
but the key must be discarded before forwarding to the executor.

The goal is to keep the tool reliable on smaller instruction-tuned
models that occasionally emit unexpected fields.

Owner: `packages/unifia/src/tool/bash.ts`.
Provenance: 2026 audit catalog entry, see repo history.
