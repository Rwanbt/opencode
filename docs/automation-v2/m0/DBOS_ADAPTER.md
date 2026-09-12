<!-- SPDX-License-Identifier: MIT -->
<!-- Copyright (c) 2026 Unifia contributors -->

# M0 DBOS Go Adapter — UNIFIA AUTOMATE V2.3.1

> Source normative : `docs/adr/ADR-000-DURABLE-EXECUTION-SUBSTRATE-M0-FROZEN.md`
> §7 (règles de qualification DBOS Go) + §20 (DBOS_ADAPTER.md obligatoire).
>
> Ce fichier EST UNE CANDIDATURE. Il ne pré-sélectionne pas DBOS Go.
> Le M0 comparatif (Native vs DBOS Go) tranchera.

---

## 1. Contexte

DBOS_GO_SQLITE est l'un des deux finalistes du M0 comparatif (avec
UNIFIA_NATIVE). L'autre candidat est documenté dans
`docs/automation-v2/m0/NATIVE_TOPOLOGY.md`.

**Critique v1.0 → v1.1** : la version initiale du document de
review a incorrectement présenté DBOS Go comme "éliminé". La
réalité (per pack gelé + M0-01-BIS §7.2) est :

- DBOS Go est **NOT_QUALIFIED — REQUIRES_PACKAGING_EVALUATION**
- DBOS Go 1.0 est production-ready avec API publique stable
- DBOS permet SQLite via `DatabaseURL` ou `SQLiteSystemDB *sql.DB`
- Le driver SQLite est **pure-Go sans cgo** (pas de dépendance C)
- Le langage Go **n'est PAS un hard eliminator** (per pack gelé §7)

## 2. DBOS Go — caractéristiques techniques

### 2.1 Version cible (pinned, per pack gelé review 2026-09-03)

```
DBOS Go    : github.com/dbos-inc/dbos-transact-golang@v1.0.0
Go         : go1.25.12  (toolchain go1.25.0)
SQLite dep : modernc.org/sqlite v1.54.0  (upstream pinned dependency)
```

**Note** : les versions antérieures (Go 1.22.0, modernc.org/sqlite
v1.34.5) étaient matériellement incorrectes. La source upstream
pinnée pour `dbos-transact-golang@v1.0.0` exige Go 1.25.x.

**Note importante** : le harness n'invente pas ces versions ; elles
proviennent des `go.mod` / `go.sum` du repo DBOS Go à la release
pinned. Toute déviation doit être justifiée mécaniquement.

### 2.2 SQLite configuration (per pack gelé §7)

À documenter dans ce fichier (et dans M0_RESULTS_DBOS_GO.json) :

| Paramètre | Valeur recommandée | Justification |
|---|---|---|
| `DatabaseURL` ou `SQLiteSystemDB` | `SQLiteSystemDB *sql.DB` (préféré) | Contrôle explicite du *sql.DB |
| `journal_mode` | `WAL` | Concurrence read/write |
| `synchronous` | `NORMAL` (ou `FULL` pour M0) | Durabilité vs performance |
| `busy_timeout` | `5000` (5 secondes) | M0 strict, à challenger post-M0 |
| `foreign_keys` | `ON` | Intégrité référentielle |
| `temp_store` | `MEMORY` | Performance |
| `cache_size` | À mesurer (default 2000 KB) | RAM vs hit rate |
| Connection count | À mesurer (start 1, max ?) | Concurrence |
| Checkpoint strategy | `auto` (SQLite default) ou manuelle | WAL checkpointing |
| Backup strategy | SQLite `.backup` API | Online backup |

### 2.3 Process topology

```
DBOS Go process (single binary, statically linked)
  |
  +-- SQLite database (file-based, WAL)
  |
  +-- IPC API (HTTP or gRPC) → Unifia host
```

**Choices** :

- **Single instance par workspace** : un process DBOS Go par
  Workspace (isolation scope)
- **Shared instance multi-workspace** : un process DBOS Go partagé
  (OwnershipScope-based filtering)
- **Pool d'instances** : N processes derrière un load balancer

Pour M0 qualification : **single instance par workspace** est le
plus simple à tester (FC-14 multi-process explicite).

### 2.4 IPC topology

Options :

- **HTTP/REST** : simple, debuggable, overhead ~1ms
- **gRPC** : binary, schemed, overhead ~0.1ms
- **Unix socket** : zéro overhead réseau, mais pas remote-ready
- **Embedded in-process** : FFI Go ↔ TS (cgo), zéro overhead

Pour M0 qualification : **HTTP/REST** est le plus simple à tester
depuis le harness TypeScript.

## 3. Architecture DBOS Go M0

```
DBOSGoQualificationAdapter (TypeScript harness driver)
   |
   +-- HTTP client → DBOS Go process
   |
   +-- DBOS Go process (Go 1.22+, binary)
        |
        +-- DBOS Conductor (workflow orchestration)
        |
        +-- DBOS Tables (workflows, steps, events)
        |
        +-- SQLite database (file-based)
        |
        +-- Step retry/timeout/cancellation
        |
        +-- Approval Broker (custom, V2 spec)
        |
        +-- Capability enforcement (custom, ADR-024 wrapper)
```

