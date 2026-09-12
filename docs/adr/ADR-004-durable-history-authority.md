<!-- SPDX-License-Identifier: MIT -->
<!-- Copyright (c) 2026 Unifia contributors -->

# ADR-004 — Durable History Authority

> **Statut** : DECIDED
> **Date** : 2026-09-01
> **Source** : plan V2.3.1 §41-43, §194 (M0 substrate proof), §196 (M1
> tests), THREAT_MODEL §1.1 (TM-W-01..05).

## Status

DECIDED. Dépend d'ADR-000 (substrate) et d'ADR-001 (canonicalisation).

## Context

Plan V2.3.1 §41 fixe les abstractions d'autorité durable :

```text
DurableHistoryAuthority
MaterializedRunProjection
AtomicTransitionBoundary
DurableCommandOutbox
DurableTimerAuthority
```

§42 illustre :
- Exemple Native : `DurableHistoryAuthority = Unifia history`.
- Exemple substrate externe : `DurableHistoryAuthority = substrate history`
  + `Unifia events = product/audit projection`.

§43 fixe l'identité d'un `WorkflowRun` :

```text
WorkflowRun {
    runId, deploymentId, workflowVersionId, deploymentScope,
    triggerId, triggerEventId,
    durableAuthorityId, durableAuthorityKind,  // immutable
    status
}
```

## Problem

Quelle architecture d'autorité pour l'historique d'un run :

1. garantit qu'**une seule** autorité durable persiste l'historique
   (plan §1, §2) ;
2. ne crée pas de double autorité (plan §2) entre `workflow-runtime`,
   `enterprise`, `workbench-orchestrator` ;
3. expose une `MaterializedRunProjection` pour l'UI (état courant) ;
4. garantit des transitions atomiques (`AtomicTransitionBoundary`) ;
5. garantit un outbox des commandes durables (`DurableCommandOutbox`)
   pour la communication avec les executors ;
6. garantit un timer authority (`DurableTimerAuthority`) pour les
   waits durables ;
7. survit à un crash de process/worker ;
8. est testable par la failure matrix du plan §38.

## Requirements

| ID | Requirement | Source |
|---|---|---|
| REQ-1 | Une seule autorité durable par run | plan §1, §2, §43 |
| REQ-2 | Authority immutable pendant le run | plan §43 |
| REQ-3 | `MaterializedRunProjection` exposée | plan §41 |
| REQ-4 | `AtomicTransitionBoundary` | plan §41 |
| REQ-5 | `DurableCommandOutbox` | plan §41 |
| REQ-6 | `DurableTimerAuthority` | plan §41 |
| REQ-7 | Crash recovery correctness | plan §38 |
| REQ-8 | No duplicate effect | plan §85, §87 |
| REQ-9 | No migration silencieuse entre authorities | plan §2 |

## Constraints

| ID | Constraint |
|---|---|
| C-1 | `enterprise` ne devient pas autorité durable (plan §2) |
| C-2 | `workbench-orchestrator` ne devient pas autorité durable |
| C-3 | Le store actuel (`FileWorkflowStore`) est trop limité — il faut
       un substrate-grade (cf. R-014) |
| C-4 | Tests de la failure matrix obligatoires avant M1 |

## Options

### Option A — History dans le kernel natif (Option A d'ADR-000)

**Description** : si ADR-000 choisit le kernel natif, l'historique est
dans le kernel. La projection est calculée par un worker qui lit
l'historique.

**Preuves en faveur** :
- Contrôle total.
- Pas de dépendance externe.

**Preuves en défaveur** :
- Tout l'effort d'implémentation est ici.

### Option B — History dans DBOS / Temporal (Option B/D d'ADR-000)

**Description** : le substrate porte l'historique. Unifia émet des events
qui sont une projection produit/audit.

**Preuves en faveur** :
- Substrate battle-tested.
- Moins d'effort.

**Preuves en défaveur** :
- Dépendance externe.

## Decision

### Decision

Kernel natif avec les 5 abstractions du plan §41 :
`DurableHistoryAuthority`, `MaterializedRunProjection`,
`AtomicTransitionBoundary`, `DurableCommandOutbox`,
`DurableTimerAuthority`. Une seule autorité par `WorkflowRun`, immuable
pendant le run. Pas de migration silencieuse entre authorities.

**Evidence** :

