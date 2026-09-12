# P3 — Security Foundation Contracts (Draft)

**Date**: 2026-08-03
**Status**: `CONTRACTS_ACCEPTED` (independently reviewed by Claude on 2026-08-03; documentary corrections closed)
**Authority**: Plan directeur V3 — Unifia Workbench (Unifia Core boundary,
§7.3 CapabilityPort, §7.5 SandboxPort, §7.6 RemoteTransportPort, §5 trust
and governance: PolicyEngine / ApprovalBroker / SecretStore / AuditRuntime /
CapabilityEngine / TaintTracker / Quotas / KillSwitches)
**Evidence**: `M1-BEHAVIOR-EVIDENCE-2026-08-03.md`, `M1-PROVENANCE-DETAIL-2026-08-03.md`

This document defines contracts before implementation. It intentionally contains
no imported upstream code and no runtime changes. Amendments in this revision
implement the C1–C9 contract set requested by `UNIFIA-P3-REVIEW-2026-08-03` and
correct the remote, sandbox and plugin-lifecycle contracts flagged as bypassable
in that review.

---

## 1. Unifia Core authority (carried forward, unchanged)

All agent sessions, providers, tools, permissions, secrets, memory and audit
records are owned by Unifia Core. Upstream OpenWork and Open Cowork components
may only be consumed through explicit ports/adapters (Plan V3 §7 ports).

**Invariant:** no adapter may create a second session, provider, tool or
approval authority outside the Core boundary. In particular, Open Cowork's
remote gateway and OpenWork's `apps/server` may not be loaded as a runtime —
only as inputs to a Unifia Core port.

---

## 2. Contract index (C1–C9)

| ID | Contract | Purpose | Section |
|---|---|---|---|
| C1 | `CapabilityDescriptor` / `CapabilityRequest` | Typed description of what a skill/plugin can request and what it offers | §3 |
| C2 | `PolicyEngine` | Decide allow / deny / approval_required for any `CapabilityRequest` | §4 |
| C3 | `ApprovalBroker` | Collect, time-bound and record human decisions on `approval_required` requests | §5 |
| C4 | `ProvenanceRecord` | Per-component licence + source digest + nested notice record | §6 |
| C5 | Plugin lifecycle (registered → approved → materialized) | Install ≠ enable ≠ execute. Identity is source digest, not manifest name. | §7 |
| C6 | `SandboxPort` | Containment-correct path/command execution; canonicalize nearest existing parent | §8 |
| C7 | `RemoteTransportPort` | Authenticated transport planes; `open` is invalid; WebSocket cannot authenticate without credentials | §9 |
| C8 | `AuditRuntime` | Structured events for every allow/deny/approval/remote/sandbox/install/materialize | §10 |
| C9 | `SecretStore` / `TaintTracker` / `Quotas` / `KillSwitches` | Secret isolation, capability taint propagation, rate limits, emergency stop | §11 |

The numbered IDs are stable references for the threat model
(`THREAT-MODEL-P3-2026-08-03.md`) and for the conformance suite (§13).

---

## 3. C1 — CapabilityDescriptor / CapabilityRequest
The capability vocabulary is closed and normative. These are the 14 Plan V3 capabilities; an implementation MUST NOT collapse them into an unscoped generic effect or invent an additional capability at runtime.

| Capability | Required scope | Minimum declared effects |
|---|---|---|
| `workspace.read[path]` | path | `filesystem.read` |
| `workspace.write[path]` | path | `filesystem.write` |
| `workspace.watch[path]` | path | `filesystem.watch` |
| `artifact.create[type]` | artifact type | `artifact.create` |
| `artifact.export[type,path]` | type + destination path | `artifact.export` + `filesystem.write` |
| `terminal.run[command-pattern]` | command pattern | `process.spawn` |
| `network.request[host-pattern]` | host pattern | `network.connect` |
| `browser.navigate[host-pattern]` | host pattern | `network.connect` + `ui.prompt` |
| `desktop.observe[app/window]` | app/window | `desktop.observe` |
| `desktop.control[app/window/action]` | app/window/action | `desktop.control` |
| `remote.receive[transport/identity]` | transport + identity | `remote.receive` |
| `remote.respond[transport/identity]` | transport + identity | `remote.send` |
| `secret.read[name]` | secret name | `secret.read` |
| `package.install[id/publisher]` | package + publisher | `process.spawn` + `filesystem.write` |

