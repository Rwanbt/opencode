<!-- SPDX-License-Identifier: MIT -->
<!-- Copyright (c) 2026 Unifia contributors -->

# M0 Windows Preflight — UNIFIA AUTOMATE V2.3.1

> Source normative : `docs/adr/ADR-000-DURABLE-EXECUTION-SUBSTRATE-M0-FROZEN.md`
> §29 (Windows preflight) + §20 (output obligatoire).

Ce document mesure la capacité du candidat à tourner sur Windows
natif, pas uniquement WSL/Linux. La cible première du plan V2.3.1
est `Automate Core × local-single-node × Windows` (plan §1-§2).

## 1. Environnement de test

| Élément | Valeur mesurée | Notes |
|---|---|---|
| OS | `Windows v.win11_dt` | Bun 1.3.14 internal build |
| Bun | `1.3.14 (0d9b296a)` | runtime TS/JS |
| Node | `v22.15.1` | disponible mais non utilisé pour la qualification M0 |
| `go` toolchain | **ABSENT** | `command -v go` → empty ; `D:/App/Go` n'existe pas |
| `sqlite3` CLI | **ABSENT** | `command -v sqlite3` → empty |
| Python | `3.x` (Microsoft Store) | utilisé pour le parser de log |
| `gh api` (GitHub) | disponible | pas exécuté par Mavis (admin externe) |

## 2. UNIFIA_NATIVE — exécution sur Windows natif

| Critère | Résultat | Évidence |
|---|---|---|
| SQLite locking (single-writer) | OK | bun:sqlite 1.3.14 single-writer OK |
| Second process/connection (in-process) | OK | `M0_RESULTS_UNIFIA_NATIVE.json` FC-14 PASS |
| Authority restart | OK | `forceProcessCrash` + `reopen` passent, le store est réouvert |
| File replacement | OK | `restoreBackup` recopie `live.sqlite` + supprime `-wal`/`-shm` |
| Backup/restore | OK | `createBackup` produit `backups/<handle>.sqlite` cohérent |
| Process termination/reopen | OK | voir `native-sqlite.ts::forceProcessCrash` |
| Packaging (binaire distribué) | N/A pour bun:sqlite | voir PACKAGING_RESULTS.md |
| Paths Windows (long/Unicode) | Non testé en M0 (dossier temp) | à challenger en PRE-1.1 |
| Timezone | UTC (par défaut) | `Date.now()` cohérent cross-runs |

## 3. DBOS_GO_SQLITE — exécution sur Windows natif

**STATUT : NOT EXECUTED.** Voir `M0_EXPECTED_NA_DBOS_GO.json` (à
produire) et le code source `adapters/dbos-go.ts` pour la liste
complète des méthodes qui throw `BlockedExecution`.

La qualification DBOS Go exige :
1. Installation de Go ≥ 1.22 sur la machine hôte
2. `go mod init && go mod tidy` dans un sous-package DBOS Go
3. Implémentation Go du contrat (équivalent des tables SQLite du
   candidat Native)
4. HTTP/REST IPC implémenté (cf. `DBOS_GO_IPC_SKETCH` dans le
   code)

## 4. Substrate driver : pivot M0 vers `bun:sqlite`

Le driver initialement prévu (`better-sqlite3 13.0.3`) provoque un
crash NAPI FATAL ERROR sur Bun 1.3.14 Windows (vérifié
2026-09-03 21:30 CEST). Pivot M0 env : `bun:sqlite` (Bun built-in).

**Note production** : le kernel natif production peut utiliser
`better-sqlite3` (N-API stable sur Node 22.15.1) ou un autre driver
qui satisfait le même contrat SQLite. Le M0 ne tranche pas.

## 5. Verdict

UNIFIA_NATIVE est **exécutable sur Windows natif** en M0
qualification. Tous les P0 tests dans `M0_RESULTS_UNIFIA_NATIVE.json`
sont PASS ou BLOCKED avec documentation (FC-25).

DBOS_GO_SQLITE est **NOT EXECUTED** sur cette machine (Go toolchain
absent). À débloquer en environnement Go-équipé.

## 6. Actions externes

Aucune action distante GitHub (D-04, voir
`docs/automation-v2/certification/gates.yaml` mise à jour).

## 7. Source

- `docs/adr/ADR-000-DURABLE-EXECUTION-SUBSTRATE-M0-FROZEN.md` §29
- `docs/automation-v2/m0/BASELINE.md`
- `docs/automation-v2/m0/M0_RESULTS_UNIFIA_NATIVE.json`
- `docs/automation-v2/m0/M0_EXPECTED_NA_UNIFIA_NATIVE.json`
- `packages/automate-m0-harness/src/qualification/adapters/native-sqlite.ts`
