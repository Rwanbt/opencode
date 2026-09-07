<!-- SPDX-License-Identifier: MIT -->
<!-- Copyright (c) 2026 Unifia contributors -->

# ADR-017 — Legacy Migration

> **Statut** : DECIDED
> **Date** : 2026-09-01
> **Source** : plan V2.3.1 §182-185, ADR-002, ADR-004.

## Status

DECIDED. Couvre la phase Migration (plan §222-223).

## Context

Plan V2.3.1 §182 : « Après cutover : V2 authority only. »

§183 : ancien runtime peut finir des workflows historiques si
nécessaire. Mais : `no new features / no permanent dual authority`.

§184 (active run) : options
- finish legacy
- cancel + restart V2
- explicit operator migration
- Pas de migration implicite.

§185 (migration CI) : `V1 fixture -> migration -> V2 validation ->
execution -> compare observable semantics`.

## Decision

### Cutover

- À un moment décidé (par ADR ou release), tous les **nouveaux**
  workflows passent par V2 (kernel natif / DBOS / Temporal).
- L'ancien runtime (`packages/workflow-runtime/` actuel) **peut**
  continuer à finir des workflows historiques en cours, mais ne reçoit
  plus de nouvelles features.

### Pas de double authority durable

- Un `WorkflowRun` n'a qu'une seule authority (plan §1, §2).
- Si un `WorkflowRun` est démarré en V1 et continue, il reste en V1
  jusqu'à completion. **Aucune migration implicite vers V2**.
- Si un operator décide de migrer, c'est une action explicite :
  `cancel + restart V2` (avec nouveau `runId` et avertissement).

### Migration CI (plan §185)

```text
CI job:
  1. V1 fixture: un workflow historique (capturé en V1) est rejoué
  2. Migration: le workflow est soumis au migrateur (mapping V1 IR -> V2 IR)
  3. V2 validation: parseSpec + capability analysis + digest ADR-001
  4. Execution: le workflow est exécuté en V2 (test, pas production)
  5. Compare observable semantics: outputs équivalents, side effects
     identiques (à tolérance d'idempotency près)
```

### Stratégies de migration par run actif (plan §184)

| Stratégie | Quand | Risque |
|---|---|---|
| `finish legacy` | Le run est presque fini | aucun (run termine en V1) |
| `cancel + restart V2` | Le run est bloqué / long | perte d'état partiel |
| `explicit operator migration` | Cas spécial | medium (operator-driven) |

L'UI propose ces options dans le DLQ (plan §180).

### Mapping V1 → V2

Le `WorkflowDefinition` actuel de `packages/workflow-runtime` est un
objet `{ id, version, workspaceId, steps: [{ id, capability, input,
requiresApproval }] }`. Le nouveau `WorkflowIR` (ADR-002) est plus
exprimant. Le mapping :

- `WorkflowDefinition` → `WorkflowDefinition` (conservé, propriétés de
  ownership ajoutées).
- `WorkflowVersion` → nouveau (avec `WorkflowIR` calculé).
- `step` → `node` (avec `node family` typé : manual / schedule / if / http /
  approval / wait).
- `input` → binding CEL (ADR-003).
- `requiresApproval: true` → `human.approval` node dans le DAG.

## Consequences

- Le migrateur est un outil TS (`@unifia/migration-tool/`, nouveau).
- `automation-surface.tsx` (UI) propose les actions DLQ.
- L'ancien `WorkflowRuntime` reste compilable avec un feature flag
  `legacy: true`.

## Liens

- plan V2.3.1 §182-185, §222-223
- ADR-000, ADR-002, ADR-003, ADR-004
- `THREAT_MODEL.md §1.1` (single authority)
