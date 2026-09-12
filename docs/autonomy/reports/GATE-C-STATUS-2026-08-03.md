<!-- SPDX-License-Identifier: MIT -->
# Gate C — état d’exécution au 2026-08-03

## Décision provisoire : NO-GO

Cette décision est volontairement provisoire : elle reflète les critères du plan V3 et les preuves locales disponibles, sans prétendre à une release publique.

| Domaine | Preuve locale | État |
|---|---|---|
| Contrats et typecheck | `bun run typecheck` : 20/20 packages green après Skill Hub | PASS |
| Skill Hub local | `@unifia/skill-hub`, manifeste strict, signatures trustées, search/install/update/rating, `5/5` | PASS local |
| MCP UI | broker déclaratif + route `/v1/ui/actions`, `WorkbenchServer: 29/29` | PASS partiel |
| Generative UI | renderer allowlisté, IDs stricts, actions injectées, `3/3` | PASS contrat |
| Memory / Workflow | runtimes et routes existants, validations antérieures | PASS local |
| Computer use | brokers navigateur/bureau, redaction, emergency stop, tests locaux | PASS technique partiel |
| Gate A / Gate B | rapports présents mais validation finale et audit externe non établis dans cette session | NON PROUVÉ |
| MCP UI 100+ capabilities, transports JSON-RPC/STDIO, OAuth/JWT, rate limiting | non livré dans l’exécution actuelle | NON |
| OpenDesign complet, Artifact Studio complet | non prouvé par les gates locaux actuels | NON PROUVÉ |
| Security audit externe, pentest, demo 90 min, migrations no-breaking | aucun artefact externe disponible | NON |

## Garde-fous

- Les dépôts sources `D:\App\OpenCode\opencode` et les clones Hermes ne sont pas modifiés.
- Aucun code `/ee`, `remoteCode` ou licence interdite n’est introduit par les lots validés.
- Les bundles locaux servent de sauvegarde avant toute étape suivante.
- La décision finale Gate C reste interdite tant que les critères bloquants et l’audit externe ne sont pas prouvés.

## Prochaine carte unique

Intégrer `@unifia/skill-hub` et `renderGenerativeUi` au bootstrap Workbench avec tests HTTP de scope, allowlist UI et install/update ; ensuite seulement réévaluer Gate C.


## Re-evaluation 2026-08-04

- Typecheck monorepo: 20/20 packages green.
- Skill Hub hardening: `8/8` checks; Workbench HTTP: `49/49`; CapabilityRegistry: `6/6`.
- Route `POST /v1/ui/render` now integrated with server-injected action allowlist, workspace scope, prop filtering and fail-closed behavior.
- Checkpoints: `f11094a`, `b986905`, `a94601e`; bundles preserved locally.
- Decision remains NO-GO: no real DOM consumer/E2 external, no MCP transports/OAuth/rate-limit proof, OpenDesign/Artifact Studio and release/security gates not complete.
- Next card unique: close the external and product-surface gates; do not claim production readiness from local package tests.

## Re-evaluation 2026-08-04 (second pass)

Decision: **still NO-GO**. Four of the previously listed gaps are now closed
with local proof, and one new blocker was found that is more fundamental than
any of them.

### Closed since the previous entry

| Gap | Evidence | Commit |
|---|---|---|
| MCP transports (JSON-RPC / STDIO) | `@unifia/mcp-transport` 32/32: strict codec, newline framing with a bounded frame, correlation, deadlines, AbortSignal cancellation, per-method authorisation, rate limiting | `907a4c0` |
| Auth and rate limiting on the server | Principal authentication is a required constructor dependency; HS256 verification with pinned alg and iss/aud/exp/nbf; fixed-window limiter always installed; 429 and 401 audited | `3bfbf66` |
| Migrations no-breaking | 8 migration conformance checks; a newer-schema state file is now preserved and refused instead of silently discarded and overwritten | `7ff7dd1` |
| Reproducible conformance / supply chain | `scripts/unifia-conformance.mjs` + CI workflow, 8/8: forbidden paths, excluded imports, SPDX, licences, dependency pinning, lint, typecheck, 25 suites | `8f1b860` |

