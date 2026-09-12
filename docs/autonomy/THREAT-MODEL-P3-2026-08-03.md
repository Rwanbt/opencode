# P3 Threat Model — Unifia Security Foundation

**Date**: 2026-08-03
**Status**: `CONTRACTS_ACCEPTED_WITH_TRACKED_DEBT`
**Authority**: Plan directeur V3 (Unifia Core boundary, §5 trust and
governance, §7 ports)
**Companion contract**: `P3-CONTRACTS-DRAFT-2026-08-03.md` (C1–C9)
**Companion import policy**: `IMPORT-CANDIDATES.md` (post-amendment)
**Companion evidence**: `M1-BEHAVIOR-EVIDENCE-2026-08-03.md`,
`M1-PROVENANCE-DETAIL-2026-08-03.md`

This document is a **documentation artefact only**. It does not import code,
does not commit, and does not modify the OpenCode main checkout.

---

## 1. Scope and methodology

**In scope:** the seven trust boundaries (B1–B7) at which the P3 contracts
operate. STRIDE is applied per boundary. Each STRIDE finding is tied to a
mitigation anchored in a C1–C9 contract clause and to a test reference in the
conformance suite (`P3-CONTRACTS-DRAFT-2026-08-03.md` §13).

**Out of scope:**

- Pure UI/UX design of approval dialogs (handled in a later shell pass).
- Network-layer attacks (DDoS, BGP) — assumed mitigated at the OS / transport.
- Hardware supply-chain attacks — assumed out of band.
- Provider-side model behaviour (jailbreaks, prompt injection in model output) —
  covered by a separate `MODEL-TRUST` document, not this one.

**Methodology:** STRIDE per trust boundary, with each entry carrying:

- A **threat** (the adversary action).
- A **STRIDE category** (Spoofing, Tampering, Repudiation, Information
  disclosure, Denial of service, Elevation of privilege).
- A **mitigation** (contract clause + test reference).
- A **residual risk** (what the mitigation does **not** cover).

---

## 2. Assets

| ID | Asset | Where it lives | Sensitivity |
|---|---|---|---|
| A1 | User credentials (account, OAuth tokens, refresh tokens, API keys) | `SecretStore` (C9) | Critical — must never leave the store as a return value |
| A2 | Workspace files (read/write scope) | Sandbox backend, host filesystem | High — depends on workspace classification |
| A3 | Unifia Core authority (session, provider, tool, approval) | In-process | Critical — second-source creation = invariant violation |
| A4 | Plugin / skill source (descriptors, code, scripts) | Materialized worktree | High — provenance-sensitive |
| A5 | Audit log | Append-only storage | High — append-only, no secret material |
| A6 | Approval decisions and policy rules | `ApprovalBroker` + `PolicyEngine` | High — controls what may run |
| A7 | Network egress / ingress capability | Sandbox backend + transport layer | High — taint propagates from `secret.read` |
| A8 | Remote identity (paired, token, allowlist) | `RemoteTransportPort` | High — bound to a workspace + capability set |
| A9 | Taint labels | `TaintTracker` (C9) | Medium — drives cross-capability decisions |
| A10 | Kill switches | `KillSwitches` (C9) | Critical — emergency stop |

---

## 3. Trust boundaries

| ID | Boundary | From | To | Why a boundary |
|---|---|---|---|---|
| B1 | Approval boundary | Human / external actor | `ApprovalBroker` | A human can grant authority; engine alone cannot. |
| B2 | Remote transport boundary | External remote peer (Slack/Feishu/CLI) | Agent loop | A remote peer can issue commands; trust must be established on the wire. |
| B3 | Sandbox containment boundary | Sandbox backend (native / Docker / WSL2 / Lima) | Host filesystem, host network, host process tree | The sandbox is the only place where user code may run; boundary must be defensible. |
| B4 | Plugin lifecycle boundary | Registry / registry user | Agent loop | Install ≠ enable; capability must be declared before reachable. |
| B5 | Provenance / licence boundary | Upstream source (OpenWork, Open Cowork, npm) | Materialized component | A nested licence may forbid extract / copy / derivative. |
| B6 | Audit / observability boundary | Runtime events | Persistent audit log | The audit log must not leak secret material; the runtime must not be able to silently drop events. |
| B7 | Secret / taint / quota / kill-switch boundary | Capability chains | External effectors (network, process spawn, FS write) | Taint must propagate; quotas must deny; kill switches must be authoritative. |

Each boundary is mapped to the relevant C-contract(s) and to the corresponding
test references in §5.

---

## 4. STRIDE per boundary