The six critical combinations are named `PolicyEngine` rules and MUST be tested independently: `secret.read + network.request`, `desktop.control + secret.read`, `remote.receive + terminal.run`, `package.install + desktop.control`, `workspace.read[global] + network.request[*]`, and `browser.cookies + network.request[*]`. The last combination is a derived browser taint/effect rule and MUST be representable even though `browser.cookies` is not independently grantable.

```ts
type CapabilityId = string;            // e.g. "workspace.read[path]"
type WorkspaceId  = string;
type CorrelationId = string;

interface CapabilityDescriptor {
  id: CapabilityId;
  owner: string;                        // "core" | "pack:<name>" | "plugin:<digest>"
  sourceDigest: string;                 // sha256 of the component sources
  licenceRef: string;                   // path to the licence marker that applies
  nestedNotices: string[];              // paths to nested NOTICE / LICENSE.txt files
  workspace: WorkspaceId;               // scope of authority
  enabled: boolean;                     // materialized and reachable from the agent loop
  version: string;                      // semver of the descriptor schema
  declaredEffects: ReadonlyArray<
    | "filesystem.read" | "filesystem.write" | "filesystem.watch"
    | "network.connect" | "network.listen"
    | "process.spawn"   | "process.signal"
    | "secret.read"     | "secret.write"
    | "ui.prompt"       | "ui.notify"
    | "desktop.observe" | "desktop.control"
    | "remote.receive"  | "remote.send"
    | "artifact.create" | "artifact.export"
  >;
  declaredResources: ReadonlyArray<string>; // path globs, hosts, ports, tool names
  requiresApproval: ReadonlyArray<CapabilityId>;
  taintOrigins: ReadonlyArray<CapabilityId>; // what tainted sources feed this capability
}

interface CapabilityRequest {
  capability: CapabilityId;
  actor: { kind: "user" | "agent" | "remote" | "system"; id: string };
  workspace: WorkspaceId;
  resource: string;                     // concrete path / host / command
  reason: string;
  correlation: CorrelationId;
  requestedAt: number;                  // epoch ms
  expiresAt?: number;                   // optional hard expiry
}
```

**Invariants:**

- A `CapabilityDescriptor` is **only** valid when paired with a `ProvenanceRecord`
  (C4). Descriptor without provenance → `BLOCKED` at the registry.
- A descriptor with `enabled: true` MUST also have passed the
  registered → approved → materialized lifecycle (C5).
- A capability is **never** granted implicitly: any code path that issues a
  `CapabilityRequest` MUST go through the `PolicyEngine` (C2).

---

## 4. C2 — PolicyEngine

```ts
interface PolicyEngine {
  evaluate(request: CapabilityRequest, context: PolicyContext): PolicyDecision;
  listRules(filter?: { workspace?: WorkspaceId }): ReadonlyArray<PolicyRule>;
}

interface PolicyContext {
  descriptor: CapabilityDescriptor;
  taint: TaintLabel;                    // current taint propagated from prior capabilities
  quotaSnapshot: QuotaSnapshot;
  workspaceTrust: "trusted" | "untrusted" | "mixed";
}

type PolicyDecision =
  | { effect: "deny"; reason: string; ruleId: string; correlation: CorrelationId }
  | { effect: "allow"; ruleId: string; correlation: CorrelationId; expiresAt?: number }
  | { effect: "approval_required"; approvalId: string; ruleId: string; correlation: CorrelationId };
```

**Defaults (deny by default — no implicit allow):**

- Deny unknown capabilities (no rule → deny).
- Deny global workspace access (paths outside the workspace are denied).
- Deny arbitrary network egress.
- Deny the six named critical combinations in C1, including every request
  whose declared effects or taint make one of those combinations true.
- Deny all components that do not have a valid `ProvenanceRecord`.
- Deny all `/ee/` paths (OpenWork enterprise, FSL-1.1-MIT).
- Deny all Open Cowork `.claude/skills/{docx,pdf,pptx,xlsx}/**` paths
  (Anthropic-restricted licence, see C4 and the licence audit).

There is no `effect: "auto_allow"` and no `mode: "auto"` for the engine.
An "automation" policy is a **named, scoped, expiring rule** evaluated by
`PolicyEngine` and recorded in `AuditRuntime` (C8).

