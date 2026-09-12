# Performance Baselines — Unifia

> **DOCUMENT LEGACY — superseded by [`measurement-contract.md`](measurement-contract.md) (carte A00, 2026-08-24).**
>
> Les valeurs ci-dessous sont des estimations ou mesures non fingerprintées
> (pas de commit, N<5, pas d'artefact JSON). Le contrat de mesure §3 fixe les
> champs obligatoires pour qu'une valeur soit qualifiée de *mesure* et §4 la
> raison d'être étiquetée `[ESTIMATE]`.

Référence mesurée sur la machine de développement principale (Windows 11, RTX 4090, Ryzen 9 7950X) — **non fingerprintée, voir contrat §3 et §4**.

## Budgets UI

| Opération | Budget | Mesuré | Status |
|-----------|--------|--------|--------|
| Rendu frame UI | < 16.6 ms | ~8 ms | ✅ `[ESTIMATE — N=1, machine non fingerprintée, commit non capturé]` |
| Navigation session → session | < 200 ms | ~80 ms | ✅ `[ESTIMATE — N=1, machine non fingerprintée, commit non capturé]` |
| Ouverture du chat | < 500 ms | ~150 ms | ✅ `[ESTIMATE — N=1, machine non fingerprintée, commit non capturé]` |
| Chargement des sessions | < 1 s | ~300 ms | ✅ `[ESTIMATE — N=1, machine non fingerprintée, commit non capturé]` |

## Budgets Inference (Desktop local LLM)

| Modèle | Prefill | Decode | Platform | Status |
|--------|---------|--------|----------|--------|
| Gemma-4 E4B Q4_0 | - | - | Desktop GPU (ref) | `[ESTIMATE — pas de harnais, valeurs non mesurées]` |

## Budgets Mobile (Android)

| Modèle | Prefill | Decode | Platform | Status |
|--------|---------|--------|----------|--------|
| Gemma-4 E4B Q4_0 | 36.5 tok/s | 7.81 tok/s | Xiaomi 14 Ultra (Hexagon NPU) | `[ESTIMATE — N=1, commit non capturé, machine non fingerprintée]` |
| Gemma-4 E4B Q4_0 | 16.2 tok/s | 4.87 tok/s | Mi 10 Pro (CPU) | `[ESTIMATE — N=1, commit non capturé, machine non fingerprintée]` |

## Méthodologie

- Mesures via le benchmark tab intégré (Settings → Benchmark)
- N = 3 runs, moyenne reportée
- Conditions : modèle chargé à froid, batch de 512 tokens de test

> **Note (2026-08-24)** : la méthodologie ci-dessus ne satisfait pas le contrat
> §3 (champs obligatoires : `source`, `commit`, `machine`, `toolchain`, `N`,
> `variance`, `timestamp`, `artifact`). Les valeurs restent `[ESTIMATE]` tant
> qu'elles n'ont pas été régénérées par un harnais conforme (cartes A01-A03).

## Mise à jour

Mettre à jour après toute modification du pipeline inference ou de la configuration llama-server.

> **Note (2026-08-24)** : après carte A03, ne mettre à jour ce fichier qu'en
> parallèle d'un artefact `docs/perf-baselines/measurements/<scenario>.<date>.<sha>.json`
> conforme au schéma défini par `scripts/perf/schema.mjs`.
