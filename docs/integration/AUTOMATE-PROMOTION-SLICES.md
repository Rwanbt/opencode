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
  `cf5c12ab53f4df22ab09b8f0c552441d3128cd73` (includes the r2 atomic
  boundary, effect machine, precedence and HTTP-proof code; pushed
  2026-09-06).
- The source is a fast-forward descendant of the base. All slice branches
  below are pushed to `origin` for review; nothing is merged.

## Review Order (actual slice ownership, as built)

| Slice | Responsibility | Contains | Required checks |
|---|---|---|---|
| A1 | Contract base | `packages/contracts` core (scopes, digests, timers, IR split, run, map-key, graph) + direct tests | contracts `145/145`, typecheck |
| A2 | Qualification + substrate decision | `packages/automate-m0-contract`, `packages/automate-m0-harness`, `tools/dbos-*`, M0 evidence, ADR-000 | m0-contract `177/177`, harness `39 pass 13 skip`, typechecks |
| A3-r2 | Durable runtime core | `packages/workflow-runtime` (effect terminal machine, stale precedence, shared-DB atomic core), `packages/expression-runtime`, `packages/digest-runtime`, `packages/automate-migration-tool`, runtime ADR evidence | runtime `127/127`, contracts `341/341`, typechecks |
| A4-r2 | Workbench durable surface | `packages/workbench-server` (native port + production assembly + atomic terminal boundary), `packages/workflow-catalog`, HTTP + canonical + terminal + versions tests | server suite `24 + 53`, workflow tests `15/15`, catalog `63 + 5`, typecheck |
| A5a-r2 | Remaining contracts + isolated services | PostM3 contracts, `packages/secret-broker`, `packages/observability`, `packages/scheduler`, `packages/artifact-store`, `packages/capability-runtime`, `tools/fc13-guest` | contracts `648/648`, per-service suites + typechecks, runtime + server spot re-verification |
| A5b-r2 | App surface + docs | `packages/app` Automate surface, `packages/mobile`, `packages/unifia`, `packages/workbench-shell`, `packages/mcp-transport`, `packages/release-hardening`, ADR + certification docs | app typecheck, targeted mode/provider `49/49`, server typecheck + canonical E2E |

## Dependency Rules

1. A1 is the contract base for all later slices.
2. A2 records the substrate decision and qualification evidence required before
   A3-r2 can claim durable production behavior.
3. A3-r2 owns `AuthorityToken`, graph execution, attempts, timers, approvals,
   retention and the atomic cross-authority core. A4-r2 must not duplicate
   those decisions.
4. A4-r2 is the only slice that exposes the durable runtime through Workbench HTTP.
5. A5a-r2/A5b-r2 may consume the HTTP contract but must not add an
   authority-token bypass.
6. `origin/dev` is outside this promotion plan. It must not be mutated or used
   as a base by any slice.

## Repaired Stack (r2-final, current)

The r2 stack below restores true linearity: each `-final` branch descends
directly from the previous verified tip. The non-final r2 branches
(A5a-r2, A5b-r2) are preserved as checkpoints and SUPERSEDED.

| Slice | Branch | Commit | Verification (2026-09-06) |
|---|---|---|---|
| A1 | `integration/automate-a1-contracts` | `ff9fa1bfd1` | contracts `145/145`, typecheck clean |
| A2 | `integration/automate-a2-m0` | `0208882bfd` | m0-contract `177/177`, harness `39 pass 13 skip`, typechecks clean |
| A3-r2 | `integration/automate-a3-runtime-r2` | `a2e50d63ce` | runtime `127/127`, typecheck clean |
| A4-r2 | `integration/automate-a4-workbench-r2` | `9bced21548` | server suite `24 + 53`, workflow `15/15`, catalog `63 + 5`, typecheck clean |
| A5a-r2-final | `integration/automate-a5-foundations-r2-final` | `6e08a9b32f` | foundations ported + idempotent reconcile (`130/130` runtime), contracts `644/644` |
| A5b-r2-final | `integration/automate-a5b-app-r2-final` | `59260459dc` | contracts `648/648`, runtime `130/130`, app `49/49`, server `15/15` workflow + typechecks |

Superseded (kept, never force-pushed): A3/A4/A5a/A5b, A3-r1/A4-r1/A5a-r1/A5b-r1.

## Repaired Stack (r2, superseded)

