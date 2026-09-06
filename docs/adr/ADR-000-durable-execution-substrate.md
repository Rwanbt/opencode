<!-- SPDX-License-Identifier: MIT -->
<!-- Copyright (c) 2026 Unifia contributors -->

# ADR-000 — Durable Execution Substrate (résumé non normatif)

> **STATUT DE CE FICHIER (corrigé 2026-09-03, post-review externe v1.1)**
>
> Ce fichier n'est **plus** la source normative pour ADR-000.
>
> La source canonique est :
>
> ```
> docs/adr/ADR-000-DURABLE-EXECUTION-SUBSTRATE-M0-FROZEN.md
> ```
>
> Version : `V1.1.2-E1 / IMPLEMENTATION PACK`
> Statut architecture : `FROZEN`
> Statut contrat M0 : `FROZEN`
> Statut M0 : `READY`
> **Statut substrate final : `NOT_RATIFIED`**
> **Statut M1 : `NO-GO`**
> Stratégie : `S2 — LOCAL AUTHORITY + PROFILE-SPECIFIC CERTIFIED ADAPTERS`
> Finalistes Local : `UNIFIA_NATIVE` + `DBOS_GO_SQLITE`
>
> **Règle anti-drift (post-review v1.1)** :
> en cas de contradiction entre ce fichier et le pack gelé,
> **`ADR-000-DURABLE-EXECUTION-SUBSTRATE-M0-FROZEN.md` est normatif pour M0**.

---

## 1. Rôle de ce fichier (résumé historique)

Ce fichier est l'ADR-000 "live" qui a accumulé les révisions de
consolidation 2026-09-01 → 2026-09-03. Il reste utile comme **trace
historique** des décisions et éliminations, mais la procédure M0
exigeant la comparaison `UNIFIA_NATIVE` ↔ `DBOS_GO_SQLITE` est dans
le pack gelé.

Voir le pack gelé pour :
- Les critères M0-1..M0-10 (et FC-01..FC-32, FC-31A/B, FC-13-CTRL)
- Le harness M0 substrate-neutral
- Les outputs obligatoires (M0_RESULTS_NATIVE.json, M0_RESULTS_DBOS_GO.json, etc.)
- La taxonomie des résultats (PASS / FAIL_ARCHITECTURAL / FAIL_CORRECTABLE / NOT_APPLICABLE / BLOCKED / NOT_VALID)
- Les règles de sélection finale (correctness avant TCO/ergonomie)

Voir `docs/automation-v2/spikes/M0-01-BIS-EVIDENCE.md` pour la trace
des éliminations DBOS (TypeScript), Restate, Temporal.

## 2. Statut actuel réel (2026-09-03, post-review v1.1)

| Champ | Valeur |
|---|---|
| **Statut architecture** | `FROZEN` (pack gelé) |
| **Statut contrat M0** | `FROZEN` (pack gelé) |
| **Statut M0** | `READY` (pack gelé) |
| **Statut substrate final** | `NOT_RATIFIED` (pack gelé) — pas `READY_TO_RATIFY` |
| **Statut M1** | `NO-GO` (pack gelé) — pas `GO` |
| **Finalistes Local** | `UNIFIA_NATIVE` + `DBOS_GO_SQLITE` (pas Native seul) |
| **Décideur final** | Erwan (signature) |
| **M0 proof gate SATISFIED ?** | `NON` (51/51 sont une preuve de **feasibility** du contrat, pas de sélection de substrate) |

## 3. Reclassification des 51/51 (post-review v1.1)

Les tests livrés en commits `d12bdad3dc` (contract half 36/36) et
`28e3058110` (runtime half 15/15) sont **conservés** mais reclassifiés :

| Ancien label | Nouveau label (correct) |
|---|---|
| `M0 contract half : 36/36 PASS` | `M0_CONTRACT_FEASIBILITY : PASS` (le contrat est cohérent) |
| `M0 runtime half : 15/15 PASS` | `MINIMAL_REFERENCE_SUBSTRATE : PASS` (un substrate jouet peut satisfaire les 10 critères logiques) |
| `M0 proof gate SATISFIED` | `M0 CONTRACT FEASIBILITY PROOF : PASS` (le contrat est exécutable, pas le choix de substrate) |
| `ADR-000 substrate proof complete` | **RETIRÉ** — ne s'applique pas, le substrate n'est pas sélectionné |

**Ne supprime aucun de ces tests.** Ils sont **réutilisés** dans le
M0 comparatif (harness substrate-neutral).

