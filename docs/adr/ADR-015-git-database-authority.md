<!-- SPDX-License-Identifier: MIT -->
<!-- Copyright (c) 2026 Unifia contributors -->

# ADR-015 — Git / Database Authority

> **Statut** : DECIDED
> **Date** : 2026-09-01
> **Source** : plan V2.3.1, ADR-005, ADR-017, ADR-002.

## Status

DECIDED 2026-09-01. Couvre le Distributed Server Track (post-M3) et
GitOps. Pour la première certification : SQLite (substrate local),
pas de DB admin cloud. Décision tranchée sur la base de
`PACKAGE_MIGRATION_MAP` et du plan §172-175.

## Context

Plan V2.3.1 ne définit pas explicitement ADR-015, mais le contexte est
clair : Git (pour GitOps, plan §172-174) et Database (pour le substrate
durable, ADR-000) sont des sources de vérité qu'il faut clarifier.

Plan §172 : `Git commit = desired deployment authority`, `runtime DB
= actual state`. Plan §174 : `DRIFT_DETECTED` si desiredDigest !=
deployedDigest.

Plan §175 : édition concurrente — `baseWorkflowVersionId +
baseDigest`. Base obsolète = `VERSION_CONFLICT`.

## Decision

### Git comme desired deployment

- `WorkflowVersion` (immutable, ADR-002) est commitée dans Git en
  mode GitOps.
- Format : JCS canonical (ADR-001) + signature (ADR-010).
- Hash du commit Git = desiredDigest.

### Database comme actual state

- `WorkflowDeployment` vit dans la runtime DB.
- `deployedDigest` = hash du déploiement effectif.
- Diff desiredDigest vs deployedDigest = `DRIFT_DETECTED` (plan §174).

### Concurrent edits (plan §175)

```ts
type EditBase = {
  baseWorkflowVersionId: string;
  baseDigest: DigestEnvelope<"workflow-version">;
};

type EditResult =
  | { kind: "ok"; newVersion: WorkflowVersion }
  | { kind: "version_conflict"; latestDigest: DigestEnvelope<"workflow-version"> };
```

### Database choices

- Pour ADR-000 Option A (kernel natif) : SQLite (cf. ADR-006).
- Pour ADR-000 Option B (DBOS) : DBOS gère la persistance.
- Pour ADR-000 Option D (Temporal) : Temporal server.

Pas de DB administrée externe obligatoire (cf.
`EXECUTION_PROFILE_REQUIREMENTS.md §1.1`).

## Consequences

- `desiredDigest` et `deployedDigest` sont des `DigestEnvelope`.
- Un outil de reconciliation Git ↔ DB est obligatoire.
- Migration V1 → V2 (ADR-017) lit depuis Git.

## Liens

- plan V2.3.1 §172-175
- ADR-001, ADR-002, ADR-005, ADR-017
