<!--
SPDX-License-Identifier: MIT
Copyright (c) 2026 Unifia contributors
-->

# Automate Promotion Slices

This plan stages Automate only onto `origin/work-design`. It does not merge,
rebase, push to, or create promotion branches from `dev`. Each slice is a
stacked review branch; it must pass its own stated checks before the next
slice is prepared. No PR is opened or merged until the whole repaired stack
is green.

## Source Snapshot

- Base: `origin/work-design` at `1bbbe6a614d90f1208e834767a2e28184cf0253c`.
- Source: `origin/agent/automate-v2-baseline-20260901` at
  `0a892f5b105b692d004137b6903f9a3fa12f4c77` (includes the #47 production
  assembly and the A3 contract alignment; pushed 2026-09-06).
- The source is a fast-forward descendant of the base. All slice branches
  below are pushed to `origin` for review; nothing is merged.

## Review Order (actual slice ownership, as built)

| Slice | Responsibility | Contains | Required checks |
|---|---|---|---|
| A1 | Contract base | `packages/contracts` core (scopes, digests, timers, IR split, run, map-key, graph) + direct tests | contracts `145/145`, typecheck |
| A2 | Qualification + substrate decision | `packages/automate-m0-contract`, `packages/automate-m0-harness`, `tools/dbos-*`, M0 evidence, ADR-000 | m0-contract `177/177`, harness `39 pass 13 skip`, typechecks |
| A3-r1 | Durable runtime core | `packages/workflow-runtime`, `packages/expression-runtime`, `packages/digest-runtime`, `packages/automate-migration-tool`, contract deltas, runtime ADR evidence; INCLUDES the projection-null contract alignment | runtime `120/120`, contracts `341/341`, typechecks |
| A4-r1 | Workbench durable surface | `packages/workbench-server` (native port + production assembly), `packages/workflow-catalog`, HTTP + canonical E2E tests; INCLUDES the TS2353 test fix and the #47 wiring | server suite `24 + 53`, workflow tests `11/11` incl. canonical E2E `46` expects, catalog `63 + 5`, typecheck |
| A5a-r1 | Remaining contracts + isolated services | PostM3 contracts, `packages/secret-broker`, `packages/observability`, `packages/scheduler`, `packages/artifact-store`, `packages/capability-runtime`, `tools/fc13-guest` | contracts `644/644`, per-service suites + typechecks, runtime + server spot re-verification |
| A5b-r1 | App surface + docs | `packages/app` Automate surface, `packages/mobile`, `packages/unifia`, `packages/workbench-shell`, `packages/mcp-transport`, `packages/release-hardening`, ADR + certification docs | app typecheck, targeted mode/provider `49/49`, server typecheck + canonical E2E |

## Dependency Rules

1. A1 is the contract base for all later slices.
2. A2 records the substrate decision and qualification evidence required before
   A3-r1 can claim durable production behavior.
3. A3-r1 owns `AuthorityToken`, graph execution, attempts, timers, approvals,
   and retention. A4-r1 must not duplicate those decisions.
4. A4-r1 is the only slice that exposes the durable runtime through Workbench HTTP.
5. A5a-r1/A5b-r1 may consume the HTTP contract but must not add an
   authority-token bypass.
6. `origin/dev` is outside this promotion plan. It must not be mutated or used
   as a base by any slice.

## Repaired Stack (r1, current)

The first stack (A3/A4/A5a/A5b) is preserved as immutable review
checkpoints and is SUPERSEDED by the r1 stack below. Old branches were
never force-pushed. A1/A2 were kept as-is after inspection found no cause
to rebuild them.

| Slice | Branch | Commit | Verification (2026-09-06) |
|---|---|---|---|
| A1 | `integration/automate-a1-contracts` | `ff9fa1bfd1` | contracts `145/145`, typecheck clean |
| A2 | `integration/automate-a2-m0` | `0208882bfd` | m0-contract `177/177`, harness `39 pass 13 skip`, typechecks clean |
| A3-r1 | `integration/automate-a3-runtime-r1` | `64b92bb946` | runtime `120/120`, contracts `341/341`, typechecks clean |
| A4-r1 | `integration/automate-a4-workbench-r1` | `3cccb53e12` | server suite `24 + 53`, workflow `11/11`, catalog `63 + 5`, typecheck clean |
| A5a-r1 | `integration/automate-a5-foundations-r1` | `94ce9fd176` | contracts `644/644`, foundations `49 + 33 + 5 + 16 + 17`, runtime + server spot green |
| A5b-r1 | `integration/automate-a5b-app-r1` | `f1b259eb8f` | app typecheck + targeted `49/49`, server typecheck + canonical E2E `46` expects |

Each `-r1` branch descends directly from the previous verified tip:
A2 -> A3-r1 -> A4-r1 -> A5a-r1 -> A5b-r1. Linearity is checkable with
`git log --oneline` on any r1 tip.

## Corrections Applied in r1

- A3 contract divergence: `getMaterializedProjection()` on a missing run
  now returns `null` per the canonical contract (was `RunNotFoundError`)
  in `in-memory.ts`, `native-history.ts` and `file-backed.ts`, with two
  new regression tests. The stale ADR-000-deferred comment in
  `adapter.ts` now records the ratified Native implementation.
- A4 autonomy: the TS2353 fix (`{ result: { ok: true } }`) is committed
  INSIDE A4-r1, so A4-r1 passes alone. No uncommitted fix is required.
- #47 production assembly: `NativeWorkflowRuntimePort` now owns history,
  attempts and approvals on the same SQLite file, registers the
  `WorkflowRun` at `start`, claims generation-1 ownership in every
  subsystem, and exposes `historyAuthority` / `attemptAuthority` /
  `approvalAuthority` / `graphEngineFor` / `takeover`. The canonical E2E
  drives graph, approval, attempt/effect, timer, history and cancel
  exclusively through the port, across a restart, with a 15-point stale
  matrix (46 expects).
- The `workflow-ir.ts` split (`1193 + 128 + 363` lines, same 77 public
  exports) is kept: the source monolith exceeds the 1500-line ceiling.
- The pre-push hook blocked the first push on the latent TS2353 (turbo
  typecheck 46/47); after the fix it is 47/47 green.

## Parity

Final tree parity A5b-r1 vs source is recorded in
`docs/integration/AUTOMATE-PROMOTION-PARITY.md` (two-dot diff, explicit
allowlist, zero undocumented divergence).

## Environment Notes

- D: filled to 0 bytes twice mid-repair; sealed worktree `node_modules`
  were deleted (reinstallable) to free ~10 GB each time.
- DBOS re-execution still blocked (Go bootstrap 404, tests stay skipped);
  FC-13 still blocked (no QEMU). Both remain explicit, never converted
  to fresh PASS.
- `dev` was never touched; no PR was opened or merged during repair.
- Pre-existing lint warnings (unused imports, import-type style) were
  left untouched; the review scope is promotion integrity, not a lint
  pass.