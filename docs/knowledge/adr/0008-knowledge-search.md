---
# SPDX-License-Identifier: MIT
# Copyright (c) 2026 Unifia contributors
id: KNOW-0008
title: Search strategy — FTS5 first, vector later, ANN deferred
status: ACCEPTED
date: 2026-08-29
sources:
  - plan gelé §8 P13 (No Technology By Prestige)
  - runbook V2 §8.7, §8.8 (Recherche ; Sélection embedding)
  - phase 5 (Recherche sémantique)
---

# ADR-KNOW-0008 — Search strategy

## Contexte

Trois familles de retrieval sont disponibles :

1. **Recherche textuelle** (parser + ripgrep + FTS5) ;
2. **Vector scan brute-force** (cosinus sur embeddings) ;
3. **ANN** (HNSW, IVF, ScaNN) ;
4. **Rerankers** (cross-encoder) ;
5. **Graph hints** (PageRank, communautés, traversées).

Le plan gelé §8 P13 "No Technology By Prestige" exige que
chaque technologie prouve sa valeur avant d'être adoptée. Le
runbook §8.7 tranche déjà la baseline :

> "Baseline : filesystem + parser + recherche textuelle +
> structural slicer. Phase suivante : SQLite FTS5 + métadonnées
> + liens/backlinks. Sémantique : interface `EmbeddingProvider`,
> modèle local seulement par défaut, brute-force vector scan
> derrière `VectorIndex`. ANN et reranker exclus tant qu'un
> holdout ne prouve pas un gain significatif."

## Décision

Stratégie de recherche V1 :

1. **Niveau 0 — structural** : parser + slicer + glob
   (toujours disponible, mode dégradé cold start).
2. **Niveau 1 — FTS5 + graph** : index SQLite FTS5 + table
   `links` + backlinks. Activation par défaut après premier
   build. Implémentation Phase 3.
3. **Niveau 2 — vector brute-force** : embeddings ONNX local,
   scan cosinus, pas d'ANN. Activation **conditionnelle** après
   benchmark Phase 5 : activée si `Recall@5` sur holdout
   ≥ baseline FTS5 + 10 %, `forbidden/superseded/conflict
   violation rate == 0`, `latency p95 ≤ 200 ms desktop / 600 ms
   Android`, `peak RAM ≤ 200 MiB desktop / 80 MiB Android`.
4. **Niveau 3 — ANN** : **désactivé par défaut** ; activé
   seulement si la base dépasse 50 000 notes ET le scan
   brute-force dépasse la deadline par défaut. Pas en V1
   sauf preuve.
5. **Rerankers** : **désactivés par défaut** ; pas en V1 sauf
   preuve.

Si aucun modèle ONNX admissible n'est trouvable selon le
score de sélection du runbook §8.8 (qualité holdout 50 %,
latency 20 %, peak RAM 15 %, taille 10 %, simplicité 5 %), la
recherche sémantique est **désactivée** sans backend factice,
et FTS + graph reste le produit V1.

## Alternatives rejetées

- **ANN dès le Niveau 1** : complexité injustifiée pour les
  vaults typiques (< 5 000 notes).
- **Vector DB externe** : viole l'invariant "rebuildable depuis
  A + B" et complique Android.
- **Reranker par défaut** : coût, latence, et plan gelé P13.
- **Embeddings en HTTP distant** : viole ADR-KNOW-0006
  (egress).
- **Pas de FTS5** : perd la baseline mesurable, ne peut pas
  comparer au vector.

## Conséquences

- Phase 3 livre FTS5 + graph + rebuild. C'est le minimum
  obligatoire.
- Phase 5 livre les embeddings, le vector scan brute-force,
  la fusion, et le benchmark. Le résultat du benchmark
  détermine si la sémantique est activée par défaut.
- Le ContextRouter peut demander un mode dégradé
  (`fallback.search = "fts-only"`) si la sémantique n'est
  pas activée. Le `ContextDiagnostics` indique la raison.
- `crates/unifia-knowledge-core/src/vector/` implémente
  `VectorIndex` avec un backing `BruteForce` (toujours) et
  un backing `Ann` (vide en V1).
- `E-08` du DoD vérifie l'équivalence avant/après rebuild.

## Validation

- Phase 3.2 livre le FTS5 + graph ; `E-08` vérifie la
  rebuild equivalence.
- Phase 5.3 livre le benchmark. Si la sémantique est
  désactivée, le DoD `U-03` est marqué
  `PASS_WITH_SAFE_FALLBACK`.
- L'ADR est révisable si la base dépasse 50 000 notes en
  pratique chez les early adopters ; le runbook autorise la
  révision sur preuve.
