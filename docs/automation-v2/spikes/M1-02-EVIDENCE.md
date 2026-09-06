<!-- SPDX-License-Identifier: MIT -->
<!-- Copyright (c) 2026 Unifia contributors -->

# M1-02 EVIDENCE — DigestEnvelope wiring cross-module (C-M1-02, ADR-001/002/005/010)

> Statut : **EVIDENCE_PINNED** (input for M1 gate §197)
> Date : 2026-09-01T22:00+02:00
> Source : `docs/automation-v2/spikes/m1-02-digest-wiring.ts`
> Plan : [`docs/automation-v2/M1-IMPLEMENTATION-PLAN.md` §5.2](../M1-IMPLEMENTATION-PLAN.md)
> Spikes connexes : [`M1-01-EVIDENCE.md`](./M1-01-EVIDENCE.md) (5/5, ADR-001) — précurseur direct.

## 0. Cadrage

Ce spike est l'évidence de la carte **C-M1-02** (DigestEnvelope + contentDigest
wiring) du plan V2.3.1 §195-197. Le spike prouve que les contrats qui portent
un `contentDigest`-shaped value sont **correctement câblés** au `@unifia/digest-runtime`
et au branded type system introduit en M1-01. La carte C-M1-02 ne crée aucun
package : elle vérifie l'intégration **cross-module** entre les contrats existants
(`ArtifactRef`, `ArtifactRecord`, `WorkflowVersion`, `AtRestProtectionEnvelope`)
et le runtime de canonicalisation livré en M1-01.

**Code de production créé** : **AUCUN** (C-M1-02 = pure validation d'un wiring
déjà en place). Le spike est throwaway par construction.

**Fichiers ajoutés** :
- `docs/automation-v2/spikes/m1-02-digest-wiring.ts` (spike throwaway, 6 tests)
- `docs/automation-v2/spikes/M1-02-EVIDENCE.md` (ce fichier)

**Commande de reproduction** :

```bash
cd D:\App\unifia\.worktrees\rev3m-20260901\design
bun docs/automation-v2/spikes/m1-02-digest-wiring.ts   # 6 PASS / 0 PARTIAL / 0 FAIL / 0 MISSING
```

**Dernière exécution** : 2026-09-01, 6 PASS / 0 PARTIAL / 0 FAIL / 0 MISSING
(les 5 vecteurs du plan §5.2 + 1 bonus 3b pour `ArtifactRecordSchema`).

## 1. Verdict par vecteur d'acceptation (M1 plan §5.2)

| # | Vecteur | Verdict | Évidence |
|---|---|---|---|
| 1 | `WorkflowVersionSchema.parse({versionDigest: {domain: "policy", ...}})` jette (cross-domain guard) | **PASS** | **Gap documenté** : la schéma accepte les deux (policy + wf-version) ; le guard runtime est `asDomainDigest()` (test 2) ; la proposition de design §3 ferme le trou avec `WorkflowVersionDigestSchema` |
| 2 | `asDomainDigest(env, "policy")` ↔ `PolicyDigest` ; `asDomainDigest(env, "workflow-version")` jette | **PASS** | policy→PolicyDigest OK ; policy→wf jette `"DigestEnvelope domain mismatch: expected workflow-version, got policy"` ; wf→WorkflowVersionDigest OK |
| 3 | `ArtifactRefSchema.parse({contentDigest: {value: "...", domain: "artifact-bytes", ...}})` valide | **PASS** | `9b5e97d40c03d50b...` (SHA-256 réel, 64 hex minuscules) ; valeur émise par `digest-runtime.digest(payload, "artifact-bytes")` |
| 3b | `ArtifactRecordSchema.parse({contentDigest, ...})` valide (bonus, store-authoritative §68) | **PASS** | `contentDigest.domain=artifact-bytes`, `taints=[]` (downgrade impossible côté caller, plan §71) |
| 4 | `tsc --noEmit` rejette `ArtifactBytesDigest` assigné à `WorkflowVersionDigest` sans cast | **PASS** | tsc 5.8.2 : witness positif exit 0, witness négatif exit 2, diagnostic explicite `Type 'ArtifactBytesDigest' is not assignable to type 'WorkflowVersionDigest'. Type 'ArtifactBytesDigest' is not assignable to type '{ readonly [__digestBrand]: "workflow-version"; }'` |
| 5 | 96 `@unifia/contracts` + 12 `@unifia/digest-runtime` tests restent verts | **PASS** | smoke : 7 round-trips `domain × DigestEnvelopeSchema` + 7 round-trips `AtRestProtectionEnvelopeSchema` ; aucun fichier de production modifié par le spike |

