<!-- SPDX-License-Identifier: MIT -->

---
id: 1036
title: Content-Security-Policy for the artifact frame
status: ACCEPTED
date: 2026-08-17
supersedes: null
related: [1035, 1034, 0006, 0007]
---

# ADR-1036: Content-Security-Policy for the artifact frame

## Context

ADR-1035 fixes the rendering path for untrusted artifacts to a sandboxed
`<iframe sandbox="allow-scripts">`. The sandbox by itself does not
constrain the iframe's own outbound behavior — the iframe can still
`fetch("https://attacker.example/")`, embed remote scripts via `<img
onerror>`, or post to a form. The complementary control is a
Content-Security-Policy (CSP) on the iframe's own document, expressed as
a `<meta http-equiv="Content-Security-Policy" content="...">` tag
injected into the `srcDoc` at iframe mount time, and a CSP header on
the Workbench server's raw-artifact route for the case where the route
is hit directly.

This ADR specifies the exact CSP values, where each one lives, and the
procedure by which `scripts/check-workbench-security.mjs` is updated to
fail the build on regression. The implementation of the guard change is
in P02 of the parity program.

Two `tauri.conf.json` files exist today (desktop and mobile), each with
its own `app.security.csp` string. The workbench server emits response
headers through Hono (see `packages/workbench-server/src/security.ts`,
which currently sets CORS but not CSP). All three are in scope.

## Decision

### 1. The iframe document CSP (injected into `srcDoc`)

The iframe receives the following CSP, inserted as the first child of
`<head>` of the `srcDoc` document at mount time:

```
default-src 'none';
script-src 'unsafe-inline' 'unsafe-eval';
style-src 'unsafe-inline';
img-src 'self' data:;
font-src 'self' data:;
media-src 'none';
connect-src 'none';
object-src 'none';
base-uri 'none';
form-action 'none';
frame-ancestors 'none';
```

Notes per directive:

- `default-src 'none'` — the floor. Any directive not listed below falls
  back to this and is denied.
- `script-src 'unsafe-inline' 'unsafe-eval'` — v1 allows inline
  scripts and `eval`. Generated artifacts commonly use inline scripts
  for setup; a stricter nonce-based policy is a v2 candidate, but only
  if the artifact runtime can mint nonces at mount time, which is not
  in scope for the parity work.
- `style-src 'unsafe-inline'` — same reasoning; inline styles in
  generated HTML are the norm, not the exception.
- `img-src 'self' data:` — `'self'` covers the Workbench server's raw
  route; `data:` covers inline data-URL images which are the most
  common embedding for generated artifacts. `blob:` and `https:` are
  **not** in v1: a remote image is a network egress we do not want
  from an untrusted artifact.
- `font-src 'self' data:` — same logic as `img-src`; generated
  artifacts sometimes embed fonts as data URLs.
- `media-src 'none'` — audio and video in v1 are not in scope.
- `connect-src 'none'` — **the v1 network-egress deny**. This is the
  CSP backstop for the network-exfiltration threat called out in
  ADR-1035 §6. The iframe cannot `fetch()`, cannot open a WebSocket,
  cannot load an `EventSource`, cannot post to a remote form target.
  XHR, `navigator.sendBeacon`, and `<a ping>` are all governed by
  `connect-src` and are likewise denied.
- `object-src 'none'` — the artifact cannot load `<object>`, `<embed>`,
  or `<applet>`. Defense in depth even though the sandbox already
  blocks these in practice.
- `base-uri 'none'` — the artifact cannot set `<base href>` to redirect
  relative URLs to an attacker-controlled origin. Without this, a
  single `<base href="https://attacker.example/">` would change the
  meaning of every relative URL in the document.
- `form-action 'none'` — the artifact cannot submit a form. Combined
  with the sandbox (no default form submission) and `connect-src
  'none'`, the form attack surface is closed.
- `frame-ancestors 'none'` — the artifact cannot frame anything else.
  Defense in depth.

This is a v1 policy. The directive set can be widened per directive
once a concrete use case is identified; the procedure to do so is an
avenant to this ADR.

### 2. The Workbench server response header

For any HTTP response that **returns artifact content intended to be
rendered as HTML** (currently and at minimum the route
`GET /v1/artifacts/:id/raw/:path` declared in ADR-1038), the
workbench server sets:

- `Content-Security-Policy` — the iframe CSP from §1, in HTTP-header
  form (semicolons, single string, no `<meta>` wrapping).
- `X-Content-Type-Options: nosniff` — prevents MIME confusion if the
  artifact is opened directly (the user clicking "open in new tab" from
  the picker bypasses the iframe and hits this route).

The server does **not** set `Content-Security-Policy` on JSON responses;
CSP is for HTML-shaped content only. JSON routes keep their existing
CORS policy unchanged.

### 3. Parent CSP additions (Tauri desktop and Tauri mobile)

The two `tauri.conf.json` files do not currently declare `frame-src` or
`child-src`. They are added now, scoped to the artifact iframe, in
addition to (and without disturbing) the existing `object-src 'none'`
and `frame-ancestors 'none'`:

- `frame-src 'self' data:` — allows the host to frame its own origin
  (the parent) and the data-URL form that `srcDoc` resolves to in
  modern browsers. No remote origin is added.
- `child-src 'self' data:` — legacy spelling kept for browsers that
  still consult `child-src` before falling back to `frame-src`. The
  modern directive is `frame-src`; `child-src` is retained as a
  belt-and-braces pairing per the parity card.

