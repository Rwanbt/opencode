<!-- SPDX-License-Identifier: MIT -->
<!-- Copyright (c) 2026 Unifia contributors -->

# Final gates assessment (directive 52 pre-check) - 2026-09-05

Measured state of every FINAL GO gate. Honest: OPEN gates are named
with their exact next action. No generic DONE.

## Measured PASS

```text
ADR-000                         : DECIDED - UNIFIA_NATIVE (ratified,
                                  addendum 85; DBOS = qualified finalist,
                                  evidence preserved)
one WorkflowRun = one authority : PASS (directive 44 mechanical audit:
                                  exactly ONE durable authority; V2
                                  quarantined/unreachable; DBOS = enum
                                  + isolated harness)
D-02 V4 durable                 : PASS (14 directive-8 proofs on the
                                  real authority; matrix doc CLOSED)
M1 production                   : PASS (native history/approval/
                                  attempts authorities; restart-safe)
M2 production                   : RUNTIME GREEN per family (8 control
                                  families + advance walk + crash
                                  proofs); E2E layer OPEN (host wiring
                                  started: NativeWorkflowRuntimePort)
M3 production                   : PASS core (identities, durable
                                  timers at-most-once, durable
                                  cancellation with stale fencing,
                                  timeouts with first-terminal-wins,
                                  retry model, recovery loop, ACK-loss
                                  regression)
security                        : Critical 0 / High 0 (canary GREEN
                                  after redaction boundary; authority/
                                  approval/uncertainty/races surfaces
                                  adversarially covered)
immutable publication           : PASS (promoteToVersion: versionId =
                                  content digest, JCS-canonicalized;
                                  catalog tests 5/5; child dispatch
                                  pins version at dispatch, TOCTOU-proof)
migration                       : PASS core (v1-migrating 6/6:
                                  legacy history -> V2, restart across
                                  migration)
```

## Measured suites (2026-09-05)

```text
workflow-runtime  : 112/112
workbench-server  : 86/86 (x2 consecutive)
expression-runtime: 8/8
native-durable    : 29/29 (incl. permanent canary regression)
```

## OPEN gates (exact next actions)

```text
1. M2/M3 E2E layer        : drive the NativeWorkflowRuntimePort
                            through the REAL workbench-server routes
                            (start/resume/cancel over HTTP) - the port
                            exists and is tested at unit level; the
                            HTTP route proof is the next commit
2. Directive 32-34        : reproduce the 4 historical browser/E2E
  quality track             issues BEFORE fixing (classification
                            PRODUCT_BUG/TEST_BUG/HARNESS_BUG/
                            PLATFORM_EXPECTATION) - requires the
                            browser E2E harness
3. Directive 41/42        : retention ADR-016 + rolling compat ADR-018
                            - contract surfaces exist, runtime
                            enforcement OPEN
4. Directive 43           : platform certification matrix
                            (Capability x Execution x Platform) -
                            Local GA reduced surface to be enumerated
5. Directive 35           : full product E2E journey (manual + AI
                            authoring through the SAME pipeline)
```

FINAL GO: BLOCKED until the OPEN gates close. The substrate decision,
the durable kernel, the approval authority and the security baseline
are production-ready and locally committed (66+ commits, no push).

LOCAL COMMITS ONLY - NOT REMOTELY PUBLISHED.