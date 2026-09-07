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

Phase D: convergence certification. Phases A, B and C are closed; the Knowledge
merge is committed on `integration/work-design-knowledge`.

## Current Branch

`integration/work-design-knowledge` (merge commit `732ffbb1a6`), branched from
the assembled `work-design` at `3c8e22e7e6`.

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

## Phase C Verdict (2026-09-08)

Merge-base `91daa35a26a8e44d7f35b539c91030ec1e230c54`. Measured before merging:
Knowledge changed 383 files, the trunk 998, and **only 26 were touched by both**.
Git auto-resolved 21 of those; five needed a decision.

| Conflict | Decision |
|---|---|
| `.gitignore` | union |
| `packages/contracts/package.json` | union: trunk `main`/`types`/`license`/`scripts`, Knowledge `files` + explicit `zod`, export map merged to five entries |
| `packages/contracts/src/index.ts` | additive union; contracts typecheck clean, so no export collision |
| both `unifia-cli.js` bundles | regenerated with `scripts/bundle-mobile.mjs`, never hand-merged |

Knowledge adapted to the trunk, never the reverse:

- `knowledge/parser/frontmatter.ts` called `gray-matter` directly, which only
  worked on the Knowledge branch because a nested `js-yaml@3.15.1` sat under
  gray-matter there. The trunk keeps ONE js-yaml (4.3.1) and routes every call
  site through `util/frontmatter.ts`. After the merge the nested copy is gone,
  so the parser threw on every note: **229 of 821 Knowledge tests failed**.
  Routing it through the wrapper restores 821/821, the branch's own baseline.
- 43 Knowledge files lacked the SPDX header the trunk's pre-commit gate
  requires. Headers added rather than the gate weakened. The 31 that carry YAML
  frontmatter take the identifier as a YAML comment inside the frontmatter,
  because gray-matter only sees frontmatter starting at byte 0.

Generated artifacts regenerated, not merged: `bun.lock` (one missing
`@unifia/mcp-transport` workspace link recovered, no version change),
`packages/sdk/openapi.json` and `types.gen.ts` (`script/generate.ts`, enforced
at zero drift by `observability-sdk-drift`).

Checks that could have hidden a loss:

- i18n union verified arithmetically on `en.ts`: 1660 base + 124 trunk + 22
  Knowledge = 1806 keys. No duplicate, no dropped key.
- Knowledge's `memory` settings block survives intact in `config-schema.ts`
  (merged file byte-identical to the Knowledge side, +42 lines vs the trunk).

## Current Gate

Phase D certification on `integration/work-design-knowledge`.

Green so far on the merged tree:

- `bun turbo typecheck --concurrency=1`: 47/47, all real executions
- Knowledge suite: 821/821 (4199 expects), equal to its own branch baseline
- `crates/unifia-knowledge-core`: 35/35
- workflow-runtime 154/154, workbench-server 103/103, contracts 695/695,
  expression-runtime 8/8, workflow-catalog 5/5
- `bunx biome check .`: 1733 files, 0 errors, 13 pre-existing warnings
- eval isolation: 11 dev / 11 holdout fixtures, no shared id, no shared 5-gram

Open on the merged tree:

- Exhaustive `packages/unifia` suite: 5077 pass / 10 skip / **47 fail** over
  462 files in 36 minutes. The same `test/knowledge/` subset passes 821/821 in
  isolation, and the one captured failure (`knowledge/e2e/cli-process.test.ts`
  R-0019, an egress-trail assertion around a spawned CLI process) is
  load-shaped. Attribution is NOT yet established. Do not claim this suite as
  PASS until each of the 47 is attributed.
- `bun turbo build --concurrency=1 --continue`: 10/13 packages build.
  `@unifia/web` fails on `@astrojs/cloudflare@14.2.1` failing to resolve
  `astro:static-paths` / `astro:assets`. **Pre-existing trunk breakage, proven
  not convergence damage**: Knowledge never touched `packages/web`, and the
  merged tree's `packages/web/package.json` and every astro entry in `bun.lock`
  are byte-identical to the trunk's. The trunk bumped Astro across a major
  (`@astrojs/cloudflare` 12.6.6 to 14.2.1, starlight 0.34 to 0.41) without the
  build following. `@unifia/console-app` (exit 1) and `@unifia/storybook`
  (exit 134, abort, consistent with this machine's OOM pattern) also fail;
  Knowledge touched neither package, and their attribution is still pending a
  run on an unloaded machine.

## Next Exact Action

1. Attribute the 47 `packages/unifia` failures: capture the full list, then run
   the same suite on `feat/sovereign-knowledge-core` and on the trunk to
   separate convergence damage from load-shaped flakiness and pre-existing red.
2. Confirm `@unifia/console-app` and `@unifia/storybook` build failures on an
   unloaded machine and file them as trunk issues if they reproduce.
3. Only then run the remaining Phase D gates (cross-mode journey, reload matrix,
   responsive pre-check) and consider promoting the integration branch.

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
PHASE:            C closed, D in progress
STATUS:           AMBER - merge green on every targeted gate, two open unknowns
CURRENT HEAD:     integration/work-design-knowledge @ 732ffbb1a6
WORKTREE:         D:/App/unifia/unifia-work-design
REMOTE MUTATION:  NO (everything local so far)
COMPLETED:        Automate trunk assembled; Knowledge merged with provenance;
                  five conflicts decided; generated artifacts regenerated;
                  Knowledge adapted to the trunk's js-yaml and SPDX contracts
OPEN:             47 unattributed failures in the exhaustive unifia suite;
                  3 of 13 package builds red (web proven pre-existing trunk)
TESTS:            typecheck 47/47; knowledge 821/821; rust 35/35;
                  automate suites unchanged; biome 0 errors
BLOCKERS:         disk 3.9 GB free; tsgo/storybook OOM under load
NEXT EXACT ACTION: attribute the 47 failures against the Knowledge branch and
                  the trunk before claiming Phase D
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

- [x] integration branch `integration/work-design-knowledge` from `3c8e22e7e6`
- [x] merge-base recorded `91daa35a26`
- [x] Knowledge-only domain inventory (357 files: `packages/unifia`,
      `tests/knowledge/eval`, `docs/knowledge`, `crates/unifia-knowledge-core`)
- [x] shared conflict surface inventory (26 files, 5 real conflicts)
- [x] merge and manual conflict resolution - `732ffbb1a6`, no squash, no rebase
- [x] generated files regenerated (lock, SDK/OpenAPI, both mobile bundles)
- [x] settings: Knowledge `memory` block intact in `config-schema.ts`
- [x] mobile runtime regenerated from the consolidated source
- [ ] provider / session / tool registry audited against §C10/§C11 in depth

### D - Convergence Certification

- [x] typecheck 47/47, biome 0 errors
- [x] Automate regression (no suite moved down)
- [x] Knowledge regression 821/821 + Rust crate 35/35
- [ ] exhaustive `packages/unifia` suite: 47 failures unattributed
- [ ] build: 10/13, three failures pending attribution (`web` proven pre-existing)
- [ ] cross-mode journey, reload matrix, responsive pre-check

### D to I - Certification, UI, and Dev Integration

- [ ] convergence certification
- [ ] Knowledge promoted to Work-Design
- [ ] UI reference frozen
- [ ] UI refactor and responsive/accessibility certification
- [ ] UI promoted to Work-Design
- [ ] latest dev integration
- [ ] full regression, migration, security, and owner review
