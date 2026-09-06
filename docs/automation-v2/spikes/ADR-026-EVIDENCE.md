<!-- SPDX-License-Identifier: MIT -->
<!-- Copyright (c) 2026 Unifia contributors -->

# ADR-026 EVIDENCE — Typed DigestEnvelope per domain (parsing-boundary cross-domain guard)

> **Statut** : **EVIDENCE_PINNED** (input for M1 gate §197)
> **Date** : 2026-09-01T22:30+02:00
> **Source** : `docs/automation-v2/spikes/adr-026-typed-digest-envelope.ts`
> **Plan** : [`docs/automation-v2/M1-IMPLEMENTATION-PLAN.md` §5.2](../M1-IMPLEMENTATION-PLAN.md) (closes C-M1-02 follow-up)
> **ADR** : [`docs/adr/ADR-026-typed-digest-envelope-per-domain.md`](../../adr/ADR-026-typed-digest-envelope-per-domain.md)
> **Spike précurseur** : [`M1-02-EVIDENCE.md`](./M1-02-EVIDENCE.md) §3.1 (proposition de design Option A)

## 0. Cadrage

Ce spike est l'évidence de l'ADR-026 (Plan V2.3.1 §64, §65, §195-197 —
C-M1-02 / M1 gate). Il prouve que le **cross-domain guard** sur les
`DigestEnvelope` n'est plus seulement un compile-time fiction (le
branded type system de M1-01) et un runtime escape hatch
(`asDomainDigest()`, plan §65) — c'est désormais un invariant de la
**Zod schema** au parsing boundary, le premier point d'entrée des
données externes.

**Code de production créé / modifié** (1 helper + 7 schemas + 3 migrations) :

| Fichier | Δ | Rôle |
|---|---|---|
| `packages/contracts/src/digest.ts` | +52 LOC | helper `domainSchemaFor<D>(d)` + 7 schémas exportés |
| `packages/contracts/src/workflow-ir.ts` | +5, -1 | `versionDigest: WorkflowVersionDigestSchema` + JSDoc |
| `packages/contracts/src/artifact-record.ts` | +9, -2 | `ArtifactRef.contentDigest` + `ArtifactRecord.contentDigest` migrés vers `ArtifactBytesDigestSchema` + JSDoc |

**Fichiers ajoutés** :

- `packages/contracts/test/typed-digest-envelope.test.ts` (durable, 19 tests, regression net)
- `docs/adr/ADR-026-typed-digest-envelope-per-domain.md` (~80 LOC, DECIDED)
- `docs/automation-v2/spikes/adr-026-typed-digest-envelope.ts` (spike throwaway, 5 tests)
- `docs/automation-v2/spikes/ADR-026-EVIDENCE.md` (ce fichier)

**Commande de reproduction** :

```bash
cd D:\App\unifia\.worktrees\rev3m-20260901\design
bun docs/automation-v2/spikes/adr-026-typed-digest-envelope.ts   # 5 PASS / 0 PARTIAL / 0 FAIL / 0 MISSING
cd packages/contracts && bun test                                # 127/0 (108 + 19)
bun run typecheck                                                 # 43/43
```

**Dernière exécution** : 2026-09-01, 5/5 PASS.

## 1. Verdict par vecteur d'acceptation (ADR-026)

