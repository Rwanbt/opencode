---
# SPDX-License-Identifier: MIT
# Copyright (c) 2026 Unifia contributors
unifia_schema: 1
unifia_id: "0190d2c0-7b00-7000-8000-000000000007"
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
  - "patch"
---

# Décision : patcher `tool/bash.ts` pour Gemma-4

Gemma-4 E4B envoie `dry_run` au lieu du champ `description` requis
dans le schéma JSON du tool bash. Le correctif rend `description`
obligatoire et ignore `dry_run` silencieusement pour éviter 5+
relances identiques sur `cargo check` / `cargo build`.

Owner : `packages/unifia/src/tool/bash.ts`.
Source : entrée du catalogue d'échecs, audit d'avril 2026.