### Defects found and fixed during this pass

1. **SSE framing was unusable** (`eff4a51`) — frames carried literal `\n`
   characters, so no SSE client could parse the event stream. The existing test
   substring-matched the payload and never saw it.
2. **Silent workspace data loss** (`7ff7dd1`) — every state read error was
   swallowed identically, so a corrupt or newer-schema file produced a fresh
   empty state that the next save overwrote.
3. **Unifia code was outside every quality gate** (`8f1b860`) — `biome.json`
   listed only inherited OpenCode packages; 25 lint violations and 25 files
   without an SPDX header had accumulated unseen.
4. **A stale security invariant** (`8f1b860`) — the capability/effect
   completeness check asserted a hardcoded count of 14 and had been failing
   since `workflow.run` was added; it ran in no gate, so nobody saw it.

### New blocker, higher priority than the previously listed residuals

**No process exposes the WorkbenchServer.** Searching `new WorkbenchServer`
across the repository returns only its own test file. Every route proof is a
library proof: an in-memory `server.fetch(new Request(...))` with no socket, no
listener and no lifecycle. "Serveur headless" — a Phase 5 exit criterion and a
Gate A condition — is therefore `NON PROUVÉ`, and both the DOM consumer and the
external E2E are blocked behind it.

### Remaining NO-GO reasons

- No headless bootstrap (above) — addressed by `NEXT-CARD-2026-08-04.md`.
- Phase 11 OpenDesign: nothing beyond `docs/adr/0017-opendesign-integration.md`.
- Phase 12 Artifact Studio core: artefacts are content-addressed with no version
  lineage, no semantic diff, no sandboxed preview, no metadata stripping.
- No real DOM consumer for the Generative UI renderer.
- No external MCP provider connected (deliberate: requires provenance review).
- External audit, pentest, 90-minute demo and signed release: `BLOQUÉ EXTERNE`.

Full phase-by-phase evidence: `PHASE-STATUS-2026-08-04.md`.

## Re-evaluation 2026-08-04 (third pass — headless bootstrap)

Decision: **still NO-GO**, but the blocker raised in the second pass is closed.

`packages/workbench-server/src/bootstrap.ts` (`5590c9d`) makes the server a
process: environment configuration, HTTP listener, durable JSONL audit and
clean shutdown. It refuses to start without a >=32 byte signing key and refuses
any non-loopback host — there is no default key and no fallback to
`UnauthenticatedPrincipal`. `WorkbenchBootstrap` 39/39 drives it over real HTTP
and parses the SSE wire format instead of searching it.

**Phase 5 "le serveur fonctionne headless" is now `PASS local`.**

### Three production defects that only real HTTP revealed

1. **The error path was dead for all 17 routes.** `fetch()` returned each
   handler promise without awaiting it, so the surrounding `try/catch` settled
   before the handler did. A rejecting handler escaped as an unhandled
   rejection instead of becoming an audited 400.
2. **`files/read` returned undecodable content.** `Uint8Array` serialised to
   `{"type":"Buffer","data":[104,...]}`, roughly six times the size and
   unusable by a client. Content now carries an explicit `encoding` field.
3. **SSE subscriptions died after 10 seconds.** The stream emitted nothing
   until its first event, so the connection sat idle and hit the server idle
   timeout. It now flushes an opening comment frame and the listener disables
   the idle timeout.

All three were invisible to in-memory tests: none of them serialise a response,
open a socket, or let a handler reject.

(The NO-GO list for this pass is superseded by the consolidated summary at the
end of this file; the empty heading that stood here was an editing artefact.)

## Re-evaluation 2026-08-04 (fourth pass — DOM consumer)

Decision: **still NO-GO**. The DOM consumer exists; the external browser proof
does not, and its blocker is now precisely characterised.

