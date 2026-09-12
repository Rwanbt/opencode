---
# SPDX-License-Identifier: MIT
# Copyright (c) 2026 Unifia contributors
unifia_schema: 1
unifia_id: "0190d2c0-7b00-7000-8000-000000000008"
unifia_type: "semantic"
unifia_lifecycle: "active"
unifia_created_at: "2026-08-29T00:00:00Z"
unifia_updated_at: "2026-08-29T00:00:00Z"
unifia_project_ref: "unifia"
unifia_supersedes: []
unifia_restrictions:
  remote_model: deny
  local_model: allow
unifia_tags:
  - "embedding"
  - "context"
---

# Mémoire sémantique (FR) : contexte obligatoire avant build Android

Avant toute tentative de build Android, le ContextRouter doit
hydrater :

- la contrainte SELinux sur les hardlinks ;
- la dette D-17 (bundle CLI stale) ;
- l'identifiant du device cible (Adreno 6xx vs 7xx).

Ces trois éléments ne doivent jamais être absents du contexte.
