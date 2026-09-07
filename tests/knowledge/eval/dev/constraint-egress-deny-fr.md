---
# SPDX-License-Identifier: MIT
# Copyright (c) 2026 Unifia contributors
unifia_schema: 1
unifia_id: "0190d2c0-7b00-7000-8000-000000000009"
unifia_type: "constraint"
unifia_lifecycle: "active"
unifia_created_at: "2026-08-29T00:00:00Z"
unifia_updated_at: "2026-08-29T00:00:00Z"
unifia_project_ref: "unifia"
unifia_supersedes: []
unifia_restrictions:
  remote_model: deny
  local_model: allow
unifia_tags:
  - "egress"
  - "secret"
---

# Constraint (FR) : interdiction d'egress pour les credentials

Toute note contenant un credential (token, clé, mot de passe) doit
être marquée `unifia_restrictions.remote_model: deny` et
`unifia_restrictions.local_model: deny` si elle n'est pas
explicitement déclassifiée.

Le `DataFlowGuard` refuse l'écriture de tels contenus dans le vault
si la classification n'est pas appliquée au moment de l'écriture.
