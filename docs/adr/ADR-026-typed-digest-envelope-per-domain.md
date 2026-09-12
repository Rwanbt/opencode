<!-- SPDX-License-Identifier: MIT -->
<!-- Copyright (c) 2026 Unifia contributors -->

# ADR-026 — Typed DigestEnvelope per domain

> **Statut** : DECIDED
> **Date** : 2026-09-01
> **Source** : M1-02 evidence §3.1, M1 plan V2.3.1 §64, §195-197 (C-M1-02, M1 gate).

## Status

DECIDED. ADR d'**impact** sur les contrats (`@unifia/contracts` — V2.3.1
foundation). Vote déclenché par l'évidence M1-02 : la `WorkflowVersionSchema`
accepte n'importe quel `DigestDomain` literal sur le champ `versionDigest`
(M1-02-EVIDENCE §3, finding principal). Le garde-fou runtime (`asDomainDigest()`)
n'est pas suffisant au *parsing boundary* — c'est le premier point d'entrée
des données externes, et le seul à protéger contre un payload forgé.

## Context

Plan V2.3.1 §64 fixe le `DigestEnvelope` comme handle canonique pour
toute valeur content-addressed de la plateforme (workflow version,
approval effect, policy bundle, deployment descriptor, artifact bytes,
etc.). §65 liste les **sept** domaines fermés :

```text
workflow-version
approval-effect
policy
connector-manifest
mcp-schema
deployment
artifact-bytes
```

L'invariant attendu est : « un `WorkflowVersion.versionDigest` est
TOUJOURS un digest du domain `workflow-version` » ; « un
`ArtifactRef.contentDigest` est TOUJOURS un digest du domain
`artifact-bytes` ». La defense-in-depth actuelle s'appuie sur deux
couches :

1. **Le branded type system** (`digest.ts:103-111`) — `WorkflowVersionDigest`,
   `ArtifactBytesDigest`, etc., sont des `Brand<DigestEnvelope, D>`. Le brand
   est un `unique symbol` privé, donc invisible au runtime. Il bloque
   l'assignation cross-domain à la compilation : on ne peut pas écrire
   `function f(d: ArtifactBytesDigest) { return d }` et passer un
   `PolicyDigest` sans cast.

2. **Le runtime `asDomainDigest()`** (`digest.ts:121-130`) — re-typed
   un `DigestEnvelope` en brand `D`, après avoir vérifié que le literal
   `domain` matche. C'est l'**escape hatch** du trust boundary (loader
   disque, IPC, RPC).

La couche (1) attrape les bugs au dev time. La couche (2) attrape les
mauvais payloads au runtime, mais **uniquement aux sites d'appel qui
pensent à l'invoquer**. Le **parsing boundary** — le moment où un JSON
arbitraire entre dans le système via `WorkflowVersionSchema.parse(payload)`
— est resté non-typé. Le M1-02 spike (test 1) le démontre explicitement
: un payload `{ versionDigest: { domain: "policy", ... } }` parse sans
erreur.

**Threat model** : TM-D-01 (cross-domain digest confusion). Un payload
forgé peut faire croire à un loader que l'envelope d'un `WorkflowVersion`
est un `PolicyDigest` (ou inversement). Le code downstream qui discrimine
par `domain` reçoit une valeur contrefaite, et la séparation des contextes
de sécurité (plan §65) est compromise. Pas d'exécution directe, mais
une **confused deputy** latente entre domaines — la même classe que
TM-CP-01 (capability confusion) à un niveau d'abstraction plus bas.

## Décision

**Ajouter sept schémas Zod par domaine**, un par membre de `DigestDomain`,
produits par un helper `domainSchemaFor<D>(d)` qui refine
`DigestEnvelopeSchema` avec un check sur le literal `domain` :

