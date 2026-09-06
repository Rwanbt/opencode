<!-- SPDX-License-Identifier: MIT -->
<!-- Copyright (c) 2026 Unifia contributors -->

# ADR-016 — History Retention / Archival

> **Statut** : DECIDED (IF kernel natif)
> **Date** : 2026-09-01
> **Source** : plan V2.3.1 §180-181 (observability), EXECUTION_PROFILE_REQUIREMENTS.md,
> THREAT_MODEL §1.10 (multi-tenant).

## Status

DECIDED (IF kernel natif). **Conditionnel** : SI ADR-000 sélectionne
kernel natif → rétention 365j history / 7 ans audit / cold archive
encrypted / chain hash tamper evidence / multi-tenant purge.
SI DBOS/Temporal → rétention substrate-natif.

## Context

Plan V2.3.1 §180 fixe les IDs core pour l'observabilité :

```text
traceId, correlationId, workflowVersionId, runId, logicalInvocationId,
attemptId, workerId, OwnershipScope, DeploymentScope
```

§181 exige que l'audit enterprise soit append-only ou logiquement
immutable, avec un record contenant : `actor, principal, OwnershipScope,
DeploymentScope, action, resource, workflowVersionId, runId, effectDigest,
Policy decision, authoritative timestamp, correlationId, result`.

Tamper evidence / export integrity si threat model requis.

Plan §1 §2 insistent sur la single authority par run. Le `WorkflowRun`
history est stockée par le substrate. La rétention (combien de temps
conserver, comment archiver) est une décision distincte.

## Decision (IF kernel natif)

**Pour ADR-000 Option A (kernel natif)** — la rétention est notre
responsabilité :

```text
@Retention par defaut
  - WorkflowRun history: 365 jours minimum
  - Audit log: 7 ans minimum (compliance)
  - Artefacts: configurable par classification
  - WorkflowVersion (published): immortel tant que le digest est
    verifie (digest reste valide apres migration d algorithme, plan §66)

@Archivage
  - Cold storage: filesystem compresse (gzip) chiffre (envelope ADR-010)
  - Migration: copie vers un autre support avant effacement du hot
  - Verification: la procedure backup -> restore -> decrypt (plan §80)
    est executee periodiquement

@Tamper evidence
  - Append-only ledger: chaque record porte un digest ADR-001
  - Chain hash: hash du record N inclut le hash du record N-1
  - Export integrity: chaque export porte un digest global,
    verifiable offline

@Multi-tenant
  - Chaque archive est scopee (OwnershipScope + DeploymentScope)
  - La suppression d un tenant purge ses archives (GDPR-like)
  - Retention legale peut bloquer la suppression d un sous-ensemble
```

## Decision (IF DBOS / Temporal)

Si ADR-000 choisit DBOS ou Temporal, leur mécanisme de rétention natif
s'applique. ADR-016 enregistre simplement la dépendance :

```text
@Substrate: ADR-000 Option B ou D
@Retention: geree par le substrate, conformite a verifier
@Archivage: hook on substrate pour archivage custom
@Tamper evidence: depend du substrate (DBOS a un journal append-only
  integre, Temporal aussi via le task queue history)
@Multi-tenant: scope par run, purge par le substrate
```

## Consequences (kernel natif)

- Un module `packages/retention-runtime/` (nouveau) gère :
  - TTL configurable par scope
  - Archivage cold
  - Backup → restore → decrypt (test E2E)
  - Tamper evidence chain
- ADR-005 (ArtifactRecord) est étendu avec `retentionPolicy` typé.
- L'audit ledger est séparé du substrate history (deux
  concerns : exécution et compliance).

## Trade-offs

| Trade-trade | Kernel natif | DBOS | Temporal |
|---|---|---|---|
| Coût de rétention | Moyen | Faible | Faible |
| Tamper evidence | À construire | Inclus | Inclus |
| Archivage | À construire | À wrapper | À wrapper |
| Conformité | Contrôle total | Dépendance | Dépendance |

## Liens

- plan V2.3.1 §180-181
- EXECUTION_PROFILE_REQUIREMENTS.md
- ADR-000, ADR-004, ADR-005, ADR-010, ADR-020