---

## 5. C3 — ApprovalBroker

```ts
interface ApprovalBroker {
  request(input: ApprovalRequest): Promise<ApprovalDecision>;
  resolve(id: string, decision: "allow" | "deny", actor: string): Promise<void>;
  cancel(id: string, reason: string): Promise<void>;
  list(workspace?: WorkspaceId): Promise<ReadonlyArray<ApprovalRequest>>;
}

interface ApprovalRequest {
  id: string;
  request: CapabilityRequest;
  context: PolicyContext;
  createdAt: number;
  expiresAt: number;                    // hard expiry; default 60s, max 24h
  prompt: { title: string; body: string; resource: string; risk: "low" | "medium" | "high" };
}
```

**Rules:**

- There is **no unrestricted `auto` mode**. An "auto" policy is a named rule
  registered in `PolicyEngine`, scoped to a specific capability and resource
  pattern, with a finite expiry, and recorded in `AuditRuntime` (C8).
- **Timeout is deny.** If `expiresAt` passes before `resolve()` → decision is
  `deny` and an audit event is emitted.
- Every decision carries: `actor`, `workspace`, `capability`, `resource`,
  `ruleId`, `correlation` and the originating `ProvenanceRecord` digest.
- Approvals are **single-use** by default; reusable approvals require an
  explicit, expiring rule in the `PolicyEngine`.
- The approval UI cannot bypass the `PolicyEngine` — it can only call
  `resolve(allow|deny)`; the engine re-evaluates the request and produces the
  authoritative decision.

---

## 6. C4 — ProvenanceRecord

```ts
interface ProvenanceRecord {
  component: string;                    // e.g. "open-cowork/.claude/skills/pdf"
  sourceDigest: string;                 // sha256 of the canonical source archive
  sourceUri: string;                    // locked commit + bare repo path
  licenceRoot: { path: string; verdict: "MIT" | "Apache-2.0" | "Anthropic-restricted" | "FSL-1.1-MIT" | "UNKNOWN"; note: string };
  nestedNotices: ReadonlyArray<{
    path: string;                       // e.g. ".claude/skills/pdf/LICENSE.txt"
    verdict: "MIT" | "Apache-2.0" | "Anthropic-restricted" | "FSL-1.1-MIT" | "UNKNOWN";
    note: string;
  }>;
  resolvedAt: number;                   // when the verdict was issued
  resolvedBy: string;                   // audit card or human approver
}
```

**Rules:**

- A nested `LICENSE.txt` / `NOTICE` / `THIRD_PARTY` file is **never erased**
  by a more permissive root `LICENSE`. The most restrictive applicable
  licence wins per file.
- The four Open Cowork `.claude/skills/{docx,pdf,pptx,xlsx}/LICENSE.txt`
  files are all `Anthropic-restricted` (verbatim text in
  `M1-PROVENANCE-DETAIL-2026-08-03.md` §3.1). Their verdict is:
  **`EXCLUDE_LICENCE` — no extract, no copy, no derivative, no distribute, no
  sublicense, no transfer.** The runtime MUST refuse to register, materialize
  or invoke any of these sub-skills.
- The fifth sub-skill, `.claude/skills/skill-creator/LICENSE.txt`, is
  `Apache-2.0` and is **conditionally admissible** under §4 of that licence
  (licence copy propagation, modification notices, attribution preservation,
  patent retaliation awareness). Per-file review still required.
- OpenWork `/ee/**` is `FSL-1.1-MIT` (Fair Source) and is permanently
  `EXCLUDE`; the registry MUST refuse to register any `/ee/` path even if
  the user tries to add it manually.

---

## 7. C5 — Plugin lifecycle (registered → approved → materialized)

The lifecycle has **three distinct states**. `enabled` is not a fourth state;
it is a separate reachability gate evaluated after materialization. Each state
has a single gate that moves it to the next.

```
                        register()
            (no I/O, no exec, no network, no secrets)
              register() → source → digest computed → registry row
                          │
                          ▼
                       registered
                          │
                          │  approve()    [human OR named policy rule]
                          │  - source digest matches
                          │  - ProvenanceRecord admissible
                          │  - user consent recorded
                          ▼
                        approved
                          │
                          │  materialize() [side-effect-isolated]
                          │  - install in isolated worktree
                          │  - declare capabilities in CapabilityDescriptor
                          │  - NOT yet reachable from the agent loop
                          ▼
                      materialized
                          │
                          └── enable() [separate PolicyEngine reachability gate]
                              CapabilityDescriptor.enabled = true only after this gate
```

