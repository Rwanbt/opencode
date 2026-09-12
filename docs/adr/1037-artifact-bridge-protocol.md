<!-- SPDX-License-Identifier: MIT -->

---
id: 1037
title: Artifact bridge protocol — host ⇄ iframe message contract
status: ACCEPTED
date: 2026-08-17
supersedes: null
related: [1035, 1036, 1038]
---

# ADR-1037: Artifact bridge protocol — host ⇄ iframe message contract

## Context

The artifact iframe introduced in ADR-1035 is sandboxed with
`allow-scripts` only — it has no DOM access to the host, no shared storage,
no shared globals. The two sides need to communicate for three reasons the
existing surface cannot meet:

1. The host has to tell the iframe when the user has activated the
   picker (a click-to-select mode for "ask the agent to change this
   element").
2. The iframe has to report back which element was clicked.
3. The host has to be able to ask the iframe for a snapshot of itself
   (rasterised image, current dimensions) so the agent has actual visual
   context, not just markup.

The only channel that crosses the sandbox boundary in either direction is
`window.postMessage`. The contract on the wire — every type, every payload,
every acceptance check — must be spelled out before any P11/P15–P20 work
touches the iframe mount point. Open Design ships its own message
protocol, prefixed `od:`; the runbook §2 freezes the Unifia prefix as
`unifia:`, and the `od:` namespace is reserved for an interop shim if and
when one is ever built, not used in v1.

## Decision

### 1. Prefix and namespace

Every `MessageEvent` flowing between the host and the artifact iframe has
a `data.type` field whose value is a string of the form
`unifia:<verb>-<noun>`. The literal `od:` prefix, used by Open Design's
own bridge, is **forbidden** in v1. A bridge shim that translates between
`od:` and `unifia:` for an Open-Design-imported artifact is out of scope
for the parity program and would be a new ADR if and when it becomes
relevant.

### 2. v1 message catalogue

The complete v1 catalogue is below. Adding a type requires an avenant
to this ADR (see §5). Removing a type requires a deprecation notice in
the successor ADR. The catalogue is **closed** at v1; the host rejects
everything outside it.

| Direction | `type` | Payload | Initiator | Purpose |
|---|---|---|---|---|
| host → iframe | `unifia:select-mode` | `{ enabled: boolean, tool: "picker" }` | host (UI toggle) | Tell the iframe to enter or leave picker mode. In picker mode, the iframe attaches a `click` listener to the body, captures the closest element with a `data-unifia-id` attribute, and posts back a `unifia:select-target`. The host never reads `iframe.contentDocument` (ADR-1035 §4); the `tool` field is the only tool kind in v1 and is reserved to make future expansion (e.g. `tool: "annotation"`) a non-breaking extension. |
| iframe → host | `unifia:select-target` | `{ elementId: string, rect: DOMRectLike }` | iframe (user click) | Report the element the user picked. `elementId` is the value of the `data-unifia-id` attribute the agent set in the artifact. `rect` is the element's bounding box in iframe-local coordinates, used by the host to draw a transient outline; it is *not* trusted for any security decision. |
| host → iframe | `unifia:snapshot` | `{ id: string, full: boolean }` | host (toolbar) | Ask the iframe to produce a rasterised snapshot. `id` is a correlation token the host uses to match the result with the requesting toolbar action. `full` requests a snapshot of the full document; `full: false` requests a snapshot of the viewport. |
| iframe → host | `unifia:snapshot-result` | `{ id: string, dataUrl?: string, width?: number, height?: number, error?: string }` | iframe (response) | Return the rasterised snapshot, or an error. `dataUrl` is a `data:image/png;base64,...` URL when successful. The host treats the bytes as untrusted (an adversarial artifact could embed anything in a "screenshot" reply) and routes them straight into the agent as image context, never to `eval`, never to a `<script src>`, never to a download trigger that bypasses the approval broker. |
| iframe → host | `unifia:ready` | `{}` | iframe (mount) | Sent exactly once, immediately after the iframe's DOM is parsed and its `unifia:` event listener is installed. The host treats the absence of `unifia:ready` after a 5-second timeout as a render failure and shows the inert text fallback for that artifact. |

`DOMRectLike` is `{ x: number, y: number, width: number, height: number }`
— the iframe's `DOMRect` is serialised through `JSON.stringify` by the
`postMessage` structured-clone algorithm, which means the host receives a
plain object. The host type-validates it on receipt.

### 3. Origin validation policy

The iframe **does not** validate `event.origin`. The reason is structural,
not ergonomic: the iframe is loaded via `srcDoc` from a parent of
arbitrary origin (Tauri `tauri.localhost` in dev, the production
Tauri-served origin in a packaged build, the `127.0.0.1` loopback when
the workbench is running on a remote box, etc.). The set of legitimate
origins is non-enumerable in the general case and would be wrong as soon
as the user runs the same workbench on a different host or behind a
different port. The right defence is the sandbox, not origin
verification: with `sandbox="allow-scripts"` and no `allow-same-origin`,
the iframe cannot read the host's storage, cannot navigate the host, and
cannot call the host's JS — even an attacker who can `postMessage` into
the iframe from any origin can only trigger the message types the iframe
chooses to handle, and the iframe is expected to handle *only* the
`unifia:`-prefixed types. Messages with unknown types are silently
dropped.

The host **does** validate every `MessageEvent` it receives against the
catalogue in §2. A message whose `data.type` is not in the catalogue is
dropped without echoing the rejected `type` in `console.warn` or
`console.error` — the absence of an error log is intentional, to deny
an attacker the side channel of "the host is logging my rejected type".
A message whose payload fails the type's schema (e.g. `select-target`
without `elementId`) is dropped for the same reason. The host does not
re-emit rejected messages to any other listener, including the agent.

