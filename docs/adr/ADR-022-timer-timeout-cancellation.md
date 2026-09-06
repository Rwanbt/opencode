<!-- SPDX-License-Identifier: MIT -->
<!-- Copyright (c) 2026 Unifia contributors -->

# ADR-022 — Timer / Timeout / Cancellation

> **Statut** : DECIDED
> **Date** : 2026-09-01
> **Source** : plan V2.3.1 §94-99, THREAT_MODEL §1.1 (TM-W-04).

## Status

DECIDED. Dépend d'ADR-000 (substrate), ADR-004 (history authority).

## Context

Plan V2.3.1 §94 définit ADR-022 :

```text
durable waits
durable timers
timeouts
cancellation
shutdown
```

§95 liste les types de timeout :

```text
workflow timeout
logical node timeout
attempt timeout
remote request timeout
heartbeat timeout
lease timeout
```

§96 : cancellation = `RUNNING → CANCEL_REQUESTED → no new dispatch`.

§97 : selon l'executor — `cooperative abort` / `remote cancellation` /
`non-cancelable effect continues`.

§98 : états terminaux `CANCELED`, `CANCELED_WITH_ACTIVE_EFFECT`,
`CANCELED_WITH_UNKNOWN_EXTERNAL_STATE`.

§99 : tests obligatoires `cancel during wait`, `retry delay`, `HTTP
request`, `parallel branch`, `child workflow`, `approval`,
`UNKNOWN_EXTERNAL_STATE`.

## Decision

### Durable wait

```text
durable wait:
  - persistant côté substrate (ADR-000)
  - réarmé à chaque checkpoint
  - timer authority = control plane, jamais worker clock (plan §102)
  - drift maximum: 1s (clock-jump handling, plan §103)
```

### Durable timer

```text
durable timer:
  - cron: timezone IANA, DST handling, catch-up, max catch-up,
    overlap policy (ALLOW/FORBIDB/QUEUE/REPLACE - plan §101)
  - heartbeat: lease authority (ADR-008) sur worker
```

### Timeout

```text
timeout per type (plan §95):
  - workflow: 7j par défaut, configurable par WorkflowVersion
  - logical node: 1h par défaut
  - attempt: 5min par défaut
  - remote request: 30s par défaut
  - heartbeat: 30s par défaut
  - lease: 60s par défaut
```

### Cancellation

```text
states (plan §96, §98):
  RUNNING -> CANCEL_REQUESTED -> no new dispatch
  -> CANCELED | CANCELED_WITH_ACTIVE_EFFECT | CANCELED_WITH_UNKNOWN_EXTERNAL_STATE

behavior per executor (plan §97):
  HTTP: cooperative abort + cancel propagation si possible
  MCP: cooperative abort
  Shell: process-tree kill (plan §136)
  Browser: cooperative + close page
  Computer Use: cooperative + kill switch
  Approval: cancel propagation
  Wait: immediate cancel
  Parallel: cancel all branches
```

### Shutdown

```text
shutdown sequence (graceful, plan §191):
  1. no new triggers accepted
  2. no new dispatches
  3. in-flight effects given grace period (configurable, 30s)
  4. active effects: cooperative abort + record outcome
  5. durable state committed
  6. workers stopped
  7. timers re-armed by next start

Hard shutdown: durable state MUST be committed before process exit.
KEY_UNAVAILABLE behavior: plan §79 + ADR-010.
```

## Consequences

- Le `Workflow Kernel` (substrate) expose une API timer/timeout/cancel.
- Les `node families` ADR-002 doivent déclarer leurs timeouts dans l'IR.
- ADR-008 (Scheduler/Worker/Time Authority) gère le lease.
- Tests M3 (plan §201) obligatoires avant GA.

## Security impact

- TM-W-04 (boucle infinie) : addressé par maxDuration, maxCost
  (ADR-002 REQ-2) + timeout workflow.
- TM-N-04 (prompt injection during cancellation) : covered par
  Computer Use corpus (plan §227).

## Liens

- plan V2.3.1 §94-103
- THREAT_MODEL §1.1
- ADR-000, ADR-002, ADR-004, ADR-008