**Rules:**

- `install` and `materialize` are distinct operations: install registers an admissible source and may prepare an isolated staging area; materialize creates the isolated runtime artifact. Neither operation is `enable`. The runtime MUST
  refuse to load any approved component into the agent loop without an
  explicit `enable` step that goes through the `PolicyEngine`.
- A component's identity is the **source digest**, not the manifest
  name. Two components with the same manifest name but different source
  digests are distinct entries in the registry. Renaming or republishing
  does not invalidate the previous record.
- `materialize` MUST NOT overwrite an existing installation. If a digest
  already exists at the target path, the operation fails with
  `ALREADY_MATERIALIZED`; the user is offered `uninstall` first.
- `materialize` MUST NOT implicitly grant any capability. Every granted
  capability is declared in the `CapabilityDescriptor` and authorised
  through `PolicyEngine` per request.
- `uninstall` and `disable` are reversible; `purge` deletes the source
  digest and the `ProvenanceRecord` from the registry. Both `uninstall`
  and `purge` emit audit events.

---

## 8. C6 — SandboxPort (path/command containment)

```ts
interface SandboxPort {
  inspect(): Promise<SandboxBackendInfo[]>;
  prepare(policy: SandboxPolicy): Promise<SandboxHandle>;
  execute(handle: SandboxHandle, request: ExecutionRequest): Promise<Execution>;
  terminate(handle: SandboxHandle): Promise<void>;
}

interface PathRequest {
  workspace: WorkspaceId;
  rawPath: string;                      // input from a tool or user
  mode: "read" | "write" | "create" | "delete" | "watch";
}

interface PathDecision {
  effect: "allow" | "deny";
  reason: string;
  canonical?: string;                   // canonical absolute path, if allowed
  correlation: CorrelationId;
}

interface CommandRequest {
  workspace: WorkspaceId;
  argv: ReadonlyArray<string>;
  envAllowList: ReadonlyArray<string>;  // explicit env var names permitted
  network: "none" | "egress-allowlist";
  timeoutMs: number;
}
```

**Path decision algorithm (canonicalize the deepest existing accumulator +
remaining lexical suffix):**

1. Take `rawPath`. Convert backslashes to `/` (Windows). Strip a single
   drive-letter prefix (e.g. `C:`) but **never** treat it as widening the
   workspace root.
2. Reject immediately if `rawPath` resolves to a path **outside** the
   workspace (lexical comparison only — do **not** follow symlinks at this
   stage).
3. Walk path components from the target backwards until the **deepest existing
   accumulator** is found (the last existing parent, nearest to the target).
   The remaining components form the lexical suffix. Every intermediate
   component between the workspace root and that accumulator MUST be checked.
4. `realpath` the deepest existing accumulator and resolve or reject every
   intermediate symlink. Then concatenate the lexical suffix. The result is
   the **canonical path**.
5. Re-verify that the canonical path is contained in the workspace root.
   If not → `deny: escaped`.
6. If the mode is `read` / `watch`, `stat` the canonical path; if it does
   not exist → `deny: not-found` (never silently create).
7. If the mode is `write` / `create`, the canonical path may legitimately
   not exist. In that case, the canonical path is the result of step 4
   and the decision is `allow` (subject to workspace containment). A lexical
   suffix beginning with `..` or an absolute segment is `deny`; silent
   rewriting to a different authorized target is forbidden.

**Rejected inputs (mandatory `deny`):**

- A `rawPath` whose deepest existing parent is a symlink pointing outside
  the workspace root → `deny: symlinked-parent-escape`.
- A Windows path that would, when canonicalized, escape the workspace root
  (e.g. `\\?\C:\...`, `\\.\pipe\...`, `C:\..\..\Windows`) → `deny`.
- Decisions taken on a path that may have been replaced between stat and
  use (TOCTOU) → the path decision is **re-validated** at the moment of
  use, inside the sandbox backend, with the same canonicalization
  algorithm. A divergence between decision-time and use-time canonical
  paths is `deny: toctou`.
