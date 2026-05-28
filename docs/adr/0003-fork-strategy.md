# ADR-0003 : Stratégie Fork — Rwanbt/opencode vs anomalyco/opencode

**Date** : 2026-05-27 | **Statut** : Accepté

## Contexte

Ce dépôt (`Rwanbt/opencode`) est un fork de `anomalyco/opencode` avec des fonctionnalités additionnelles (inference mobile on-device, Hexagon NPU, CLI toolchain, gouvernance). Comment gérer la divergence sans dette ingérable ?

## Décision

**Stratégie fork additive** :
- Upstream changes absorbés périodiquement via `git merge upstream/main`
- Nos modifications vivent dans des fichiers séparés ou des blocs clairement délimités (`// FORK:`)
- Les packages core (opencode/, sdk/) sont modifiés minimalement — préférer l'injection de comportement
- `packages/app/` est notre domaine principal — toutes les règles LOC s'y appliquent strictement
- La gate CI LOC est scopée à `packages/app/src/` uniquement

## Upstream debt

Les fichiers suivants dépassent 1500 LOC dans les packages upstream mais sont hors scope du gate :
- `packages/opencode/src/session/prompt.ts` (2085 LOC)
- `packages/opencode/src/lsp/server.ts` (1958 LOC)
- `packages/ui/src/components/message-part.tsx` (2268 LOC)
- *(voir `docs/loc-debt-upstream.md` pour la liste complète)*

## Conséquences

- ✅ Nos ajouts dans `packages/app/` restent < 1500 LOC
- ✅ Pas de friction avec les upstream merges
- ⚠️ Dette upstream non adressée — à traiter si contribution upstream souhaitée