### B1 — Approval boundary (C3 ApprovalBroker, C2 PolicyEngine)

| Threat | STRIDE | Mitigation | Residual risk |
|---|---|---|---|
| An "auto" mode grants an undeclared capability without human review | E (Elevation) | C3 forbids a global `auto` mode; any automation is a named, scoped, expiring rule in `PolicyEngine` (C2). Test: C3-auto-rule-required. | Operator-authored rule that is too broad; mitigated by `expiresAt` and by periodic re-review. |
| An approval is replayed past its `expiresAt` | T (Tampering) | C3 `resolve()` re-validates the request through `PolicyEngine` before persisting the decision. Test: C3-approval-timeout-deny. | Clock-skew between the user and the runtime; mitigated by monotonic clocks + max 24 h ceiling. |
| A user revokes an approval but the runtime continues to honour it | R (Repudiation) | C3 exposes `cancel(id, reason)`; C8 emits `approval.cancel`. Test: C3-approval-cancel-effective. | Approvals that have already been persisted as policy rules; mitigated by the `single-use` default. |
| A non-human actor bypasses `ApprovalBroker` and writes a `PolicyRule` directly | E (Elevation) | C2 lists `listRules()` and the engine is the only writer; rule insertion is mediated by the engine. Test: C2-no-bypass-writer. | An internal `system` actor that the engine trusts; mitigated by audit + human review of `system`-authored rules. |
| An approval grants a capability not present in the original `CapabilityRequest` | E (Elevation) | C3 `resolve()` re-evaluates with the original request, not a substituted one. Test: C3-approval-narrow-scope. | None material. |

### B2 — Remote transport boundary (C7 RemoteTransportPort, C8 AuditRuntime)

| Threat | STRIDE | Mitigation | Residual risk |
|---|---|---|---|
| A WebSocket is treated as authenticated because it connected | S (Spoofing), E (Elevation) | C7: every transport plane authenticates **on the path**; WebSocket without an `Authorization` header / signed token / paired-identity is not authenticated; first non-handshake frame is dropped. Test: C7-websocket-no-creds-denied. | A misconfigured transport that fails open in dev; mitigated by `mode: "open"` being invalid at construction (test: C7-open-mode-refused). |
| A transport is configured with `mode: "open"` | E (Elevation) | C7 declares `open` invalid; the registry refuses to construct such a transport. Test: C7-open-mode-refused. | None. |
| Pairing is initiated by an already-unauthenticated peer | S (Spoofing) | C7: pairing requires an **already-authenticated out-of-band actor**; the pairing code is one-shot and expires in ≤ 5 min. Test: C7-pairing-needs-oob-auth. | Out-of-band channel itself is compromised (e.g. social engineering of the human); out of band of this model. |
| A remote command is replayed | T (Tampering) | C7 binds the identity to a sequence number / nonce; replayed commands are denied. Test: C7-replay-denied. | Replay window of a few seconds in distributed deployments; mitigated by short nonce windows. |
| A remote command bypasses the `PolicyEngine` | E (Elevation) | C7: `receive()` translates every command into a `CapabilityRequest` and routes it through C2. Test: C7-remote-via-engine. | A transport that constructs a `CapabilityRequest` that lies about the actor; mitigated by C8 audit and by transport-level identity binding. |
| A revoked identity continues to issue commands | S (Spoofing), E (Elevation) | C7 `revoke(identityId)` is immediate; the next command is denied and audit-logged. Test: C7-revoke-effective. | Cached identities in load-balanced backends; mitigated by short-lived tokens. |
| A misbehaving transport leaks error strings that carry credentials | I (Information disclosure) | C7 `respond()` returns a structured response; raw error strings are not echoed. Test: C7-respond-no-echo. | Application-level errors that embed `resource`; mitigated by C8 `redact()`. |

### B3 — Sandbox containment boundary (C6 SandboxPort, C9 quotas)