```ts
// packages/contracts/src/digest.ts
function domainSchemaFor<D extends DigestDomain>(d: D) {
  return DigestEnvelopeSchema.refine(
    (e): e is DigestForDomain<D> => e.domain === d,
    { message: `expected domain "${d}"` },
  )
}

export const WorkflowVersionDigestSchema  = domainSchemaFor("workflow-version")
export const ApprovalEffectDigestSchema   = domainSchemaFor("approval-effect")
export const PolicyDigestSchema           = domainSchemaFor("policy")
export const ConnectorManifestDigestSchema = domainSchemaFor("connector-manifest")
export const McpSchemaDigestSchema        = domainSchemaFor("mcp-schema")
export const DeploymentDigestSchema       = domainSchemaFor("deployment")
export const ArtifactBytesDigestSchema    = domainSchemaFor("artifact-bytes")
```

Les branded types (`WorkflowVersionDigest`, etc.) restent **inchangés** :
ils sont un compile-time fiction par construction, et continuer à les
exporter permet à `asDomainDigest()` (qui retourne un brand) de rester
le type-level escape hatch au trust boundary.

Les **deux migrations** de call site de cette PR (les autres sont
tracées en §Alternatives) :

```ts
// packages/contracts/src/workflow-ir.ts:246
- versionDigest: DigestEnvelopeSchema,
+ versionDigest: WorkflowVersionDigestSchema, // ADR-026

// packages/contracts/src/artifact-record.ts:28
- contentDigest: DigestEnvelopeSchema,
+ contentDigest: ArtifactBytesDigestSchema, // ADR-026

// packages/contracts/src/artifact-record.ts:76 (ArtifactRecordSchema, store-authoritative)
- contentDigest: DigestEnvelopeSchema,
+ contentDigest: ArtifactBytesDigestSchema, // ADR-026
```

Le spike throwaway `docs/automation-v2/spikes/adr-026-typed-digest-envelope.ts`
porte les 5 vecteurs d'acceptation ; le test file
`packages/contracts/test/typed-digest-envelope.test.ts` (19 tests) verrouille
le contrat en CI. Le récapitulatif d'évidence est dans
`docs/automation-v2/spikes/ADR-026-EVIDENCE.md`.

## Alternatives considered

**Option B (statu quo)** — ne rien changer, documenter le gap comme
« design intent » et laisser chaque call site appeler `asDomainDigest()`
explicitement. Rejetée pour deux raisons :
1. Le parsing boundary est par définition *outside* du typage statique
   — c'est le moment où le `unknown` devient un `WorkflowVersion`. Si
   le runtime ne valide pas le domain literal à ce moment-là, on dépend
   de chaque call site en aval pour appeler `asDomainDigest()`. C'est
   un invariant distribué, qui finit par être violé.
2. Le store (`@unifia/artifact-store`) commence à émettre des
   `ArtifactBytesDigest` en M1-06. C'est le bon moment pour fermer
   le trou, avant que l'invariant « domain = artifact-bytes » soit
   diffusé dans toute la base de code.

**`z.discriminatedUnion("domain", [...])`** — explorer dans M1-02 §3.2,
rejetée :
- `z.discriminatedUnion` produit un *union* des sept membres, pas un
  schéma par membre. Le caller devrait re-discriminer pour récupérer
  le type exact. On perd l'invariant « un `WorkflowVersion.versionDigest`
  est TOUJOURS un `WorkflowVersionDigest` » au profit d'un
  `WorkflowVersionDigest | PolicyDigest | ...` qu'il faut discriminer.
- L'Option A préserve l'invariant de type **par site d'appel**, pas au
  niveau global. C'est précisément ce qu'on veut.
- Le `version: z.literal(1)` est le discriminator du *shape* de
  l'envelope (versionné indépendamment des domaines). Mélanger les
  deux discriminators complique le parsing sans bénéfice.

## Consequences

**Positives** :
- Le cross-domain guard est enforced au **parsing boundary**. Plus
  besoin de faire confiance à chaque callsite pour appeler
  `asDomainDigest()` correctement : le premier
  `WorkflowVersionSchema.parse(payload)` rejette un payload mal-formé
  avec un `domain` non-`"workflow-version"`.