`@unifia/generative-ui-dom` (`2783f35`, `GenerativeUiDom` 29/29) mounts a
validated tree into a real document with every safety rule enforced
structurally: no `innerHTML` family, no generic `setAttribute` loop, no
behaviour read from the payload, input type hardcoded, and re-validation
through the canonical renderer so this layer neither trusts its own server nor
grows a second allowlist. Hostile payloads (`onclick`, `style`,
`href=javascript:`, markup inside a text value) are covered.

### The external browser proof is BLOCKED, not missing by omission

The E2E is written — real Chromium, page served from a harness origin that
keeps the tokens server-side, click forwarded to the workbench, assertion that
a generated-UI click becomes a *pending approval* rather than an execution. It
does not run here:

- `chromium.launch()` starts the browser then hangs to the launch timeout:
  Playwright uses `--remote-debugging-pipe`, needing stdio fds 3 and 4 that Bun
  does not wire on Windows.
- Attaching over a TCP debugging port gets further — Chromium logs
  `DevTools listening on ws://127.0.0.1:<port>/...` and `/json/version` returns
  200 — but `connectOverCDP` fails with `Timeout 30000ms exceeded /
  <ws connecting>`: playwright-core's websocket client does not complete a
  handshake under Bun either.
- Running it under Node, the convention used by
  `packages/browser-runtime/test/playwright-driver.e2e.ts`, is blocked from the
  other side: the suite needs the WorkbenchServer, whose bootstrap uses
  `Bun.serve`, and Node's `--experimental-strip-types` refuses to strip types
  from workspace packages reached through node_modules.

This is a toolchain incompatibility, not a product defect. Two ways out are
recorded in the suite header; the suite is excluded from the gate with that
reason attached rather than deleted or quietly skipped.

### Update, same day — the browser proof is no longer blocked

`637f786` runs it. The diagnosis above was correct about playwright under Bun,
but the second half was wrong: Node *can* type-strip through the workspace
symlinks. What actually failed was that the packages import siblings with `.js`
specifiers pointing at `.ts` files (`./runtime.js` → `runtime.ts`), which Bun
rewrites and Node does not.

The fix is a runner/implementation split. The runner stays under Bun and
bundles both sides with `bun build` — the page script for the browser, the
suite for Node with playwright left external. Bundling resolves the specifiers
at build time, so Node runs the suite and drives Chromium normally. The bundle
is written inside the package, not the system temp directory: Node resolves a
bare specifier by walking up from the importing file, and neither `cwd` nor
`NODE_PATH` applies to ESM.

`GenerativeUiBrowserE2E` 10/10: real Chromium loads the page over a real
socket, mounts the server-described UI with the real consumer, a real click
travels back over HTTP into `WorkbenchServer.fetch`, and the decision reaches
the durable audit log — **a click from a generated UI does not execute, it
becomes a pending approval**. Browser suites are opt-in behind `--with-browser`
so the default gate stays offline-reproducible.

## Re-evaluation 2026-08-04 (fifth pass — runtime conformance suite)

Decision: **still NO-GO**, and the remaining reasons are now down to two
product surfaces plus the external gates.

`@unifia/runtime-conformance` (`541238e`) implements plan section 13: the three
runtimes each pass the same ten scenarios — create a session, send a prompt,
receive events, request a permission, answer a permission, cancel, switch
workspace, read and write an artefact, close cleanly, recover after a crash.
**RuntimeConformance 30/30.**

Two things are reported rather than smoothed over:

- **Contract divergence.** Plan section 7.1 lists `replyApproval` on
  `RuntimeAdapter`; the implemented interface has no such method. Adding it
  would contradict plan section 5, which makes ApprovalBroker the sole
  authority for approvals — the second authority the plan forbids. The
  approval scenarios go through ApprovalBroker and the divergence is recorded
  in the suite. The plan is internally inconsistent here.
- **Scope of the result.** The `opencode` and `unifia` adapters run over a
  backend built from a FakeRuntimeAdapter. This proves each adapter honours the
  contract and delegates faithfully; it does **not** prove the real OpenCode
  runtime's behaviour. Wiring `OpenCodeRuntimeBackend` to a live session
  runtime is a separate step and is not claimed here.