| Threat | STRIDE | Mitigation | Residual risk |
|---|---|---|---|
| A `rawPath` resolves to a path outside the workspace via lexical escape | T (Tampering), E (Elevation) | C6: canonicalize-nearest-existing-parent algorithm rejects lexical escape; a Windows path that would widen the root is denied (`\\?\C:\...`, `\\.\pipe\...`, `C:\..\..\Windows`). Test: C6-windows-no-widen, C6-lexical-escape-denied. | A path that uses an obscure Windows reserved name; mitigated by the denylist + W^X policy on the backend. |
| A `rawPath`'s nearest existing parent is a symlink pointing outside the workspace | E (Elevation) | C6 explicitly rejects `symlinked-parent-escape` (decision is `deny` regardless of the lexical suffix). Test: C6-symlinked-parent-denied. | Time-of-check vs time-of-use races; mitigated by C6 re-validation at use time inside the backend. |
| A TOCTOU race replaces a directory between decision and use | T (Tampering), E (Elevation) | C6 re-validates the canonical path at the moment of use inside the backend; a divergence is `deny: toctou`. Test: C6-toctou-denied. | Kernel-level TOCTOU that cannot be observed at the FS layer; mitigated by `O_NOFOLLOW` / `O_RESOLVE_BENEATH` on the backend. |
| A command relies solely on a denylist (e.g. "block `rm -rf /`") | T (Tampering), E (Elevation) | C6 explicitly rejects `denylist-only` policies; at least one explicit allow rule per command class is required. Test: C6-denylist-only-denied. | Operators who add too-broad allow rules; mitigated by audit + review + quotas. |
| A `write` to a non-existing target silently creates a wider file | T (Tampering) | C6 separates `read/watch` (must exist) from `write/create` (may not yet exist); the canonical path is checked against the workspace root in both cases. Test: C6-write-no-silent-create. | None material. |
| A sandbox execution consumes unbounded host resources | D (Denial of service) | C9 quotas (`concurrentSandboxExecutions`, `diskUsage`, `bytesPerMinute`) and `execute` timeouts. Test: C9-quota-exceeded-deny. | A backend that leaks resources outside the runtime's accounting; mitigated by OS-level cgroups on the backend. |
| A secret value is returned to the agent loop and exfiltrated through the sandbox | I (Information disclosure) | C9 `SecretStore.get()` returns the value only to a named, scoped sandbox execution; the value is substituted at the boundary and stripped from any audit event. Test: C9-secret-no-return-to-loop. | Application code in the sandbox that logs the value to its own console; mitigated by stdout redaction. |

### B4 — Plugin lifecycle boundary (C5 lifecycle, C1 CapabilityDescriptor, C4 ProvenanceRecord)

| Threat | STRIDE | Mitigation | Residual risk |
|---|---|---|---|
| `install` (materialize) silently enables a component | E (Elevation) | C5: install is `materialize`, which is **not** `enable`. `enable` requires a separate decision through `PolicyEngine`. Test: C5-install-not-enable. | A user who clicks "trust and run" on an approval dialog without reading; mitigated by clear UI + audit trail. |
| Two components with the same manifest name are conflated | S (Spoofing), T (Tampering) | C5: identity is the **source digest**, not the manifest name; renaming or republishing does not invalidate the previous record. Test: C5-identity-is-digest. | A user who deletes a record thinking they removed all versions; mitigated by `purge` being explicit. |
| `materialize` overwrites an existing installation with a different digest | T (Tampering), E (Elevation) | C5: `materialize` MUST NOT overwrite; if a digest already exists, the operation fails with `ALREADY_MATERIALIZED`. Test: C5-no-overwrite. | None. |
| `materialize` implicitly grants a capability | E (Elevation) | C5: every granted capability is declared in the `CapabilityDescriptor` and authorised per request through C2. Test: C5-no-implicit-grant. | A descriptor that declares broader effects than the user expects; mitigated by approval flow + review. |
| A non-admissible component (e.g. Anthropic-restricted) is registered | T (Tampering), E (Elevation) | C4: the registry refuses any `/ee/` path and any `.claude/skills/{docx,pdf,pptx,xlsx}` path. Test: C4-anthropic-refused, C4-ee-refused. | A user who bypasses the registry by hand-loading a component; mitigated by `PolicyEngine` refusing unregistered descriptors. |
| A component is enabled with a stale or missing `ProvenanceRecord` | T (Tampering) | C1: a descriptor with no `sourceDigest` or no `ProvenanceRecord` is rejected at registration; C5: `enable` requires the provenance to be admissible. Test: C1-no-provenance-rejected, C5-enable-needs-provenance. | A component whose digest was computed but whose provenance has since been revoked; mitigated by re-validation at `enable`. |
| A revoked component continues to run | T (Tampering), E (Elevation) | C5 `disable` is reversible and audit-logged; C9 `kill_switch.engage("all-plugin-enable")` rolls back every enabled component. Test: C5-disable-audit, C9-kill-switch-rollback. | Background work that does not check the kill switch; mitigated by the engine forcing all reachable components through a wrapper. |

### B5 — Provenance / licence boundary (C4 ProvenanceRecord)

