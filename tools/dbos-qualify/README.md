<!--
SPDX-License-Identifier: MIT
Copyright (c) 2026 Unifia contributors

Derived from https://github.com/Rwanbt/unifia@3bf597d629500a1064d63a1c4a61e45094ccf4e2
Original path: tools/dbos-qualify/README.md
Original license: MIT
Original copyright: Unifia contributors

Modifications: staged for the A2 M0 qualification slice.
Responsible: hermes-agent@local.invalid
-->

# DBOS Go qualification candidate

This is the M0 qualification kernel for the `DBOS_GO_SQLITE`
candidate (ADR-000 §6/§7). It is a real `dbos-transact-golang`
v1.0.0 binary that exposes the M0 substrate-neutral contract
surface over HTTP/JSON on `127.0.0.1:ephemeral`.

## Pinned versions (per pack gelé review 2026-09-03, v1.1)

| Component           | Pinned version                          | Why                     |
| ------------------- | --------------------------------------- | ----------------------- |
| DBOS Go module      | `github.com/dbos-inc/dbos-transact-golang@v1.0.0` | exact upstream release  |
| Go toolchain        | `go 1.25.12`                            | required by DBOS v1.0.0 |
| SQLite driver       | `modernc.org/sqlite v1.54.0`            | pure-Go, cgo-free       |
| `dbos-qualify.exe`  | built from this tree (NOT in git)       | build artefact          |
| Go SDK              | `.tools/go/go1.25.12/` (NOT in git)     | bootstrap artefact      |

## Source files (tracked in git)

- `main.go` — HTTP server + schema v1 SQLite + FC-04 ACK-loss → UNKNOWN_EXTERNAL_STATE
- `go.mod` — module declaration + pinned versions
- `go.sum` — module checksums (verified by `go mod verify`)
- `build.sh` / `build.ps1` — reproducible build (uses repo-local Go)
- `README.md` — this file

## Build artefacts (NOT in git)

- `dbos-qualify.exe` — built binary
- `go.sum.lock` — optional lock for offline verification
- `*.test` — test binaries
- `.dbos-stores/` — runtime state dirs

## Build (reproducible, no admin)

From the repo root, after running the repo-local Go bootstrap:

```bash
# POSIX
scripts/bootstrap-go.sh
cd tools/dbos-qualify
../../.tools/go/go1.25.12/bin/go build -buildvcs=false -o dbos-qualify.exe .

# Windows PowerShell
scripts/bootstrap-go.ps1
cd tools/dbos-qualify
..\..\.tools\go\go1.25.12\bin\go.exe build -buildvcs=false -o dbos-qualify.exe .
```

## Verify

```bash
go version          # go1.25.12 windows/amd64
go list -m github.com/dbos-inc/dbos-transact-golang  # v1.0.0
go list -m modernc.org/sqlite                        # v1.54.0
go mod verify
```

## DBOS primitive mapping (per pack gelé review 2026-09-03 §17)

| Unifia contract surface    | This binary's implementation                  | DBOS Conductor primitive used |
| -------------------------- | --------------------------------------------- | ----------------------------- |
| `startRun()`               | `POST /runs` → `INSERT runs + logical_invocations + effects` | NONE — custom SQLite table     |
| `driveAttempt()`           | `POST /attempts` → `UPDATE attempts` (incl. `ackLost: true → UNKNOWN_EXTERNAL_STATE`) | NONE — custom SQLite update    |
| `provideApproval()`        | `POST /approvals` → `INSERT approvals`        | NONE — custom SQLite table     |
| `resolveApproval()`        | `POST /approvals/:id/resolve` → `UPDATE approvals` | NONE — custom SQLite update    |
| `scheduleTimer()`          | `POST /timers` → `INSERT timers`              | NONE — custom SQLite table     |
| `forceProcessCrash()`      | `POST /admin/crash` → exit(1)                 | NONE — process.exit            |
| `reopen()`                  | (driven by the harness: spawn fresh process)  | NONE — process restart         |
| `backup/restore`           | `POST /admin/backup`, `POST /admin/restore`   | NONE — SQLite file copy        |
| `candidateInfo()`          | `GET /version`                                | NONE — hand-rolled JSON        |
| `diagnostics()`            | `GET /diagnostics`                            | NONE — hand-rolled SQL         |

**Honest disclosure (per pack gelé review 2026-09-03 §17)**: this binary
depends on `github.com/dbos-inc/dbos-transact-golang` v1.0.0 (per
`go.mod`) and the `dbos` package is imported (per `import _ "..."` in
`main.go`), but the M0 surface — startRun, driveAttempt, provideApproval,
scheduleTimer, etc. — is implemented via custom SQLite tables, NOT via
DBOS Conductor primitives (DBOS `Workflow`, `Step`, `SetWorkflowID`,
`GetWorkflow`, `CreateWorkflow`, etc.). The DBOS package init registers
background goroutines that the binary does not use.

For the M0 substrate comparison, this means:

- FC-31A / FC-31B / FC-04 / FC-32 results from this binary measure
  the *SQLite+HTTP* surface, not the *DBOS Conductor* surface. The
  binary name "DBOS_GO_SQLITE" is therefore aspirational; the M0
  benchmark treats it as `DBOS_GO_SQLITE_AS_CANDIDATE_KERNEL`.

- To actually exercise the DBOS Conductor semantics, the binary
  would need to be rewritten to map Unifia `startRun` →
  `dbos.CreateWorkflow`, `driveAttempt` → `dbos.RunStep`, etc.
  This is a larger refactor and is OUT OF M0 SCOPE per the
  ADR-000 frozen contract (the candidate's M0 surface is
  intentionally minimal).

- For ADR-000 final ratification, Erwan must decide whether the
  candidate "uses DBOS in production paths" is REQUIRED. The
  current binary does not. The M0 evidence reflects this honestly.

## How M0 runs this binary

The harness (`packages/automate-m0-harness/src/qualification/
adapters/dbos-go.ts`) spawns this binary with `M0_STORE_DIR=<tmp>`
and a random free port, polls `/healthz` for readiness, then drives
the M0 P0 set (FC-31A, FC-31B, FC-04, FC-32) over HTTP/JSON.

`scripts/run-m0-qualification.ts` runs the canonical production
qualification and writes the result to
`docs/automation-v2/m0/M0_RESULTS_DBOS_GO_SQLITE.json`.

## See also

- `docs/adr/ADR-000-DURABLE-EXECUTION-SUBSTRATE-M0-FROZEN.md`
  (frozen contract)
- `docs/automation-v2/m0/DBOS_ADAPTER.md` (IPC sketch)
- `docs/automation-v2/m0/M0_RESULTS_DBOS_GO_SQLITE.json`
  (canonical results)
