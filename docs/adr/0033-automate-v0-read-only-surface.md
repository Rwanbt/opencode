<!-- SPDX-License-Identifier: MIT -->

---
id: 0033
title: Automate v0 read-only workspace surface
status: SUPERSEDED
superseded-by: 1033
date: 2026-08-14
---

> **Superseded by [ADR-1033](./1033-automate-removed-from-production.md)
> (2026-08-17).** Automate is no longer part of the production surface; see
> that ADR for the current state and rationale.

# ADR-0033: Automate v0 read-only workspace surface

## Context

The desktop Automate route needs a real workspace-backed surface, but the
current Workbench server exposes workflow execution only through POST actions.
It has no typed read-only endpoint for listing workflow definitions. A static
placeholder or an invented API would make unavailable functionality look real.

## Decision

Automate v0 reads the bounded `.unifia/workflows` directory through the existing
`WorkbenchClient.listFiles()` contract with `workspace.read`. It displays the
real definition paths, an explicit empty state, connection state, and errors.

Workflow execution, scheduling, and approval actions remain unavailable until a
versioned read/write workflow contract is added to the authoritative server and
client packages. The UI must not expose an active execution button before that
contract exists.

## Alternatives rejected

- Inventing `GET /v1/workflows`: rejected because no server contract exists.
- Calling the existing workflow POST route from the UI: rejected because it
  would require an untyped definition and an execution capability.
- Keeping a static Automate placeholder: rejected because it provides no real
  workspace behavior and hides the implementation boundary.

## Consequences

- Automate is a genuine read-only vertical slice in v0.
- The workspace remains the authority for available definitions.
- No workflow execution is claimed or simulated.
- A future workflow catalog endpoint can replace the file-index adapter without
  changing the mode navigation contract.

## Implementation references

- `packages/app/src/pages/workbench-mode.tsx`
- `packages/workbench-shell/src/client.ts`
- `packages/workbench-server/src/index.ts`
- `packages/workflow-runtime/src/index.ts`