The suite earned its keep on first run: `reply-permission` failed on all three
runtimes until the scenario was corrected — `WorkspacePort.write` resolves an
*existing* path by design, so creating a file through a write is not a
capability the workspace grants.

With this, **Gate A's two outstanding items are closed locally**: a real
headless server (`5590c9d`) and adapters passing a conformance suite
(`541238e`).

## Re-evaluation 2026-08-04 (sixth pass — artefact version lineage)

Decision: **still NO-GO**, on one product surface plus the external gates.

`47b1b84` (`ArtifactStore` 27/27) gives artefacts a real lineage. The id was
derived from the content hash with `version` hardcoded to 1, so the type called
ArtifactVersion versioned nothing — and the same derivation made two logically
distinct artefacts with identical bytes collide, the second being refused. An
id now names a lineage independent of content; each revision carries its own
manifest and history is derived from what is on disk, so no global index can
drift from the versions it describes.

Export to a workspace outbox lands with a metadata policy defaulting to
`strip`: an export leaves the trust boundary, so disclosure is opt-in. The
limit is written into the code rather than implied — the policy governs the
Unifia metadata record only, not format-level metadata inside the bytes.

Still missing from Phase 12: semantic diff for DOCX/PPTX/XLSX, sandboxed
preview, and format-level metadata stripping (EXIF, OOXML docProps, PDF Info).

## Re-evaluation 2026-08-04 (seventh pass — Artifact Studio complete)

Decision: **still NO-GO**, now on Phase 11 plus the external gates alone.

`@unifia/artifact-studio` (`e5dbfe8`, 33/33) closes the three Phase 12 surfaces
that were missing:

- **Metadata stripping** removes OOXML metadata parts *and* the references to
  them, so the package stays consistent — a stripped archive still declaring an
  Override or Relationship for a deleted part is corrupt, which is worse than
  not stripping.
- **Preview** extracts inert text and refuses anything that can execute: a
  macro part, an external relationship, or a PDF carrying JavaScript, an
  OpenAction or an embedded file.
- **Semantic diff** compares extracted content units, not bytes, and inherits
  the preview's refusals.

Two limits are stated in the code rather than implied: PDF stripping **refuses**
a document carrying an `/Info` dictionary instead of pretending to sanitise it,
and EXIF inside embedded images is not touched.

**Phase 12 is now complete for its stated scope.**

## Re-evaluation 2026-08-04 (eighth pass — spec-driven development)

Decision: **still NO-GO**, and the remaining reasons are now *only* the
external gates plus two deliberately deferred surfaces.

`@unifia/spec-runtime` (`43ccdaa`, 35/35) implements the load-bearing part of
plan section 25. That section rests on one sentence — *une spec ne peut pas
élargir les permissions du workspace* — and the reason it matters is that a
spec is authored content, frequently authored by a model. If declaring a
capability granted it, a spec would be a privilege-escalation primitive.

`resolveEffectiveCapabilities` computes an **intersection, never a union**, so
no code path exists along which a spec adds a capability. Denials are returned
and audited rather than dropped: a silently ignored request is
indistinguishable from a granted one at the call site. Tests assert the
invariant directly, including that an empty grant yields nothing and that the
workspace grant is never mutated.

Around it: strict parsing that refuses rather than partially applies, rule
injection carrying spec id and version so an instruction merged into a prompt
stays traceable, design tokens with constrained names and values because tokens
reach generated documents and stylesheets, and reviews rendered as artefact
inputs so a review can be versioned instead of living in a chat log.

Deferred, with the reason recorded in the module: code generation (a product of
its own; a half-generator would create a second authority over the codebase),
diagram round-trips (need format parsers — a supply-chain decision), and YAML
specs (adding a parser is a dependency this repo gates on provenance review).

