<!--
SPDX-License-Identifier: MIT
Copyright (c) 2026 Unifia contributors
-->

# Automate Promotion Parity (A5b-r1 vs Source)

Reproducible tree-parity proof for the repaired promotion stack.
Three-dot diffs are FORBIDDEN here: with deliberately divergent
histories, `A...B` measures merge-base to tip, not tip to tip.

## Endpoints

- Source: `origin/agent/automate-v2-baseline-20260901`, code state pinned
  at `0a892f5b105b692d004137b6903f9a3fa12f4c77` (later commits on the
  branch touch only `docs/integration` review metadata, verified with
  `git diff 0a892f5b10 <tip> --stat`)
- Tip: `origin/integration/automate-a5b-app-r1` at
  `f1b259eb8fcfb2d78a2dbea56244d8b63ee53f64`

## Commands (exact, two-dot, review-metadata excluded)

Review metadata (`docs/integration`, `state.md`) lives on the baseline
by design and drifts with every doc update, so the reproducible code
comparison excludes those paths:

```bash
git diff \
  origin/integration/automate-a5b-app-r1 \
  origin/agent/automate-v2-baseline-20260901 \
  --stat -- . `:!docs/integration` `:!state.md`

git diff \
  --name-status \
  origin/integration/automate-a5b-app-r1 \
  origin/agent/automate-v2-baseline-20260901 \
  -- . `:!docs/integration` `:!state.md`
```

## Result (2026-09-06)

8 code files differ, 520 insertions(+), 750 deletions(-):

| File | Status | Classification |
|---|---|---|
| `packages/contracts/src/workflow-ir.ts` | differs | Slice-side IR split core (`1193` lines; monolith is `1794`, over ceiling) |
| `packages/contracts/src/workflow-effect.ts` | tip-only | Slice-side IR split, effects module (`128` lines) |
| `packages/contracts/src/workflow-recovery.ts` | tip-only | Slice-side IR split, recovery module (`363` lines) |
| `packages/contracts/test/digest.test.ts` | tip-only | Slice-side focused digest regression (source covers this in `typed-digest-envelope.test.ts`) |
| `packages/contracts/test/foundation-contracts.test.ts` | tip-only | Slice-side foundation regression for A1 scope |
| `packages/contracts/test/timer.test.ts` | tip-only | Slice-side focused timer regression |
| `packages/contracts/test/workflow-ir.test.ts` | tip-only | Slice-side barrel-compatibility test (locks the 77-export surface) |
| `packages/contracts/test/workflow-map-key.test.ts` | tip-only | Slice-side focused map-key regression |

The unfiltered diff adds exactly three baseline-only review-metadata
paths (`AUTOMATE-PROMOTION-SLICES.md`,
`UNIFIA-CONVERGENCE-AUTOMATE-KNOWLEDGE-UI-ROADMAP.md`, `state.md`),
also allowlisted by category.

| File | Status | Classification |
|---|---|---|
| `docs/integration/AUTOMATE-PROMOTION-SLICES.md` | baseline-only | Review metadata, lives on the baseline by design |
| `docs/integration/UNIFIA-CONVERGENCE-AUTOMATE-KNOWLEDGE-UI-ROADMAP.md` | baseline-only | Review metadata, lives on the baseline by design |
| `state.md` | baseline-only | Session-local memory, never ported by design |
| `packages/contracts/src/workflow-ir.ts` | differs | Slice-side IR split core (`1193` lines; monolith is `1794`, over ceiling) |
| `packages/contracts/src/workflow-effect.ts` | tip-only | Slice-side IR split, effects module (`128` lines) |
| `packages/contracts/src/workflow-recovery.ts` | tip-only | Slice-side IR split, recovery module (`363` lines) |
| `packages/contracts/test/digest.test.ts` | tip-only | Slice-side focused digest regression (source covers this in `typed-digest-envelope.test.ts`) |
| `packages/contracts/test/foundation-contracts.test.ts` | tip-only | Slice-side foundation regression for A1 scope |
| `packages/contracts/test/timer.test.ts` | tip-only | Slice-side focused timer regression |
| `packages/contracts/test/workflow-ir.test.ts` | tip-only | Slice-side barrel-compatibility test (locks the 77-export surface) |
| `packages/contracts/test/workflow-map-key.test.ts` | tip-only | Slice-side focused map-key regression |

## Verdict

Zero undocumented divergence. Every differing file is above, with its
reason. In particular the following are IDENTICAL between tip and
source (previous repair gaps, now closed):

- `packages/workflow-runtime` in full (A3 contract alignment is on both
  sides, verified `120/120` + `53/53` on each side where applicable)
- `packages/workbench-server/src/native-workflow-port.ts` and
  `test/canonical-authority-e2e.test.ts` (#47 assembly on both sides,
  canonical E2E `46` expects on each side)
- `packages/contracts/test/ownership-scope-validation.test.ts`
  (canonical C-M1-04 net restored in the tip)
- `tools/dbos-qualify/README.md`,
  `tools/dbos-real-qualify/README.md` and
  `docs/automation-v2/m0/archive/pre-cp6-3-attribution-repair/README.md`
  (SPDX headers on both sides)

## Reproduction

Fetch both refs, run the two commands above, and compare against the
table. Any file outside the table is a parity failure and blocks PR
creation.