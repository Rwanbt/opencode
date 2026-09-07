---
# SPDX-License-Identifier: MIT
# Copyright (c) 2026 Unifia contributors
unifia_schema: 1
unifia_id: "0190d2c0-7b00-7000-9000-000000000004"
unifia_type: "decision"
unifia_lifecycle: "active"
unifia_created_at: "2026-08-29T00:00:00Z"
unifia_updated_at: "2026-08-29T00:00:00Z"
unifia_project_ref: "unifia"
unifia_supersedes: ["0190d2c0-7b00-7000-9000-000000000010"]
unifia_restrictions:
  remote_model: allow
  local_model: allow
unifia_tags:
  - "tokens"
  - "thinking"
---

# Holdout decision: per-model thinking budget

Thinking-capable models receive a larger token budget than default
models. The new policy raises the thinking cap to eight thousand one
hundred ninety-two tokens for the supported families. The fallback
default is two thousand forty-eight. A fraction-based fallback is
also accepted.

The previous default of one thousand twenty-four is superseded.