## 4. Composants M0 DBOS Go

Pour atteindre les 10 critères M0 :

1. **Workflow identity** : DBOS `WorkflowID` (UUID)
2. **Step effect ledger** : DBOS `steps` table (append-only)
3. **Step idempotency** : DBOS built-in via `Step()` API
4. **Fencing tokens** : DBOS Conductor fencing (built-in)
5. **Approval state** : DBOS `SetWorkflowState` / `GetWorkflowState`
   + custom Approval Broker V2
6. **Capability enforcement** : custom middleware
7. **Canonical value persistence** : DBOS `Get` / `Set` (typed)
8. **Host adapter** : custom FC-31B (DBOS stocke via Go types)
9. **Timer model** : DBOS `Sleep` (durable timer)
10. **Cancellation** : DBOS `CancelWorkflow`
11. **Retry / reconciliation** : DBOS built-in

## 5. Ce que la qualification M0 DBOS Go doit prouver

Per pack gelé §7 :

```
Can DBOS Go be packaged,
started,
stopped,
upgraded,
backed up,
monitored,
and operated
as an Unifia-managed native component?
```

**Critères mesurables** :

- **Packaging** : binaire statique, taille, deps, signature
- **Startup** : time-to-ready, ressources
- **Stop** : graceful shutdown, in-flight workflow handling
- **Upgrade** : rolling upgrade support (DBOS Conductor)
- **Backup** : SQLite backup online, PITR
- **Monitoring** : metrics export (Prometheus?), traces
- **Operation** : systemd service, Windows service, logs

## 6. Livrables (per pack gelé §20)

- `docs/automate/m0/M0_RESULTS_DBOS_GO.json` (à venir)
- `docs/automate/m0/M0_EXPECTED_NA_DBOS_GO.json` (à venir, déclaratif)
- `docs/automate/m0/EXIT_DBOS_GO.md` (à venir, stratégie de sortie)
- `docs/automate/m0/evidence/dbos-go/` (logs, traces, sqlite dumps)

## 7. Risques spécifiques DBOS Go (per pack gelé §22)

- **Determinism burden** : DBOS rejoue le workflow sur recovery
  (FC-32). Si le workflow contient des sources de non-déterminisme
  (time, random, ordering), DBOS impose des contraintes.
- **Dependency surface** : DBOS Go + SQLite + HTTP server + monitoring
- **Security response** : DBOS upstream patches
- **Forkability** : DBOS est MIT (REQ-6 PASS), fork possible
- **Exit strategy** : export SQLite + workflow state, puis migration
  vers autre substrate (e.g. Native)

## 8. Substrate cross-cutting concerns (pack gelé §22)

| Dimension | DBOS Go | Notes |
|---|---|---|
| Operational simplicity | Bon (Go binary + SQLite) | systemd/Windows service |
| Windows integration | Bon (Go cross-compile) | musl ou mingw |
| Packaging | Bon (single binary) | ~20-50 MB |
| Startup | Très bon (<1s) | À mesurer M0 |
| Memory | Modéré (~50-200 MB) | À mesurer M0 |
| Disk | Modéré (SQLite WAL) | À mesurer M0 |
| Upgrade | Moyen (rolling upgrade DBOS Conductor) | Documentation |
| Backup | Bon (SQLite backup API) | Online, PITR |
| Future mobile path | Faible (Go → Android/iOS possible mais lourd) | DBOS Go est server-side |
| Determinism burden | Élevé (workflow replay constraints) | ADR-002 implications |
| WorkflowIR constraints | Implicites (DBOS workflow model) | Documentation |
| Maintained code surface | DBOS + custom adapter | ~500-1000 LOC Go |
| Dependency surface | Go stdlib + DBOS + SQLite driver | modéré |
| Security-response burden | DBOS upstream | à évaluer |
| Forkability | Excellent (MIT) | Possible |
| 5-year ownership cost | Modéré | DBOS mature |

## 9. Ce que cette topologie ne prétend PAS

- **DBOS Go n'est pas présélectionné sur Native.**
- **Le choix de topologie IPC (HTTP) est réversible** post-M0.
- **DBOS Go ne contourne pas les invariants FC-01..FC-32.**
- **DBOS Go n'est pas un hard pass** — il doit prouver chaque
  invariant avec le harness substrate-neutral.

## 10. Source

Pack gelé : `docs/adr/ADR-000-DURABLE-EXECUTION-SUBSTRATE-M0-FROZEN.md`
Baseline : `docs/automation-v2/m0/BASELINE.md`
NATIVE_TOPOLOGY.md : `docs/automation-v2/m0/NATIVE_TOPOLOGY.md`
M0-01-BIS §7.2 : `docs/automation-v2/spikes/M0-01-BIS-EVIDENCE.md`
DBOS Go upstream : https://github.com/dbos-inc/dbos-transact-go
