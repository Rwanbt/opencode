<!-- SPDX-License-Identifier: MIT -->
<!-- Copyright (c) 2026 Unifia contributors -->

# ADR-020 — Ownership / Deployment Scope

> **Statut** : DECIDED
> **Date** : 2026-09-01
> **Source** : plan V2.3.1 §44-48, THREAT_MODEL §1.10 (TM-T-01, TM-T-02),
> EXECUTION_PROFILE_REQUIREMENTS.md.

## Status

DECIDED. Dépend d'ADR-000 (substrate). Bloque l'isolation multi-tenant.

## Context

Unifia Automate sert plusieurs **organisations**, plusieurs **projets** par
organisation, plusieurs **espaces de travail** par projet, plusieurs
**environnements** par espace (dev/staging/prod), et plusieurs
**déploiements** par environnement.

Le plan V2.3.1 §44-48 fixe deux types d'entités :

```text
OwnershipScope   { organizationId, projectId?, workspaceId }
DeploymentScope  { ownershipScope, environmentId }
```

Et précise que :

- `WorkflowDefinition` et `WorkflowVersion` appartiennent à
  `OwnershipScope` (plan §46) ;
- `WorkflowDeployment`, `WorkflowRun`, `CredentialBinding`, `PolicyBinding`,
  et les artefacts runtime-generated appartiennent à `DeploymentScope` (plan §47) ;
- Une même `WorkflowVersion` immuable peut avoir plusieurs déploiements
  (dev/staging/prod) sans changer d'identité (plan §48).

## Problem

Comment garantir qu'un `WorkflowRun` :

1. ne lit pas les credentials d'un autre `OwnershipScope` ;
2. n'écrit pas dans un artefact d'un autre `DeploymentScope` ;
3. n'expose pas ses metrics à un autre `OwnershipScope` ;
4. ne peut pas être lancé depuis un workspace qui n'a pas `workflow.run`
   dans son grant ;
5. ne peut pas être ré-exécuté dans un environnement où sa `WorkflowVersion`
   n'est pas déployée ;
6. propage un `AuditContext` qui identifie l'`OwnershipScope` et le
   `DeploymentScope` à chaque événement d'audit ;
7. respecte la règle de single authority par run (plan §1) même quand
   plusieurs deployments partagent la même `WorkflowVersion` immuable.

## Requirements

| ID | Requirement | Source |
|---|---|---|
| REQ-1 | `OwnershipScope` et `DeploymentScope` sont immuables pour un run donné | plan §43, §48 |
| REQ-2 | WorkflowRun.identity contient `ownershipScopeId` et `deploymentScopeId` | plan §43 |
| REQ-3 | Capability Authority vérifie `OwnershipScope` et `DeploymentScope` | TM-T-01, TM-T-02 |
| REQ-4 | Secret Broker résout un `CredentialRef` dans le scope du run | plan §124, TM-S-01..03 |
| REQ-5 | Artifact Store refuse un caller qui tente de fixer `ownership` ou `environment` | plan §71, TM-AR-01 |
| REQ-6 | AuditContext propage `actor`, `principal`, `ownershipScope`, `deploymentScope` | plan §181, A4/D11 |
| REQ-7 | Promotion (dev→staging→prod) ne mute pas la `WorkflowVersion` | plan §48 |
| REQ-8 | Drift detection (plan §174) — `desiredDigest != deployedDigest` → `DRIFT_DETECTED` | plan §174 |
| REQ-9 | Multi-tenant structural tests (plan §226) | THREAT_MODEL §1.10 |

## Constraints

| ID | Constraint |
|---|---|
| C-1 | `OwnershipScope` et `DeploymentScope` sont des types dans
       `packages/contracts/src/`, pas des strings ad hoc |
| C-2 | Aucun run GA avant que C-PRE1-05 (workbench-orchestrator isolation)
       soit vert |
| C-3 | `enterprise` n'est pas l'autorité durable d'un run (plan §2) |
| C-4 | L'isolation est testée par des tests structurels, pas seulement
       par des tests d'intégration |

## Options

### Option A — OwnershipScope/DeploymentScope dans contracts, enforced par tous les adapters

