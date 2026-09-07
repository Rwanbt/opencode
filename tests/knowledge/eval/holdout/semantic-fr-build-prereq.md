---
# SPDX-License-Identifier: MIT
# Copyright (c) 2026 Unifia contributors
unifia_schema: 1
unifia_id: "0190d2c0-7b00-7000-9000-000000000008"
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
  - "build:android"
---

# Mémoire sémantique (holdout FR) : prérequis build Android

Avant une étape de build Android, l'agent doit recevoir dans son
contexte :

- la contrainte liée à la politique de hardlinks sur Android ;
- l'avertissement sur la dette D-17 (bundle CLI obsolète) ;
- l'identifiant du GPU cible, pour activer ou désactiver OpenCL
  selon la famille Adreno.

Ces trois éléments ne sont pas négociables.