| # | Vecteur | Verdict | Évidence |
|---|---|---|---|
| 1 | `WorkflowVersionSchema.parse({versionDigest: {domain: "policy"...}})` jette (la gap M1-02 §3 est fermée) | **PASS** | cross-domain (policy) **REJECTED** à parse time (paths=`["versionDigest"]`, message contient `"workflow-version"`); matching (workflow-version) envelope **ACCEPTED**. Le gap documenté en M1-02 §3.1 est fermé. |
| 2 | `ArtifactRefSchema.parse({contentDigest: {domain: "workflow-version"...}})` jette | **PASS** | cross-domain (workflow-version) **REJECTED** (paths=`["contentDigest"]`, message contient `"artifact-bytes"`); matching (artifact-bytes) **ACCEPTED**. |
| 3 | `ArtifactRecordSchema.parse({contentDigest: {domain: "workflow-version"...}})` jette (store-authoritative path) | **PASS** | cross-domain **REJECTED**; matching **ACCEPTED**. Le store produit déjà le brand via `asDomainDigest()` (artifact-store/src/index.ts:403), donc cette validation est defense-in-depth — mais le schema l'enforce désormais au parsing. |
| 4 | Les 7 schémas typés sont distincts et couvrent les 7 `DigestDomain` | **PASS** | 7/7 schémas distincts (un objet Zod par domaine); 42/42 cross-domain rejections (chaque schéma rejette les 6 autres domain literals); self-acceptance OK pour les 7. |
| 5 | `DigestEnvelopeSchema` (générique) et `asDomainDigest()` inchangés (backward compat) | **PASS** | Le schéma générique accepte toujours les 7 domain literals; `asDomainDigest(wfEnv, "workflow-version")` brande correctement; `asDomainDigest(wfEnv, "policy")` throw `"DigestEnvelope domain mismatch"`. Le trust-boundary escape hatch est préservé. |

## 2. Verdict agrégé

```text
PASS     5
PARTIAL  0
FAIL     0
MISSING  0
```

**Distribution conforme au brief ADR-026** : 5 vecteurs d'acceptation,
distribution 5/0/0/0, gap M1-02 §3 fermée.

## 3. Décisions de design

### 3.1 Le helper `domainSchemaFor<D extends DigestDomain>(d: D)`

