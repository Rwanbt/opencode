<!-- SPDX-License-Identifier: MIT -->

---
id: 1038
title: Design capabilities — what the Design mode can ask the server to do
status: ACCEPTED
date: 2026-08-17
supersedes: null
related: [1034, 1037, 0007, 0009, 0019]
---

# ADR-1038: Design capabilities — what the Design mode can ask the server to do

## Context

The Design mode needs a small, closed set of server-side capabilities to
be productive. They range from a read of raw artifact content (to
populate the iframe preview) to triggering image generation. Each one
must be named, scoped, and tied to a route or an internal call, and each
one must say whether it is a connection-time grant, a step-up grant
eligible through the approval broker, or a hard refusal.

The previous program of work left the capability landscape inconsistent.
ADR-1034 split "token scope" from "approval broker" and made
`workflow.run` unreachable in `work-design` regardless of gate
configuration — that split is the foundation this ADR builds on. ADR-1033
removed Automate from the production surface in this branch. Both are
in force today.

This ADR names the new capabilities the Design mode needs, maps each to
a route or internal call, and states the broker posture for each. It
does not change the broker itself, the token-scope check, or the
step-up list. It does not grant anything that is currently refused.

## Decision

The Design mode needs six capabilities. Five of them are new in this
ADR; one (`workflow.run`) is restated as a non-grant to keep the
program's contractual surface explicit. The table is the authoritative
list for v1 of the Design mode. Adding a capability requires an
avenant to this ADR; renaming or splitting an existing one also does.

| Capability | Authorises | Route / call | Broker posture |
|---|---|---|---|
| `artifact.preview` | Read the raw, unrendered content of an artifact for the purpose of mounting it in the artifact iframe (ADR-1035). Returns the bytes; the host wraps them in a `<meta http-equiv="Content-Security-Policy">` per ADR-1036 §1. | `GET /v1/artifacts/:artifactId/raw/:path` (new in P10) | Step-up eligible. The connection lease never carries `artifact.preview`; the broker issues a per-request grant when the picker toolbar asks for a preview. Reason for step-up rather than connection-time grant: previews are the only path through which the iframe CSP backstop gets evaluated, and we want every preview to be a deliberate user-visible action. |
| `artifact.render` | Ask the server to materialise an artifact into a self-contained document (e.g. compile a `design-draft` spec into a final HTML page). Distinct from `artifact.preview` because `render` produces new content while `preview` reads existing content. | Internal call (`packages/workbench-server/src/render.ts`, new in P13) — no route, no inbound HTTP. The render happens server-side on a request originating from a step-up-eligible `artifact.create` or `artifact.export` call. | Step-up eligible, transitively. The host's call into the server carries the same token that triggered the export or create, and the broker enforces the same gate. |
| `designsystem.read` | Read the design system catalogs declared in `.unifia/workspace.json` (ADR-1040). | `GET /v1/design-systems` (exists today, capability is `workspace.read` — see "Open question" below) | Step-up eligible in v1 of this ADR, **even though the existing route uses `workspace.read`**. The route returns the same data the workspace manifest already authorises reading; the new capability exists so that a future policy tightening (e.g. "deny design systems on read-only connections") is a one-line gate change rather than a route refactor. Until that tightening lands, `designsystem.read` and `workspace.read` are effectively interchangeable for the broker — the broker's allow-list lists both, and either suffices. |
| `plugin.apply` | Apply a marketplace plugin to a conversation. Distinct from `package.install` (which is a code-install verb, also capability-gated per ADR-1034). | `POST /v1/plugins/:pluginId/apply` (new in P29) | Hard `403` in v1 — the marketplace is not in scope. The route is registered as not-grantable to mirror the pre-emptive posture of `workflow.run`. The marketplace work in P29 will revisit this and either grant it through a step-up flow or leave it refused. |
| `media.generate` | Trigger an image, video, or audio generation through the workbench's media endpoints. | `POST /v1/media/generate` (new in P31) | Step-up eligible. Reason: a generation is irreversible once started (the cost is on the bill) and the artifact it produces is permanent, so a user-visible confirmation per generation is the right grain. |
| `workflow.run` | Execute a workflow through the workbench's workflow engine. | `POST /v1/workflows/start` (new in P30) | **Hard `403` until P30.** This restates the pre-`work-design` posture (ADR-1033, finding ARCH-001) and the split from ADR-1034. The capability is named here so that the program has a single place to look up "what does the Design mode need from the broker"; the answer for this one is "nothing, today". P30 is the card that rehabilitates the workflow engine; **at that point ADR-1033 becomes caduque** and this capability flips to step-up eligible per the workflow-engine annex of the remediation plan. Not before. |

### Open question: `designsystem.read` vs `workspace.read`

