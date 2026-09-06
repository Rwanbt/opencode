<!-- SPDX-License-Identifier: MIT -->
<!-- Copyright (c) 2026 Unifia contributors -->

# ADR-005 — Artifact Contract / Storage Authority

> **Statut** : DECIDED
> **Date** : 2026-09-01
> **Source** : plan V2.3.1 §67-71, THREAT_MODEL §1.5 (TM-AR-01..03),
> ADR-001, ADR-004, ADR-010, ADR-020.

## Status

DECIDED. Dépend d'ADR-001 (canonicalisation), ADR-004 (history), ADR-010
(key/secret), ADR-020 (ownership).

## Context

Plan V2.3.1 §67-71 fixe le contrat d'artefact :

```text
ArtifactRef    { artifactId, contentDigest }   // handle non autoritaire
ArtifactRecord { artifactId, OwnershipScope, DeploymentScope?, contentDigest,
                 mediaType, size, storageClass, taints, classification,
                 origin, retentionPolicy, protectionEnvelope?,
                 createdAt }
```

Règles strictes (plan §71) :
- Le caller ne peut **pas** décider de `classification`, `taint`,
  `ownership`, `environment`.
- Ces données viennent du store / policy / taint authority.

`ArtifactRef` est un handle (non autoritaire), `ArtifactRecord` est
autoritaire (store-side).

## Problem

Quel contrat pour l'`ArtifactStore` :

1. le store est l'autorité sur `ArtifactRecord` ;
2. le caller ne peut pas fixer les champs sécurité (`classification`,
   `taint`, `ownership`, `environment`) ;
3. le `contentDigest` est calculé par le store, pas par le caller ;
4. le `protectionEnvelope` est construit par le store, pas par le
   caller ;
5. les gros outputs ne vont pas dans `WorkflowRun` history — ils sont
   remplacés par `ArtifactRef` (plan §70, `LARGE PAYLOAD RULE`) ;
6. le scope (`OwnershipScope` + `DeploymentScope?`) est obligatoire
   pour les artefacts générés par runtime, optionnel pour les artefacts
   de définition (plan §69) ;
7. l'`ArtifactStore` ne devient pas une autorité durable d'exécution
   (plan §2) ;
8. le taint se propage (THREAT_MODEL §3, plan §121-122) ;
9. un `ArtifactRef` ne peut pas forger un `ArtifactRecord` (TM-AR-02).

## Requirements

| ID | Requirement | Source |
|---|---|---|
| REQ-1 | Store autoritaire sur `ArtifactRecord` | plan §68 |
| REQ-2 | Caller ne fixe pas `classification`/`taint`/`ownership`/`environment` | plan §71, TM-AR-01 |
| REQ-3 | `contentDigest` calculé par store | TM-AR-02 |
| REQ-4 | `protectionEnvelope` construit par store | TM-AR-02 |
| REQ-5 | `LARGE PAYLOAD RULE` (ArtifactRef) | plan §70, TM-AR-03 |
| REQ-6 | `OwnershipScope` obligatoire pour runtime-generated artefacts | plan §69 |
| REQ-7 | Pas autorité durable d'exécution | plan §2 |
| REQ-8 | Taint propagé | plan §121-122, THREAT_MODEL §3 |
| REQ-9 | Multi-tenant (scope enforced) | ADR-020, TM-T-01 |
| REQ-10 | Domaine de chiffrement par classe d'artefact | plan §76 |

## Constraints

| ID | Constraint |
|---|---|
| C-1 | `ArtifactRef` est en `@unifia/contracts/src/artifact.ts` (étendu) |
| C-2 | Le store est dans `packages/artifact-runtime/` (étendu) |
| C-3 | L'envelope at-rest (plan §74) — voir ADR-010 |
| C-4 | Pas de dépendance à un cloud KMS obligatoire (local-first) |
| C-5 | `artifact-studio` (UI) ne peut pas fixer `classification` |

## Options