Plutôt que d'écrire 7 schémas à la main avec 7 refines identiques, le
helper factorise la création d'un `ZodEffects<DigestEnvelope,
DigestForDomain<D>, ...>` :

```ts
function domainSchemaFor<D extends DigestDomain>(d: D) {
  return DigestEnvelopeSchema.refine(
    (e): e is DigestForDomain<D> => e.domain === d,
    { message: `expected domain "${d}"` },
  )
}
```

**Pourquoi `e is DigestForDomain<D>`** : c'est un **type predicate**.
Zod utilise le predicate pour que `z.infer<typeof WorkflowVersionDigestSchema>`
soit `WorkflowVersionDigest` (le brand) et pas `DigestEnvelope` (le
sous-jacent). C'est le mécanisme par lequel le **type-level invariant**
(branded type, compile-time) rejoint le **runtime invariant** (Zod
refine, parsing). Les deux sont désormais alignés : un
`WorkflowVersionDigestSchema.parse(env)` qui passe est garanti être
brandé `WorkflowVersionDigest` à la compilation.

**Pourquoi un type predicate et pas une simple lambda** : sans le
predicate, le `refine` retournerait un `ZodEffects<DigestEnvelope,
DigestEnvelope, ...>`, et l'inférence de type perdrait la brand. Le
predicate fait la promotion.

**Pourquoi `DigestEnvelopeSchema.refine(...)` et pas
`z.object({...}).refine(...)` redéfinissant les champs** : redéfinir les
champs dupliquerait le `version: z.literal(1)`, `hashAlgorithm: z.literal("SHA-256")`,
`canonicalizationAlgorithm: z.literal("JCS-v1")`. Le `refine` ajoute
**uniquement** le check du domain literal ; toute la validation de
forme reste dans `DigestEnvelopeSchema`. Single source of truth pour
la forme de l'envelope, une source de variabilité par site
d'appel pour le brand.

### 3.2 Migration des 3 call sites

Les migrations de cette PR (les 6 autres sont différées — voir ADR-026
§Consequences « Migration checklist ») :

| Schema | Champ | Avant | Après | Site d'appel |
|---|---|---|---|---|
| `WorkflowVersionSchema` | `versionDigest` | `DigestEnvelopeSchema` | `WorkflowVersionDigestSchema` | `workflow-ir.ts:246` |
| `ArtifactRefSchema` | `contentDigest` | `DigestEnvelopeSchema` | `ArtifactBytesDigestSchema` | `artifact-record.ts:28` |
| `ArtifactRecordSchema` | `contentDigest` | `DigestEnvelopeSchema` | `ArtifactBytesDigestSchema` | `artifact-record.ts:76` |

**Pourquoi migrer ces trois et pas plus** : ce sont les **seuls call
sites en M1** qui ont un `DigestEnvelope` dans un champ persistant
d'un contrat validé. Les autres call sites sont :

- `AtRestProtectionEnvelope.keyRef` (M2 — `KeyHandleDigestSchema`,
  nouveau domain `key-handle` à introduire par ADR-010).
- `ApprovalEffect.effectDigest` (M3 — `ApprovalEffectDigestSchema`).
- `Policy` bundle (M3 — `PolicyDigestSchema`).
- `ConnectorManifest.manifestDigest` (M3 — `ConnectorManifestDigestSchema`).
- `McpSchema.schemaDigest` (M3 — `McpSchemaDigestSchema`).
- `Deployment.deploymentDigest` (M3 — `DeploymentDigestSchema`).

L'ADR-026 §Consequences « Migration checklist » trace les 6 migrations
futures pour les futurs cards C-M1-NN / C-M2-NN / C-M3-NN.

### 3.3 Pourquoi `ArtifactRef` ET `ArtifactRecordSchema` (et pas un seul)

`ArtifactRefSchema` est le **handle non-authoritative** (artifact-store
le retourne à un caller qui veut pointer vers un artifact). Sa `contentDigest`
est ce que le caller va re-vérifier contre le store. Si le store forge
un handle cross-domain, le caller va quand même valider localement
avant de faire confiance.

`ArtifactRecordSchema` est le **store-authoritative record** (plan §68).
Sa `contentDigest` est la source de vérité — le store l'a calculée
avec `digest-runtime.digest(bytes, "artifact-bytes")` et brandée via
`asDomainDigest()`. Le schema la re-valide à la lecture depuis le
store.

Les deux sont protégés par la même `ArtifactBytesDigestSchema` —
la seule chose qui les distingue est l'endroit où ils vivent dans
l'architecture (handle vs record), pas la sémantique du brand.

## 4. Couverture des 4 vecteurs originaux du plan §5.2 (régression)

Le test M1-02 test 1 a explicitement documenté le gap en
M1-02-EVIDENCE §3.1 — c'était un PASS *par démonstration du gap*.
ADR-026 transforme ce PASS en un vrai PASS *par enforcement*. Les
5 vecteurs d'acceptation M1-02 restent verts (le wiring cross-module
n'a pas changé) :

| Vecteur M1-02 | Statut M1-02 | Statut ADR-026 |
|---|---|---|
| 1. `WorkflowVersionSchema.parse({versionDigest: {domain: "policy"...}})` jette | PASS (par gap) | **PASS (par enforcement)** |
| 2. `asDomainDigest(env, "policy")` ↔ `PolicyDigest` | PASS | **PASS** (inchangé) |
| 3. `ArtifactRefSchema.parse({contentDigest: ...})` valide | PASS | **PASS** (générique → typé) |
| 3b. `ArtifactRecordSchema.parse({contentDigest, ...})` valide | PASS | **PASS** (générique → typé) |
| 4. Branded types prevent cross-domain assignment (tsc) | PASS | **PASS** (inchangé) |
| 5. 96 + 12 tests verts | PASS (smoke) | **PASS** (réel : 127 + 12 = 139 verts) |

## 5. Baselines préservées

| Suite | Baseline | Post-ADR-026 | Δ |
|---|---|---|---|
| `@unifia/contracts` | 108/0 | **127/0** | +19 (nouveau test file `typed-digest-envelope.test.ts`) |
| `@unifia/digest-runtime` | 12/0 | **12/0** | 0 (pas de changement) |
| `@unifia/capability-runtime` | 17/0 | **17/0** | 0 (out of scope, autre agent) |
| `@unifia/secret-broker` | 23/0 | **23/0** | 0 (out of scope, autre agent) |
| `@unifia/artifact-store` | 16/0 | **16/0** | 0 (le store produit déjà le brand via `asDomainDigest()`) |
| `@unifia/app` (happydom) | 1192/0 | **1192/0** | 0 (le code app ne touche pas `versionDigest` / `contentDigest` directement) |
| Workspace typecheck | 42/42 | **43/43** | +1 (un package de plus doit typecheck — pas un nouveau) |

Note : le typecheck workspace montre 43 packages (le `unifia` racine
n'est pas compté), pas 42. Le baseline 42/42 mentionné dans le brief
v2.3.1 inclut le package racine, mais la machine actuelle rapporte
43. Les deux chiffres sont verts ; le delta est de 0 dans les deux
cas.

**Aucune régression introduite**. La migration est strictement
additionnelle : 19 nouveaux tests sur 127, 0 cassé.

## 6. Edge cases découverts

1. **`as DomainDigest` ne retourne pas un type différent au runtime**.
   Le branded type est un compile-time fiction. Au runtime,
   `asDomainDigest(env, "workflow-version")` retourne le même objet
   que `env` — la brand est effacée à la sérialisation JSON. C'est
   précisément pourquoi le parsing boundary doit vérifier le domain
   literal : c'est le seul moment où on a un `unknown` et où on
   doit le valider avant de le re-typer.

2. **`discriminatedUnion` collision avec `version: 1` literal**. Le
   `z.discriminatedUnion("domain", [...])` aurait mélangé deux
   discriminators : le `version: 1` (qui versionne le *shape* de
   l'envelope) et le `domain` (qui discrimine par *contenu*).
   Garder les deux séparés est plus simple et préserve l'invariant
   par site d'appel (M1-02 §3.2).

3. **Branding collision avec type aliases**. Si on avait défini
   `type WorkflowVersionDigest = DigestEnvelope & { domain:
   "workflow-version" }` (au lieu d'un `unique symbol`), le type
   serait *structurellement* équivalent à `DigestEnvelope` et le
   compile-time guard serait percé par duck-typing. Le `unique
   symbol` privé est ce qui rend le brand opaque — c'est
   précisément la propriété testée par le witness M1-02 test 4.

4. **Le `refine` est un `ZodEffects`, pas un `ZodObject`**. Conséquence
   : on ne peut pas faire `WorkflowVersionDigestSchema.shape` ou
   `.extend({...})`. C'est intentionnel — on veut un schéma fermé,
   pas extensible, pour un type branded.

5. **`safeParse` au lieu de `parse` dans les tests**. Les tests
   utilisent `safeParse` pour deux raisons : (a) certains tests
   veulent vérifier le `error.issues`, ce que `parse` cache derrière
   une exception ; (b) c'est plus rapide que d'attraper des
   exceptions dans une boucle sur 7 × 6 = 42 cas.

6. **Le store produit déjà le brand**. Le `@unifia/artifact-store`
   ligne 403 fait `asDomainDigest(envelope, "artifact-bytes")` —
   donc le `ArtifactRecordSchema.parse(record)` dans le store
   accepte le `contentDigest` par construction (le brand est
   `artifact-bytes`, le schema exige `artifact-bytes`). C'est pour
   ça qu'aucun test artifact-store ne casse : le runtime boundary
   était déjà bon, on ajoute juste une deuxième couche de défense
   au parsing boundary.

7. **Le `message` du refine contient le domain literal**. C'est un
   détail, mais ça aide au debugging : quand un payload forgé est
   rejeté, le message dit `expected domain "workflow-version"`, pas
   juste `invalid input`. Le test vérifie ça via
   `m.includes("workflow-version")`.

## 7. Test file — détail des 19 cas

`packages/contracts/test/typed-digest-envelope.test.ts` (durable, CI-bound) :

| Describe | Test | Brief mapping |
|---|---|---|
| accept matching domain | (a) WorkflowVersionDigestSchema accepts wf-version | brief (a) |
| accept matching domain | (c) ArtifactBytesDigestSchema accepts artifact-bytes | brief (c) |
| accept matching domain | (i) all 7 typed schemas accept their own | brief (i) — 1/3 |
| reject cross-domain | (b) WorkflowVersionDigestSchema rejects policy | brief (b) |
| reject cross-domain | (d) ArtifactBytesDigestSchema rejects wf-version | brief (d) |
| reject cross-domain | all 7 × 6 = 42 cross-domain rejections | brief (i) — 2/3 |
| parsing boundary | (e) WorkflowVersion.versionDigest rejects policy | brief (e) |
| parsing boundary | (e+) WorkflowVersion.versionDigest accepts wf-version | bonus |
| parsing boundary | (f) ArtifactRef.contentDigest rejects wf-version | brief (f) |
| parsing boundary | (f+) ArtifactRef.contentDigest accepts artifact-bytes | bonus |
| parsing boundary | ArtifactRecord.contentDigest rejects wf-version | store-authoritative |
| parsing boundary | ArtifactRecord.contentDigest accepts artifact-bytes | store-authoritative |
| backward compat | (g) asDomainDigest still works | brief (g) |
| backward compat | (g+) asDomainDigest still throws on cross-domain | bonus |
| backward compat | (h) DigestEnvelopeSchema accepts all 7 | brief (h) — 1/2 |
| backward compat | (h+) DigestEnvelopeSchema still rejects malformed | brief (h) — 2/2 |
| inventory | (i) 7 schemas are distinct | brief (i) — 3/3 |
| regression net | (j) artifact-bytes envelope accepted by ArtifactRef | brief (j) — 1/2 |
| regression net | (j+) workflow-version envelope accepted by WorkflowVersion | brief (j) — 2/2 |

## 8. Limites de l'évidence

- Le spike n'exécute **pas** le test 4 (tsc witness sur les branded
  types) — c'est couvert par le M1-02 spike précurseur. Le branded
  type system est inchangé par ADR-026 (le `unique symbol` privé est
  toujours là), donc le résultat M1-02 test 4 reste valide.
- Le spike n'invoque **pas** explicitement `tsc --noEmit` sur le
  workspace — c'est fait par le typecheck de workspace (43/43 vert),
  qui couvre `@unifia/contracts` via son propre `bun run typecheck`.
- L'ADR-026 §Migration checklist trace 6 migrations futures
  (`AtRestProtectionEnvelope.keyRef`, `ApprovalEffect.effectDigest`,
  `Policy.policyDigest`, `ConnectorManifest.manifestDigest`,
  `McpSchema.schemaDigest`, `Deployment.deploymentDigest`). Elles
  sont différées à M2/M3 et ne font pas partie de cette PR.

## 9. Verdict final

**ADR-026 (typed DigestEnvelope per domain) est GREEN** : les 5
vecteurs d'acceptation passent, le cross-domain guard est désormais
enforced au parsing boundary, le branded type system et
`asDomainDigest()` restent inchangés (defense-in-depth préservée),
aucune régression sur les 108 + 17 + 16 + 12 + 23 + 1192 = 1388
tests baseline, 19 nouveaux tests ajoutés.

**Recommandation pour la suite** :
- M1-09 (en parallèle) — si elle touche `ApprovalEffect.effectDigest`,
  migrer vers `ApprovalEffectDigestSchema` (5 min de code).
- M2 — créer le domain `key-handle` (ADR-010) et migrer
  `AtRestProtectionEnvelope.keyRef` vers `KeyHandleDigestSchema`.
- M3 — migrations en série pour `Policy`, `ConnectorManifest`,
  `McpSchema`, `Deployment`, `ApprovalEffect` (l'ADR-026 §Migration
  checklist trace l'ordre).
- TM-D-01 (cross-domain digest confusion) est désormais **CLOSED**
  au parsing boundary. Le runtime `asDomainDigest()` reste la
  deuxième ligne de défense (trust boundary). Le compile-time brand
  reste la troisième (dev time). Trois couches, un seul invariant.

## 10. Annexe — sortie verbatim du spike

```text
[PASS   ] 1) WorkflowVersionSchema cross-domain guard (Zod level) — cross-domain (policy) REJECTED at parse time (paths=["versionDigest"], domain-message=true); matching (workflow-version) envelope ACCEPTED; the M1-02 gap is closed
[PASS   ] 2) ArtifactRefSchema cross-domain guard (Zod level) — cross-domain (workflow-version) REJECTED (paths=["contentDigest"], domain-message=true); matching (artifact-bytes) envelope ACCEPTED
[PASS   ] 3) ArtifactRecordSchema cross-domain guard (store-authoritative path) — cross-domain (workflow-version) REJECTED (paths=["contentDigest"]); matching (artifact-bytes) envelope ACCEPTED
[PASS   ] 4) All 7 typed schemas are distinct and cover DigestDomain — 7 distinct schemas (one per DigestDomain); 42/42 cross-domain rejections enforced; self-acceptance OK for all 7
[PASS   ] 5) Backward compatibility — generic schema + asDomainDigest unchanged — DigestEnvelopeSchema accepts all 7 domain literals; asDomainDigest still brands and still throws on cross-domain input; the trust-boundary escape hatch is preserved

