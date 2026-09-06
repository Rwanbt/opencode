# UNIFIA Convergence: Automate, Knowledge, and UI

This is the single operational roadmap for the current Unifia convergence. GitHub
Issues #43, #44, and #45 are the canonical active work state; this file records
local execution evidence and checkpoints only.

## Current Phase

Phase A11: Automate canonical authority, multi-run isolation, and reconciliation fencing verified on the native production path.

## Current Branch

`agent/automate-v2-baseline-20260901` at `3bf597d629`

## Current HEAD

`3bf597d629500a1064d63a1c4a61e45094ccf4e2`

## Source Branches and SHAs

| Ref | Current SHA | Roadmap checkpoint SHA | Notes |
|---|---|---|---|
| `origin/agent/automate-v2-baseline-20260901` | `3bf597d629500a1064d63a1c4a61e45094ccf4e2` | same | current Automate baseline |
| `origin/work-design` | `1bbbe6a614d90f1208e834767a2e28184cf0253c` | `1bbbe6a614...` | direct ancestor of Automate; 305 commits behind |
| `origin/feat/sovereign-knowledge-core` | `b511ea44f45d4f4a61ef027a3a4cf914715c0b0a` | same | independent Knowledge history; untouched |
| `origin/dev` | `95350647140a382ee6d5d61bc2f6639597d80f0b` | same | current integration target checkpoint |

Refs were fetched on 2026-09-06. Re-fetch before every integration action.

## Open Blockers

- Native desktop certification remains environment-blocked by LLVM OOM / Windows paging-file exhaustion.

## Closed Blockers

- Automate tri-state access and deep-link bootstrap: shipped in `af48118975`.
- Automate reload stability workload `10 x 100`: PASS in 34.3 minutes, one worker.
- #44 multi-run isolation and immutable version pinning: verified and pushed.
- #45 reconciliation-only effect guard: verified and pushed.
- #43 canonical authority and shared fencing: verified and pushed.
- Integrated production authority E2E: PASS, including restart after generation-5 takeover.

## Completed Gates

- ADR-000 / UNIFIA_NATIVE decision: frozen and not reopened.
- FC-13 power-loss qualification: preserved.
- Automate mode/design/navigation/resource/latency suite: 15/15 PASS.
- Targeted mode/provider tests: 49/49 PASS.
- App typecheck: PASS.
- Full Automate reload contract: PASS.
- GitHub issues #43, #44, #45 remain OPEN pending review/merge; implementation commits are pushed.

## Current Gate

Automate P0 production path: GREEN for the tested native local production path.
Final merge/issue closure remains pending review and normal CI.

## Next Exact Action

1. Re-read current Work-Design and Automate refs before promotion.
2. Run promotion topology and regression checks without merging yet.
3. Open the review PR with complete Automate evidence and current issue AC.
4. Close #43/#44/#45 only after merge and final acceptance re-read.

## Promotion Assessment

Measured 2026-09-06 after fetching current refs:

- The Automate branch is a fast-forward descendant of `origin/work-design`:
  `0` commits behind and `315` commits ahead.
- Against `origin/dev`, it is `3` commits behind and `551` commits ahead.
- The direct `dev` delta is approximately `977` files and `149k` added lines;
  this is not a reviewable single promotion PR under the repository size gate.
- No merge, rebase, or branch mutation was performed. Promotion must be split
  into independently buildable/reviewable increments.

## Promotion Plan

`docs/integration/AUTOMATE-PROMOTION-SLICES.md` defines five stacked review
slices: contracts/foundations, M0 qualification, durable runtime, Workbench
HTTP surface, then application/hardening. The original commit history is not
cleanly partitionable; mixed commits must be reconstructed in a fresh
integration worktree rather than cherry-picked wholesale. `dev` is explicitly
out of scope: `work-design` is the sole promotion target. No promotion branch
or merge has been created.

## Tests Baseline

- Existing prior evidence: workflow-runtime 115/115, workbench-server 88/88, expression-runtime 8/8, native durable 29/29.
- Existing prior evidence: Turbo typecheck 47/47; app targeted mode/provider 49/49.
- Existing prior evidence: Automate reload 10 x 100 PASS, 34.3 minutes.