| Threat | STRIDE | Mitigation | Residual risk |
|---|---|---|---|
| A component is imported despite an upstream licence that forbids extract / copy / derivative | T (Tampering), E (Elevation), L (Legal) | C4 + `IMPORT-CANDIDATES.md` OCW-S1.a–d: Anthropic-restricted components are `EXCLUDE_LICENCE` and refused at registration. Test: C4-anthropic-refused. | Operator who hand-loads a restricted file outside the registry; mitigated by the runtime not being able to address the file by digest. |
| A permissive root `LICENSE` is used to erase a more restrictive nested notice | T (Tampering) | C4: nested licences always win over a more permissive root; the most restrictive applicable licence applies per file. Test: C4-nested-wins. | A nested notice that the operator never reads; mitigated by the registry's verdict being mandatory. |
| An OpenWork `/ee/` path is loaded despite Fair Source | L (Legal), E (Elevation) | C4 + `IMPORT-CANDIDATES.md` OW-S6: `/ee/` is `EXCLUDE_LICENCE`; the registry refuses any path under `ee/`. Test: C4-ee-refused. | None. |
| An Apache-2.0 component is shipped without the licence text or attribution | L (Legal) | C4 + `IMPORT-CANDIDATES.md` OCW-S1.e: Apache 2.0 is admissible **only** with §4(a) licence copy + §4(b) modification notices + §4(c) attribution; §3 patent retaliation tracked. Test: C4-apache-attribution. | A downstream modifier who strips the NOTICE; mitigated by the distributed pack carrying it. |
| A licence verdict is UNKNOWN | R (Repudiation) | C4: an `UNKNOWN` verdict blocks the component; the verdict is human-reviewed via a `BLOCKED_LICENCE` card. Test: C4-unknown-blocked. | An UNKNOWN that is auto-allowed; mitigated by `UNKNOWN` → `BLOCKED_LICENCE` default. |

### B6 — Audit / observability boundary (C8 AuditRuntime)

| Threat | STRIDE | Mitigation | Residual risk |
|---|---|---|---|
| A secret value is persisted in the audit log | I (Information disclosure) | C8: `resource` and any free-form string is passed through `redact()`; raw credentials and full environment variable values are never persisted. Test: C8-no-secret-in-dump (corpus test). | A secret that does not match the redactor's pattern; mitigated by additive patterns and by human review of new event types. |
| A `deny` decision is not logged | R (Repudiation) | C8: every allow / deny / approval_required / remote / sandbox / plugin event emits an `AuditEvent`; missing event is a conformance failure. Test: C8-every-decision-logged. | A drop in transport to the audit sink; mitigated by a local buffer + replay. |
| An `allow` decision is logged with the wrong actor or correlation | R (Repudiation) | C8: every event carries `actor`, `workspace`, `capability`, `resource`, `ruleId`, `sourceDigest` (when relevant), `correlation`. Test: C8-event-fields-complete. | None. |
| The audit log is silently truncated | R (Repudiation) | C8: the log is append-only; deletion requires out-of-band human action and itself emits an audit event. Test: C8-delete-audited. | Disk-full; mitigated by rotation policy + alarm. |
| A `kill_switch.engage` is not recorded before shutdown | R (Repudiation) | C8: a `kill_switch.engage` event MUST be emitted **before** shutdown begins. Test: C8-kill-switch-pre-emit. | Crash between emit and shutdown; mitigated by `kill_switch.engage` being the first instruction in the shutdown path. |

### B7 — Secret / taint / quota / kill-switch boundary (C9)

| Threat | STRIDE | Mitigation | Residual risk |
|---|---|---|---|
| A `secret.read` capability is combined with `network.connect` | I (Information disclosure), E (Elevation) | C9: `TaintTracker` propagates taint; the `PolicyEngine` denies the combination regardless of precedence. Test: C2-taint-veto, C9-taint-propagates. | A capability that mis-declares its effects; mitigated by C1 requiring `declaredEffects`. |
| A secret is returned to the agent loop | I (Information disclosure) | C9: `SecretStore.get()` returns the value only to a named, scoped sandbox execution. Test: C9-secret-no-return-to-loop. | Application code in the sandbox that mirrors the value into a workspace file; mitigated by `TaintTracker` marking the file. |
| Quota exhaustion allows continued operation | D (Denial of service) | C9: quotas are enforced per workspace; exceeding returns `exceeded` and emits an audit event. Test: C9-quota-exceeded-deny. | Backends that do not honour the quota signal; mitigated by the runtime refusing to schedule new work. |
| A kill switch can be disabled by a non-human actor | E (Elevation) | C9: `engage()` and `release()` are both `actor`-typed; a remote or plugin actor cannot release a switch engaged by a human (release requires a human, system, or kill-switch operator; tracked case-by-case). Test: C9-kill-switch-actor. | A compromised human session; mitigated by out-of-band confirmation for `release`. |
| `kill_switch.engage("all-remote")` leaves some connections open | D (Denial of service), I (Information disclosure) | C9: `all-remote` terminates all open `RemoteTransportPort` connections and refuses new pairing. Test: C9-kill-switch-rollback. | Connections that ignore the runtime's terminate signal; mitigated by the OS-level socket close. |
| A `kill_switch.engage("all-plugin-enable")` leaves some components reachable | E (Elevation) | C9: `all-plugin-enable` rolls back every component from `enabled` to `materialized` (or `approved`). Test: C9-kill-switch-rollback. | A component that bypasses the registry at runtime; mitigated by `PolicyEngine` refusing unregistered descriptors. |