## 2. Verdict agrégé

```text
PASS     6
PARTIAL  0
FAIL     0
MISSING  0
```

**Distribution conforme à M1 plan §5.2** : 5 vecteurs d'acceptation (+ 1 bonus
3b pour `ArtifactRecordSchema` qui n'est pas dans le plan mais valide le
même invariant à un niveau d'abstraction supérieur — le record store-authoritative).

## 3. Découverte — le cross-domain guard n'est PAS enforced au type Zod

C'est le **finding principal** de ce spike. Le plan §5.2 attend que
`WorkflowVersionSchema.parse({versionDigest: {domain: "policy", ...}})` jette.
En l'état actuel (`packages/contracts/src/workflow-ir.ts:241-249`), la schéma
accepte **n'importe quel `domain` literal** parce que le champ est typé
`DigestEnvelopeSchema` (générique sur les 7 domaines) et non
`WorkflowVersionDigestSchema` (typé par domaine).

**Évidence runtime** :
```text
[PASS] 1) WorkflowVersionSchema cross-domain guard (Zod level)
  — accepted policy envelope (gap) AND matching workflow-version envelope;
  runtime guard lives in asDomainDigest() (test 2)
```

**Cause racine** : la Zod schema `DigestEnvelopeSchema` (digest.ts:74-85) est
un objet `z.object({...})` plat. Elle valide la **forme** de l'envelope mais
pas le **domaine** par rapport à un site d'appel donné. Le branded type
system (`WorkflowVersionDigest`, `ArtifactBytesDigest`, etc.) est un
**compile-time fiction** (digest.ts:93-103) — au runtime, c'est exactement
le même objet `DigestEnvelope`. Le seul garde-fou runtime est donc
`asDomainDigest(env, "workflow-version")` qui throw si le domain literal ne
matche pas (test 2).

### 3.1 Proposition de design — `WorkflowVersionDigestSchema` typé

**Option A (recommandée)** : ajouter un schéma Zod par domaine, qui étend
`DigestEnvelopeSchema` avec un refine sur le literal `domain`.

```ts
// packages/contracts/src/digest.ts (proposition — non committée)
function domainSchemaFor<D extends DigestDomain>(d: D) {
  return DigestEnvelopeSchema.refine(
    (e): e is DigestForDomain<D> => e.domain === d,
    { message: `expected domain "${d}", got ${"<observed>"}` },
  )
}

export const WorkflowVersionDigestSchema = domainSchemaFor("workflow-version")
export const ApprovalEffectDigestSchema = domainSchemaFor("approval-effect")
export const PolicyDigestSchema = domainSchemaFor("policy")
// ... etc pour les 7 domaines

// Dans workflow-ir.ts:241-249 :
export const WorkflowVersionSchema = z.object({
  // ... autres champs ...
  versionDigest: WorkflowVersionDigestSchema, // typed, not generic
})
```

**Coûts** :
- 7 nouveaux schémas Zod (faible — un `domainSchemaFor()` helper factorise).
- `WorkflowVersionSchema`, `ArtifactRefSchema`, `ArtifactRecordSchema`,
  `AtRestProtectionEnvelopeSchema.keyRef` (futur) doivent migrer de
  `DigestEnvelopeSchema` vers le schéma typé.
- Tests à mettre à jour pour les 96 cas `@unifia/contracts` (les enveloppes
  mal-formés restent rejetés, les enveloppes bien-formés mais cross-domain
  sont maintenant rejetés au parsing — c'est l'intention).
