<!--
SPDX-License-Identifier: MIT
Copyright (c) 2026 Unifia contributors
-->

# Automate Promotion Parity (A5b-r2 vs Source)

Reproducible tree-parity proof for the repaired promotion stack.
Three-dot diffs are FORBIDDEN here: with deliberately divergent
histories, `A...B` measures merge-base to tip, not tip to tip.

## Endpoints

- Source: `origin/agent/automate-v2-baseline-20260901` at
  `6bb7f153d6a6e53a2c22da0d3d5af683625a364b` (includes the r2 atomic
  boundary, effect machine, precedence and HTTP-proof code)
- Tip: `origin/integration/automate-a5b-app-r2` at
  `93343127838d008568b3143d8e24773da4ca9c9a`

## Commands (exact, two-dot, review-metadata excluded)

Review metadata (`docs/integration`, `state.md`) lives on the baseline
by design and drifts with every doc update, so the reproducible code
comparison excludes those paths:

```bash
git diff \
  origin/integration/automate-a5b-app-r2 \
  origin/agent/automate-v2-baseline-20260901 \
  --stat -- . `:!docs/integration` `:!state.md`

git diff \
  --name-status \
  origin/integration/automate-a5b-app-r2 \
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

The unfiltered diff adds exactly four baseline-only review-metadata
paths (`AUTOMATE-PROMOTION-PARITY.md`,
`AUTOMATE-PROMOTION-SLICES.md`,
`UNIFIA-CONVERGENCE-AUTOMATE-KNOWLEDGE-UI-ROADMAP.md`, `state.md`),
allowlisted by category (12 files, 955 insertions(+), 750 deletions(-)
unfiltered).

## Verdict

Zero undocumented divergence. Every differing file is above, with its
reason. In particular the following are IDENTICAL between tip and
source (previous repair gaps, now closed):

- `packages/workflow-runtime` in full (effect machine, precedence,
  atomic core and contract alignment on both sides; runtime suite
  `127/127` on each side)
- `packages/workbench-server/src/native-workflow-port.ts`,
  `test/canonical-authority-e2e.test.ts` (`50` expects),
  `test/workflow-terminal.test.ts` and
  `test/workflow-versions-http.test.ts` (#47 assembly, terminal
  boundary and HTTP proofs on both sides)
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