<!-- SPDX-License-Identifier: MIT -->

# ADR-0010: Shell modes project a single Workbench workspace

**Date**: 2026-08-14 | **Status**: Accepted

## Context

Code, Work, Design and Automate must preserve one decoded workspace, one session lineage and one native Workbench lease. Route state, mode chrome and resource data previously had independent fallback paths, which made a return to Code diverge from the visible projection.

## Decision

The URL is the authoritative mode selector. `DirectoryLayout` owns the decoded workspace boundary and mounts one `WorkspaceWorkbenchProvider`; Workbench lifecycle state owns connection, rollback, deadline and cleanup. Surfaces consume TanStack Query entries keyed by server origin, instance, workspace, resource and parameters. SessionHeader titlebar content is registered through reactive refs owned by the Solid titlebar.

## Alternatives rejected

- A connection per mode: rejected because workspace-scoped revoke can invalidate a sibling mode.
- DOM id lookup for titlebar slots: rejected because it races mount order and does not react to replacement.
- Silent fallback to Code or demo data: rejected because invalid state must remain visible and diagnosable.

## Consequences

Mode changes are route transitions over shared providers, not runtime launches. A native bearer remains short-lived and scoped; signing material and IPC secrets stay native. GUI smoke tests remain required for Windows controls, DPI, shutdown and Snap behavior.
