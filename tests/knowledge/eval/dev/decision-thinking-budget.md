---
# SPDX-License-Identifier: MIT
# Copyright (c) 2026 Unifia contributors
unifia_schema: 1
unifia_id: "0190d2c0-7b00-7000-8000-000000000004"
unifia_type: "decision"
unifia_lifecycle: "active"
unifia_created_at: "2026-08-29T00:00:00Z"
unifia_updated_at: "2026-08-29T00:00:00Z"
unifia_project_ref: "unifia"
unifia_supersedes: ["0190d2c0-7b00-7000-8000-000000000010"]
unifia_restrictions:
  remote_model: allow
  local_model: allow
unifia_tags:
  - "model:qwen"
  - "model:deepseek"
  - "reasoning"
---

# Decision: thinking-mode token budget per model

`getThinkingCap()` returns:

- 8192 tokens for Qwen / DeepSeek thinking models ;
- 2048 tokens by default ;
- 0.15 of the model output max as a fraction fallback.

The previous cap of 1024 (decision-bad-1024) is superseded.
