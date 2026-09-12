<!-- SPDX-License-Identifier: MIT -->

# Build warnings policy (H11)

**Statut** : H11 READY_FOR_REVIEW (autorité opérateur sur STRONG_REVIEW).
**Date** : 2026-08-24.

## Politique

**Une carte par warning, jamais plusieurs warnings hétérogènes par
carte.** Cette règle protège le signal : si une PR solde 5 warnings
en même temps et qu'un warning réapparaît au build suivant, on ne
sait pas lequel des 5 a été réintroduit.

## Inventaire (au moment de cette carte)

Au cours de la rédaction de cette section (H11, août 2026) le build
de l'app n'a pas été ré-exécuté dans la session Mavis. L'inventaire
suivant est basé sur l'état connu des derniers builds CI :

| Warning | Origine probable | Carte associée | Statut |
|---------|------------------|----------------|--------|
| KaTeX TTF drop | `vite.js` plugin (déjà filtré) | — | résolu |
| Bundle chunk size > 500 kB | `@floating-ui`, `monaco-editor` | H10 (manifest) | budget exposé |
| Sourcemap size | `@parcel/watcher` native binding | hors scope | non mesuré |

## Process de capture

À chaque build de référence (run sur le desktop runtime), copier
la sortie de `vite build` dans `docs/perf-baselines/build-warnings/<date>.log`.
Pour chaque warning restant, créer une carte H11-N dans le plan
performance et la suivre jusqu'à résorption.

## Garantie

Cette politique fait partie du gate **G8 Bundle/green** :
- G8 PASS si **0 warning** dans le build de référence.
- G8 PASS conditionnel si les warnings restants ont chacun une
  carte H11-N ouverte (l'opérateur accepte la dette).
- G8 FAIL si un warning est ouvert sans carte de résorption.