- Le branded type system reste un compile-time check
  (defense-in-depth), mais le runtime ne peut plus jamais observer un
  `WorkflowVersion.versionDigest` dont le domain est `"policy"`.
- L'invariant « un `versionDigest` est TOUJOURS un
  `WorkflowVersionDigest` » devient l'invariant du **schéma**, pas une
  convention de code sujette à oubli.
- `asDomainDigest()` reste nécessaire au **trust boundary** (data
  loaded from disk) — sa sémantique ne change pas. C'est désormais
  le seul moyen légitime d'introduire un `DigestEnvelope` non-typé
  dans le code branded.

**Coûts** :
- 7 nouveaux schémas Zod (faible — un `domainSchemaFor()` helper
  factorise l'essentiel).
- 4 call sites migrés dans cette PR : `WorkflowVersion.versionDigest`,
  `ArtifactRef.contentDigest`, `ArtifactRecord.contentDigest`, et
  l'import nommé dans `workflow-ir.ts`. Les call sites restants
  (`ApprovalEffect.effectDigest` en M3, `AtRestProtectionEnvelope.keyRef`
  avec un nouveau domain `key-handle` en M2) sont différés — ils sont
  sur des fields pas encore produits par le runtime.
- 19 nouveaux tests dans `@unifia/contracts` (127/0 total) — le delta
  est entièrement additionnel : 108/0 baseline préservé, +19 nouveaux.
- Risque résiduel : un caller qui construisait un `WorkflowVersion` ou
  un `ArtifactRef` programmatiquement avec un digest du mauvais domain
  va maintenant voir son `parse` échouer. Le M1-06 evidence confirme
  que le seul caller en M1 (`@unifia/artifact-store:403`) passe déjà
  par `asDomainDigest()` qui brande le bon domain — donc aucune
  régression dans le code de prod actuel.

**Migration checklist (futurs M1/M2/M3 cards)** :
- [ ] C-M1-09 (en cours) — si elle touche `ApprovalEffect`, migrer
      `effectDigest` vers `ApprovalEffectDigestSchema`.
- [ ] C-M2-NN — `AtRestProtectionEnvelope.keyRef` (plan §80) : créer
      un nouveau domain `key-handle` (ADR-010) et migrer `keyRef` vers
      `KeyHandleDigestSchema`.
- [ ] M3 — `Policy` bundle (plan §115) : migrer `policyDigest` vers
      `PolicyDigestSchema`.
- [ ] M3 — `ConnectorManifest` (plan §125) : migrer `manifestDigest`
      vers `ConnectorManifestDigestSchema`.
- [ ] M3 — `McpSchema` (plan §127) : migrer `schemaDigest` vers
      `McpSchemaDigestSchema`.
- [ ] M3 — `Deployment` (plan §141) : migrer `deploymentDigest` vers
      `DeploymentDigestSchema`.

## Reference

- Plan V2.3.1 §64 (DigestEnvelope), §65 (DigestDomain enum),
  §195-197 (M1 gate, C-M1-02).
- ADR-001 (canonicalization), ADR-002 (capability authority),
  ADR-005 (artifact record), ADR-010 (at-rest protection).
- M1-02 evidence `docs/automation-v2/spikes/M1-02-EVIDENCE.md` §3
  (cross-domain gap), §3.1 (Option A design proposal), §3.2
  (alternatives considered).
- Spike throwaway `docs/automation-v2/spikes/adr-026-typed-digest-envelope.ts`.
- Test file `packages/contracts/test/typed-digest-envelope.test.ts`.
- Code touched : `packages/contracts/src/digest.ts` (helper + 7 schemas),
  `packages/contracts/src/workflow-ir.ts` (1 field), `packages/contracts/src/artifact-record.ts` (2 fields).