### Remaining NO-GO reasons
- Phase 12 Artifact Studio core: see the sixth pass — lineage and export landed,
  semantic diff / sandboxed preview / format-level metadata stripping remain.
- No external MCP provider connected (deliberate), and no real OpenCode backend
  behind the conformance suite.
- External audit, pentest, 90-minute demo and signed release: `BLOQUÉ EXTERNE`.

## Re-evaluation 2026-08-04 (ninth pass — event replay in the real backend)

Decision: **still NO-GO**, unchanged reasons. This pass fixed a defect rather
than closing a gate.

Investigating whether the real OpenCode backend could sit behind the conformance
suite produced two results.

**The honest answer to the original question:** it cannot, offline.
`SessionPrompt.prompt` reaches a model, so the `send-prompt` scenario is not
runnable here. `createSession` and `listSessions` would be, but a partial
conformance run would be more misleading than useful, so the caveat on the
30/30 result stands as written.

**A real defect found on the way:** `OpenCodeSessionBackend` did not honour the
event replay contract. `toRuntimeEvent` emitted no `sequence`, so the server
never wrote an SSE `id:` line and a client had nothing to resume from; and
`subscribeEvents` ignored `afterSequence` entirely, so a client that reconnected
anyway received only what happened next and silently lost everything that
arrived while it was away. "Les événements sont rejouables" is a Phase 2 exit
criterion and this was the one place it was not met. Both failures are invisible
until someone reconnects, which is why every suite stayed green over them.

`cc6b325` adds `SessionEventHub` to the contracts package — sequence assignment,
bounded retained history, replay from a cursor then live — and wires the backend
to one hub and one bus subscription per session. The subscription outlives any
individual reader on purpose: if a disconnecting reader tore it down, the hub
would record nothing while that reader was away and the replay it reconnects for
would be empty by construction. A cursor older than the retained window raises
`EventGapError` rather than jumping forward, because a stream that looks
continuous but is not is worse than one that says resynchronise. The hub carries
no runtime dependency, so the contract is proven (25/25) without booting a
runtime.

---

# Consolidated state — 2026-08-04, end of session

**Gate C: NO-GO.**

## Closed with local proof

| Area | Evidence |
|---|---|
| Headless server | `WorkbenchBootstrap` 40/40 over real HTTP |
| Principal auth + rate limiting | required by construction, 401/429 audited |
| MCP transports | `McpTransport` 32/32 |
| Runtime conformance (plan §13) | `RuntimeConformance` 30/30, 3 runtimes × 10 scenarios |
| Event replay contract | `SessionEventHub` 25/25, real backend wired |
| Generative UI DOM consumer | `GenerativeUiDom` 29/29 |
| Real-browser E2E | `GenerativeUiBrowserE2E` 10/10 in Chromium |
| Artefact lineage | `ArtifactStore` 27/27 |
| Artifact Studio (Phase 12) | `ArtifactStudio` 33/33 |
| Spec-driven (Phase 11 core) | `SpecRuntime` 35/35 |
| Migrations no-breaking | `WorkspaceStorage` 12/12 |
| Reproducible conformance gate | 8/8 over 32 suites |

## Still NO-GO — nothing here can be closed by writing code

- External security audit targeting computer use and remote control.
- Pentest.
- Signed installers and checksums (keys are not on this machine, and must not be).
- 90-minute product demo.
- A remote CI run: the workflow exists and the gate passes locally, but the
  branch has not been pushed and pushing was not authorised.

## Deferred by decision, with the reason recorded in the code

- Code generation from a spec (ADR-0017): a product of its own; a half
  generator would create a second authority over the codebase.
- Diagram round-trips and YAML specs: both need a third-party parser, which is
  a supply-chain decision under provenance review, not a coding task.
- A real OpenCode backend behind the conformance suite: `SessionPrompt.prompt`
  reaches a model and cannot run offline.

**Do not promote Gate C on the strength of the table above.** Thirty-two green
suites prove the code does what it says. They do not prove anyone independent
has looked at it, which is what plan sections 31 and 33 actually require.