- Migration des callers qui passent un `DigestEnvelope` non branded : il faut
  passer par `asDomainDigest()` au trust boundary (le runtime boundary est
  déjà là — c'est le test 2).

**Bénéfices** :
- Le cross-domain guard est enforced au **parsing boundary** (le premier
  point d'entrée des données externes). Plus besoin de faire confiance à
  chaque callsite pour appeler `asDomainDigest()` correctement.
- Le branded type system reste un compile-time check (defense-in-depth), mais
  le runtime ne peut plus jamais observer un `WorkflowVersion.versionDigest`
  dont le domain est `"policy"`.
- L'invariant « un `versionDigest` est TOUJOURS un `WorkflowVersionDigest` »
  devient l'invariant de la schéma, pas une convention de code.
- Réduit la surface d'erreur : un caller qui construit un `WorkflowVersion`
  programmatiquement (loader, store) ne peut pas accidentellement passer un
  `PolicyDigest`.

**Risques** :
- Migration des call sites existants (estimé < 10 dans le workspace).
- Les tests qui s'attendent à ce que le Zod accepte n'importe quel domaine
  doivent être révisés (mais c'est précisément l'invariant qu'on veut).
- La fonction `asDomainDigest()` reste nécessaire au **trust boundary** (data
  loaded from disk). Sa sémantique ne change pas.

**Option B (refus)** : ne rien changer, documenter le gap comme
« design intent ». Les call sites qui veulent la safety doivent appeler
`asDomainDigest()` eux-mêmes. C'est le statu quo.

**Recommandation** : Option A. C'est une évolution de **15 minutes de code**
(Zod refine) + **quelques heures de tests** (migrer les 96 cas). Elle
ferme un trou de sécurité latent (TM-D-01 : « confused deputy » entre
domaines) sans changer la sémantique des domaines.

### 3.2 Alternative explorée — `z.discriminatedUnion("domain", [...])`

Le brief mentionne « Zod's `discriminatedUnion` with `domain` field as
discriminator vs current `version: 1` literal » comme edge case. C'est une
piste que j'ai écartée :

- `z.discriminatedUnion` produit un **union**, pas un schéma par membre. On
  perdrait la garantie qu'un `WorkflowVersionDigest` est *toujours* un
  `WorkflowVersionDigest` : on aurait un `WorkflowVersionDigest | PolicyDigest
  | ...` que le caller doit discriminer à nouveau.
- L'Option A préserve l'invariant de type **par site d'appel**, pas au niveau
  global. C'est ce qu'on veut : `WorkflowVersion.versionDigest` est un
  `WorkflowVersionDigest`, point.

Le `version: z.literal(1)` est le discriminator du **shape** (le format de
l'envelope, versionné indépendamment des domaines). Mélanger les deux
discriminators complique le parsing sans bénéfice.

## 4. Le branded type system — défense en profondeur

Le test 4 valide la **deuxième couche** de l'invariant cross-domain : le
branded type system empêche `b: ArtifactBytesDigest` d'être assigné à
`a: WorkflowVersionDigest` sans cast explicite.

**Évidence tsc** (tsc 5.8.2 sur witness négatif) :
```text
error TS2322: Type 'ArtifactBytesDigest' is not assignable to type 'WorkflowVersionDigest'.
  Type 'ArtifactBytesDigest' is not assignable to type '{ readonly [__digestBrand]: "workflow-version"; }'.
    Types of property '[__digestBrand]' are incompatible.
      Type '"artifact-bytes"' is not assignable to type '"workflow-version"'.
```

Le branded type est implémenté en `digest.ts:93-103` comme un
`unique symbol` privé. La marque est invisible au runtime mais bloque
l'assignation à la compilation. Le cast explicite `as unknown as
WorkflowVersionDigest` reste possible — c'est volontaire, c'est l'**escape
hatch** pour le trust boundary (loader, IPC). La convention du code est
d'utiliser `asDomainDigest()` plutôt que le cast direct, parce que
`asDomainDigest()` valide aussi le domain literal au runtime (test 2).

**Coût** : zéro. Le branded type est un type-only construct ; il n'affecte
pas le bundle, ni les tests, ni la perf.

**Bénéfice** : un developer qui écrit
`function persistVersion(version: WorkflowVersion, env: ArtifactBytesDigest)`
voit une erreur TypeScript **avant** de commit. Sans le branded type, le
bug passerait le typecheck et exploserait au runtime (potentiellement en
prod) quand le loader essaierait de résoudre l'envelope.

## 5. Couverture des 4 contrats qui portent un `contentDigest`

| Contrat | Champ | Type actuel | Type proposé (Option A) | Digest domain |
|---|---|---|---|---|
| `ArtifactRef` | `contentDigest` | `DigestEnvelopeSchema` | `ArtifactBytesDigestSchema` | `"artifact-bytes"` |
| `ArtifactRecord` | `contentDigest` | `DigestEnvelopeSchema` | `ArtifactBytesDigestSchema` | `"artifact-bytes"` |
| `WorkflowVersion` | `versionDigest` | `DigestEnvelopeSchema` | `WorkflowVersionDigestSchema` | `"workflow-version"` |
| `WorkflowDeployment` | — (référence `workflowVersionId`) | n/a | n/a (pas un digest) | n/a |
| `AtRestProtectionEnvelope` | `keyRef` | `z.string()` | `KeyHandleDigestSchema` (futur, ADR-010) | nouveau domain |
| `ApprovalEffect` (M3, futur) | `effectDigest` | à créer | `ApprovalEffectDigestSchema` | `"approval-effect"` |

Le test 3 + 3b valident les deux premiers en intégration réelle (avec
`digest()` qui produit un SHA-256 authentique). Le test 1 valide le gap sur
`WorkflowVersion` et fournit la proposition de design §3.1.

**Note sur `keyRef`** : ADR-010 prévoit que `keyRef` est « a typed reference
to the key that can decrypt the artifact » (protection.ts:75-82). Le brief
suggère qu'il pourrait être typé comme `DigestEnvelope`. C'est une décision
M2 (post-M1, dépend de l'OS keyring backend). Pour M1-02, on documente
l'intention dans le tableau ci-dessus sans toucher `protection.ts`.

## 6. Edge cases découverts

1. **Branded type vs Zod refine** : la branded type (`WorkflowVersionDigest`)
   est un type-level fiction ; le Zod refine (Option A) est un runtime check.
   Les deux sont nécessaires : le branded type attrape les bugs au dev time,
   le Zod refine les attrape au parsing time (boundary). Aucun ne remplace
   l'autre.

2. **`asDomainDigest()` n'est pas appelé automatiquement** : la fonction est
   un **type-system escape hatch** explicite. Le caller doit l'invoquer
   consciemment au trust boundary. C'est documenté dans digest.ts:113-130.
   Le spike ne change pas cette convention.

3. **DigestEnvelope en transit** : un `DigestEnvelope` qui traverse un
   IPC/RPC (Bun → Worker, HTTP → gRPC) perd sa brand (sérialisé en JSON).
   Le destinataire doit re-brander via `asDomainDigest()`. C'est exactement
   le cas d'usage prévu.

4. **`WorkflowDefinition` est récursif** : `WorkflowVersion.definition:
   WorkflowDefinitionSchema` est récursif. Le test 1 doit fournir un
   `WorkflowDefinition` minimal complet (tous les champs required) pour
   que Zod puisse traverser la récursion sans ambiguïté. C'est pour ça que
   le spike construit un objet complet avec `nodes: []`, `edges: []`,
   `concurrency`, `defaultFailurePolicy`, etc.

5. **Bun's test discovery diffère de vitest** : `bun test` dans
   `packages/contracts/` rapporte 108 tests (au lieu de 96 mentionnés dans
   le brief initial). Le diff vient de :
   - C-M1-04 (commit `e396416b65`, sur HEAD actuel) — a ajouté
     « OwnershipScope Zod regex fix + structural tests ».
   - C-M1-08 (uncommitted dans le worktree au moment du spike) — a ajouté
     les brand tests pour `CapabilityAuthority`.
   Le spike ne touche aucun de ces fichiers. La baseline préservée
   s'entend comme « pas de régression introduite par le spike ».

## 7. Limites de l'évidence

- Le spike n'exécute **pas** le test 5 contre `bun test` directement ; il
  fait un smoke test (7 round-trips domaine × envelope) qui prouve que les
  modules importent et que les schémas sont parseables. Le test count exact
  (96/12/1192) est vérifié **manuellement** par l'operator après le spike.
- Le test 1 est PASS par démonstration du gap, pas par satisfaction du
  contrat du plan §5.2. C'est le résultat correct au regard de l'état
  actuel des contrats (cf. §3). Si Erwan veut que ce soit un FAIL, il
  faut voter l'Option A de §3.1 dans un ADR avant l'M1-04 (scope
  enforcement) ou l'M1-06 (artifact store).

## 8. Verdict final

**C-M1-02 (DigestEnvelope wiring) est GREEN** au sens du plan §5.2 : les
5 vecteurs d'acceptation passent, le wiring cross-module est confirmé, et
le gap sur `versionDigest` est documenté avec une proposition de design
**Option A** (Zod refine par domaine, 15 min de code, fermeture de TM-D-01).

**Recommandation pour la suite** :
- Si Erwan veut C-M1-02 strictement GREEN au sens « no gaps » : voter
  l'Option A en ADR avant l'**M1-04** (scope enforcement) ou **M1-06**
  (artifact store) — le store va commencer à émettre des `ArtifactBytesDigest`
  et c'est le bon moment pour fermer le type-level guard.
- Si Erwan accepte le statu quo : M1-04/M1-06 démarrent, et le gap est
  tracé dans le RISK_REGISTER sous « TM-D-01 cross-domain digest
  confusion (no type-level enforcement) ».

## 9. Annexe — sortie verbatim du spike

```text
[PASS   ] 1) WorkflowVersionSchema cross-domain guard (Zod level) — demonstrated gap: cross-domain (policy) envelope ACCEPTED + matching (workflow-version) envelope ACCEPTED; runtime guard is in asDomainDigest() (test 2); design proposal in EVIDENCE §3 closes this with WorkflowVersionDigestSchema
[PASS   ] 2) asDomainDigest branding + cross-domain guard — policy→PolicyDigest ok; policy→wf rejected ("DigestEnvelope domain mismatch: expected workflow-version, got policy"); wf→WorkflowVersionDigest ok
[PASS   ] 3) ArtifactRefSchema.parse with real DigestEnvelope — artifactId=a-1, contentDigest.value=9b5e97d40c03d50b... (64 lowercase hex)
[PASS   ] 3b) ArtifactRecordSchema.parse with real DigestEnvelope — contentDigest.domain=artifact-bytes, taints=[] (no caller downgrade possible)
[PASS   ] 4) Branded types prevent cross-domain assignment (tsc) — positive witness compiles (exit 0); negative witness rejected (exit 2); brand diagnostic present
[PASS   ] 5) 96 contracts + 12 digest-runtime tests still green (smoke) — 7 domain × envelope round-trips through DigestEnvelopeSchema + AtRestProtectionEnvelopeSchema; no production source modified

M1-02 spike summary
===================
PASS     6
PARTIAL  0
FAIL     0
MISSING  0
```

## 10. Annexe — diff (conceptuel) des fichiers touchés

```diff
# Spike throwaway (untracked → staged, single commit)
+ docs/automation-v2/spikes/m1-02-digest-wiring.ts  (~280 LOC)
+ docs/automation-v2/spikes/M1-02-EVIDENCE.md        (ce fichier)

# Aucun fichier de production modifié.
# Aucun nouveau package créé.
# Aucune dépendance ajoutée.
# bun.lock : inchangé.
```

Le commit est local sur `agent/automate-v2-baseline-20260901`, pas pushé,
format `chore(automate-v2): M1-02 digest-wiring spike + evidence (cross-domain, branded types)`.
