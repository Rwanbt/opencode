# UNIFIA Convergence: Automate, Knowledge, and UI

This is the single operational roadmap for the current Unifia convergence. GitHub
Issues #43, #44, and #45 are the canonical active work state; this file records
local execution evidence and checkpoints only.

## Current Phase

Phase A8: #45 reconciliation-only effect guard complete locally; #44 remains next.

## Current Branch

`agent/automate-v2-baseline-20260901`

## Current HEAD

`af48118975aef109937393a52989a8067c61dfc8`

## Source Branches and SHAs

| Ref | Current SHA | Roadmap checkpoint SHA | Notes |
|---|---|---|---|
| `origin/agent/automate-v2-baseline-20260901` | `af48118975aef109937393a52989a8067c61dfc8` | same | current Automate baseline |
| `origin/work-design` | `1bbbe6a614d90f1208e834767a2e28184cf0253c` | `1bbbe6a614...` | direct ancestor of Automate; 305 commits behind |
| `origin/feat/sovereign-knowledge-core` | `b511ea44f45d4f4a61ef027a3a4cf914715c0b0a` | same | independent Knowledge history; untouched |
| `origin/dev` | `95350647140a382ee6d5d61bc2f6639597d80f0b` | same | current integration target checkpoint |

Refs were fetched on 2026-09-06. Re-fetch before every integration action.

## Open Blockers

- #43: canonical WorkflowRun authority and shared fencing, P0.
- #44: independent WorkflowRun identities and immutable version pinning, P0.
- #45: reject raw attempt allocation after `UNKNOWN_EXTERNAL_STATE`, P0.
- Native desktop certification remains environment-blocked by LLVM OOM / Windows paging-file exhaustion.

## Closed Blockers

- Automate tri-state access and deep-link bootstrap: shipped in `af48118975`.
- Automate reload stability workload `10 x 100`: PASS in 34.3 minutes, one worker.

## Completed Gates

- ADR-000 / UNIFIA_NATIVE decision: frozen and not reopened.
- FC-13 power-loss qualification: preserved.
- Automate mode/design/navigation/resource/latency suite: 15/15 PASS.
- Targeted mode/provider tests: 49/49 PASS.
- App typecheck: PASS.
- Full Automate reload contract: PASS.
- GitHub issues #43, #44, #45: OPEN, labeled `type:bug` and `priority:P0`.

## Current Gate

Automate P0 production path: NO-GO. Isolated Native components are not yet
evidence of one production WorkflowRun authority.

## Next Exact Action

1. Claim the authorized P0 issue tranche before implementation.
2. Run the relevant Automate baseline suites from package directories.
3. Implement #44's real run/version identities.
4. Implement #43's canonical authority token and shared production-path fencing.
5. Close only after the integrated production E2E proves stale-owner rejection across all protected surfaces.

## Tests Baseline

- Existing prior evidence: workflow-runtime 115/115, workbench-server 88/88, expression-runtime 8/8, native durable 29/29.
- Existing prior evidence: Turbo typecheck 47/47; app targeted mode/provider 49/49.
- Existing prior evidence: Automate reload 10 x 100 PASS, 34.3 minutes.

## Tests Latest

- `packages/workflow-runtime`: `115/115` PASS.
- `packages/workbench-server`: `87/87` server assertions plus `53/53` Vitest checks PASS.
- `packages/automate-m0-contract`: `177/177` PASS.
- #45 tranche: `native-durable.test.ts` `30/30` PASS after the guard and explicit retry-authorisation changes.
- #45 tranche: full `workflow-runtime` suite `116/116` PASS.
- #45 tranche: workflow-runtime typecheck PASS.

## Known Deviations

- The roadmap's supplied `work-design` and `dev` values were checkpoints, not current refs; current refs are recorded above.
- The code audit confirms `NativeWorkflowRuntimePort` still caches one graph engine and derives run identity from `workflowId`.
- #45 local fix rejects allocation after `UNKNOWN_EXTERNAL_STATE`; production-path integration remains open.
- The underlying historical Chromium resource failure remains a P2 investigation item; the full reload contract passes.

## Conflict Decisions

- Work-Design/Automate remains the shell and runtime authority during future convergence.
- Knowledge remains the authority for Knowledge persistence, retrieval, indexing, and policy only.
- No blanket ours/theirs conflict resolution.
- No remote mutation is authorized by this roadmap. Fetch is allowed; no push, PR, merge, tag, or branch-protection mutation without explicit owner authorization.

## UI Reference

`UNSELECTED`. Freeze v103 or v104 only after Automate and Knowledge convergence is green and the owner source-of-truth gate is explicit.

## Last Checkpoint

2026-09-06: roadmap created locally from fetched refs at `af48118975`. Baseline
Automate suites pass. Claims recorded on #44 and #45. #45 local implementation
tests pass and is committed locally; no remote code mutation performed; GitHub
issue comments/assignments are the only remote state changes.

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

- [ ] #43 canonical authority and shared fencing
- [ ] #44 multi-run isolation and immutable version pinning (claimed)
- [ ] #45 reconciliation-only unknown effect state (claimed; local implementation green, production integration open)
- [ ] integrated production E2E

### B - Automate to Work-Design

- [ ] topology verified for promotion
- [ ] fast-forward
- [ ] regression
- [ ] local safety checkpoint

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
