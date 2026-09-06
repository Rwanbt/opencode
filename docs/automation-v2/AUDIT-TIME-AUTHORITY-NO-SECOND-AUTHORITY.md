<!-- SPDX-License-Identifier: MIT -->
<!-- Copyright (c) 2026 Unifia contributors -->

# Directive 18 + 44 audits - 2026-09-05

## Directive 18 - ADR-008 time authority (measured)

All four production native authorities inject the clock:

```text
NativeDurableHistoryAuthority : options.now?.() ?? Date.now
NativeAttemptAuthority        : options.now?.() ?? Date.now
NativeApprovalAuthority       : options.now?.() ?? Date.now
GraphRuntimeEngine            : options.now?.() ?? Date.now
```

Durable decisions in tests use injected deterministic clocks (the
`Date.now` fallback is the production default, never used as durable
test semantics). The legacy V2 broker and the M1 test
implementations (in-memory/file-backed) are NOT production
authorities (quarantined / test-only).

## Directive 44 - no second authority (mechanical scan)

```text
ApprovalStore            : packages/workflow-runtime/src/approval-v2.ts
                           -> LEGACY/TEST-ONLY, quarantined,
                           constructor-gated, NOT re-exported from the
                           package barrel - unreachable from production
DBOS_GO_SQLITE           : packages/automate-m0-contract/src/ids.ts only
                           (DurableAuthorityKind contract enum + M0
                           qualification harness, isolated) - NOT a
                           production selection
legacy workflow runtime  : quarantined V2 (same gate as above)
in-memory owner maps     : none in production paths
JSONL durable queue      : none
artifact state as authority: none
```

Verdict: production exposes exactly ONE durable WorkflowRun authority
(UNIFIA_NATIVE). PASS.

LOCAL COMMITS ONLY - NOT REMOTELY PUBLISHED.