- Spike M0-01 (`docs/automation-v2/spikes/M0-01-EVIDENCE.md`) confirme
  que le runtime actuel n'est pas substrate-grade.
- Plan V2.3.1 §41 (les 5 abstractions).
- Plan §38 (failure matrix).

**Migration strategy** :

- `WorkflowRuntime` réécrit (actuellement 91 lignes).
- `FileWorkflowStore` (16 lignes) déprécié.
- Wire workbench expose les nouveaux champs (`durableAuthorityId`,
  `durableAuthorityKind`).
- Feature flag `legacy: true` pour fallback.
- Aucun WorkflowRun GA avant que M0-01 ne passe.

**Option PROPOSED : alignée sur ADR-000** — la décision est
conditionnée par le spike M0-01.

**Sous-règles** :
- Quelle que soit l'option substrate, l'`authority architecture` est :
  - `durableAuthorityId` = identifiant opaque du substrate.
  - `durableAuthorityKind` = enum `{ native, dbos, temporal, restate }`
    (Restate est éliminé par REQ-6 d'ADR-000).
  - `MaterializedRunProjection` = dérivée de l'historique, jamais
    éditable directement.
  - `AtomicTransitionBoundary` = transition de status + effect dans une
    même opération atomique.
  - `DurableCommandOutbox` = file de commandes vers les executors, avec
    garantie de livraison.
  - `DurableTimerAuthority` = timers côté contrôleur, jamais côté worker
    (plan §102).
- ADR-000 a déjà promis REQ-9 (no silent migration between authorities).
  Cet ADR confirme : un `WorkflowRun` ne migre JAMAIS entre deux
  authorities. Si le substrate change, on démarre un nouveau `WorkflowRun`.

## Consequences

- L'API publique de `workflow-runtime` change :
  - ajout de `durableAuthorityId, durableAuthorityKind` à `WorkflowRun`.
  - ajout de `getMaterializedProjection(runId): Promise<RunProjection>`.
  - ajout de `transition(runId, event): Promise<void>` (atomique).
  - ajout de `enqueueCommand(command): Promise<void>` (outbox).
  - ajout de `scheduleTimer(timerId, fireAt): Promise<void>`.
- `automate-surface.tsx` doit afficher `MaterializedRunProjection`.
- `WorkbenchOrchestrator` reçoit les events de l'authority.

## Trade-offs

| Trade-off | Native | DBOS | Temporal |
|---|---|---|---|
| Effort d'implémentation | Très élevé | Moyen | Moyen |
| Substrate battle-tested | Non | Oui | Oui |
| Authority uniqueness | Garantie | Garantie | Garantie |
| Crash recovery | À prouver | DBOS | Temporal |

## Rejected alternatives

- **Double authority (history + events séparés)** : rejeté — plan §2
  l'interdit, et le risque de drift est trop élevé.
- **enterprise comme authority** : rejeté — plan §2.

## Security impact

- TM-W-01 (switch `isEngaged`) : addressé par REQ-7 (crash recovery
  teste le switch).
- TM-W-02 (modification state file) : addressé par REQ-4 (transition
  atomique + digest).
- TM-W-05 (mutation post-publication) : addressé par REQ-1 + REQ-2
  (immutability).
- TM-T-01 (A lit B workflow) : addressé par REQ-9 (pas de migration
  silencieuse, donc le scope reste constant).

## Migration impact

- Le `WorkflowRuntime` actuel (91 lignes) est réécrit ou remplacé.
- `FileWorkflowStore` (16 lignes) est déprécié.
- Le wire workbench expose les nouveaux champs.

## Testing strategy

1. **M0-01 spike** : failure matrix du plan §38.
2. **M1 tests** (plan §196) : restart, reconstruction, authority
   uniqueness, scope isolation structural tests, historical schema read.
3. **M3 tests** (plan §201) : crash matrix.

## Rollback / exit strategy

- Le feature flag `legacy: true` permet de retomber sur l'ancien
  `WorkflowRuntime` en attendant la migration.
- Aucun WorkflowRun GA tant que M0-01 n'est pas passé.

## Liens

- `plan V2.3.1` §41-43, §194, §196
- `THREAT_MODEL.md` §1.1
- ADR-000 (substrate)
- ADR-001 (canonicalisation)
- ADR-002 (WorkflowIR)
- ADR-005 (artifact contract)
- ADR-020 (ownership)
