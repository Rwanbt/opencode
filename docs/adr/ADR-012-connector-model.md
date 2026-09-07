<!-- SPDX-License-Identifier: MIT -->
<!-- Copyright (c) 2026 Unifia contributors -->

# ADR-012 — Connector Model

> **Statut** : DECIDED
> **Date** : 2026-09-01
> **Source** : plan V2.3.1 §140, ADR-024, ADR-009, ADR-011.

## Status

DECIDED 2026-09-01. Dépend d'ADR-024, ADR-011 (MCP), ADR-009 (Policy).
Couvre le Connectors/MCP Track (post-M3). Implémentation connector
général différée à post-M3 ; pour la première certification, seul
l'executor HTTP est in-scope. Décision tranchée sur la base de
`AUTOMATE_TRUST_PATH §C.1`.

## Context

Plan V2.3.1 §140 fixe le `ConnectorManifest` :

```text
identity
version
digest
provenance
tools
auth methods
network requirements
minimum capabilities
effect semantics
idempotency
rate limit metadata
trust class
```

Et précise : « Manifest ≠ sandbox. »

## Decision

### ConnectorManifest

```ts
type ConnectorManifest = {
  identity: { id: string; name: string; vendor: string };
  version: string;
  digest: DigestEnvelope<"connector-manifest">;  // ADR-001
  provenance: { source: string; commit?: string; license: string };
  tools: readonly ToolManifest[];
  authMethods: readonly ("oauth2" | "api_key" | "basic" | "mtls" | "custom")[];
  networkRequirements: NetworkRequirements;
  minimumCapabilities: readonly P3Capability[];
  effectSemantics: EffectClass;  // ADR-007
  idempotency: IdempotencyStrategy;
  rateLimitMetadata?: RateLimitMetadata;
  trustClass: TrustClass;  // ADR-024
  signature: string;  // signed by Unifia (ADR-010)
};
```

### Sandbox ≠ manifest

Le `ConnectorManifest` déclare **ce que le connector peut faire**. Le
sandbox (worker isolé, ADR-024) **enforce** ce qu'il fait. Le manifeste
n'est pas un sandbox.

### Auth methods

- `oauth2` : `OAuthConnectionRef` (ADR-010).
- `api_key` : `SecretRef`.
- `basic` : `CredentialRef`.
- `mtls` : `CredentialRef` (cert + key).
- `custom` : `SecretRef` + contrat custom.

### Effect semantics

- `pure` : safe à retry.
- `idempotent` : retry safe avec idempotency key (ADR-007).
- `repeatable` : retry possible mais avec side effects.
- `reconcilable` : retry avec reconciliation endpoint.
- `non-repeatable` : retry interdit.

## Consequences

- `ConnectorManifest` type dans `contracts/connector.ts` (nouveau).
- `ConnectorRegistry` (nouveau) — registre signé des connectors.
- `@unifia/connector-runtime/` (nouveau) — runtime de connector.
- `Capability Authority` est consulté pour valider le minimum.

## Security impact

- TM-M-03 (manifest over-claim) : manifest signé + trust class.
- TM-SC-05 (connector hostile) : provenance + signature + sandbox.
- TM-T-02 (cross-tenant credential) : ADR-010 + ADR-020.

## Liens

- plan V2.3.1 §140
- THREAT_MODEL §1.7
- ADR-001, ADR-007, ADR-009, ADR-010, ADR-011, ADR-020, ADR-024
