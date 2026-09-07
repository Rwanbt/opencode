<!--
SPDX-License-Identifier: MIT
Copyright (c) 2026 Unifia contributors
-->

# UNIFIA Convergence: Automate, Knowledge, and UI

Single operational roadmap for the current Unifia convergence. GitHub Issues are
the canonical active work state; this file records local execution evidence and
checkpoints only.

> This file now lives on `work-design`, the real trunk since the Automate
> promotion (PR #60). The copy on `agent/automate-v2-baseline-20260901` is
> historical: that branch is content-superseded (see Phase B verdict below) and
> must not be edited as a second dashboard.

## Current Phase

Phase C: Knowledge convergence preflight. Phases A and B are closed.

## Current Branch

`work-design`

## Current HEAD

See `git rev-parse work-design`. Local trunk assembled 2026-09-08 from
`6ba540abf5` (PR #60) fast-forwarded with `feat/automate-phase1-vertical-slice`
(`cff9551559`) plus one lint repair.

## Source Branches and SHAs

Resolved mechanically 2026-09-07T21:xx UTC. Re-fetch before every integration
action; the values below are checkpoints, not authority.

| Ref | Resolved SHA | Original roadmap checkpoint | Status |
|---|---|---|---|
| `origin/work-design` | `6ba540abf5` | `1bbbe6a614` | moved: absorbed Automate via squash PR #60 |
| `origin/feat/automate-phase1-vertical-slice` | `cff9551559` | n/a | Automate Phase 1 slice, linear on work-design |
| `origin/agent/automate-v2-baseline-20260901` | `5b750939bd` | `af48118975` | content-superseded; retained for provenance |
| `origin/feat/sovereign-knowledge-core` | `b511ea44f4` | same | unchanged; Knowledge convergence source |
| `origin/dev` | `9535064714` | same | unchanged; final integration target |

Topology, measured not assumed:

- `work-design` ↔ `agent/automate-v2-baseline-20260901`: `1` / `331`. The
  baseline is **not** an ancestor of the trunk; a fast-forward promotion is
  impossible and must not be attempted.
- `work-design` ↔ `feat/sovereign-knowledge-core`: merge-base `91daa35a26`,
  `237` / `179`. Semantic convergence, never a rebase or squash.
- `dev` ↔ `work-design`: `3` / `237`. `dev` holds three commits the trunk lacks.

## Open Blockers

- **Disk**: `D:` has ~4.2 GB free at 100% use. A fresh worktree with
  `node_modules` costs ~2.4 GB, so convergence work reuses the existing
  `unifia-work-design` and `unifia-memory` worktrees. Reclaiming the superseded
  `rev3m-20260901/*` slice worktrees is the first lever if space runs out.
- **tsgo OOM**: `bun turbo typecheck` crashes the Go typechecker under parallel
  execution on this machine (`memory allocation failed`, and a spurious
  `browser-runtime exited (3)`). `--concurrency=1` passes 47/47. Environmental,
  not a product defect; do not "fix" it in the codebase.
- Native desktop certification remains environment-blocked (LLVM OOM / Windows
  paging-file exhaustion), carried over from the previous dashboard.

## Closed Blockers

- #43 canonical WorkflowRun authority and shared fencing: CLOSED as completed
  2026-09-07T13:46Z.
- #44 run isolation and immutable version pinning: CLOSED as completed
  2026-09-07T13:45Z.
- #45 retries blocked while an effect is UNKNOWN: CLOSED as completed
  2026-09-07T13:45Z.
- Automate promotion into `work-design`: landed as squash PR #60
  (`6ba540abf5`, 543 files, 88 310 insertions).
- Automate Phase 1 vertical slice review fixes: `11ff7188ea`, `cff9551559`;
  CI `unifia-conformance` run 34163256514 SUCCESS.

## Phase B Verdict (2026-09-08)

The original roadmap prescribed `git merge --ff-only` from the Automate
baseline. That premise is dead: the promotion happened as a **squash of a
reconstructed A1..A5b slice stack**, so the two histories diverged by
construction. §B2 therefore applies — stop, investigate, recalculate — and the
recalculation is recorded here.

Full mechanical audit of the 40-file delta `work-design` ↔ baseline:

| Direction | Count | Content | Verdict |
|---|---|---|---|
| trunk-only | 7 | IR split (`workflow-effect.ts`, `workflow-recovery.ts`) + 5 focused contract tests | intentional, documented in `AUTOMATE-PROMOTION-PARITY.md` |
| baseline-only | 2 | this roadmap file, `state.md` | review metadata, allowlisted; roadmap now carried to the trunk |
| modified | 31 | P3 effect rows, `.js` import suffixes, fail-closed secret broker, `sha2` 0.10→0.11, stronger #45 restart assertion | trunk side is newer in every case inspected |

Spot-checks that could have hidden a loss, all resolved in the trunk's favour:

- `cf5c12ab53` (idempotent `reconcileEffect` with typed conflict), the only
  baseline code commit after the parity pin, **is present** in the trunk
  (`RECONCILIATION_CONFLICT` ×2 in `native-attempts.ts`); the residual delta on
  those two files is 3 lines of import suffix and one extra trunk assertion.
- `packages/secret-broker`: the trunk carries `OsSecureStorageUnavailableError`
  and the `allowInsecureFallback` fail-closed guard; the baseline does not.
- `native-durable.test.ts`: the trunk asserts that the #45 refusal survives
  restart; the baseline dropped that assertion.

**Conclusion: nothing was lost.** `work-design` is a strict content superset of
`agent/automate-v2-baseline-20260901` except for the two review-metadata files.
The baseline branch is superseded and kept only for provenance. No recovery
work is owed.

## Completed Gates

- ADR-000 / UNIFIA_NATIVE decision: frozen, not reopened.
- FC-13 power-loss qualification: preserved.
- Phase A P0 architecture: all three issues closed as completed.
- Phase B promotion: landed and audited (verdict above).
- Post-merge regression on the assembled trunk, 2026-09-08:
  - `packages/workflow-runtime` 154/154
  - `packages/workbench-server` 103/103
  - `packages/contracts` 648/648
  - `packages/expression-runtime` 8/8
  - `packages/workflow-catalog` 5/5
  - `bun turbo typecheck --concurrency=1` 47/47
  - `bunx biome check .` 0 errors, 15 warnings

## Current Gate

Phase C preflight: create `integration/work-design-knowledge` from the
assembled trunk, inventory Knowledge-only domains and shared conflict surfaces,
then merge `feat/sovereign-knowledge-core` with `--no-ff` and manual conflict
resolution.

## Next Exact Action

1. Create `integration/work-design-knowledge` from the assembled `work-design`.
2. Record merge-base `91daa35a26a8e44d7f35b539c91030ec1e230c54`.
3. Produce the C2/C3 inventory (Knowledge-only domains vs shared conflict
   surfaces) BEFORE running the merge.
4. `git merge --no-ff feat/sovereign-knowledge-core`; resolve by the C4 policy,
   never by blanket ours/theirs.
5. Regenerate rather than hand-merge: `bun.lock`, SDK/OpenAPI, embedded mobile
   runtime.

## Tests Baseline

Pre-convergence trunk figures are the "Completed Gates" block above. Any
Knowledge merge that moves them down is a regression to resolve, not to accept.

## Known Deviations

- The roadmap's `work-design`, `dev` and Automate baseline values were
  checkpoints, not current refs; §1, §2, §3 and §B1 of the source roadmap are
  superseded by the resolved values and the Phase B verdict above.
- The source roadmap instructs creating this dashboard; it already existed on
  the Automate baseline. It was carried here rather than duplicated, per §0
  ("do not create competing master plans").
- 13 pre-existing Biome warnings remain outside the Automate scope
  (`file-backed.ts`, `in-memory.ts`, `native-durable.test.ts`,
  `m2-control-while-child.test.ts`, `m0-proof.test.ts`). Not entering the
  convergence change; route through normal triage.

## Conflict Decisions

- Work-Design/Automate stays the shell and runtime authority.
- Knowledge stays the authority for Knowledge persistence, retrieval, indexing
  and policy only. It never becomes WorkflowRun durable authority.
- No blanket ours/theirs resolution anywhere in the repository.

## Remote Mutation

Owner authorised the convergence merges on 2026-09-08 (Automate, Knowledge and
Work-Design). That authorisation is scoped to this convergence; it does not
extend to `dev`, to PR creation, to tags, or to branch-protection changes.
Earlier sessions' authorisations are never inherited.

## UI Reference

`UNSELECTED`. Freeze v103 or v104 only after Knowledge convergence is green and
the owner source-of-truth gate is explicit.

## Last Checkpoint

```text
PHASE:            B closed, C preflight
STATUS:           GREEN
CURRENT HEAD:     work-design, local trunk assembled
WORKTREE:         D:/App/unifia/unifia-work-design
REMOTE MUTATION:  NO (local only so far)
COMPLETED:        Phase A (issues closed), Phase B (promotion audited, verdict
                  "nothing lost"), Phase 1 slice merged, full trunk regression
OPEN:             Phase C not started
TESTS:            154 + 103 + 648 + 8 + 5 PASS; typecheck 47/47; Biome 0 errors
BLOCKERS:         disk 4.2 GB free; tsgo OOM under parallel turbo
NEXT EXACT ACTION: create integration/work-design-knowledge and run the C2/C3
                  inventory before merging Knowledge
```

## Master Status Board

Completed lines are never deleted; they carry their evidence.

### A - Automate P0

- [x] #43 canonical authority and shared fencing — CLOSED as completed 2026-09-07
- [x] #44 run isolation and immutable version pinning — CLOSED as completed 2026-09-07
- [x] #45 reconciliation-only unknown effect state — CLOSED as completed 2026-09-07
- [x] integrated production E2E (Bun native path)
- [x] Phase 1 vertical slice review fixes — `cff9551559`, CI run 34163256514 SUCCESS

### B - Automate to Work-Design

- [x] topology verified (measured: baseline is NOT an ancestor; ff impossible)
- [x] promotion landed — squash PR #60 `6ba540abf5`
- [x] A1..A5b slice stack (`AUTOMATE-PROMOTION-SLICES.md` § Execution Record)
- [x] parity audit of the residual 40-file delta — verdict: nothing lost
- [x] Phase 1 slice folded into the trunk (fast-forward, linear)
- [x] post-merge regression on the assembled trunk

### C - Knowledge Convergence

- [ ] integration branch
- [ ] merge-base recorded
- [ ] Knowledge-only domain inventory
- [ ] shared conflict surface inventory
- [ ] merge and manual conflict resolution
- [ ] generated files regenerated (lock, SDK/OpenAPI, mobile runtime)
- [ ] settings / provider / session / tool registry
- [ ] desktop/mobile

### D to I - Certification, UI, and Dev Integration

- [ ] convergence certification
- [ ] Knowledge promoted to Work-Design
- [ ] UI reference frozen
- [ ] UI refactor and responsive/accessibility certification
- [ ] UI promoted to Work-Design
- [ ] latest dev integration
- [ ] full regression, migration, security, and owner review
