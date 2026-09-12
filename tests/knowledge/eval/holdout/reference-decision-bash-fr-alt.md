---
# SPDX-License-Identifier: MIT
# Copyright (c) 2026 Unifia contributors
unifia_schema: 1
unifia_id: "0190d2c0-7b00-7000-9000-000000000007"
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
  - "outil:bash"
  - "schema"
---

# Décision (holdout) : durcir le schéma de l'outil bash

Le schéma JSON de l'outil bash doit refuser les appels qui omettent
le champ `description`. Les appels qui contiennent l'ancienne clé
`dry_run` doivent être tolérés, mais la clé est supprimée avant que
l'appel ne soit transféré à l'exécuteur.

L'objectif est de garder l'outil fiable sur les modèles de petite
taille qui émettent parfois des champs inattendus.

Owner : `packages/unifia/src/tool/bash.ts`.