### Option A — ArtifactStore avec scope, taint, classification enforced

**Description** : on étend `packages/artifact-runtime/` pour ajouter
`OwnershipScope` + `DeploymentScope?` + `taints` + `classification` au
record, et on refuse tout caller-control sur ces champs. L'UI
`artifact-studio` est testée pour ne pas les fixer.

**Preuves en faveur** :
- Couvre toutes les REQ.
- Type-safe.
- Multi-tenant.

**Preuves en défaveur** :
- Coût d'extension.

### Option B — ArtifactStore en mode "caller fixe tout"

**Description** : on garde l'API actuelle, sans enforcement.

**Preuves en défaveur** :
- Contredit REQ-2, REQ-3, REQ-4.
- Sécurité insuffisante.

### Option C — ArtifactStore via S3 / R2 / cloud storage

**Description** : on utilise un backend S3-compatible.

**Preuves en défaveur** :
- Contredit C-4 (local-first).
- REQ-7 (autorité) plus difficile à garantir (un S3 n'est pas
  l'autorité sur les metadata sécurité — le caller peut les modifier
  via des policies).

## Evidence

| Source | Contenu | Statut |
|---|---|---|
| plan V2.3.1 §67-71 | contrat ArtifactRef/Record | MEASURED |
| `AUTOMATE_TRUST_PATH.md` §C.1 | état actuel artifact-runtime | MEASURED |
| THREAT_MODEL §1.5 | TM-AR-01..03 | MEASURED |
| ADR-001 | canonicalisation | MEASURED |
| ADR-010 | key/secret | PROPOSED |
| ADR-020 | ownership | PROPOSED |

## Decision

### Decision

`ArtifactStore` avec enforcement strict de `scope` / `taint` /
`classification`. Le caller ne peut pas fixer `classification`, `taint`,
`ownership`, `environment`. `contentDigest` et `AtRestProtectionEnvelope`
sont construits par le store, jamais par le caller. Seuil `LARGE PAYLOAD`
à 64 KiB (au-delà, le runtime remplace la valeur par un `ArtifactRef`).

**Evidence** :

