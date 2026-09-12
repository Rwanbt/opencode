<!-- SPDX-License-Identifier: MIT -->

---
project: opencode
type: contract
tags: [unifia, performance, measurement, canonical-source, single-source-of-truth]
summary: "Contrat canonique de mesure des performances Unifia. Source de vérité unique pour toute métrique citée dans le programme. Carte A00."
created: 2026-08-24
updated: 2026-08-24
supersedes: [PERFORMANCE_REPORT.md, docs/perf-baselines/baseline.md]
related: [[Unifia/Plan-Optimisation-Performance-2026-08-23]], [[Unifia/Runbook-MiniMax-M3-Optimisation-Performance-2026-08-24]], [[Unifia/Execution-Optimisation-Performance-State]]
---

# Measurement contract — Unifia performance program

> **Statut : READY (carte A00). Source canonique unique pour toute métrique de performance.**
>
> Ce document est l'autorité pour les règles de mesure. Les estimations et
> mesures existantes dans `PERFORMANCE_REPORT.md` et `docs/perf-baselines/baseline.md`
> restent visibles mais ne sont **pas** des sources de vérité tant qu'elles ne
> sont pas promues par un artefact du harnais conforme à §3.

## 1. Hiérarchie d'autorité

1. `AGENTS.md` du checkout (racine ou package) ;
2. plan maître performance (`Plan-Optimisation-Performance-2026-08-23.md`) ;
3. **ce contrat de mesure** ;
4. artefacts de harnais versionnés (`docs/perf-baselines/measurements/*.json`) ;
5. `PERFORMANCE_REPORT.md` (legacy, pointage uniquement) ;
6. `docs/perf-baselines/baseline.md` (legacy, pointage uniquement).

Toute contradiction entre un document legacy et un artefact conforme à §3 est
tranchée en faveur de l'artefact.

## 2. Source canonique

- **Type** : artefact JSON versionné, un fichier par scénario.
- **Chemin** : `docs/perf-baselines/measurements/<scenario>.<yyyymmdd>.<short-sha>.json`.
- **Schéma** : défini par `scripts/perf/schema.mjs` (carte A01) ; un fichier
  non conforme au schéma est **rejeté** et ne peut être cité.
- **Générateur** : scripts `scripts/perf/bench-*.ps1` et `scripts/perf/compare.mjs`
  (cartes A02, A03). Aucun chiffre n'est accepté en dehors d'un artefact généré
  par ces scripts.

## 3. Champs obligatoires d'une métrique

Toute métrique citée dans le programme doit comporter :

| Champ        | Description                                                                |
|--------------|----------------------------------------------------------------------------|
| `source`     | script + identifiant de scénario (ex. `bench-startup.cold.v1`)             |
| `commit`     | `git rev-parse HEAD` au moment de la mesure                                 |
| `machine`    | hostname, OS, CPU, RAM, GPU                                                 |
| `toolchain`  | versions Bun, Rust, Cargo, Tauri, WebView                                   |
| `N`          | nombre de runs (≥5, conforme au plan §5 P0-A)                               |
| `variance`   | médiane et p95, plus variance documentée (cf. plan §5 P0-A)                |
| `timestamp`  | ISO 8601 UTC                                                                |
| `artifact`   | chemin relatif du JSON source                                               |

Une métrique qui omet un champ n'est pas une mesure. Elle doit être marquée
`[ESTIMATE]` conformément à §4.

## 4. Estimations vs mesures

- **Mesurée** : tous les champs de §3 sont présents et l'artefact JSON existe.
- **Estimée** : un ou plusieurs champs manquent, ou l'artefact n'existe pas.

Toute estimation doit être étiquetée :

```text
[ESTIMATE — <raison courte>]
```

Raisons acceptées (non exhaustif) :

- `provenance absente` — la source du chiffre n'est pas documentée ;
- `N<5` — nombre de runs insuffisant pour un verdict de régression ;
- `pas de harnais mobile` — scénario non encore couvert par le harnais ;
- `commit non capturé` — la mesure n'est pas reproductible bit-à-bit ;
- `machine non fingerprintée` — la mesure dépend d'un hardware non identifié.

Une estimation **ne peut pas** servir de seuil de non-régression. Pour devenir
un seuil, elle doit être promue en mesure par re-exécution du harnais.

## 5. Règle de retrait

- Quand une métrique est remplacée par une mesure conforme, l'estimation est
  soit supprimée, soit déplacée dans une section `## Deprecated` clairement
  étiquetée qui n'apparaît pas dans la vue par défaut du document.
- Aucune métrique n'est effacée en silence. Le retrait est tracé dans
  l'état d'exécution (`Execution-Optimisation-Performance-State.md`).
- Un `[DEPRECATED — moved to measurements/<scenario>.<date>.<sha>.json]`
  doit remplacer l'estimation, avec lien vers l'artefact.

## 6. Contrat de pointage (legacy)

- `PERFORMANCE_REPORT.md` et `docs/perf-baselines/baseline.md` commencent
  chacun par un bandeau pointant vers ce document.
- Toute métrique citée dans ces fichiers appartient à exactement l'une des
  trois catégories :

  | Code | Catégorie                                                         | Source d'exécution requise |
  |------|-------------------------------------------------------------------|-----------------------------|
  | (a)  | Référence code (file:line) — pas une mesure                       | non                         |
  | (b)  | Estimation étiquetée `[ESTIMATE — <raison>]`                      | non                         |
  | (c)  | Mesure conforme à §3 avec lien vers son artefact JSON             | oui                         |

Aucune autre catégorie n'est acceptée. Une ligne qui ne rentre dans aucune
des trois doit être étiquetée ou déplacée en `## Deprecated`.

## 7. Garde-fous

- Une régression ne peut être déclarée qu'à partir d'une mesure conforme à §3.
- Un seuil de CI ne peut être défini qu'à partir d'une mesure conforme à §3.
- Une optimisation n'est acceptée que si elle s'accompagne d'un avant/après
  sur la même machine, même commit de toolchain, et variance documentée.
- Le seuil de non-régression par défaut est `+X %` sur p95, où `X` est
  calibré par la gate `G1` (baseline) puis affiné lot par lot. Aucune
  optimisation n'est acceptée avec un seuil inventé.

## 8. Cycle de vie et suites

- **A00 (cette carte)** pose le contrat et marque les sources legacy.
- **A01** fige le schéma JSON et les scénarios.
- **A02** produit le sampler de processus Windows (read-only).
- **A03** orchestre cold/warm/idle et préserve les artefacts.
- **G1 (baseline)** exige un artefact conforme à §3 avec N≥5, variance et
  contrôle négatif ; sans quoi la gate n'est pas franchie.
- À chaque promotion d'estimation en mesure, l'artefact est référencé dans
  `docs/perf-baselines/measurements/INDEX.md` (créé en A03).

---

*Ce contrat est modifié par cartes successives. Toute évolution est consignée
dans l'état d'exécution append-only.*
