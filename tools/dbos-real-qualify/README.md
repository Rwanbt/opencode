<!--
SPDX-License-Identifier: MIT
Copyright (c) 2026 Unifia contributors

Derived from https://github.com/Rwanbt/unifia@3bf597d629500a1064d63a1c4a61e45094ccf4e2
Original path: tools/dbos-real-qualify/README.md
Original license: MIT
Original copyright: Unifia contributors

Modifications: staged for the A2 M0 qualification slice.
Responsible: hermes-agent@local.invalid
-->

# dbos-real-qualify — Real DBOS_GO_SQLITE candidate

**This is the REAL DBOS candidate.** It uses
`github.com/dbos-inc/dbos-transact-golang@v1.0.0` Conductor APIs
on the measured path:

- `dbos.NewContext` (via `Config` + `dbos.NewContext`)
- `dbos.RegisterWorkflow` (the qualification workflow)
- `dbos.RunAsStep` (durable steps inside the workflow)
- `Launch()` (start the runtime)
- Real recovery: re-opening a fresh `dbos.NewContext` against
  the same `M0_STORE_DIR/dbos.db` re-runs pending workflows.

## Architecture

The binary exposes a small HTTP/JSON control surface so the
harness (`packages/automate-m0-harness`) can drive it without
importing Go code. Internally, every operation is a registered
DBOS workflow or step:

| HTTP endpoint | DBOS primitive |
| --- | --- |
| `POST /runs` | starts a `StartRun` workflow (3 durable steps) |
| `GET /runs/:id` | reads DBOS system DB via the `dbos.Client` |
| `POST /runs/:id/invocations/:liId/attempts` | starts a `DriveAttempt` workflow |
| `POST /recover` | creates a fresh context + runs `recoverPendingWorkflows` |
| `GET /healthz` | liveness (HTTP only) |
| `GET /version` | build info (no DBOS primitive) |

The **M0 contract** (per
`packages/automate-m0-harness/src/qualification/contract.ts`) is
preserved so the substrate-neutral harness does not change.

## DBOS evidence attribution

The candidate's `provenance.executionSubstrate` is
`DBOS_GO_V1` and `provenance.realDbosApisUsed` is `true`. The
harness-side `provenance.providedBy` breakdown is:

```json
{
  "workflowDurability": "DBOS",
  "workflowRecovery":   "DBOS",
  "systemPersistence":  "DBOS_SQLITE",
  "fencing":            "UnifiaAdapter",
  "effectPolicy":       "UnifiaAdapter"
}
```

The Unifia adapter still owns the **fencing / effect policy**
decisions (consistent with the rest of the harness). DBOS owns
the **workflow durability / recovery / system DB**.

## Build

```bash
cd tools/dbos-real-qualify
../../.tools/go/go1.25.12/bin/go build -buildvcs=false -o dbos-real-qualify.exe .
```

## Run

```bash
M0_STORE_DIR=./my-store \
../../.tools/go/go1.25.12/bin/go run . serve
```

The server binds 127.0.0.1 on an ephemeral port, prints the
address on stdout, and exits cleanly on SIGTERM.
