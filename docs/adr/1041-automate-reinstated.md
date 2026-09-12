<!-- SPDX-License-Identifier: MIT -->

---
id: 1041
title: Automate reinstated — capability `workflow.run` is now real
status: ACCEPTED
date: 2026-08-18
supersedes: 1033
related: [1033, 0003, 0020]
---

# ADR-1041: Automate reinstated — capability `workflow.run` is now real

## Context

ADR-1033 declared that the Automate surface stays out of production
builds: the surface was a dev-only flag, gated on `import.meta.env.DEV`
and a local-storage dev flag. The reason was that no `workflow.run`
capability existed in the runtime to back the surface; a
production-visible Automate that hit a "no such capability" error would
have been a regression in the design-vs-architecture relationship.

Since ADR-1033, the workbench has added real workflow support: the
`workflow-runtime` package, the workbench-server's `POST /v1/workflows`
route, and the `workflow.run` capability are now part of the
contract surface. The capability check is real: a workflow start
without `workflow.run` is denied and audited.

This ADR supersedes ADR-1033. The dev-only flag is removed; the
surface appears in the rail whenever the workspace has
`workflow.run` granted; it is hidden otherwise. The visible
`SHELL_MODES` constant stays at four entries — the check
`check-mode-registry.mjs` still requires it — but the filter for
"surface is reachable from the rail" is now driven by the capability,
not by a dev flag.

## Decision

### 1. The dev flag is removed

`packages/app/src/context/automate-flag.ts` is neutralised. The
`isAutomateAccessible` function is replaced by a
`isAutomateSurfaceReachable(hasCapability)` function that takes the
capability grant as input, not the dev flag. The local-storage key
is no longer read.

`packages/app/src/context/mode.tsx` no longer imports the dev flag.
The filter for the visible modes is driven by the capability grant
that the workbench context provides; the `SHELL_MODES` array is
unchanged.

### 2. Order is imperative: capability first, UI second

The capability is the gate. The UI is a downstream consequence. The
reverse order reproduces ADR-1033: a surface that pretends to be
usable but fails at the first workflow start.

The workbench-server's `#workflowAction` checks `workflow.run`
before any state is read or written. The audit record `deny` is
emitted when the capability is missing.

### 3. ADR-1033 is superseded, not deleted

ADR-1033 stays in the vault for traceability. The replacement is
ADR-1041. No ADR is ever deleted.

## Alternatives rejected

- **Keep the dev flag alongside the capability check.** Rejected.
  The flag is a separate gate that the capability check is supposed
  to replace. Two gates are worse than one; an agent that is allowed
  by the capability but not by the flag is an inconsistent state.
- **Move the dev flag to a separate env var.** Rejected. The flag
  was a workaround for a missing capability; the capability now
  exists. Adding a second flag re-creates the problem the
  capability was supposed to fix.

## Consequences

- A user with `workflow.run` granted sees Automate in the rail.
- A user without `workflow.run` does not see Automate. The route
  is still defined; the user receives a 403 with an audit
  `deny` if they navigate to it directly.
- The dev flag is no longer read. Existing local-storage entries
  are ignored.
- ADR-1033 stays in the vault for traceability.

## Rollback

Removing this ADR is possible only after removing the `workflow.run`
capability and the workbench-server route. The dev flag was
deleted; the previous behaviour cannot be restored without
re-introducing the flag in `automate-flag.ts`.
