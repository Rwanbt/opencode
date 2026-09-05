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

## Update 2026-09-06 (Automate platform contract and mode gates)

```text
CONTRACT:
  Automate is gated exclusively by workflow.run (ADR-1041).
  WEB_BROWSER_WITHOUT_BRIDGE remains unsupported/fail-closed.
  E2E_BROWSER_WITH_MOCK_BRIDGE is the supported browser certification profile.

IMPLEMENTATION:
  AutomateGrantBridge now primes ensureConnected() so a valid Automate
  deep link can discover grants before AutomateSurface mounts. No capability
  rule was bypassed and no web bridge was added to production.

E2E:
  mode/design/navigation + resource + latency suites: 15/15 PASS.
  mode-reload-stability reaches Automate after the fix, but the 10 x 100
  prompt long-run exceeded 20 minutes and remains OPEN; workload/assertions
  were not reduced.

HARNESS:
  mode-reload-stability now installs the canonical mock with workflow.run.
  Its queued response is attached to the first prompt of each cycle, avoiding
  an orphan response at teardown.

NATIVE:
  TypeScript adapter/typecheck/Vite build PASS.
  Rust/Tauri executable remains BLOCKED_ENVIRONMENT: LLVM OOM and Windows
  error 1455 (paging file too small).
```

LOCAL COMMITS ONLY - NOT REMOTELY PUBLISHED.

## Update 2026-09-05 (batch: HTTP layer + publication + diagnosis)

```text
CLOSED since the pre-check:
  E2E layer (core)     : GREEN - durable workflow HTTP surface through
                         the substrate-backed port (start 201 / inspect
                         200 / cancel 200, principal-gated, audited,
                         501 fail-closed; workbench 87/87)
  Directive 36         : GREEN - immutable pin at the canonical
                         publication path (versionId = JCS digest),
                         persisted with the run, survives restart
  Directive 37         : GREEN - read-only durable journal exposed at
                         GET /v1/workflows/:id (diagnosis surface);
                         repair = NEW version through the SAME start
                         pipeline (active run never mutated)

STILL OPEN (unchanged, exact actions):
  1. Directive 32-34 quality track: reproduce the 4 historical browser
     issues via the browser harness BEFORE fixing (repro-first rule)
  2. Directive 41/42: retention ADR-016 + rolling ADR-018 RUNTIME
     enforcement (contract surfaces exist: enterprise.ts audit
     retention, identity compatibility)
  3. Directive 43: platform certification matrix
  4. Directive 35: full product E2E journey (manual + AI authoring
     through the SAME HTTP pipeline - now available)
```

Suites at this update: workflow-runtime 112/112, workbench-server
87/87, expression 8/8, catalog 5/5, migration 6/6, durable 29/29.

LOCAL COMMITS ONLY - NOT REMOTELY PUBLISHED.

## Update 2026-09-05 (batch 2: E2E journey + retention + version skew)

```text
CLOSED:
  Directive 35 (core E2E journey) : GREEN - one E2E through the REAL
    HTTP pipeline + production durable kernel (20 assertions): manual
    authoring 201, immutable pin no-latest (V2 published after, run
    stays V1), restart/rediscovery, durable approval across restart
    with stale fencing, durable timer across restart (fire once),
    ACK-loss UNKNOWN + reconcile-only, retry (same LI, new AttemptId),
    durable cancellation across restart, read-only diagnosis journal.
    test: packages/workbench-server/test/e2e-full-journey.test.ts
  Directive 41 (retention)        : GREEN - applyHistoryRetention
    (ADR-016): terminal runs -> cold archive one transaction per run,
    ACTIVE runs NEVER archived + fully recoverable, provenance
    inspectable. test: retention.test.ts
  Directive 42 (version skew)     : GREEN - schema version gate with
    the ADR-018 window (min = N-1): unknown future version fails
    CLOSED at open. test: retention.test.ts
  Migration around restart        : PASS (v1-migrating 6/6 + version
    gate fail-closed)

STILL OPEN:
  1. Directives 32-34: quality track repro-first (browser harness
     required - interactive session)
  2. Directive 43: platform certification matrix
  3. Directive 35 (residual): AI-authoring proof through the same
     HTTP pipeline (the pipeline is family-agnostic - the compiler
     integration is the remaining wire)
```

Suites: workflow-runtime 115/115, workbench-server 88/88.
