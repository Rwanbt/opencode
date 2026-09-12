<!-- SPDX-License-Identifier: MIT -->

---
id: 1034
title: Token capability scope vs the approval broker — who is authoritative
status: ACCEPTED
date: 2026-08-17
---

# ADR-1034: Token capability scope vs the approval broker — who is authoritative

## Context

The audit (`UNIFIA-WORK-DESIGN-AUDIT-b7add2bb.md`, finding SEC-001) found that
`WorkbenchServer#checkCapability(capability, resource)` only ever called
`this.#capability.check(capability, resource, "workbench-server")` — it never
received the calling principal, so a token issued with only
`["workspace.read", "workspace.watch"]` could still reach the server-wide
`CapabilityGate` for `workflow.run`, `desktop.control`, `workspace.write`, or
any other capability, and get `202 approvalRequired` instead of `403`. No
document explained which of the two — the token's own scopes, or the
gate's server-wide allowlist/approval broker — was supposed to be
authoritative for a given request. That ambiguity is exactly what produced
SEC-001: two mechanisms existed, neither fully owned the decision, and the
gap between them was where a mutating request slipped through.

## Decision

Both are authoritative, for different questions, checked in this order:

1. **The token's own scope** (`principal.scopes`, built from
   `ScopedTokenRequest.capabilities` at `#authenticate`) answers: *was this
   specific caller ever handed this capability at all?* A capability absent
   from the token's scope is refused at `403` before the gate runs, **unless**
   it is step-up eligible (below) — see `#checkCapability`,
   `packages/workbench-server/src/index.ts`.
2. **The `CapabilityGate`** (`this.#capability.check(...)`, typically
   `ApprovalCapabilityGate`) answers, only for requests that pass step 1:
   *is this specific operation, on this specific resource, currently allowed
   — outright (server allowlist), already approved, or does it need a new
   approval?*

**Capability matrix for `work-design`** (2026-08-17; updated 2026-08-31):

| Capability | Granted at connection | Reaches the gate without it? |
|---|---|---|
| `workspace.read`, `workspace.watch` | Yes (`READ_CAPABILITIES`, `provider.tsx`) | N/A — always present |
| `artifact.create`, `artifact.export` | No | **Yes — step-up eligible** (`STEP_UP_ELIGIBLE_CAPABILITIES`) |
| `workflow.run`, `desktop.control`, `desktop.observe`, `browser.navigate`, `package.install` | No | No — hard `403`, gate never runs |
| `workspace.write` | **Yes** (widened 2026-08-23, see Update below) | N/A — always present in `principal.scopes` when the surface lease requests it |

Step-up eligibility exists because Design/Work trigger `artifact.create`
(save) and `artifact.export` (export) for real, on a token that only ever
carries the base read/watch lease — without it, save and export break
outright instead of asking for confirmation. Every other capability has no
legitimate caller in `work-design` (Automate/`workflow.run` is out of scope,
see ADR-1033; `workspace.write`, `desktop.control`, `browser.navigate`,
`package.install` have no UI surface that requests them here) — a token
should never be able to make the gate even consider them, regardless of how
the gate itself is configured.

Enforced at three layers, all independently, since a caller can reach the
server at any of them:

- **Server** (`workbench-server/src/index.ts`): `#checkCapability` as above.
- **Native/Tauri** (`desktop/src-tauri/src/lib.rs`): `workbench_issue_token` /
  `workbench_rotate_token` refuse any requested capability outside
  `ALLOWED_CONNECTION_CAPABILITIES` (`workspace.read`, `workspace.watch`)
  before ever calling the sidecar — the connection lease is never issued
  with a step-up or never-granted capability in the first place.
- **Sidecar** (`packages/unifia/src/server/workbench.ts`): `readInput`
  checks each requested capability against `P3_CAPABILITIES` (a real,
  known capability name), catching malformed input before it reaches
  `issueNativeScopedToken`. It intentionally does not re-implement the
  connection-time allowlist — that boundary belongs to the native layer and
  to `#checkCapability`; duplicating it here would be a second copy of the
  same fact that could drift from the other two.

## Alternatives rejected

