<!-- SPDX-License-Identifier: MIT -->

---
id: 1033
title: Automate removed from the production surface
status: ACCEPTED
date: 2026-08-17
supersedes: 0033
---

# ADR-1033: Automate removed from the production surface

## Context

ADR-0033 shipped Automate v0 as a genuine read-only vertical slice: real
`.unifia/workflows` listing, no execution. The `work-design` audit
(`UNIFIA-WORK-DESIGN-AUDIT-b7add2bb.md`, finding ARCH-001) found that this
read-only surface still reaches a real `startWorkflow` call
(`workbench-mode.tsx:305`) with no server-side capability ever granted for
`workflow.run` in this branch — the button is wired to an action the backend
will always refuse. A mode that looks interactive but cannot function is
worse than no mode: it invites a user into a dead end instead of failing
closed.

The successor workflow engine (contract, permissions, budgets,
anti-recursion, scheduler) is scoped separately as annex A of the
remediation plan and is not part of `work-design`.

## Decision

Automate is **absent from the production interface**:

- `SHELL_MODES` (`packages/workbench-shell/src/modes.ts`) keeps its four
  entries — it is the shared navigation contract, guarded by
  `scripts/check-mode-registry.mjs`, and other ADRs and tests depend on its
  shape.
- The rail and the router are the two production surfaces, and both are
  gated by `isAutomateAccessible(import.meta.env.DEV, devFlag)`
  (`packages/app/src/context/automate-flag.ts`), off by default:
  - `packages/app/src/context/mode.tsx` filters `automate` out of the modes
    passed to the sidebar rail.
  - `packages/app/src/context/mode-directory.ts` treats `/:dir/automate` as
    an unresolved route (`kind: "invalid"`) unless the flag is set, so the
    URL is not a bypass around the missing rail entry.
- `import.meta.env.DEV` is replaced with the literal `false` in a production
  bundle by the bundler, so the accessible branch is dead-code-eliminated —
  not merely runtime-gated — in any build that is not a local dev server.
- No path in a production build can reach `WorkbenchClient.startWorkflow`:
  `AutomateSurface` (`workbench-mode.tsx`) only mounts when the router
  resolves an `automate` route, which it cannot do in that build.

## Alternatives rejected

- **Keep it visible, marked "preview"**: rejected. A reachable
  non-functional mode in production is exactly the failure this ADR closes;
  a label does not change what the button does when clicked.
- **Remove `automate` from `SHELL_MODES`**: rejected. The registry is a
  shared contract other code and tests assert against (four entries); the
  fix belongs at the production-surface boundary, not in the contract.

## Consequences

- Automate remains fully implemented and reachable behind a developer-only,
  build-time-eliminated flag, so the successor workflow-engine work (annex A
  of the remediation plan) has continuity to build on.
- `work_design/STATE.md` no longer claims Automate is an exposed read-only
  surface in this branch.
- A future workflow catalog/execution contract (annex A) removes this gate
  entirely rather than working around it.

## Implementation references

- `packages/app/src/context/automate-flag.ts`
- `packages/app/src/context/mode-directory.ts`
- `packages/app/src/context/mode.tsx`
- `packages/app/src/context/mode.test.ts`