**Description** : `OwnershipScope` et `DeploymentScope` sont des types
stricts dans `@unifia/contracts`. Chaque adapter (Capability Authority,
Secret Broker, Artifact Store, Audit, Network Authority) reçoit le scope
courant et refuse toute opération hors scope. Les tests structurels
vérifient que le scope est propagé.

**Preuves en faveur** :
- Aligné avec le plan §44-48.
- Type-safe : `OwnershipScope = { organizationId: OrgId, workspaceId: WorkspaceId }`.
- Multi-tenant tests (plan §226) rendent l'isolation mesurable.

**Preuves en défaveur** :
- Demande un refactor large des adapters existants.
- Risque de régression si un consumer omet de propager le scope.

### Option B — OwnershipScope/DeploymentScope en option (legacy string)

**Description** : on garde les scopes comme strings optionnels pour
backward compat.

**Preuves en défaveur** :
- Aucun typage → drift, fuite cross-tenant silencieuse.
- Contredit REQ-2.

### Option C — Pas de scope, juste `workspaceId` partout

**Description** : on garde uniquement `workspaceId` (déjà partiellement
présent dans `WorkbenchOrchestrator`).

**Preuves en défaveur** :
- Insuffisant : un workspace appartient à un projet, qui appartient à
  une organisation. La règle de multi-tenant demande plus.

## Decision

**Option A**.

**Justification** :
- REQ-2 (types stricts) ne peut pas être garanti par B ou C.
- C-2 (C-PRE1-05 vert) est une condition de gate — sans test, l'ADR
  n'est pas rendu.
- L'enforcement est dans chaque adapter, pas dans un middleware global,
  parce que le scope est sémantique par opération.

## Consequences

- `packages/contracts/src/workspace.ts` (ou nouveau fichier) doit définir
  `OwnershipScope` et `DeploymentScope`.
- `workbench-server/src/auth.ts` (16 Ko) doit émettre le scope dans le
  `AuditContext` (cf. D11).
- `WorkbenchOrchestrator` doit tester qu'un workspace A ne peut pas
  accéder au scope de B.
- C-PRE1-05 (test isolation scope) doit être vert avant la première
  carte M1 qui consomme un scope.

## Trade-offs

| Trade-off | A | B | C |
|---|---|---|---|
| Type safety | Haute | Basse | Basse |
| Migration effort | Élevée | Faible | Faible |
| Multi-tenant safety | Haute | Basse | Moyenne |
| Régression risk | Moyen | Bas | Bas |

## Rejected alternatives

- **B (optionnel)** : rejete pour REQ-2.
- **C (workspaceId seul)** : rejete pour REQ-1 (OwnershipScope > workspaceId).
- **Pas d'ADR** : rejete — sans ADR, le scope reste implicite, source de bugs.

## Security impact

- TM-T-01 (A lit B workflow) : adresse par REQ-3 + C-PRE1-05.
- TM-T-02 (A utilise credential de B) : adresse par REQ-4.
- Plan §226 (multi-tenant structural tests) : adresse par REQ-9.

## Migration impact

- `WorkbenchOrchestrator` actuel refait un filtrage post-`listSessions`
  (ligne 67 du code), ce qui est un début d'enforcement. C-PRE1-05
  formalise ce test.
- `auth.ts` doit être étendu pour émettre le scope (mais pas le stocker
  en clair dans le token si c'est cross-tenant).

## Testing strategy

1. **C-PRE1-05** : test isolation scope sur workbench-orchestrator.
2. **Plan §226** : 7 tests structurels (A cannot read/use/approve B's
   workflow/credential/artifact/log/metric/monopolize).
3. **M1** : chaque adapter a un test « hors-scope refused ».

## Rollback / exit strategy

- Si un test d'isolation échoue, retour à cette ADR avec un nouveau
  type de scope.
- Si l'enforcement casse un consumer légitime, élargir le scope
  localement (avec justification) plutôt que désactiver l'enforcement.

## Liens

- `plan V2.3.1` §44-48, §174, §181, §226
- `THREAT_MODEL.md` §1.10
- `EXECUTION_PROFILE_REQUIREMENTS.md`
- ADR-000 (substrate — qui porte l'identité du run)
- ADR-005 (artifact contract — refuse caller-control sur ownership)
- ADR-010 (key/secret — résout un CredentialRef dans le scope)
- C-PRE1-05 (workbench-orchestrator isolation test)