---

## 5. Test references per boundary

| Boundary | Test references (in `P3-CONTRACTS-DRAFT-2026-08-03.md` §13) |
|---|---|
| B1 Approval | C3-auto-rule-required, C3-approval-timeout-deny, C3-approval-cancel-effective, C3-approval-narrow-scope, C2-no-bypass-writer |
| B2 Remote | C7-websocket-no-creds-denied, C7-open-mode-refused, C7-pairing-needs-oob-auth, C7-replay-denied, C7-remote-via-engine, C7-revoke-effective, C7-respond-no-echo |
| B3 Sandbox | C6-lexical-escape-denied, C6-windows-no-widen, C6-symlinked-parent-denied, C6-toctou-denied, C6-denylist-only-denied, C6-write-no-silent-create, C9-quota-exceeded-deny, C9-secret-no-return-to-loop |
| B4 Plugin lifecycle | C5-install-not-enable, C5-identity-is-digest, C5-no-overwrite, C5-no-implicit-grant, C1-no-provenance-rejected, C5-enable-needs-provenance, C5-disable-audit, C9-kill-switch-rollback |
| B5 Provenance / licence | C4-anthropic-refused, C4-ee-refused, C4-apache-attribution, C4-nested-wins, C4-unknown-blocked |
| B6 Audit | C8-no-secret-in-dump, C8-every-decision-logged, C8-event-fields-complete, C8-delete-audited, C8-kill-switch-pre-emit |
| B7 Secret / taint / quota / kill-switch | C2-taint-veto, C9-taint-propagates, C9-secret-no-return-to-loop, C9-quota-exceeded-deny, C9-kill-switch-actor, C9-kill-switch-rollback |

---

## 6. Residual risks

- **Phase 4 debt B6:** `WorkspaceRuntime` MUST use `realpath`/equivalent final-target containment for every authorized root; lexical `resolve()` alone is insufficient against junctions or symlinked roots. (cross-cutting)

These risks are **not** fully mitigated by the contracts above. Each is
flagged here so it can be tracked across phases and so the next reviewer can
challenge the assumptions.

- **R1 — Operator over-broad rule.** A human-authored `PolicyRule` may
  allow a capability too broadly. Mitigated by `expiresAt` and periodic
  re-review, but the engine itself cannot tell a "good" rule from a "bad"
  one. Tracked in Phase 4 (WorkspaceRuntime).
- **R2 — Out-of-band channel compromise.** C7 assumes the out-of-band
  channel used to authorise a pairing is itself trustworthy. A compromised
  human session is out of band of this model.
- **R3 — Backend kernel TOCTOU.** C6 mitigates FS-level TOCTOU, but a
  kernel-level race that cannot be observed at the FS layer remains.
  Mitigated by `O_NOFOLLOW` / `O_RESOLVE_BENEATH` on the backend, but
  portability across all backends is not yet proven.
- **R4 — Redactor coverage.** C8 `redact()` relies on pattern matching
  for known secret shapes. A new secret shape that does not match the
  patterns would not be redacted. Mitigated by human review of new event
  types and by additive patterns.
- **R5 — Model-side prompt injection.** Not in scope. A model that has
  read an attacker-controlled document and produces a `CapabilityRequest`
  for an attacker's resource is not detected by the engine. Tracked in
  a separate `MODEL-TRUST` document.
- **R6 — UI bypass.** A misbehaving approval UI could fail to render a
  risk indicator. Mitigated by structured risk in the `ApprovalRequest`
  and by audit, but the human factor is a residual.

---

## 7. Gate

`CONTRACTS_ACCEPTED_WITH_TRACKED_DEBT`. The independent review passed after the contract and import corrections. Runtime adapter work may proceed only against the reviewed contracts; B6 remains explicitly tracked for Phase 4 WorkspaceRuntime. No upstream import, `/ee` materialization, open transport mode, or global auto approval is permitted.
