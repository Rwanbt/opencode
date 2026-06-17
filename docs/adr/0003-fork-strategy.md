# ADR-0003 : Stratégie Fork — Rwanbt/opencode vs anomalyco/opencode

**Date** : 2026-05-27 | **Statut** : Accepté | **Amendé** : 2026-06-17 (D-14, voir §Amendement)

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

## Amendement (2026-06-17, D-14)

**Constat** : un audit a trouvé **0 marqueur `// FORK:`** dans tout le dépôt
(`packages/opencode|ui|sdk`). La convention « blocs délimités `// FORK:` » de la
décision initiale n'a jamais été appliquée, ni rétroactivement ni sur les
nouveaux changements. Un retrofit complet des centaines de divergences upstream
historiques serait coûteux et à faible valeur (les conflits se résolvent de
toute façon au `git merge upstream/main`).

**Décision amendée — stratégie réelle assumée** :
1. **Priorité absolue** : ne PAS éditer les fichiers upstream. Tout nouveau
   comportement vit dans `packages/app/` (domaine fork) ou via injection
   (Host structs, callbacks, hooks) — c'est ce qui élimine vraiment la friction
   de merge, pas les commentaires.
2. **Quand un fichier upstream DOIT être modifié** (inévitable) : entourer la
   divergence d'un bloc `// FORK: <raison>` … `// END FORK` — appliqué aux
   **nouvelles** modifications à partir de maintenant, vérifié en revue. Ça
   localise le diff pour le prochain merge.
3. Les changements déjà tracés `// DEBT: D-NN` (observabilité, single-flight…)
   restent acceptables tels quels : ils documentent le POURQUOI, ce qui est
   l'objectif premier.
4. **Pas de gate CI** sur `// FORK:` (un grep bloquant créerait plus de bruit
   que de valeur tant que la base upstream-éditée est petite) — discipline de
   revue uniquement. À revoir si les edits upstream se multiplient.

Le retrofit historique est donc **explicitement hors scope** ; la convention
s'applique en avant uniquement.