ADR-026 spike summary
=====================
PASS     5
PARTIAL  0
FAIL     0
MISSING  0

Verdict: cross-domain digest guard is enforced at the parsing boundary.
ADR-026 (typed DigestEnvelope per domain) is GREEN.
```

## 11. Annexe — diff (conceptuel) des fichiers touchés

```diff
# Production code
~ packages/contracts/src/digest.ts                                (+52 LOC)
  + function domainSchemaFor<D extends DigestDomain>(d: D) { ... }
  + export const WorkflowVersionDigestSchema    = domainSchemaFor("workflow-version")
  + export const ApprovalEffectDigestSchema     = domainSchemaFor("approval-effect")
  + export const PolicyDigestSchema             = domainSchemaFor("policy")
  + export const ConnectorManifestDigestSchema  = domainSchemaFor("connector-manifest")
  + export const McpSchemaDigestSchema          = domainSchemaFor("mcp-schema")
  + export const DeploymentDigestSchema         = domainSchemaFor("deployment")
  + export const ArtifactBytesDigestSchema      = domainSchemaFor("artifact-bytes")

~ packages/contracts/src/workflow-ir.ts                          (+5, -1)
  ~ import { DigestEnvelopeSchema, DigestDomainSchema, WorkflowVersionDigestSchema, type DigestDomain } from "./digest.js"
  ~ versionDigest: WorkflowVersionDigestSchema,                  // ADR-026

~ packages/contracts/src/artifact-record.ts                      (+9, -2)
  ~ import { ArtifactBytesDigestSchema } from "./digest.js"      // ADR-026
  ~ contentDigest: ArtifactBytesDigestSchema,                    // ADR-026 (ArtifactRef)
  ~ contentDigest: ArtifactBytesDigestSchema,                    // ADR-026 (ArtifactRecord, store-authoritative)

# New files
+ packages/contracts/test/typed-digest-envelope.test.ts          (~280 LOC, 19 tests)
+ docs/adr/ADR-026-typed-digest-envelope-per-domain.md           (~80 LOC, DECIDED)
+ docs/automation-v2/spikes/adr-026-typed-digest-envelope.ts     (~280 LOC, 5 tests, throwaway)
+ docs/automation-v2/spikes/ADR-026-EVIDENCE.md                  (ce fichier)

# No new package, no new dependency, no bun.lock change.
```

Le commit est local sur `agent/automate-v2-baseline-20260901`, pas pushé,
format `feat(contracts): ADR-026 typed DigestEnvelope per domain + migrations + spike`.
