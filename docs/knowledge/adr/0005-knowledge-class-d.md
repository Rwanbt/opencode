---
# SPDX-License-Identifier: MIT
# Copyright (c) 2026 Unifia contributors
id: KNOW-0005
title: Class D — Derived state (reconstructible)
status: ACCEPTED
date: 2026-08-29
sources:
  - plan gelé §12 (Class D — Derived State)
  - runbook V2 §8.1
  - ADR 1030 (Migration, rollback, dérive SDK)
---

# ADR-KNOW-0005 — Class D Derived State

## Décision

La **Class D** est entièrement dérivée de Class A + Class B.
Elle est **jetable et reconstructible** par construction.

Contenu de Class D :

- `derived.db` (SQLite, Drizzle ORM) : index FTS5, table
  `chunks`, table `links`, table `embeddings`, table
  `index_state`.
- caches LRU de retrieval.
- caches de parser (résultats de parse CommonMark par hash).
- snapshots d'embedding (versionnés par modèle + content hash).

Garanties :

- `rm derived.db && rebuild` ⇒ aucun résultat de recherche
  modifié (test de régression Phase 3).
- La Class D n'est jamais commitée dans Git
  (`.gitignore` la couvre, mais c'est une garantie logique
  : la Class D ne porte aucune connaissance qui n'est pas
  dans A + B).
- Le rebuild est **cancellable** (Admin Task avec progress).
- Le rebuild est **borné** en temps (deadline) et en espace
  (max size).
- En cas de cold start avec `derived.db` corrompue, le système
  démarre en **mode dégradé utilisable** (recherche textuelle
  brute via parser + glob) et lance un rebuild background.

## Alternatives rejetées

- **Stocker Class D dans le vault** : viole P4 "Derived Is
  Disposable" et grossit le repo Git pour rien.
- **Stocker Class D en mémoire pure** : impossible à reconstruire
  sans un cache persistant, et la latence du cold start serait
  inacceptable.
- **Stocker Class D dans une vector DB externe** : viole
  l'invariant "rebuildable depuis A + B" et complique
  l'Android.
- **Stocker Class D dans un format custom non-SQLite** : viole
  l'ADR 1030 qui impose Drizzle/Bun SQLite.

## Conséquences

- L'ADR 1030 s'applique directement : migrations Drizzle
  timestampées, première migration additive, rollback manuel
  documenté.
- `crates/unifia-knowledge-core/src/derived/` est le module
  propriétaire de Class D ; il dépend uniquement de Class A
  (fichiers Markdown) et Class B (sidecar portable).
- Le rebuild est testé par
  `crates/unifia-knowledge-core/tests/rebuild_equivalence.rs`
  qui compare les résultats de recherche avant suppression
  et après rebuild (Phase 3).
- En Android, le rebuild cold start est borné par la RAM
  disponible (mobile profile : 30 s pour 1000 notes).

## Validation

- Phase 3.1 livre le schéma Drizzle.
- Phase 3.2 livre FTS5 + graph + rebuild.
- Le test de rebuild est `E-08` du DoD.
