---
# SPDX-License-Identifier: MIT
# Copyright (c) 2026 Unifia contributors
unifia_schema: 1
unifia_id: "0190d2c0-7b00-7000-9000-000000000009"
unifia_type: "constraint"
unifia_lifecycle: "active"
unifia_created_at: "2026-08-29T00:00:00Z"
unifia_updated_at: "2026-08-29T00:00:00Z"
unifia_project_ref: "unifia"
unifia_supersedes: []
unifia_restrictions:
  remote_model: deny
  local_model: deny
unifia_tags:
  - "egress"
  - "classification"
---

# Contrainte (holdout FR) : classifier avant egress

Tout contenu sensible doit être classifié au moment de l'écriture
dans le vault. La classification par défaut refuse l'envoi vers un
modèle distant, et n'autorise l'envoi vers un modèle local que sur
déclassification explicite liée à un hash et à une destination.

Le `DataFlowGuard` est l'organe qui applique cette contrainte.
