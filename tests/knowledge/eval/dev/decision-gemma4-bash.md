---
# SPDX-License-Identifier: MIT
# Copyright (c) 2026 Unifia contributors
unifia_schema: 1
unifia_id: "0190d2c0-7b00-7000-8000-000000000001"
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
  - "model:gemma-4"
  - "tool:bash"
---

# Decision: patch tool/bash.ts for Gemma-4 schema

Gemma-4 E4B sends `dry_run` instead of the required `description` field
in the bash tool schema. The patch must:

- render `description` mandatory in the JSON schema ;
- silently ignore `dry_run` to avoid 5+ retries on `cargo check` /
  `cargo build`.

Owner: `packages/unifia/src/tool/bash.ts`.
Source: failure catalogue entry, audit cycle 2026-04.
