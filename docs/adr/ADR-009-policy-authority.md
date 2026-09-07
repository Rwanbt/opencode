<!-- SPDX-License-Identifier: MIT -->
<!-- Copyright (c) 2026 Unifia contributors -->

# ADR-009 — Policy Authority

> **Statut** : DECIDED
> **Date** : 2026-09-01
> **Source** : plan V2.3.1 §117, THREAT_MODEL §1.10, ADR-020, ADR-023.

## Status

DECIDED 2026-09-01. Dépend d'ADR-020 (ownership) et ADR-023 (network).
Couvre le Security Core Track (§203 du plan). Décision tranchée sur la
base de `THREAT_MODEL.md` + `EXECUTION_PROFILE_REQUIREMENTS.md`.

## Context

Plan V2.3.1 §117 exige que la Policy supporte :

```text
local-only
region allowlist
EU-only
provider allowlist
provider denylist
model provider restriction
artifact residency
credential residency
network destination policy
data classification policy
```

Et précise : « Une policy ne peut pas promettre une garantie que le
deployment profile ne peut pas techniquement enforce. »

## Decision

### Policy scope

```ts
type Policy = {
  ownershipScope: OwnershipScope;        // ADR-020
  deploymentScope?: DeploymentScope;     // ADR-020
  residency: {
    localOnly?: boolean;                 // local-single-node
    regionAllowlist?: string[];          // server
    euOnly?: boolean;
    providerAllowlist?: string[];        // LLM, MCP, connector
    providerDenylist?: string[];
    modelProviderRestriction?: string[];
    artifactResidency?: "local" | "regional" | "global";
    credentialResidency?: "local" | "regional" | "global";
  };
  networkPolicy: NetworkPolicy;          // ADR-023
  dataClassificationPolicy: DataClassificationPolicy;
};
```

### Enforceability check

ADR-009-ENF: à la publication d'une `Policy`, le `WorkflowVersion`
associé doit être validé contre le profil d'exécution. Si le profil
ne peut pas enforce une partie de la policy (ex: `localOnly: true`
sur un profile `server-cluster`), la policy est rejetée.

```ts
function validatePolicyEnforceability(policy: Policy, profile: ExecutionProfile): ValidationResult {
  // Si profile = local-single-node et policy.residency.regionAllowlist
  // est défini -> OK (single-node, on s'engage à être dans la liste)
  // Si profile = server-cluster et policy.residency.localOnly = true
  // -> REJECTED (cluster est multi-régions par nature)
  // ...
}
```

### Decision points

La Policy est consultée à chaque transition d'un WorkflowRun :

1. **Compile time** (publication) : la policy est validée contre le
   profil d'exécution.
2. **Dispatch time** : la policy est re-validée contre le scope du run
   (OwnershipScope + DeploymentScope).
3. **Side effect time** : la policy vérifie que la destination
   réseau et le provider sont autorisés.
4. **Audit time** : la décision Policy est loggée (append-only).

### AI Trust Rule (plan §4)

L'IA ne peut pas être Policy authority. Le composant Policy est
**déterministe** : si le LLM propose une décision, la policy runtime
doit la valider contre les règles statiques.

## Consequences

- `@unifia/policy-runtime/` (nouveau) — package dédié.
- `@unifia/contracts/src/policy.ts` (nouveau) — types Policy,
  Residency, NetworkPolicy, DataClassificationPolicy.
- `WorkbenchAuthenticator` (auth.ts) charge la policy au boot.
- `Capability Authority` consulte la policy avant de grant.
- `Network Authority` (ADR-023) applique `networkPolicy`.

## Trade-offs

| Trade-off | Avantage | Inconvénient |
|---|---|---|
| Policy déterministe | Pas de drift | Plus rigide |
| Enforceability check | Évite les promesses intenables | Limite les profils mixtes |
| Multi-tenant par scope | Isolation | Cache à gérer |

## Security impact

- TM-T-01, TM-T-02 (multi-tenant) : addressés par scope sur policy.
- TM-N-01..05 (network) : addressés par networkPolicy.
- TM-AI-01 (LLM as authority) : addressé par AI Trust Rule.
- Plan §168 (`forbidden secret-to-model flow = 0`) : policy refuse.

## Liens

- plan V2.3.1 §117
- THREAT_MODEL §1.10, §1.6
- ADR-000, ADR-020 (ownership scope), ADR-023 (network)
- ADR-004 (history pour audit policy)
- ADR-005 (artifact contract — `dataClassificationPolicy`)