- `AUTOMATE_TRUST_PATH` §C.1 (état actuel d'`artifact-runtime`).
- `THREAT_MODEL` §1.5 (TM-AR-01..03).
- Plan V2.3.1 §67-71 (contrat).

**Migration strategy** :

- `packages/artifact-runtime/src/index.ts` étendu.
- `packages/contracts/src/artifact.ts` étendu avec `ArtifactRecord`,
  `ArtifactWriteRequest`, `Taint`, `Classification`, `ArtifactOrigin`,
  `RetentionPolicy`.
- `automate-surface.tsx` affiche `digest` et `size`.
- `workbench-server` passe le `scope` à chaque appel store.
- `artifact-studio` testée (C-5 — pas de contrôle caller sur
  `classification`).

**Option A**.

**Justification** :
- REQ-2 (no caller-control) est éliminatoire pour B.
- REQ-7 (autorité) est éliminatoire pour C en cloud.
- Le coût d'extension est compensé par les tests (TM-AR-01..03).

**Forme du contrat** :

```ts
type ArtifactRef = { artifactId: ArtifactId; contentDigest: DigestEnvelope<"artifact-bytes"> };

type ArtifactRecord = {
  artifactId: ArtifactId;
  ownershipScope: OwnershipScope;
  deploymentScope?: DeploymentScope;
  contentDigest: DigestEnvelope<"artifact-bytes">;
  mediaType: string;
  size: number;
  storageClass: "hot" | "cold" | "encrypted" | "redacted";
  taints: readonly Taint[];
  classification: Classification;       // "public" | "internal" | "confidential" | "restricted"
  origin: ArtifactOrigin;              // { kind: "workflow" | "user" | "connector" | "mcp", ref: string }
  retentionPolicy: RetentionPolicy;
  protectionEnvelope?: AtRestProtectionEnvelope;
  createdAt: number;
};

type ArtifactWriteRequest = {
  bytes: Buffer | ReadableStream<Uint8Array>;
  mediaType: string;
  // PAS de classification, taint, ownership, environment — store decide
};
```

**API du store** :

```ts
interface ArtifactStore {
  put(req: ArtifactWriteRequest, scope: OwnershipScope & { deploymentScope?: DeploymentScope }): Promise<ArtifactRef>;
  get(ref: ArtifactRef, scope: OwnershipScope): Promise<ReadableStream<Uint8Array>>;
  getRecord(artifactId: ArtifactId, scope: OwnershipScope): Promise<ArtifactRecord>;
  list(scope: OwnershipScope & { deploymentScope?: DeploymentScope }, filter?: ArtifactFilter): AsyncIterable<ArtifactRecord>;
  delete(artifactId: ArtifactId, scope: OwnershipScope): Promise<void>;
  // PAS de méthode setClassification / setTaint / setOwnership — store seul
}
```

**Gros outputs** (REQ-5) :

```ts
// Threshold configurable
const ARTIFACT_INLINE_THRESHOLD = 64 * 1024; // 64 KiB

// Si un step retourne > threshold, le runtime remplace par ArtifactRef
if (stepOutput.byteLength > ARTIFACT_INLINE_THRESHOLD) {
  const ref = await artifactStore.put({ bytes: stepOutput, mediaType: "application/octet-stream" }, runScope);
  return ref; // ArtifactRef, pas bytes
}
```

## Consequences

- `packages/artifact-runtime/src/index.ts` étendu.
- `packages/contracts/src/artifact.ts` étendu avec `ArtifactRecord`,
  `ArtifactWriteRequest`, `Taint`, `Classification`, `ArtifactOrigin`,
  `RetentionPolicy`.
- `automate-surface.tsx` doit afficher le `digest` et le `size` d'un
  artefact.
- `workbench-server/src/index.ts` doit passer le scope à chaque
  appel store.
- `artifact-studio` doit être testée (C-5).

## Trade-offs

| Trade-off | A | B | C |
|---|---|---|---|
| Sécurité | Haute | Basse | Moyenne |
| Local-first | Oui | Oui | Non (cloud) |
| Effort | Moyen | Faible | Moyen |
| Multi-tenant | Oui | Non | Difficile |

## Rejected alternatives

- **B (caller fixe tout)** : rejeté (sécurité).
- **C (S3)** : rejeté (local-first + autorité).
- **Stockage hors store** : rejeté (REQ-1).

## Security impact

- TM-AR-01 (downgrade classification) : REQ-2 l'interdit.
- TM-AR-02 (envelope forgé) : REQ-3, REQ-4 enforced par store.
- TM-AR-03 (gros output sature history) : REQ-5 enforced.
- TM-T-01 (cross-tenant) : REQ-9 + ADR-020.
- TM-DF-01..07 (data-flow taint) : REQ-8.

## Migration impact

- `ArtifactStore` actuel n'a pas les champs requis. Refactor.
- `automate-surface.tsx` doit s'adapter au nouveau contrat.
- Tests : TM-AR-01..03 + multi-tenant.

## Testing strategy

1. **M1 tests** (plan §196) : artifact contract tests.
2. **M3 tests** (plan §201) : cancel during wait, etc.
3. **Multi-tenant** (plan §226) : A cannot read B artifact.
4. **TM-AR-01..03** : tests ciblés (caller refuse, envelope forger,
   threshold).

## Rollback / exit strategy

- Le store est derrière une interface ; un autre store peut être branché.
- Si un test d'enforcement casse un consumer légitime, élargir
  localement.

## Liens

- `plan V2.3.1` §67-71
- `THREAT_MODEL.md` §1.5, §3
- ADR-001 (canonicalisation — `contentDigest`)
- ADR-004 (history authority — l'`ArtifactRef` est dans la history)
- ADR-010 (key/secret — `protectionEnvelope`)
- ADR-020 (ownership — `OwnershipScope`)
