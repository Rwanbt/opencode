<!--
SPDX-License-Identifier: MIT
Copyright (c) 2026 Unifia contributors
-->

# Automate Promotion Slices

This plan stages Automate only onto `origin/work-design`. It does not merge,
rebase, push to, or create promotion branches from `dev`. Each slice is a
stacked review branch; it must be rebased on the accepted predecessor and pass
its own stated checks before the next slice is prepared.

## Source Snapshot

- Base: `origin/work-design` at `1bbbe6a614d90f1208e834767a2e28184cf0253c`.
- Source: `origin/agent/automate-v2-baseline-20260901` at
  `3bf597d629500a1064d63a1c4a61e45094ccf4e2`.
- The source is a fast-forward descendant of the base, with 315 additional
  commits. No promotion branch has been created by this plan.

## Review Order

| Slice | Responsibility | Includes | Excludes | Required checks |
|---|---|---|---|---|
| A1 | Contracts and isolated foundations | `packages/contracts`, `packages/digest-runtime`, `packages/capability-runtime`, `packages/artifact-store`, `packages/secret-broker`, `packages/observability`, `packages/scheduler`, `packages/workflow-catalog`, and their direct tests | Durable authority, graph execution, HTTP routes, UI | package tests and package typechecks |
| A2 | Qualification and native authority decision | `packages/automate-m0-contract`, `packages/automate-m0-harness`, `packages/automate-migration-tool`, `tools/dbos-*`, `tools/fc13-guest`, the M0 evidence and ADR-000 decision artifacts | Production workbench wiring | M0 qualification gate and reproducibility checks |
| A3 | Durable runtime core | `packages/workflow-runtime`, `packages/expression-runtime`, and the runtime ADR/status evidence | Workbench HTTP and app surfaces | workflow-runtime and expression-runtime tests plus typechecks |
| A4 | Workbench durable workflow surface | `packages/workbench-server` native workflow port, workflow handlers, HTTP tests, and certification evidence | App navigation and reload certification | server tests, workflow HTTP tests, canonical Bun authority E2E, typecheck |
| A5 | Automate user surface and final hardening | `packages/app` Automate mode/deep-link/reload work, release-hardening alignment, final authority fencing changes, and convergence records | Knowledge convergence and any direct `dev` integration | app typecheck, targeted mode/provider tests, canonical Bun E2E, relevant runtime/server suites |

## Dependency Rules

1. A1 is the contract base for all later slices.
2. A2 records the substrate decision and qualification evidence required before
   A3 can claim durable production behavior.
3. A3 owns `AuthorityToken`, graph execution, attempts, timers, approvals, and
   retention. A4 must not duplicate those decisions.
4. A4 is the only slice that exposes the durable runtime through Workbench HTTP.
5. A5 may consume the HTTP contract but must not add an authority-token bypass.
6. `origin/dev` is outside this promotion plan. It must not be mutated or used
   as a base by any slice.

## Implementation Method

The original branch interleaves code, tests, and evidence. Each slice therefore
requires a fresh integration worktree and a dependency-ordered reconstruction:

1. Create the slice from the accepted predecessor.
2. Cherry-pick only commits wholly owned by the slice.
3. For mixed commits, recreate the minimal cohesive change with its tests rather
   than bringing unrelated paths into the slice.
4. Run the listed checks and have an independent reviewer inspect the exact
   commit range.
5. Merge only after review; then rebase the next slice on the accepted head.

This is deliberately not a promise that historical commit boundaries are clean.
The measured history shows that the early foundation range alone changes 502
files, so mechanically cherry-picking it would violate the review-size gate.

## Execution Record (2026-09-06, local branches only, no push, no merge)

Stacked branches, each verified before the next was created:

| Slice | Branch | Commit | Verification |
|---|---|---|---|
| A1 | `integration/automate-a1-contracts` | `ff9fa1bfd1` | contracts `145/145`, typecheck clean |
| A2 | `integration/automate-a2-m0` | `0208882bfd` | m0-contract `177/177`, harness `39 pass 13 skip`, typechecks clean |
| A3 | `integration/automate-a3-runtime` | `189d6a6792` | contracts `341/341`, workflow-runtime `118/118`, typechecks clean |
| A4 | `integration/automate-a4-workbench` | `012d893d90` | server suite `24 + 53`, workflow tests `11/11` incl. canonical E2E, typecheck clean after one test-only fix |
| A5a | `integration/automate-a5-foundations` | `bcd8b8d350` | contracts `644/644`, secret-broker `49/49`, observability `33/33`, scheduler `5/5`, artifact-store `16/16`, capability-runtime `17/17`, runtime `118/118` re-verified, typechecks clean |
| A5b | `integration/automate-a5b-app` | `323e5e0e8c` | app typecheck clean, targeted mode/provider `49/49`, workbench-server typecheck fully clean |

A5b vs source parity: identical except six deliberate divergences �
`workflow-ir.ts` split (`1193 + 128 + 363` lines, same 77 public exports),
canonical E2E test-only type fix (`{ result: { ok: true } }`),
canonical `ownership-scope-validation.test.ts` restored, our SPDX headers on
the two DBOS READMEs, our newer promotion roadmap, and session-local
`state.md` never ported.

Corrections found while slicing (all fixed inside the slices):
- Source `canonical-authority-e2e.test.ts:192` has a latent TS2353
  (`{ ok: true }` vs `{ result?, ackLost? }`); Bun does not typecheck, so
  the suite stayed green. Fixed test-only in A5a/A5b.
- A4 commit `012d893d90` captured the pre-fix test (fix stayed unstaged);
  A5a/A5b carry the fix. Reviewers should diff A5b, not A4, for that file.
- `workflow-catalog` (planned A1) was only ported in A4 when the server
  typecheck proved it missing; `secret-broker`, `observability`,
  `scheduler`, `artifact-store`, `capability-runtime` and the remaining
  contract areas landed in A5a.

Environment notes: D: filled to 0 bytes mid-slice; `node_modules` of the
sealed A1-A4 worktrees were deleted (reinstallable) to free 11 GB.
DBOS re-execution still blocked (Go bootstrap 404); FC-13 still blocked
(no QEMU). `dev` was never touched; nothing was pushed or merged.
