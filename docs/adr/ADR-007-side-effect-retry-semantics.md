<!-- SPDX-License-Identifier: MIT -->
<!-- Copyright (c) 2026 Unifia contributors -->

# ADR-007 — Side-Effect / Retry Semantics

> **Statut** : DECIDED
> **Date** : 2026-09-01
> **Source** : plan V2.3.1 §84-93, ADR-002, ADR-004.

## Status

DECIDED. Dépend d'ADR-000 (substrate), ADR-002 (WorkflowIR), ADR-004
(history authority). Couvre la base M3.

## Context

Plan V2.3.1 §84 définit 5 classes d'effets :

```text
pure
idempotent
repeatable
reconcilable
non-repeatable
```

§85 interdit la promesse **exactly-once** générique. La promesse réelle :

```text
durable at-least-once
+ idempotency
+ reconciliation
```

§86 : chaque effet logique a un `effectSlot` stable.

§87 : `idempotency identity` = `hash(workflowVersionId, runId,
logicalInvocationId, effectSlot)`.

§88 : `UNKNOWN_EXTERNAL_STATE` quand le provider a peut-être réussi
mais le local ne peut pas vérifier. **Pas de blind retry**.

§89 : fencing protège le local durable commit, pas l'external side
effect.

§90 : retry policy — `maxAttempts, initialDelay, maxDelay, multiplier,
jitter, Retry-After, retryable classifications`.

§91 : pas de retry par défaut sur :
- validation
- Policy denial
- Capability denial
- 401
- 403
- business rejection
- non-repeatable effect

§92 : retry = `same logicalInvocationId + same logical effect identity +
new attemptId`.

§93 : DLQ retry = par défaut `resume/retry same WorkflowRun` si sûr.
Nouvelle exécution = `RE-RUN AS NEW WORKFLOW RUN`, action différente
avec nouveau runId.

## Decision

### Decision

5 classes d'effet : `pure`, `idempotent`, `repeatable`, `reconcilable`,
`non-repeatable`. `IdempotencyKey = hash(workflowVersionId, runId,
logicalInvocationId, effectSlot)`. Pas de promesse exactly-once — la
promesse est « durable at-least-once + idempotency + reconciliation ».
`UNKNOWN_EXTERNAL_STATE` est un état explicite, pas de blind retry. Pas
de retry sur validation / policy / capability denial / 4xx / effets
non-repeatable.

**Evidence** :

- Spike M0-01.
- Plan V2.3.1 §84-93.

**Migration strategy** :

- Chaque `node family` (ADR-002) déclare son `EffectManifest`.
- Le `Workflow Kernel` calcule l'`IdempotencyKey` à chaque effet.
- Les executors (HTTP, MCP, etc.) implémentent la sémantique retry.
- M3 crash matrix tests (plan §201).

### Classes d'effet (plan §84)

```ts
type EffectClass = "pure" | "idempotent" | "repeatable" | "reconcilable" | "non-repeatable";

interface EffectManifest {
  effectClass: EffectClass;
  effectSlot: string; // stable, hash input
  retryableClassifications: readonly string[]; // e.g. "5xx", "Timeout"
  reconciliationEndpoint?: string; // for "reconcilable"
  isIdempotent: boolean; // computed from effectClass
}
```

### Identité d'idempotence (plan §87)

```ts
type IdempotencyKey = {
  workflowVersionId: string;
  runId: string;
  logicalInvocationId: string;
  effectSlot: string;
};
// hash = DigestEnvelope<"effect-idempotency">(canonicalize(IdempotencyKey))
```

### Retry policy (plan §90)

```ts
interface RetryPolicy {
  maxAttempts: number;
  initialDelay: Duration; // ms
  maxDelay: Duration; // ms
  multiplier: number; // exponential backoff
  jitter: "none" | "full" | "equal" | "decorrelated";
  respectRetryAfter: boolean; // honor Retry-After header
  retryableClassifications: readonly ErrorClassification[];
}
```

### Erreurs non retryable (plan §91)

- validation errors (input/output schema mismatch)
- Policy denial (forbidden by ADR-009)
- Capability denial (no grant)
- 401 (auth failed)
- 403 (auth succeeded but forbidden)
- business rejection (4xx with explicit business code)
- non-repeatable effect (e.g. wire transfer without idempotency key)

### UNKNOWN_EXTERNAL_STATE (plan §88)

```ts
// Quand le provider a peut-être réussi mais le local ne peut pas vérifier:
// - 5xx avec retry possible -> retry avec backoff
// - network error sans body -> UNKNOWN_EXTERNAL_STATE -> pas de blind retry
// - le run attend une intervention manuelle (re-run ou DLQ resume)
```

### Fencing (plan §89)

```ts
// Worker commit (ADR-004 history) est protégé par lease token (ADR-008).
// External side effect n'est PAS protégé par fencing : si le provider
// a déjà accepté l'effet, retry = duplicate. C'est l'idempotency
// identity qui gère.
```

### DLQ retry (plan §93)

```ts
// DLQ entry contient: reason, run, invocation, attempt, error classification,
// last safe state, recommended operations.
// "Retry" dans DLQ UI = par défaut resume/retry same WorkflowRun.
// "Re-run" = action explicite avec nouveau runId et avertissement.
```

## Consequences

- Chaque `node family` (ADR-002) déclare son `EffectManifest`.
- Le `Workflow Kernel` (substrate) calcule l'`IdempotencyKey` à chaque
  effet.
- Les executors (HTTP, MCP, etc.) implémentent la sémantique retry.
- M3 tests obligatoires (plan §201) : crash matrix.

## Security impact

- TM-W-04 (boucle infinie) : retry borné par maxAttempts.
- TM-S-01..03 (secret) : idempotency key n'est pas un secret.
- TM-AG-06 (cost unbounded) : retry cost borné par maxCost.

## Liens

- plan V2.3.1 §84-93
- THREAT_MODEL §1.1, §1.6
- ADR-000, ADR-002, ADR-004, ADR-008