## Tests Latest

- `packages/workflow-runtime`: `118/118` PASS.
- `packages/workbench-server`: `87/87` server assertions plus targeted native authority E2E PASS.
- `packages/automate-m0-contract`: `177/177` PASS.
- #45 tranche: `native-durable.test.ts` `30/30` PASS after the guard and explicit retry-authorisation changes.
- #45 tranche: full `workflow-runtime` suite `118/118` PASS.
- #45 tranche: workflow-runtime typecheck PASS.

## Known Deviations

- The roadmap's supplied `work-design` and `dev` values were checkpoints, not current refs; current refs are recorded above.
- The native production path now requires explicit `AuthorityToken` for protected mutations.
- The legacy full journey test still has a Windows SQLite cleanup lock and Vitest cannot load `bun:sqlite`; the canonical Bun E2E is the active gate.
- The underlying historical Chromium resource failure remains a P2 investigation item; the full reload contract passes.

## Conflict Decisions

- Work-Design/Automate remains the shell and runtime authority during future convergence.
- Knowledge remains the authority for Knowledge persistence, retrieval, indexing, and policy only.
- No blanket ours/theirs conflict resolution.
- No remote mutation is authorized by this roadmap. Fetch is allowed; no push, PR, merge, tag, or branch-protection mutation without explicit owner authorization.

## UI Reference

`UNSELECTED`. Freeze v103 or v104 only after Automate and Knowledge convergence is green and the owner source-of-truth gate is explicit.

## Last Checkpoint

2026-09-06: Automate authority convergence verified and pushed through commits
`57e2b8e42b`, `2706cfccb4`, `6b31f0bb6f`, `bc5a4a04fb`, `9afb48baea`,
`d8f08e03e6`, and `3a33967e95`. Canonical Bun E2E passes with 38 assertions.

## Phase Checkpoint Format

Each meaningful phase update must record:

```text
PHASE:
STATUS:
CURRENT HEAD:
WORKTREE:
REMOTE MUTATION:
COMPLETED:
OPEN:
TESTS:
BLOCKERS:
NEXT EXACT ACTION:
```

## Master Status Board

### A - Automate P0

- [x] #43 canonical authority and shared fencing (implementation + production E2E pushed)
- [x] #44 multi-run isolation and immutable version pinning (implementation pushed)
- [x] #45 reconciliation-only unknown effect state (implementation pushed)
- [x] integrated production E2E (Bun native path)

### B - Automate to Work-Design

- [x] topology verified for promotion
- [x] A1 contracts and foundations (integration/automate-a1-contracts @ `ff9fa1bfd1`, contracts 145/145)
- [x] A2 M0 qualification (integration/automate-a2-m0 @ `0208882bfd`, m0-contract 177/177)
- [x] A3 durable runtime (integration/automate-a3-runtime @ `189d6a6792`, runtime 118/118)
- [x] A4 Workbench HTTP (integration/automate-a4-workbench @ `012d893d90`, workflow E2E 11/11)
- [x] A5a foundations (integration/automate-a5-foundations @ `bcd8b8d350`, contracts 644/644)
- [x] A5b app and docs (integration/automate-a5b-app @ `323e5e0e8c`, app 49/49, parity-identical to source modulo six divergences)
- [x] regression (per-slice suites re-run green on 2026-09-06)
- [ ] local safety checkpoint (independent reviewer inspection of A5b vs source + merge decision — NO merge performed)
- [ ] review PRs opened against work-design (stacked A1..A5b, Refs while working; dev untouched, nothing pushed)

Full slice record: `docs/integration/AUTOMATE-PROMOTION-SLICES.md` § Execution Record.

### C - Knowledge Convergence

- [ ] integration branch
- [ ] merge and shared conflict inventory
- [ ] generated files
- [ ] settings/provider/session/tools
- [ ] desktop/mobile

### D to I - Certification, UI, and Dev Integration

- [ ] convergence certification
- [ ] Knowledge promoted to Work-Design
- [ ] UI reference frozen
- [ ] UI refactor and responsive/accessibility certification
- [ ] UI promoted to Work-Design
- [ ] latest dev integration
- [ ] full regression, migration, security, and owner review
