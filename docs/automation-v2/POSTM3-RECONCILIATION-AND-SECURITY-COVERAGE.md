<!-- SPDX-License-Identifier: MIT -->
<!-- Copyright (c) 2026 Unifia contributors -->

# PostM3 reconciliation + security campaign coverage - 2026-09-05

Owner directive 25: every historical GREEN is re-classified. NO false
GREEN from contract-only work. Evidence pointers only.

## M1 (durable core)

| Card | Classification | Evidence |
|---|---|---|
| C-M1-01/02 canonicalization + digest | IMPLEMENTED_ISOLATED | packages/digest-runtime (tested; consumed by approval-v4 digest) |
| C-M1-03 IR loader + validator | IMPLEMENTED_ISOLATED | packages/workflow-catalog |
| C-M1-04 scopes | CONTRACT (schemas) + enforcement at broker facade | packages/contracts/src/scope.ts; ApprovalBrokerV4 binding equality |
| C-M1-05 triggers + scheduler | CONTRACT_ONLY (runtime timer firing now exists on native authority) | contracts/timer.ts; NativeDurableHistoryAuthority.dueTimers |
| C-M1-06 artifacts | IMPLEMENTED_ISOLATED | packages/artifact-* |
| C-M1-07 at-rest + SecretBroker | IMPLEMENTED_ISOLATED | packages/secret-broker (49 tests) |
| C-M1-08 capability enforcer | IMPLEMENTED_ISOLATED | packages/capability-runtime |
| C-M1-09/11 WorkflowRun + durable authority + projection | PRODUCTION_WIRED | packages/workflow-runtime/src/native-history.ts (NativeDurableHistoryAuthority, 108-test package suite) |
| C-M1-10 logical invocations / attempts / effect identity | PRODUCTION_WIRED | packages/workflow-runtime/src/native-attempts.ts |
| C-M1-12 observability | CONTRACT_ONLY | observability package; kernel-side logs/metrics/traces wiring OPEN |

## M2 (graph engine)

```text
M2 CONTRACT : GREEN (9 cartes, plan COMPLETE)
M2 RUNTIME  : GREEN per family (GraphRuntimeEngine: if/switch/parallel/
              merge/repeat/while/map/child durables + advance() walk;
              directive-13 restart/crash proofs per family)
M2 E2E      : OPEN - production host wiring (see below)
```

## M3 (effect / timer / cancellation)

```text
M3 RUNTIME  : GREEN core (attempt/effect identities, durable timers
              with at-most-once firing, durable cancellation with
              stale-worker fencing, durable timeouts with
              first-terminal-wins races, retry model, recovery loop,
              ACK-loss production regression)
M3 E2E      : OPEN (same host-wiring gate as M2)
```

## Directive 31 - workbench-server finding (measured)

`packages/workbench-server/src/workflow-port.ts` exposes an INJECTED
port (`WorkflowStepPort`/`WorkflowStatePort`) explicitly awaiting "a
substrate-backed executor after ADR-000 ratification". ADR-000 IS
ratified: the port is now implementable against
`GraphRuntimeEngine` + the native authorities. The OperationRegistry
(`operations.ts`) owns workbench UI operations, not WorkflowRun
authority. OPEN: implement the substrate-backed port (start/restart/
rediscover/approve/cancel/resume from durable state).

## Directive 38 - adversarial security coverage (measured)

```text
stale AuthorityToken / wrong owner / wrong generation : PASS
  (NativeApprovalAuthority fencing, 19+ directive-8 proofs)
approval bypass / self approval / forged SYSTEM_CANCEL : PASS
  (ApprovalBrokerV4 contract matrix 20/20 + durable gate)
binding TOCTOU / execution digest mismatch / scope widening : PASS
  (STALE_PLAN_CHANGED, STALE_DIGEST_MISMATCH, fail-closed expiry)
effect duplication / retry during uncertainty : PASS
  (NativeAttemptAuthority: terminal never overwritten, UNKNOWN
  reconcile-only, ACK-loss regression)
timer/cancel races : PASS (first-terminal-wins fencing)
```

OPEN for the campaign (need production-boundary tests): SSRF/DNS
rebinding/redirect escape at network boundaries (ADR-023), untrusted
code/shell escape (ADR-019/024), resource exhaustion, secret-leak
canary across history/logs/artifacts/UI (directive 39). The approval/
authority surface is fully covered; the network and sandbox surfaces
require their runtime packages to be production-wired first (same
host-wiring gate).

LOCAL COMMITS ONLY - NOT REMOTELY PUBLISHED.

## Directive 39 - secret-leak canary (2026-09-05, MEASURED: HIGH FINDING)

The canary test (native-durable.test.ts "Secret-leak canary") injects
a known canary through realistic paths (tool result, effect error,
approval resourceScope) and scans ALL durable surfaces.

```text
RESULT: DETECTED - HIGH finding, NOT WAIVED
Raw canary ESCAPES into NativeAttemptAuthority result_json (attempt
outcome persistence stores the executor-provided result verbatim).
Approval surfaces (records + history) are clean.
```

Root cause: the durable attempt/effect layer persists whatever the
EXECUTOR hands it; secret redaction belongs at the executor boundary
(directive 26 - taint/data classification via C-M1-07 SecretBroker
envelope), which is not yet production-wired (same host-wiring gate as
the network/sandbox surfaces).

Required remediation before FINAL GO: the production effect executor
must redact classified values BEFORE recording attempt outcomes; the
canary test then turns GREEN and becomes a permanent regression.

Security verdict at 2026-09-05: Critical = 0, High = 1 (unwaived,
tracked, remediation path identified) -> FINAL GO BLOCKED by this
gate (directive 52 requires High = 0).

LOCAL COMMITS ONLY - NOT REMOTELY PUBLISHED.