**`packages/automate-m0-harness/src/minimal-substrate.ts` reste
intact** mais avec une étiquette clarifiée : "reference substrate for
contract feasibility only, not a production kernel candidate".

**`gates.yaml` gate `m0_substrate_proof`** est mis à jour pour refléter
cette reclassification.

## 4. Ce qui doit maintenant être produit (M0 comparatif)

Voir le pack gelé §20 "OUTPUTS M0 OBLIGATOIRES" :

```
docs/automate/m0/BASELINE.md
docs/automate/m0/NATIVE_TOPOLOGY.md
docs/automate/m0/DBOS_ADAPTER.md
docs/automate/m0/M0_RESULTS_NATIVE.json
docs/automate/m0/M0_RESULTS_DBOS_GO.json
docs/automate/m0/M0_EXPECTED_NA_NATIVE.json
docs/automate/m0/M0_EXPECTED_NA_DBOS_GO.json
docs/automate/m0/DURABLE-SUBSTRATE-BENCHMARK.md
docs/automate/m0/PACKAGING_RESULTS.md
docs/automate/m0/RESOURCE_RESULTS.md
docs/automate/m0/WINDOWS_PREFLIGHT.md
docs/automate/m0/EXIT_NATIVE.md
docs/automate/m0/EXIT_DBOS_GO.md
docs/automate/m0/evidence/native/
docs/automate/m0/evidence/dbos-go/
```

Adapter les chemins si la topologie actuelle du repo possède déjà
une convention équivalente (ex: `docs/automation-v2/m0/`).

## 5. Pourquoi cette réconciliation

Une review externe multi-IA (2026-09-03) a identifié que :

1. Ce fichier dérivait vers "Native = SELECTED_PENDING_M0_PROOF" et
   "M0 = falsification de Native seulement", ce qui contredit le pack
   gelé qui exige une comparaison à armes égées.
2. Le pack gelé (importé tel quel 2026-09-02) est la source normative.
3. Le langage Go n'est PAS un hard eliminator (DBOS Go 1.0 est
   production-ready avec SQLite via `DatabaseURL` ou
   `SQLiteSystemDB *sql.DB`, driver pure-Go sans cgo).
4. Les 51/51 tests utilisent un `minimal-substrate.ts` qui déclare
   explicitement "not a production kernel (no concurrency, no
   persistence, no scheduler)".

## 6. Action immédiate suivante

1. **Reclassifier les 51/51** dans `gates.yaml` (m0_substrate_proof) et
   `EXECUTION_STATUS.md` (sans toucher au code des tests).
2. **Créer la structure `docs/automation-v2/m0/`** avec les outputs
   obligatoires.
3. **Implémenter `NATIVE_TOPOLOGY.md`** : choix de topologie M0 Native
   (TypeScript/Bun vs Rust vs Hybrid) avec critères ADR-006-friendly.
4. **Implémenter `DBOS_ADAPTER.md`** : DBOS Go 1.0 + SQLite,
   configuration `SQLiteSystemDB` ou `DatabaseURL`, journal_mode,
   synchronous, busy_timeout, process topology.
5. **Implémenter le harness M0 substrate-neutral** qui drive les
   deux adapters (FC-01..FC-32, FC-31A/B, FC-13-CTRL).
6. **Exécuter les early discriminating tests** (P0-1..P0-8 dans le
   pack gelé).
7. **Produire les résultats** dans `M0_RESULTS_NATIVE.json` et
   `M0_RESULTS_DBOS_GO.json`.
8. **D-02** (Approval Broker V2) en parallèle.
9. **D-04** (Git topology) en parallèle.
10. **D-05** (DK-01 DEFER + ADR-032 corrections) en parallèle.

## 7. Source normative externe

Plan maitre : `D:\Documents\Obsidian\IA_Dev_Brain\projects\unifia\roadmaps\UNIFIA-Automate-Master-Implementation-Plan-V2.3.1.md`
(SHA256 3A63FE3D2CE12E84CC47787A2B6257167F2FEC50EAB294CD125D9CFB86510815, 71 KB, 3 729 lignes)

Pack gelé : `docs/adr/ADR-000-DURABLE-EXECUTION-SUBSTRATE-M0-FROZEN.md`
(2184 lignes, importé tel quel 2026-09-02)

Branche : `agent/automate-v2-baseline-20260901`
Remote : `https://github.com/Rwanbt/unifia.git`
HEAD (post-réconciliation) : à mettre à jour après commit de ce fichier.
