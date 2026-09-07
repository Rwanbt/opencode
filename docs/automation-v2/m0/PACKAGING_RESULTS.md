<!-- SPDX-License-Identifier: MIT -->
<!-- Copyright (c) 2026 Unifia contributors -->

# M0 Packaging Results — UNIFIA AUTOMATE V2.3.1

> Source normative : `docs/adr/ADR-000-DURABLE-EXECUTION-SUBSTRATE-M0-FROZEN.md`
> §22 (comparison finale dimensions) + §30 (packaging).

Ce document mesure le coût packaging/runtime pour chaque candidat.
Pour la décision finale A/B/C, ces chiffres sont **secondaires**
(per pack gelé §22 : correctness > TCO/ergonomie).

## 1. UNIFIA_NATIVE — M0 qualification

| Dimension | M0 env (bun:sqlite) | Production candidate (better-sqlite3) |
|---|---|---|
| Runtime components | 1 (Bun process) | 1 (Node 22 + native module) |
| Binary/package size | ~60 MB (Bun runtime) | ~30 MB (Node + better-sqlite3) |
| Installed size | ~150 MB (Bun + deps) | ~80 MB (Node + better-sqlite3) |
| Startup time | <100 ms | <300 ms (Node cold start) |
| Idle memory | ~80 MB | ~60 MB |
| Active memory | ~150 MB (under M0 load) | ~100 MB |
| Disk writes/usage | minimal (M0 test) | à mesurer en PRE-1.1 |
| First startup | ~200 ms (Bun cold) | ~500 ms (Node cold) |
| Offline startup | OK (Bun embedded) | OK (Node + native module) |
| Shutdown | ~50 ms | ~100 ms (graceful) |
| Upgrade | Bun runtime upgrade (rare) | Node upgrade (frequent) |
| Backup | file copy (M0), VACUUM INTO (prod) | SQLite .backup API |
| Uninstall | remove Bun | remove Node + packages |

**Notes** :
- La M0 qualification utilise `bun:sqlite` (Bun built-in), pas un
  binaire de production. Le binaire production du kernel natif
  Unifia serait un binaire Node 22+ ou un sidecar Rust (à décider en
  post-M0).
- Le M0 ne construit pas de binaire. Le but est de mesurer
  l'API/contract, pas l'artefact de déploiement.

## 2. DBOS_GO_SQLITE — M0 qualification

**STATUT : NOT EXECUTED.** Voir `WINDOWS_PREFLIGHT.md` §3.

Coût packaging DBOS Go (estimé, à confirmer sur environnement
Go-équipé) :

| Dimension | DBOS Go (estimé) |
|---|---|
| Runtime components | 2 (TS harness + Go binary sidecar) |
| Binary/package size | ~30-50 MB (Go static binary) |
| Installed size | ~50-80 MB (Go binary + SQLite driver) |
| Startup time | <1s (Go) |
| Idle memory | ~50-200 MB (Go + DBOS Conductor) |
| Backup | SQLite .backup API ou DBOS checkpoint |
| Maintenance | DBOS upstream patches |
| Forkability | MIT (REQ-6 PASS) |

**Note** : DBOS Go est un sidecar dans le M0, pas un binaire
embarqué. Coût opérationnel = 2 processus à monitorer.

## 3. TCO (5-year ownership cost) — estimation qualitative

| Dimension | UNIFIA_NATIVE | DBOS_GO_SQLITE |
|---|---|---|
| Maintenance code surface | Modéré (TS/Bun) | Élevé (TS harness + Go adapter) |
| Dependency surface | Modéré (bun:sqlite ou better-sqlite3) | Élevé (TS + DBOS Go + SQLite driver) |
| Security response burden | Unifia uniquement | DBOS upstream + Unifia |
| Forkability | Excellent (MIT) | Excellent (MIT) |
| 5-year TCO | TBD (post-M0) | TBD (post-M0) |

**Pour la décision finale** : correctness > TCO/ergonomie. Les
chiffres ci-dessus sont indicatifs, pas bloquants.

## 4. Verdict M0

UNIFIA_NATIVE a un profil packaging/runtime **plus simple** (1
process, Bun embedded) que DBOS_GO_SQLITE (2 processus, Go sidecar).
**Mais** ce profil packaging seul ne justifie pas la sélection : les
M0 results (correctness, FC-31A, FC-04) sont la base de la décision.

## 5. Source

- `docs/adr/ADR-000-DURABLE-EXECUTION-SUBSTRATE-M0-FROZEN.md` §30
- `docs/automation-v2/m0/NATIVE_TOPOLOGY.md`
- `docs/automation-v2/m0/DBOS_ADAPTER.md`
- `docs/automation-v2/m0/M0_RESULTS_UNIFIA_NATIVE.json`
