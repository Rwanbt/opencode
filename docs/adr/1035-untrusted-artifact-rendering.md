<!-- SPDX-License-Identifier: MIT -->

---
id: 1035
title: Untrusted artifact rendering — sandboxed iframe contract
status: ACCEPTED
date: 2026-08-17
supersedes: null
related: [1036, 1034]
---

# ADR-1035: Untrusted artifact rendering — sandboxed iframe contract

## Context

The Design mode renders artifacts produced by an agent — HTML pages, decks,
component previews, design-system reports, exported documents. These artifacts
are **untrusted by construction**: the agent can be tricked into emitting
malicious HTML, the upstream model can be jailbroken, and the user-generated
content embedded in an artifact can itself contain hostile markup. The
statu quo (`generative-ui-dom` 4-component allow-list) is safe for
in-conversation UI — it covers the small set of pre-approved Solid components
and stops at their props. It does not cover arbitrary HTML/CSS/JS an agent
wants to ship as a "page" or "preview". Without a separate path, the only
options are (a) refuse parity or (b) render the artifact in the host page
directly. Both are unacceptable: (a) breaks the Open Design parity mandate
([[Unifia/Runbook-Parite-OpenDesign-2026-08-17|runbook §1 décision gelée]]);
(b) hands the artifact full access to the host origin.

This ADR fixes the rendering path for arbitrary untrusted artifacts. It does
**not** change the path used by `packages/generative-ui-dom` — the
4-component allow-list remains exactly as it is, intact and separate.

## Decision

### 1. Container

Every artifact produced by an agent in Design mode is rendered in an
`<iframe>` element with the `sandbox` attribute set to exactly:

```
sandbox="allow-scripts"
```

The full token list for v1 is `allow-scripts` only. No other token is
permitted in the attribute.

### 2. `allow-same-origin` is forbidden

The token `allow-same-origin` is **never** added to the `sandbox` attribute.
There is no exception, no developer flag, no environment variable, no
`if (import.meta.env.DEV)` branch, no opt-in dialog. The reason is not
ergonomics — it is structural. With `allow-same-origin`, the artifact is
treated as same-origin to the host page, which means it can read the host's
cookies, localStorage, IndexedDB, and any auth-bearing storage the
Workbench server has populated. The `unifia:ready` handshake (ADR-1037) and
the `unifia:snapshot` / `unifia:snapshot-result` / `unifia:select-target`
bridges are designed precisely to **not** need same-origin access — the
artifact asks the host, the host decides what to send back.

### 3. `allow-popups` and `allow-popups-to-escape-sandbox`

These tokens are **not** in the default `sandbox` attribute. They may be
added dynamically **only** when the user activates a "open in new tab"
action on a link element the artifact contains, and **only** if the link's
URL passes the allow-list filter:

- `http:` followed by an absolute URL, or
- `https:` followed by an absolute URL, or
- `mailto:` followed by an RFC-5322 address.

Any other protocol (`javascript:`, `data:`, `file:`, `vbscript:`, `blob:`
with a non-allow-listed inner URL, custom schemes) is refused and the popup
is not opened. The filter runs in the host, not the iframe, because the
iframe is the untrusted party.

### 4. The host never reaches into the iframe

The host page **does not** call `iframe.contentDocument`, does not call
`iframe.contentWindow.eval`, and does not assign to
`iframe.srcdoc` after the initial load. The host's only API surface into
the iframe is `iframe.contentWindow.postMessage(message, targetOrigin)`,
and it only does so with the message types defined in ADR-1037
(`unifia:select-mode`, `unifia:snapshot`, and any future addition requires
an avenant to that ADR). The host validates every `message` event it
receives against the type allow-list and discards the rest without
echoing them in the console (ADR-1037 §4 — silence on rejection, to avoid
a side channel for an attacker probing what types the host accepts).

### 5. Coexistence with `generative-ui-dom`

The 4-component allow-list in `packages/generative-ui-dom` is unchanged.
It is the rendering path for **in-conversation** UI that the agent emits
inline in a message — buttons, forms, pickers, a single status card. The
iframe path described in this ADR is the rendering path for **page-shaped**
artifacts that the agent emits as standalone files — a full HTML page, a
deck, a design-system report, a component preview. The two paths are
disjoint:

- A `generative-ui-dom` element is mounted as a Solid component in the
  host tree and obeys the host's props, theming, and CSP. It cannot ship
  arbitrary HTML.
- An artifact iframe is mounted as a sandboxed `<iframe>` and obeys only
  the iframe's own CSP (ADR-1036). The host does not see its DOM.

The two do not share storage, do not share postMessage origin, and do not
share message types. `generative-ui-dom` does not gain a backdoor into the
iframe path; the iframe path does not gain a backdoor into the host's DOM.

### 6. Threat model

What the sandbox + ADR-1036 iframe CSP **prevent**:

- **Cookie theft from the host origin**: impossible — the iframe is opaque
  to the host, and the iframe's own storage is partitioned by the browser.
- **Read access to parent DOM**: impossible — sandbox blocks DOM access.
- **Read or write access to host localStorage / IndexedDB / sessionStorage
  / CacheStorage**: impossible — no `allow-same-origin`.
- **Navigation of the host top frame**: blocked by sandbox; the artifact
  cannot call `window.top.location = ...` or `<a target="_top">` (a target
  it never had in the first place since the host controls link policy).
- **Calling parent JS**: impossible — no DOM access, no shared globals,
  `postMessage` is the only channel and the host validates messages.
- **Reading the Workbench token**: the token is in the host's memory, not
  visible to the iframe.

What they **do not** prevent, and what handles each:

- **Network exfiltration from the iframe** — handled by the iframe's
  own CSP (`connect-src 'none'` in v1, see ADR-1036). The sandbox itself
  does not stop the iframe from making a `fetch()` call; the CSP does.
- **CPU / memory DoS from a heavy artifact** — handled by the browser's
  per-iframe process limits and by the workbench server's request
  size limits. Not a CSP concern.
- **Phishing the user inside the iframe** — the user is the operator and
  understands that artifact content is generated; this is a user-trust
  surface, not a security boundary. The same warning the workbench
  shows today on `artifact.preview` is shown on the iframe mount point.
- **Side-channel / Spectre-class attacks** — out of scope for this ADR.
  Cross-origin iframe isolation in modern browsers is the default and
  remains the right floor.

## Alternatives rejected

- **Inert text extraction (statu quo)**: the workbench already renders
  some artifacts as inert text/markdown previews. Rejected. It does not
  reach parity with Open Design 0.10.0, which renders HTML artifacts in
  a live preview; without parity, the mode is dead.
- **Render in a separate Tauri WebView child process**: rejected. Tauri
  supports multiple windows, and a child window would have its own
  origin and storage. The cost is non-trivial: a second Tauri window
  brings a second runtime, a second CSP, and a second IPC bridge. The
  threat model it adds (cross-process postMessage via Tauri channels)
  is strictly larger than the in-document iframe for the same
  confinement. We can revisit if the iframe path turns out to be
  insufficient for a concrete use case; the ADR is not a permanent
  veto on that approach.
- **Tag-and-attribute allow-list at the parser level (DOMPurify-style)**:
  rejected. A tag allow-list does not protect against CSS exfiltration
  (e.g. attribute selectors that signal private state to a remote
  background), against `eval` reached through seemingly safe strings
  (`"a]b" + "ert(0)"` to evade naive scanners), or against
  JavaScript-in-a-data-URL inside an `<img src>`. The maintenance burden
  of keeping the allow-list in step with new attack patterns is also
  continuous. The sandbox + iframe CSP pair is a stronger guarantee for
  the same workload.
- **Reuse the host page's main thread**: rejected. The agent can emit
  arbitrary markup; rendering it in the host page is by definition
  same-origin execution, which is exactly the threat this ADR closes.

## Consequences

- Every artifact in Design mode is rendered in a sandboxed iframe. The
  `generative-ui-dom` allow-list continues to exist for in-conversation
  Solid components, untouched.
- Adding any token to the `sandbox` attribute — `allow-same-origin`,
  `allow-forms`, `allow-modals`, `allow-popups` by default — requires
  an explicit avenant to this ADR. The default is "deny".
- The host has no JavaScript API to reach into the iframe; bridges are
  the only contract and they are spelled out in ADR-1037.
- The `data-unifia-id` attribute used by the picker (ADR-1037
  `unifia:select-target`) is the only artifact-side contract surface
  that the host reads. It is set by the agent in the artifact's
  markup; the host treats it as untrusted input and only uses it to
  route a `unifia:select-target` message back to the iframe so the
  user sees a confirmation of what they picked.

## Rollback

Removing this ADR requires (a) removing the iframe mount in the artifact
preview component introduced in P11, (b) reverting the `data-unifia-id`
attribute round-trip, and (c) reintroducing the inert text fallback for
artifact previews. The `generative-ui-dom` allow-list is unaffected by
this rollback — it is a sibling path, not a child of this one.

## Implementation references

- `packages/artifact-render/src/preview-frame.tsx` (P11) — the iframe
  element and the `sandbox` attribute literal.
- `packages/artifact-render/src/bridge.ts` (P11) — the only host-to-iframe
  API, forwarding to ADR-1037 message types.
- `packages/artifact-render/src/popup-allowlist.ts` (P11) — the URL
  filter for `target="_blank"` that gates `allow-popups`.
- `docs/adr/1036-csp-artifact-frame.md` — the iframe CSP.
- `docs/adr/1037-artifact-bridge-protocol.md` — the `unifia:` message
  contract.
- `scripts/check-workbench-security.mjs` (P02) — guard that fails the
  build if any worktree file contains the string `allow-same-origin`.
