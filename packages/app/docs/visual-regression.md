<!-- SPDX-License-Identifier: MIT -->

# Visual regression harness (V13)

The design surface has a deterministic visual harness that
captures 4 viewports × 2 themes = 8 combinations and compares
each capture against a baseline image. The harness is independent
of the agent runtime (no LLM, no real bridge) and produces a
verdict in two consecutive runs on the same host.

## Scope

What is captured:

- The Vite-rendered home + workbench chrome at 375 / 768 / 1280 /
  1440 px, in light and dark themes.
- The "unsupported" bridge state (per V03) is the only state the
  design surface can reach without a Tauri build, so the captures
  prove the layout, the switcher, and the banner — not the full
  artifact rendering.

What is **not** in scope:

- Captures of the design surface with a live bridge and a real
  agent output. Those need either a Tauri build (V15) or a mock
  bridge fixture (V14).
- The full responsive grid at every size. The harness covers the
  four plan viewports; sub-pixel breakpoints (e.g. 1023 vs 1024)
  are exercised by the unit tests on `resolveLayout`.

## How to run

```bash
# 1. Run the Playwright spec to produce fresh snapshots.
cd packages/app
bunx playwright test e2e/design/design-visual.spec.ts

# 2. The first run has no baseline. Seed it once.
bun scripts/visual-diff.ts --update

# 3. Re-run the spec, then diff.
bunx playwright test e2e/design/design-visual.spec.ts
bun scripts/visual-diff.ts
```

The diff script:

- reads `e2e/visual-snapshots/{name}.png`
- compares against `e2e/visual-snapshots-baseline/{name}.png`
- writes a per-snapshot diff image to
  `e2e/visual-snapshots-diffs/{name}.png`
- writes a JSON report to `e2e/visual-snapshots-report.json`
- exits non-zero if any snapshot exceeds the budget

## Determinism rules

The spec enforces these, the script does not need to re-check:

- **Fonts**: `document.fonts.ready` is awaited before the first
  capture. The web font may not be cached on a fresh checkout, so
  the first run after `bun install` can drift. The `--update`
  flag rebaselines after the fonts are warm.
- **Animations**: a `* { animation/transition: 0s !important }`
  stylesheet is injected before navigation. Any future
  component that introduces an animation that is not handled by
  this rule must either be disabled at the source or pinned in
  the spec.
- **Time**: `Date.now` and `performance.now` are pinned to a
  fixed epoch. Any component that reads the clock is then
  deterministic.
- **Order**: the spec is `viewport × theme`; both are seeded
  before navigation, so the order of execution does not change
  the resulting pixel buffer.

## Budgets

From the V13 plan (§7):

| Axis | Budget |
|---|---|
| Structural regions | 0 pixel diff (excluding anti-aliasing) |
| Whole image | ≤ 0.5% significantly different pixels |
| Mean absolute error | ≤ 1.5/255 |

A pixel is "significantly different" when any RGB channel drifts
by more than 16 (≈ 6% of 255). The noise floor (≤ 2 / channel)
counts toward MAE but not toward the structural budget.

## Updating a baseline

Any change to the design surface that is intended (color tokens,
component shape, copy) requires a baseline update. The process
is:

1. Open a PR with the product change.
2. Run the spec and the diff on a human-checked environment.
3. Open every `e2e/visual-snapshots-diffs/{name}.png` and verify
   the diff matches the intent. A refactor that shifts the layout
   by 2 px is a *failure* even if the budget passes; the budget
   is a guard, not a license.
4. Run `bun scripts/visual-diff.ts --update` and commit the
   new baseline alongside the product change.

A bare `--update` without a human review is forbidden. The
discipline is in the manual eye, not the script.

## Local environment

The script depends on:

- `sharp` (already in the lockfile via `@playwright/test`'s
  transitive deps).
- A Vite dev server (`bun run dev`). The Playwright config
  launches it automatically.
- A Chromium browser (Playwright's default project).

The CI runners documented in the project are slower than the
local dev host. Set `PLAYWRIGHT_EXPECT_TIMEOUT=60000` on a fresh
runner to avoid timing flakes; the visual diff is independent
of that timeout.