The desktop and mobile CSPs each receive **only** these two additions
in this ADR. Specifically:

- `connect-src` is unchanged. The parent's IPC, loopback, and
  websocket endpoints are unrelated to the artifact iframe's needs.
- `img-src` is unchanged. It already includes `data:` and `blob:` and
  `https:` for the parent's own image needs; the iframe has its own
  stricter policy in §1.
- `default-src`, `script-src`, `style-src`, `font-src`, `media-src`,
  `object-src`, `frame-ancestors` are all unchanged. The last two are
  preserved **as-is** per §4 below.

### 4. Preserved directives

The following directives, already present in both `tauri.conf.json`
files, are **preserved untouched** by this ADR:

- `object-src 'none'` — applies to the parent; the artifact iframe
  has its own (also `'none'`).
- `frame-ancestors 'none'` — applies to the parent; prevents
  clickjacking of the workbench itself. Unrelated to the artifact
  iframe's content, but the guard in §5 still asserts it.

These two are asserted by `scripts/check-workbench-security.mjs`
today and continue to be asserted after P02.

### 5. Guard update procedure (P02 implements)

`scripts/check-workbench-security.mjs` is extended with the
following checks, in addition to the existing four assertions on
the parent CSPs:

1. **Parent has `frame-src 'self' data:`** (desktop and mobile).
   Fails with a clear message if `frame-src` is missing or does not
   include both `'self'` and `data:`.
2. **Parent has `child-src 'self' data:`** (desktop and mobile).
   Fails with a clear message if `child-src` is missing or does
   not include both `'self'` and `data:`.
3. **No `allow-same-origin` in any worktree file under
   `packages/`, `scripts/`, or the two `tauri.conf.json`**. The
   string is searched with a case-sensitive literal regex against
   the union of those file globs. Matches in documentation comments
   inside `docs/adr/` are excluded by scoping the search outside
   `docs/`.

Two negative test cases are added to demonstrate the guard fails
on regression:

- A CSP string with `object-src 'self'` (or any value other than
  the literal `'none'`) must fail the guard. The existing assertion
  on `object-src` already covers this; P02 re-runs it as part of
  the negative suite.
- A worktree file containing the literal `allow-same-origin` must
  fail the guard. P02 writes a fixture in a temp directory and
  invokes the guard against it; the fixture is deleted after the
  demonstration. The checkpoint records both pass and fail output.

The procedure in this ADR is the specification. P02 implements it
in code and demonstrates both the positive and negative paths.

## Alternatives rejected

- **A single host-wide CSP that governs both the parent and the
  iframe**: rejected. The parent and the iframe have different
  threat surfaces (the parent is trusted code, the iframe is
  untrusted agent output) and benefit from different defaults.
  Collapsing them would either (a) loosen the iframe to the
  parent's level (defeats the point) or (b) tighten the parent to
  the iframe's level (breaks the parent's IPC, websocket, and
  remote-image needs).
- **`connect-src *` in the iframe to "let the artifact do what it
  wants"**: rejected. Network egress from the iframe is the
  threat that ADR-1035 §6 explicitly defers to this ADR. `'none'`
  is the v1 default; widening requires an avenant.
- **No CSP on the iframe (rely on the sandbox alone)**: rejected.
  The sandbox does not constrain the iframe's own outbound
  behavior. `fetch`, `XMLHttpRequest`, `navigator.sendBeacon`,
  `<a ping>`, and `<form action>` are all governed by CSP, not by
  the sandbox. Relying on the sandbox alone would leave the
  network-exfiltration threat from ADR-1035 §6 unaddressed.

## Consequences

- The two `tauri.conf.json` files gain exactly two new directives
  each (`frame-src`, `child-src`). The shape of the rest of the
  CSP is unchanged, so the change can be reviewed as a two-line
  diff per file.
- `scripts/check-workbench-security.mjs` gains three new
  assertions and two negative test demonstrations. The guard
  remains executable from the repo root.
- Any future change to the iframe CSP is an avenant to this ADR.
  A loose `connect-src` or a relaxed `form-action` is a
  security-relevant change, not a routine edit.
- The `generative-ui-dom` allow-list is unaffected; this ADR does
  not touch `packages/generative-ui-dom/**`.

## Rollback

Reverting the parent additions is a two-line edit per
`tauri.conf.json`. Reverting the iframe CSP means the iframe is
rendered without `<meta http-equiv="Content-Security-Policy">` in
`srcDoc`; the sandbox is still in place, but the
network-exfiltration control from ADR-1035 §6 is lost. The guard
reverts to its current four assertions.

## Implementation references

- `packages/desktop/src-tauri/tauri.conf.json` (P02) — adds
  `frame-src 'self' data:` and `child-src 'self' data:`.
- `packages/mobile/src-tauri/tauri.conf.json` (P02) — same.
- `packages/artifact-render/src/preview-frame.tsx` (P11) — the
  `<meta http-equiv="Content-Security-Policy">` injection in
  `srcDoc` at mount time.
- `packages/workbench-server/src/security.ts` (P13) — the
  CSP response header on `/v1/artifacts/:id/raw/:path`.
- `scripts/check-workbench-security.mjs` (P02) — the three new
  assertions and the two negative demonstrations.
- `docs/adr/1035-untrusted-artifact-rendering.md` — the sandbox
  contract this ADR complements.
- `docs/adr/1034-token-capability-scope-vs-approval-broker.md` —
  the token-scope / approval-broker split that this ADR does not
  change.