The r1 stack (A3-r1/A4-r1/A5a-r1/A5b-r1) is preserved as immutable review
checkpoints and is SUPERSEDED by the r2 stack below. Old branches were
never force-pushed. A1/A2 were kept as-is after inspection found no cause
to rebuild them.

| Slice | Branch | Commit | Verification (2026-09-06) |
|---|---|---|---|
| A1 | `integration/automate-a1-contracts` | `ff9fa1bfd1` | contracts `145/145`, typecheck clean |
| A2 | `integration/automate-a2-m0` | `0208882bfd` | m0-contract `177/177`, harness `39 pass 13 skip`, typechecks clean |
| A3-r2 | `integration/automate-a3-runtime-r2` | `a2e50d63ce` | runtime `127/127`, typecheck clean |
| A4-r2 | `integration/automate-a4-workbench-r2` | `9bced21548` | server suite `24 + 53`, workflow `15/15` (terminal + versions + canonical), catalog `63 + 5`, typecheck clean |
| A5a-r2 | `integration/automate-a5-foundations-r2` | `9934660b7a` | contracts `644/644`, foundations `49 + 33 + 5 + 16 + 17`, runtime + server spot green |
| A5b-r2 | `integration/automate-a5b-app-r2` | `4a4c73eec2` | contracts `648/648`, runtime `127/127`, app typecheck + targeted `49/49`, server typecheck + canonical E2E `50` expects, full foundations + m0 gates green |

Each `-r2` branch descends directly from the previous verified tip:
A2 -> A3-r2 -> A4-r2 -> A5a-r2 -> A5b-r2. Linearity is checkable with
`git log --oneline` on any r2 tip. Note: A4-r2 was rebased onto A3-r2
after creation (wrong initial base); the rebase was conflict-free and
the branch was fully re-verified afterwards.

## Corrections Applied in r2

- P0-A canonical run state: `complete()`/`cancel()` compose the graph
  terminal mark (`markRunTerminal`, idempotent) and the canonical history
  transition (`transitionSync`) in ONE shared SQLite transaction — nested
  savepoints, proven by a deterministic rollback test (forced inner
  failure reverts graph writes). `state()` maps terminal history to HTTP
  status, so HTTP == projection == recovered state. `resume()` heals a
  graph-terminal/history-open skew atomically; terminal history blocks
  further advance, `complete()` on a finished run throws
  RUN_ALREADY_TERMINAL, `cancel()` stays idempotent.
- P0-B effect machine: SUCCEEDED always blocks allocation
  (EFFECT_ALREADY_TERMINAL); FAILED requires explicit authorization and
  consumes it atomically (FAILED -> PENDING journalled, reconciled
  reset); the new outcome genuinely drives the effect. `authorizeRetry`
  accepts any FAILED effect; `inspectJournal` exposes the audit trail.
- P1 stale precedence: fence-first on history (transition,
  enqueueCommand), attempts (allocate), graph (all decide/fan-out/loop
  families) and broker facade (new `ApprovalAuthority.fence`), with a
  5-family zero-mutation proof plus discrimination controls.
- P1 #44 HTTP proof: `workflow-versions-http.test.ts` (R1/R2 share V1,
  R3 pins V2, cancel isolation, restart persistence) through HTTP only.
- The pre-push hook blocked the first r2 push on nothing new (turbo
  typecheck 47/47 green throughout).
- r1 findings stay fixed: TS2353 inside A4-r1/A4-r2, projection-null
  alignment, #47 assembly (now extended with the terminal boundary).

## Parity

Final tree parity A5b-r2 vs source is recorded in
`docs/integration/AUTOMATE-PROMOTION-PARITY.md` (two-dot diff, explicit
allowlist, zero undocumented divergence).

## Environment Notes

- D: filled to 0 bytes twice mid-repair; sealed worktree `node_modules`
  were deleted (reinstallable) to free ~10 GB each time.
- DBOS re-execution still blocked (Go bootstrap 404, tests stay skipped);
  FC-13 still blocked (no QEMU). Both remain explicit, never converted
  to fresh PASS. One transient m0-harness failure observed (timing
  flake), green on two reruns.
- Uncommitted foreign edits were observed in two worktrees (port
  shared-DB injection adopted after verification; M0 evidence rerun left
  stashed, outcomes identical). No foreign commits on any r2 branch.
- `dev` was never touched; no PR was opened or merged during repair.
- Pre-existing lint warnings (unused imports, import-type style) were
  left untouched; the review scope is promotion integrity, not a lint
  pass.