- A command whose security relies solely on a denylist (e.g. "block
  `rm -rf /`") → `deny: denylist-only`. The sandbox MUST require at least
  one explicit allow rule per command class.

**Backend isolation:**

- Backends are `native-restricted`, `Docker`, `WSL2`, `Lima/Apple-Container`,
  `browser-profile`, `document-worker`, `external-MCP`, `local-model`. A
  backend is **only** selectable if its `SandboxBackendInfo.capabilities`
  cover the requested effects.
- `execute` runs in the chosen backend; the host process MUST NOT execute
  the request directly. There is no "trust the host" path.

---

## 9. C7 — RemoteTransportPort (authenticated transport)

```ts
interface RemoteTransportPort {
  pair(input: PairingRequest): Promise<PairingSession>;
  verify(envelope: RemoteEnvelope): Promise<RemoteIdentity>;
  receive(): AsyncIterable<RemoteCommand>;
  respond(input: RemoteResponse): Promise<void>;
  revoke(identityId: string): Promise<void>;
}

type RemoteAuthMode = "token" | "allowlist" | "pairing"; // "open" is INVALID

interface PairingRequest {
  transport: "websocket" | "http" | "sse" | "grpc" | "unix";
  initiatedBy: "user" | "agent";        // who is asking to start a pairing
  scope: ReadonlyArray<CapabilityId>;    // what the paired identity will be allowed
  expiresAt: number;
}
```

**Authentication rules (mandatory, on every transport plane):**

- Every transport plane (WebSocket, HTTP, SSE, gRPC, Unix socket) MUST
  authenticate **on the path to the agent**, not afterwards. A WebSocket
  upgrade without a valid `Authorization` header / signed token /
  paired-identity is **not** considered authenticated.
- The transport implementation MUST NOT mark a client as authenticated
  based on the connection alone (no "you're in because you connected"
  shortcut). The first inbound frame that is not part of the
  authentication handshake is dropped, and the connection is closed.
- `RemoteAuthMode` is one of `token`, `allowlist`, `pairing`. The mode
  `open` is **invalid**; the registry refuses to construct a transport
  with `mode: "open"`.
- `pairing` requires an **already-authenticated out-of-band actor** to
  approve the pairing request. The pairing code (or QR / out-of-band
  channel) is only consumable once, expires in ≤ 5 minutes, and yields
  a `RemoteIdentity` that is itself scoped to a workspace and to a
  `CapabilityRequest` set.
- A pairing code MUST be delivered only through the authenticated out-of-band approval channel; it MUST NOT be returned on the unauthenticated inbound transport.
- The remote identity is **bound** to:
  1. A workspace.
  2. A `CapabilityRequest` set.
  3. A rate limit (e.g. requests/minute, bytes/minute).
  4. A replay window (sequence number / nonce).
- `receive()` is an `AsyncIterable<RemoteCommand>`. Each command is
  translated into a `CapabilityRequest` and routed through the
  `PolicyEngine` (C2). A remote command cannot bypass the engine.
- `respond()` carries the `correlation` id and a structured response;
  raw error strings are not echoed.
- `revoke(identityId)` is immediate. Subsequent commands with the
  revoked identity are denied and audit-logged.

---

## 10. C8 — AuditRuntime

```ts
interface AuditRuntime {
  emit(event: AuditEvent): Promise<void>;
  query(filter: AuditFilter): Promise<ReadonlyArray<AuditEvent>>;
  redact<T>(value: T): T;              // helper to strip secret-shaped strings
}

interface AuditEvent {
  type:
    | "policy.deny" | "policy.allow" | "policy.approval_required"
    | "approval.request" | "approval.resolve" | "approval.timeout"
    | "remote.connect" | "remote.command" | "remote.revoke"
    | "sandbox.path.allow" | "sandbox.path.deny" | "sandbox.execute" | "sandbox.toctou"
    | "plugin.register" | "plugin.approve" | "plugin.materialize"
    | "plugin.enable" | "plugin.disable" | "plugin.uninstall" | "plugin.purge"
    | "secret.read" | "secret.write"
    | "kill_switch.engage" | "kill_switch.release";
  ts: number;
  actor: { kind: "user" | "agent" | "remote" | "system"; id: string };
  workspace: WorkspaceId | null;
  capability: CapabilityId | null;
  resource: string | null;              // redacted by AuditRuntime.redact before persist
  decision: string;                     // "allow" | "deny" | "approval_required" | ...
  ruleId: string;
  sourceDigest: string | null;          // component digest, when relevant
  correlation: CorrelationId;
}
```

**Rules:**

- Every `allow` / `deny` / `approval_required` / `remote.receive` /
  `sandbox.*` / `plugin.install` / `plugin.materialize` / `plugin.enable`
  / `plugin.disable` / `migration` event emits an `AuditEvent`.
- `resource` and any free-form string is passed through `redact()` before
  persist. Raw credentials, full file contents, and full environment
  variable values are **never** persisted.
- The audit log is append-only. Deletion requires an out-of-band
  human action and itself emits an audit event.
- A `kill_switch.engage` event MUST be emitted **before** the
  corresponding shutdown begins; the runtime MUST be reachable for
  audit query in the seconds following the engage.

---

## 11. C9 — SecretStore / TaintTracker / Quotas / KillSwitches

```ts
interface SecretStore {
  put(ref: string, value: string, scope: WorkspaceId, actor: string): Promise<void>;
  get(ref: string, actor: string, justification: string): Promise<string>;
  list(scope: WorkspaceId): Promise<ReadonlyArray<{ ref: string; scope: WorkspaceId; createdAt: number }>>;
  revoke(ref: string, actor: string): Promise<void>;
}

interface TaintTracker {
  label(input: TaintLabel): TaintLabel;  // combine labels
  current(): TaintLabel;                 // label of the running capability chain
  check(request: CapabilityRequest): "ok" | "taint-veto";
}

interface Quotas {
  snapshot(workspace: WorkspaceId): QuotaSnapshot;
  consume(workspace: WorkspaceId, kind: QuotaKind, n: number): "ok" | "exceeded";
}

interface KillSwitches {
  engage(name: KillSwitchName, reason: string, actor: string): Promise<void>;
  release(name: KillSwitchName, actor: string): Promise<void>;
  isEngaged(name: KillSwitchName): boolean;
}

type KillSwitchName =
  | "all-remote"
  | "all-sandbox-execute"
  | "all-secret-read"
  | "all-plugin-enable"
  | "all-network-egress";
```

**Rules:**

- A secret value never leaves the `SecretStore` as a return value to the
  agent loop; it is only delivered to a **named, scoped** sandbox
  execution, with the value substituted at the boundary and stripped
  from any `AuditEvent`.
- `TaintTracker` propagates taint from any `secret.read` capability
  through subsequent capabilities. A capability that mixes
  `secret.read` + `network.connect` is `taint-veto` and the
  `PolicyEngine` denies it even if a rule would allow it.
- `Quotas` are enforced per workspace: per-minute requests, per-minute
  bytes (network), concurrent sandbox executions, concurrent secret
  reads, and disk usage of materialized components. Exceeding a quota
  is `deny` and emits an audit event.
- `KillSwitches` are emergency stops. Engaging `all-remote` terminates
  all open `RemoteTransportPort` connections and refuses new pairing
  for the remainder of the session. Engaging `all-plugin-enable` rolls
  back every component from `enabled` to `materialized` (or
  `approved`, depending on operator choice). A kill switch is the
  **only** path that may invalidate a previously-issued approval.

---

## 12. Cross-cutting invariants

- **Single authority per concern.** Policy decisions live in `PolicyEngine`
  (C2); approvals live in `ApprovalBroker` (C3); secrets live in
  `SecretStore` (C9); audit lives in `AuditRuntime` (C8). No other
  component is allowed to make a policy decision, grant an approval, or
  persist a secret.
- **No implicit allow.** Every capability use goes through C1 → C2 → C8.
- **No silent capability grant.** Plugin install ≠ enable (C5).
- **No unauthenticated remote command.** Every remote command is a
  `CapabilityRequest` after authentication (C7).
- **No path decision without canonicalization.** Even for `stat`-only
  reads, the canonicalize-nearest-existing-parent algorithm in C6 runs
  first.
- **No licence erasure.** A nested licence marker always wins over a
  permissive root licence (C4).

---

## 13. Required conformance tests before any P3 implementation

The following tests MUST exist and pass before any code is written against
the contracts above. They are also the test references for the threat model
(`THREAT-MODEL-P3-2026-08-03.md`).

### C1 — CapabilityDescriptor
- A descriptor with a missing `sourceDigest` is rejected at registration.
- A descriptor with a non-admissible `ProvenanceRecord` is rejected.
- A descriptor with `enabled: true` and no `materialize` audit trail is rejected.

### C2 — PolicyEngine
- An unknown capability → `deny`.
- A capability with no rule → `deny` (no implicit allow).
- Each of the six C1 critical combinations has a named rule and an independent deny test.
- A rule that allows `secret.read` + `network.connect` → `deny` regardless
  of precedence (taint veto).
- An OpenWork `/ee/` path → `deny` at the registry, even with a hand-written
  rule that would allow it.

### C3 — ApprovalBroker
- An approval that times out → `deny` and emits `approval.timeout`.
- An approval that grants a capability not present in the original request
  → `deny` and audit-flagged.
- A reusable approval requires a named, expiring rule in the `PolicyEngine`.
- The "auto" mode is unreachable without a named rule (no global `auto`).

### C4 — ProvenanceRecord
- The four `.claude/skills/{docx,pdf,pptx,xlsx}/LICENSE.txt` files are
  marked `Anthropic-restricted` and refused at registration.
- The `.claude/skills/skill-creator/LICENSE.txt` is `Apache-2.0`; a
  registration that does not include a copy of the licence and the
  attribution notice is rejected.
- A nested `NOTICE` file (when present) propagates to the descriptor.

### C5 — Plugin lifecycle
- `materialize` does **not** set `enabled` (verified by a negative test).
- A second `materialize` for the same digest at the same path → `ALREADY_MATERIALIZED`.
- Renaming a manifest does **not** change its identity (digest-based).
- An `enable` for a non-approved component is `deny`.

### C6 — SandboxPort
- A `rawPath` whose nearest existing parent is a symlink outside the
  workspace root → `deny: symlinked-parent-escape`.
- A Windows path that would, when canonicalized, escape the workspace root
  (`\\?\C:\...`, `\\.\pipe\...`, `C:\..\..\Windows`) → `deny`.
- A TOCTOU-sensitive path (decision-time vs use-time divergence) → `deny: toctou`.
- A command that relies on a denylist-only policy → `deny: denylist-only`.
- `read` and `write` of a non-existing target are distinguished (no silent create).
- `existing-path` and `new-target` checks have separate tests.

### C7 — RemoteTransportPort
- A WebSocket that connects without an `Authorization` header / signed token
  / paired-identity is **not** authenticated; the first non-handshake
  inbound frame is dropped.
- A transport registered with `mode: "open"` is refused at construction.
- A pairing request whose initiator is not authenticated out-of-band is
  refused.
- A pairing code is never delivered on the unauthenticated inbound transport; it is one-shot and expires in ≤ 5 minutes.
- A replayed remote command (same sequence number / nonce) is denied.
- A revoked identity is denied on the next command.
- A remote command is translated into a `CapabilityRequest` and routed
  through the `PolicyEngine`; it cannot bypass the engine.

### C8 — AuditRuntime
- Every `allow` / `deny` / `approval_required` / `remote.receive` / `sandbox.*`
  / `plugin.*` event produces an `AuditEvent`.
- A secret value is never persisted (verified by a corpus test that scans
  audit dumps for known-shaped strings).
- A `kill_switch.engage` event is emitted before the corresponding shutdown.

### C9 — SecretStore / TaintTracker / Quotas / KillSwitches
- A `secret.read` value is delivered to a named, scoped sandbox execution
  only; it is not returned to the agent loop.
- Taint propagates: a `secret.read` followed by a `network.connect` is
  vetoed, even if a rule allows `network.connect` on its own.
- Quota exceeded → `deny` and audit event.
- `kill_switch.engage("all-remote")` terminates all open
  `RemoteTransportPort` connections.
- `kill_switch.engage("all-plugin-enable")` rolls back every enabled
  component.

---

## 14. Gate

`CONTRACTS_ACCEPTED`: the independent Claude review passed on 2026-08-03 and the documentary corrections are closed. Runtime adapter work may proceed only against these contracts and the threat model; upstream source import, `/ee` materialization, open transport mode, and global auto approval remain forbidden.