The host is the only side that opens a path to anything outside the
iframe. Every host-to-iframe call is explicit user action (a click on
"enter picker mode", a click on "snapshot now"). The host never
subscribes to a "broadcast" channel.

### 4. Versioning

The `unifia:` prefix carries no version segment. Versioning is on the
*catalogue* — the table in §2 is the v1 catalogue. An iframe that wants
to negotiate a higher version sends a future `unifia:hello` (or
equivalent) message; the absence of that message in v1 means the host
assumes the iframe speaks only v1 types and rejects everything else.

A v2 catalogue is an avenant to this ADR. The host will refuse to
mount an iframe that announces a v2-only type without the v2
catalogue being installed.

### 5. Extension rule

Adding a `unifia:`-prefixed message type is a security-relevant change
because the host's allow-list is the single point of trust for what
the iframe can ask. An addition requires:

- An avenant to this ADR with the new type, its payload, its
  initiator, and the threat-model delta (what new attack does this
  open, and what new control closes it).
- A corresponding change to the host's allow-list (`packages/artifact-render/src/bridge.ts`
  in P11) and to the iframe's handler set (in the artifact runtime).
- A passing guard run — `scripts/check-bridge-types.mjs` is introduced
  in P11 to assert the allow-list matches this ADR; P03 only specifies
  the catalogue.

## Alternatives rejected

- **Reuse Open Design's `od:`-prefixed protocol verbatim**: rejected.
  The Unifia prefix is frozen by the runbook §2 to `unifia:`, and
  re-using `od:` would couple the bridge to Open Design's wire
  format, which can change upstream without warning. The translation
  cost of a future interop shim is one file; the cost of an unbounded
  upstream dependency is "Open Design breaks us at will".
- **Allow the host to call `iframe.contentWindow.eval(...)` for a
  "narrowly scoped" introspection API**: rejected. This is the
  same-origin surface in disguise, and the audit's whole point is
  that the iframe is untrusted. `postMessage` is sufficient for
  every need in §2; there is no use case that requires
  `contentWindow.eval` and cannot be expressed as a `unifia:`
  message.
- **Validate `event.origin` in the iframe against a hard-coded list
  of legitimate origins**: rejected. The legitimate origin set is
  platform-dependent (Tauri `tauri.localhost` in dev, a
  `https://app.unifia.ai`-style origin in production web, the
  loopback in remote-box deployment) and would be wrong on at least
  one of those surfaces. The sandbox is the real boundary.
- **Use a more elaborate envelope (typed message IDs, sequence
  numbers, signed payloads)**: rejected for v1. The
  `JSON.stringify`-clonable payload is enough for the catalogue in §2;
  adding an envelope is a v2 problem. An envelope change is exactly
  the kind of avenant §5 anticipates.

## Consequences

- The host, the iframe, and the bridge implementation share one
  closed catalogue. The catalogue is small and explicit; reviewers
  can spot a missing or extra type by reading §2.
- A new type is impossible to add silently. The avenant rule means
  every addition is its own review, with its own threat-model delta.
- The host becomes the audit point: every message leaving the
  iframe is logged in the workbench trace, every message the host
  rejects is silent. An attacker probing the bridge from the iframe
  side sees no signal of which types they got right.
- The bridge implementation (`packages/artifact-render/src/bridge.ts`,
  P11) is the only place that imports the v1 catalogue. The runtime
  contract is the ADR; the code reads it.

## Rollback

Removing this ADR deletes the bridge. The host falls back to the
inert text preview for every artifact, and the picker, snapshot, and
select-target interactions stop existing. The artifact iframe
introduced in ADR-1035 still mounts — it just no longer receives any
`unifia:` messages and never sends any back. ADR-1035 and ADR-1036
remain valid in their own scope.

## Implementation references

- `packages/artifact-render/src/bridge.ts` (P11) — the host-side
  allow-list, reading the v1 catalogue from a generated module that
  is produced from this ADR.
- `packages/artifact-render/src/preview-frame.tsx` (P11) — the
  iframe mount, the `unifia:ready` send on parse, the click handler
  in picker mode.
- `packages/artifact-render/src/snapshot.ts` (P17) — the
  `unifia:snapshot` request, the `unifia:snapshot-result` reply,
  the agent-bound image context dispatch.
- `packages/artifact-render/src/picker.ts` (P18) — the
  `unifia:select-target` reply and the host's outline render.
- `scripts/check-bridge-types.mjs` (P11) — the guard that fails the
  build if `bridge.ts` drifts from the catalogue in §2.
- `docs/adr/1035-untrusted-artifact-rendering.md` — the sandbox
  contract this protocol runs over.
- `docs/adr/1036-csp-artifact-frame.md` — the CSP that constrains
  what the iframe can do even with the protocol in place.
- `docs/adr/1038-design-capabilities.md` — the capabilities the
  bridge eventually unlocks, including the broker-gated ones.
