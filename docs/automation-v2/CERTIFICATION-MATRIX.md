<!-- SPDX-License-Identifier: MIT -->
<!-- Copyright (c) 2026 Unifia contributors -->

# Certification matrix - Capability x Execution x Platform (directive 43)

Target profile: **Local GA** (frozen). Reduced surface, every advertised
capability fully certified. Evidence-based, no contract-only certification.

## Platform Profiles

| Platform profile | Bridge | Automate contract | Current evidence | Status |
|---|---|---|---|---|
| `WEB_BROWSER_WITHOUT_BRIDGE` | Absent | Hidden/fail-closed; Workbench operations unavailable | `mode-navigation.spec.ts` | **SUPPORTED restriction** |
| `E2E_BROWSER_WITH_MOCK_BRIDGE` | Injected mock + explicit grants | Reachable when `workflow.run` is granted; cold deep links bootstrap the bridge | `15/15` mode suite; long reload gate open | **PARTIAL** |
| `DESKTOP_WITH_NATIVE_BRIDGE` | Native Tauri bridge | Intended supported profile | TypeScript adapter/build pass; native Rust build blocked by host OOM/pagefile | **BLOCKED_ENVIRONMENT** |

These profiles are not interchangeable: a successful Workbench HTTP transport
test does not prove that the web runtime owns a platform bridge.

| Capability (Local GA) | Contract | Runtime | E2E | Verdict |
|---|---|---|---|---|
| Durable WorkflowRun authority | PASS (contracts) | PASS (NativeDurableHistoryAuthority) | PASS (e2e-full-journey) | **SUPPORTED** |
| Approval lifecycle (D-02 V4) | PASS (22 matrix) | PASS (NativeApprovalAuthority + fencing) | PASS (directive-8 proofs + E2E) | **SUPPORTED** |
| Graph control (8 families) | PASS (M2) | PASS (GraphRuntimeEngine) | PASS (per-family + journey) | **SUPPORTED** |
| Durable wait/timers | PASS (timer.ts) | PASS (dueTimers/markTimerFired) | PASS (E2E timer) | **SUPPORTED** |
| Effects + retry + uncertainty | PASS | PASS (NativeAttemptAuthority) | PASS (E2E ACK-loss/retry) | **SUPPORTED** |
| Cancellation | PASS | PASS (requestCancel + fencing) | PASS (E2E cancel) | **SUPPORTED** |
| Retention/archival | PASS (ADR-016) | PASS (applyHistoryRetention) | PASS (retention.test) | **SUPPORTED** |
| Version compatibility | PASS (ADR-018) | PASS (schema gate fail-closed) | PASS (skew test) | **SUPPORTED** |
| Immutable publication/diagnosis | PASS | PASS (promoteToVersion pin + journal) | PASS (HTTP pin + events) | **SUPPORTED** |
| Expression evaluation (CEL) | PASS (ADR-003) | PASS (expression-runtime) | PASS (8 tests + graph use) | **SUPPORTED** |
| Secret protection at durable boundary | PASS | PASS (DefaultSecretRedactor) | PASS (canary regression) | **SUPPORTED** |
| AI authoring | CONTRACT_ONLY (ai-compiler contract) | NOT_WIRED (compiler runtime integration) | PARTIAL (same-pipeline proof) | **NOT_CERTIFIED - OPEN** |
| Browser/computer-use | CONTRACT_ONLY | ISOLATED (browser-runtime pkg) | NOT_RUN (browser harness required) | **NOT_CERTIFIED - OPEN** |
| Network/SSRF guard (ADR-023) | CONTRACT_ONLY | ISOLATED | NOT_RUN | **NOT_CERTIFIED - OPEN** |
| Code/Shell sandbox (ADR-019/024) | CONTRACT_ONLY | ISOLATED (sandbox-drivers) | NOT_RUN | **NOT_CERTIFIED - OPEN** |
| Connector/MCP | CONTRACT_ONLY | ISOLATED (mcp-transport) | NOT_RUN | **NOT_CERTIFIED - OPEN** |
| Distributed server / cluster | FUTURE_COMPATIBILITY_REQUIRED | - | - | **NOT_APPLICABLE (Local GA)** |
| Mobile control/local-execution | FUTURE_COMPATIBILITY_REQUIRED | - | - | **NOT_APPLICABLE (Local GA)** |
| Desktop host | CONTRACT_ONLY | ISOLATED (desktop-electron) | TypeScript adapter/build PASS; native executable blocked by host memory | **BLOCKED_ENVIRONMENT - OPEN** |
| UX/Design system | PASS (design contracts) | ISOLATED | Mode/design browser E2E PASS; full accessibility/profile coverage remains open | **PARTIAL - OPEN** |
| Enterprise (audit retention config) | PASS (enterprise.ts) | PARTIAL (retention on durable core) | PARTIAL | **PARTIAL - OPEN** |

Certified Local GA core: durable workflow product (authoring -> publication
-> durable execution -> approval/effects/wait/recovery -> diagnosis/repair)
= PRODUCTION READY as measured.

NOT_CERTIFIED rows require the browser/network harness and the AI-compiler
runtime wire - they are NOT advertised in the Local GA core profile and do
not block the core product verdict; they block the FULL-surface FINAL GO.

LOCAL COMMITS ONLY - NOT REMOTELY PUBLISHED.