- **Token scope alone, no gate**: rejected. The gate's approval broker is
  what turns a step-up-eligible capability into a real user-facing
  confirmation (`202 approvalRequired` → `/v1/approvals/:id`); removing it
  would mean either granting artifact.create/export unconditionally to every
  connection (defeats the point of scoping the lease) or hard-blocking
  Design save/export entirely.
- **Gate alone, no token scope check**: rejected — this is the pre-fix
  state and is exactly SEC-001.
- **A single merged allowlist covering both connection-time issuance and
  request-time authorization**: rejected. The native layer's allowlist
  (what a token may ever be issued with) and the server's step-up set (what
  may still reach the gate despite being absent from the token) answer
  different questions at different times; collapsing them would make the
  native layer aware of resource-scoped approval semantics it doesn't need.

## Consequences

- A token can only ever be issued with `workspace.read`/`workspace.watch`
  (native layer) or trigger step-up for `artifact.create`/`artifact.export`
  (server layer) in this branch. Every other capability is unreachable by
  construction at two independent layers.
- Adding a legitimate new step-up-eligible capability requires an explicit,
  reviewed change to `STEP_UP_ELIGIBLE_CAPABILITIES` — it cannot happen by
  accident through the gate's own configuration.
- `workflow.run` is refused before the gate runs regardless of how the gate
  is configured — see `capability-scope.test.ts`'s dedicated test asserting
  this even against a gate stub that would otherwise allow everything.

## Update 2026-08-31 — `workspace.write` widened to the connection lease

The capability matrix above lists `workspace.write` as "No — hard 403".
In practice, since 2026-08-23, the connection lease the surface requests at
`WorkbenchClient.connect` time carries `workspace.write` because two real
Design/Work operations need it:

1. **Fichiers CRUD** — the file picker, the CRUD panel, the rename and
   remove operations all call `#files(..., "create" | "write" | "remove" |
   "rename", principal)` (`packages/workbench-server/src/index.ts:630-673`),
   which checks the `workspace.write` capability. With a read/watch-only
   lease, every one of those routes answered a flat 403 in the shipped app
   while passing its own tests against a fully-scoped test principal.
2. **Composer uploads** — the artifact preview composer writes to the
   workspace via the same `workspace.write` route.

`artifact.preview` is widened for the same reason and is narrower than
`workspace.read`: it reads one artifact's bytes, not arbitrary workspace
files. Without it `ArtifactPreview`'s read of the raw artifact answered a
flat 403, because `artifact.preview` is not step-up eligible either.

The shipped surface — three layers in agreement — is:

- `packages/workbench-shell/src/routes.ts:185` —
  `SURFACE_LEASE_CAPABILITIES = ["workspace.read", "workspace.write",
  "workspace.watch", "artifact.preview"]` (with an inline comment that
  documents the same widening).
- `packages/workbench-server/src/index.ts:98-103` — `SURFACE_GRANTED_CAPABILITIES`
  mirrors the same four.
- `packages/desktop/src-tauri/src/lib.rs:183-188` —
  `ALLOWED_CONNECTION_CAPABILITIES` (the native bridge's issuance guard) is
  the same four.

The matrix in this ADR is now stale. The widening is **intentional**, not
a regression: the server's `#checkCapability` (`index.ts:1304-1313`) still
refuses any capability absent from `principal.scopes` before the gate runs,
so a token that was never issued `workspace.write` is still refused without
ever creating an approval. Only a token that asked for `workspace.write`
at connection time (which only the WebView's surface lease does today) ever
reaches the gate, and the gate is configured to allow it.

This update is documentation, not a behavioural change: the code path
described above has been live since 2026-08-23. The matrix is brought into
agreement with the shipped surface; the decision (token-scope check first,
then gate) is unchanged.

## Implementation references

- `packages/workbench-server/src/index.ts` (`#checkCapability`,
  `STEP_UP_ELIGIBLE_CAPABILITIES`)
- `packages/workbench-server/test/capability-scope.test.ts`
- `packages/desktop/src-tauri/src/lib.rs`
  (`reject_disallowed_capabilities`, `ALLOWED_CONNECTION_CAPABILITIES`)
- `packages/unifia/src/server/workbench.ts` (`readInput`,
  `KNOWN_CAPABILITIES`)
- `packages/unifia/test/server/workbench-bridge.test.ts`