The current route in `packages/workbench-server/src/index.ts` line 236
uses `workspace.read` as the gate for `GET /v1/design-systems`. ADR-1040
makes the design-system catalog a first-class workspace resource, so
the new capability name (`designsystem.read`) is the right surface
name. The route keeps `workspace.read` for now to avoid a breaking
change to the gate. The P10–P12 work adds the new capability as a
broker-side alias; the route is updated to use the new capability
in a follow-up. This ADR records the alias as the v1 contract; the
route-side migration is a separate, well-scoped refactor that the
implementation must call out explicitly.

### `workflow.run` and the expiry of ADR-1033

ADR-1033 currently removes Automate from the production surface. The
rehabilitation of the workflow engine (annex A of the remediation plan)
is the work that will make ADR-1033 obsolete. Until that work lands —
specifically, until P30 is closed and `workflow.run` is granted through
a real step-up flow — this ADR keeps the hard-`403` posture on
`workflow.run`, and ADR-1033 remains in force. The two ADRs will
transition together: when P30 closes, ADR-1033 is marked SUPERSEDED
in this same `related` block, and `workflow.run`'s row in the table
above changes from "Hard `403` until P30" to "Step-up eligible". Not
before.

## Alternatives rejected

- **Grant `workflow.run` to "make the workflow picker look alive" in
  v1**: rejected. ADR-1033 documents exactly why this is wrong — a
  mode that looks interactive but cannot function is worse than no
  mode. The button has to be absent, not grayed.
- **Make every new capability connection-time grants**: rejected. The
  read-only connection lease (ADR-1034) is intentionally narrow, and
  any capability that produces side effects (render, generate, apply)
  must be a step-up so the user sees the confirmation.
- **Make every new capability hard `403`**: rejected. `artifact.preview`,
  `artifact.render`, and `media.generate` are legitimate user-driven
  needs; a hard refusal would break the Design mode's primary flows.
- **Reuse the `workspace.read` capability name for design-system
  reads and skip introducing `designsystem.read`**: rejected. The
  capabilities are a contract surface, and naming the design-system
  read distinctly lets the broker tighten independently in the
  future. The cost is one alias; the benefit is a smaller blast
  radius for any tightening.
- **Skip the explicit "ADR-1033 becomes caduque at P30" line**:
  rejected. Without that line, the program has no single place that
  names the workflow-engine card as the trigger for ADR-1033's
  expiry, and the two ADRs can drift. The line costs nothing and
  prevents that drift.

## Consequences

- The Design mode has six named capabilities, each tied to a route
  or internal call, each with an explicit broker posture. Reviewers
  can verify the matrix against the broker's allow-list and
  step-up set in `packages/workbench-server/src/index.ts` and
  `packages/workbench-server/src/security.ts`.
- `workflow.run` is a contractual no-op in this branch until P30.
  Any code that would call it in v1 is broken by design; a
  reviewer who sees such a call should ask why the gate was not
  consulted.
- `designsystem.read` exists as a name today and as a broker alias;
  the route-side migration to use it as the gate is a follow-up
  and is tracked in the open question above.
- Adding a capability is now a security-relevant change. The
  avenant rule means any addition has a threat-model delta
  attached.

## Rollback

Removing this ADR deletes the capability matrix. The routes that
already exist (`/v1/design-systems`) keep their existing gates
(`workspace.read`); the new routes introduced by P10–P30 do not
exist before P30 in any case, so removing this ADR is effectively
a documentation change for the post-P30 work and a no-op for the
pre-P30 branch. ADR-1033 stays in force unchanged. The broker
allow-list and step-up set are unchanged.

## Implementation references

- `packages/workbench-server/src/index.ts` (`#checkCapability`,
  `STEP_UP_ELIGIBLE_CAPABILITIES`) — the broker enforcement, from
  ADR-1034.
- `packages/workbench-server/src/render.ts` (P13) — the
  `artifact.render` internal call.
- `packages/contracts/src/capability.ts` (P10) — the
  capability-name constants this ADR names, exported as TypeScript
  literal types so a typo at a call site is a compile error.
- `packages/workbench-shell/src/routes.ts` — the
  `M_DESIGN_ROUTE_REGISTRY` added in P10 to declare the new
  routes against the matrix.
- `docs/adr/1033-automate-removed-from-production.md` — the
  `workflow.run` non-grant that this ADR restates and that P30
  supersedes.
- `docs/adr/1034-token-capability-scope-vs-approval-broker.md` —
  the token-scope / approval-broker split that defines what
  "step-up eligible" and "hard `403`" mean.
- `docs/adr/1037-artifact-bridge-protocol.md` — the bridge whose
  catalogue is the only thing the host exposes to the iframe;
  the capabilities here are server-side, the bridge is host-side.
- `docs/adr/1039-artifact-manifest.md` — the artifact manifest
  format that the preview and render capabilities consume.
- `docs/adr/1040-design-system-contract.md` — the
  `.unifia/workspace.json` shape that `designsystem.read` reads.
