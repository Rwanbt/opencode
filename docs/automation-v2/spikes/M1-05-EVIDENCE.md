<!-- SPDX-License-Identifier: MIT -->
<!-- Copyright (c) 2026 Unifia contributors -->

# M1-05 EVIDENCE — Capability Authority enforcer spike (C-AR-01, ADR-002 + ADR-020)

> Statut : **EVIDENCE_PINNED** (enforcer design validated, production lift = C-M1-08)
> Date : 2026-09-01T17:48+02:00
> Source : `docs/automation-v2/spikes/m1-05-capability-enforcer.ts`

## 0. Cadrage

Ce spike ferme le **seul trou crypto/enforcement** identifié par la
multi-review (C-AR-01, Medium) en proposant la couche **enforcer**
qui transforme le `capability-runtime` actuel (vérificateur seul,
M0-06) en **autorité exécutive** (plan §114, §195).

**Code de production modifié** : aucun. Le spike est jetable. La
production vit dans `packages/capability-runtime/src/enforcer.ts`
(C-M1-08, hors scope de cette session).

**Commande de reproduction** :

```bash
cd D:\App\unifia\.worktrees\rev3m-20260901\design
bun docs/automation-v2/spikes/m1-05-capability-enforcer.ts
```

**Dernière exécution** : 2026-09-01, **5 PASS / 0 PARTIAL / 0 FAIL / 0 MISSING**
(distribution §5.5 exacte) + 1 bonus PASS + 1 production MISSING
référencé en `supplementary`, hors distribution.

## 1. Verdict par vecteur

| # | Vecteur | Verdict | Évidence |
|---|---|---|---|
| 1 | Happy path (signed, REVIEWED_EXTENSION, scope match) | **PASS** | `allow=true`, `grant.expiresAt > grantedAt`, `bindingDigest` = 64 hex chars |
| 2 | Manifest non signé → `MANIFEST_UNSIGNED` | **PASS** | `deny reason=MANIFEST_UNSIGNED`, detail `"manifest.signature is missing or empty"` |
| 3 | `UNTRUSTED_THIRD_PARTY` pour `network.request` (≥ REVIEWED_EXTENSION) → `TRUSTCLASS_TOO_LOW` | **PASS** | `deny reason=TRUSTCLASS_TOO_LOW`, detail `"requires >= REVIEWED_EXTENSION, got UNTRUSTED_THIRD_PARTY"` |
| 4 | Principal `org-evil` demande scope `org-acme` → `CAPABILITY_NOT_IN_SCOPE` (TM-T-01) | **PASS** | `deny reason=CAPABILITY_NOT_IN_SCOPE`, detail scope mismatch |
| 5 | `principalInB` (scopes[0]=scopeA) demande deploymentB (ownershipScope=scopeB) → `SCOPE_CHAIN_BROKEN` (TM-T-02) | **PASS** | `deny reason=SCOPE_CHAIN_BROKEN`, detail `"principal.scopes[0] is org-acme/proj-1/ws-alpha, requested deployment is org-acme/proj-1/ws-beta"` |
| 6 *(supplementary)* | `bindingDigest` varie avec `grantedAt` (replay protection) | **PASS** | 2 grants à t et t+1 → 2 digests différents |
| 7 *(supplementary)* | Production `@unifia/capability-runtime` exporte `enforce` | **MISSING** | verifier-only aujourd'hui (M0-06). Ce spike **définit** l'API production. Lift = C-M1-08. |

## 2. Verdict agrégé (§5.5 distribution)

```text
PASS     5
PARTIAL  0
FAIL     0
MISSING  0
```

**Verdict** : le design de l'enforcer tient. Les 5 chemins de refus
sont atteignables, le happy path minte un grant court-vivant avec
un `bindingDigest` qui varie avec `grantedAt` (protection anti-replay).

## 3. Pipeline d'enforcement — où s'insère l'enforcer

Plan §114 — pipeline cible, le spike ferme la case 2 :

```text
                     ADR-002                C-AR-01 (M1-05)         ADR-009
  ┌──────────┐    ┌──────────┐         ┌──────────────────┐    ┌──────────┐
  │WorkflowIR│ →  │ trusted  │ →       │ Capability       │ →  │ Policy   │ →  short-lived grant → executor
  │          │    │ manifest │         │ Authority        │    │          │
  └──────────┘    │ (signed) │         │ verify + enforce │    └──────────┘
                  └──────────┘         └──────────────────┘
                         ¹                  ² ▲                 ³
                                            │ │
                                            │ └─ refuse :
                                            │     • MANIFEST_UNSIGNED
                                            │     • TRUSTCLASS_TOO_LOW
                                            │     • CAPABILITY_NOT_IN_SCOPE
                                            │     • SCOPE_CHAIN_BROKEN
                                            │
                              M0-06 spike ▲ │     ▲ M1-05 spike
                              (verifier)   │     │   (enforcer)
                                           │     │
                                          déjà OK   nouveau (cette livraison)
```

L'enforcer est **strictement en aval** du vérificateur M0-06 :
- Vérificateur (M0-06) : « la signature Ed25519 du manifest est-elle valide ? »
- Enforcer (M1-05) : « le contenu du manifest, *une fois vérifié*, donne-t-il le droit d'exécuter ? »

Les 2 sont nécessaires : un manifest valide mais sans droit est *forbidden*, un manifest invalide est *forbidden* quelle que soit la légitimité du claim.

## 4. Design proposal — `enforce()` et `EnforcementResult`

### 4.1 Signature

```ts
enforce(
  principal: PrincipalIdentity,
  capability: string,
  requestedScope: DeploymentScope,
  trustClass: TrustClass,
  manifest: SignedManifest,
  options?: { now?: () => number; ttlMs?: number },
): EnforcementResult
```

| Param | Type | Source | Notes |
|---|---|---|---|
| `principal` | `PrincipalIdentity` | extension de `WorkerId` | Doit porter `scopes: readonly OwnershipScope[]` (cf. §5) |
| `capability` | `string` | P3 capability id | Doit être dans `CAPABILITY_MIN_TRUST` |
| `requestedScope` | `DeploymentScope` | contrat existant | `ownershipScope` + `environmentId` |
| `trustClass` | `TrustClass` (4 valeurs) | M0-06 + §6 | Doit être ≥ minimum de la capability |
| `manifest` | `SignedManifest` | runtime | `{ capability, trustClass, payload, signature? }` |

### 4.2 Forme du résultat

Forme spike (test contract, M1 plan §3.8) :

```ts
type EnforcementResult =
  | { allow: true; grant: Grant }
  | { allow: false; reason: DenialReason; detail?: string }
```

Forme production (proposée pour lift dans `@unifia/contracts/src/enforcement.ts`) :

```ts
// discriminatedUnion("kind", [GrantSchema, DenialSchema])
const EnforcementResultSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("grant"), grant: GrantSchema }),
  z.object({ kind: z.literal("deny"), reason: DenialReasonSchema, detail: z.string().optional() }),
])
```

Le lift est un **refactor cosmétique** : `allow: true` ↔ `kind: "grant"`,
`allow: false` ↔ `kind: "deny"`. Le `discriminatedUnion` permet aux
callers d'écrire un `switch (result.kind) { case "grant": ...; case "deny": ... }`
exhaustif, ce que TypeScript vérifie. C'est l'argument pour la
migration production.

### 4.3 Grant — contenu et sémantique

```ts
const GrantSchema = z.object({
  capability: z.string(),                       // ex. "network.request"
  scope: DeploymentScopeSchema,                 // ex. { org-acme / proj-1 / ws-alpha, prod }
  grantedAt: z.number().int().nonnegative(),   // ms epoch
  expiresAt: z.number().int().nonnegative(),   // ms epoch, grantedAt + 5 min
  bindingDigest: z.string(),                   // sha256(principal|capability|scope|grantedAt) hex 64
})
```

| Champ | Pourquoi |
|---|---|
| `capability` | la capability accordée (peut différer de `manifest.capability` après policy) |
| `scope` | le scope *précis* accordé — un grant n'est pas généralisable |
| `grantedAt` | horodatage, base du TTL |
| `expiresAt` | TTL = 5 min par défaut (plan §3.8 (f)), surchargeable via `options.ttlMs` |
| `bindingDigest` | SHA-256 sur `(workerId, capability, scope, grantedAt)` ; l'audit replay peut détecter un grant réutilisé hors de sa fenêtre |

### 4.4 Order of checks (plan §5.5)

```text
enforce(principal, capability, scope, trustClass, manifest)
  │
  ├─ 1. manifest.signature  ?  ── no ──▶  { allow: false, reason: MANIFEST_UNSIGNED }
  │
  ├─ 2. TRUST_RANK[trustClass] ≥ TRUST_RANK[CAPABILITY_MIN_TRUST[capability]]
  │     ?  ── no ──▶  { allow: false, reason: TRUSTCLASS_TOO_LOW }
  │
  ├─ 3. principal.capabilities ⊇ {capability}
  │     AND principal.scopes ⊇ requestedScope.ownershipScope
  │     ?  ── no ──▶  { allow: false, reason: CAPABILITY_NOT_IN_SCOPE }  ← TM-T-01
  │
  ├─ 4. principal.scopes[0] === requestedScope.ownershipScope
  │     ?  ── no ──▶  { allow: false, reason: SCOPE_CHAIN_BROKEN }  ← TM-T-02
  │
  └─ 5. mint grant { capability, scope, grantedAt, expiresAt, bindingDigest }
         return { allow: true, grant }
```

**Justification de l'ordre** :

1. **Manifest signé d'abord** — c'est l'invariant de **provenance** (ADR-002) : sans signature, on ne peut rien dire de sensé.
2. **TrustClass d'abord** (avant la capability) — un `UNTRUSTED_RUNTIME` qui prétend avoir `secret.read` doit être refusé *avant* de chercher la capability, parce que c'est une claim absurde. Si on inversait, un attaquant qui présenterait un `principal.capabilities` truqué gagnerait du CPU et masquerait l'attaque sous un `CAPABILITY_NOT_IN_SCOPE`.
3. **Capability en scope** — c'est l'autorisation de la part du runtime (TM-T-01). Le principal doit (a) détenir la capability, (b) la détenir *dans le scope demandé*.
4. **Scope chain** — c'est l'invariant structurel de ADR-020 (TM-T-02). Le scope *primaire* du principal doit être l'ownership du deployment.
5. **Grant** — la sortie, auditable, court-vivante, liée.

## 5. Trou dans `WorkerId` — finding pour C-M1-08

Le `WorkerIdSchema` actuel (`packages/contracts/src/identity.ts:21-36`)
porte `capabilities: readonly string[]` mais **PAS** `scopes`. Or
l'enforcer a besoin de savoir dans quels workspaces le worker est
autorisé à opérer.

**Recommandation** : ajouter à `WorkerIdSchema` un champ

```ts
scopes: z.array(OwnershipScopeSchema).readonly()
```

où `scopes[0]` est le **primary scope** (le « home » workspace) et
les entrées suivantes sont des délégations explicites. Ce champ
est signé par `identityProof` (déjà présent), donc l'autorité qui
a émis la `WorkerId` (control plane) est responsable de l'audit des
délégations.

**Alternative rejetée** : dériver `scopes` depuis `capabilities`
(`capability.scope`). Rejeté parce que (1) ça couple 2 dimensions
indépendantes (quoi vs. où), (2) ça empêche l'énumération simple
des workspaces autorisés sans connaître toutes les capabilities, (3)
ça complique l'ADR-008 (TrustClass in WorkerId) qui ne parle que
d'identité, pas d'autorisation.

## 6. TrustClass — énumération et matrice de capabilities

### 6.1 Les 4 niveaux

| Rang | Niveau | Qui ? | Isolation substrat (substrat-dépendant) |
|---|---|---|---|
| 3 | `CORE` | compilé dans le binaire runtime, signé par la build officielle | native process (audit ADR-000) |
| 2 | `REVIEWED_EXTENSION` | marketplace avec code review humain + signature éditeur | WASM sandbox ou container léger |
| 1 | `UNTRUSTED_THIRD_PARTY` | extension téléchargée sans review approfondi | container + seccomp |
| 0 | `UNTRUSTED_RUNTIME` | expression collée par l'utilisateur (YAML, JS, etc.) | gVisor / Firecracker |

Le rang numérique (3, 2, 1, 0) n'est pas exposé ; il sert seulement
à la comparaison interne `TRUST_RANK[trustClass] >= TRUST_RANK[min]`.

### 6.2 Matrice capabilities × trust (6 capabilities représentatives sur 20 P3)

| Capability | Min trust | Justification | Réf. ADR / plan |
|---|---|---|---|
| `workflow.run` | `REVIEWED_EXTENSION` | auto-trigger, modéré, schedulable | §114, ADR-002 |
| `network.request` | `REVIEWED_EXTENSION` | SSRF ; M0-05 spike montre que l'algorithme IP-classification requiert un code revu | §108-113, ADR-023 |
| `secret.read` | `CORE` | accès à des credentials OS-level (DPAPI/Keychain/libsecret) | §80, ADR-010 |
| `terminal.run` | `CORE` | exécution shell arbitraire | ADR-019 |
| `package.install` | `CORE` | modifie le supply chain du runtime | C-AR-02 (Medium) |
| `desktop.control` | `CORE` | input injection, mouse/keyboard | ADR-014 |

Les 14 autres P3_CAPABILITIES héritent du même mapping par
extrapolation (capacités de lecture = `REVIEWED_EXTENSION`,
capacités d'écriture/destructive = `CORE`).

### 6.3 Visualisation 4 × 6

```text
                            workflow.run   network.request   secret.read   terminal.run   package.install   desktop.control
                            ────────────   ───────────────   ───────────   ────────────   ───────────────   ───────────────
CORE                  (3)        ✓               ✓               ✓              ✓               ✓                  ✓
REVIEWED_EXTENSION    (2)        ✓               ✓               ✗              ✗               ✗                  ✗
UNTRUSTED_THIRD_PARTY (1)        ✗               ✗               ✗              ✗               ✗                  ✗
UNTRUSTED_RUNTIME     (0)        ✗               ✗               ✗              ✗               ✗                  ✗
```

Une capability requise par un trust inférieur à son minimum → `TRUSTCLASS_TOO_LOW` (chemin 2 de l'enforcer).

## 7. Edge cases identifiés (à couvrir en production, hors scope M1-05 spike)

| # | Cas | Comportement spike | Comportement production attendu |
|---|---|---|---|
| E1 | **Grant expiré** | pas testé (le spike teste le `mint`, pas la consommation) | Le runtime doit rejeter un grant dont `expiresAt < now()`. Le contrat `Grant` est *purement déclaratif* ; la consommation est du ressort de l'executor. |
| E2 | **Délégation transitive** | pas testé | Le contrat `scopes: readonly OwnershipScope[]` permet à un principal d'opérer dans N workspaces. La *transitivité* (A délègue à B qui délègue à C) **n'est pas dans le scope du spike** ; à traiter dans une ADR séparée si besoin. |
| E3 | **Héritage de capabilities par workspace** | pas testé | Une capability peut être *workspace-wide* (déclarée sur le workspace parent) ou *node-only*. À formaliser dans une future carte. |
| E4 | **Clock skew** | spike avec clock injectable | Production : utiliser un *monotonic clock* (`performance.now()` côté grant, `Date.now()` côté audit) avec une fenêtre de tolérance (typiquement 30 s). |
| E5 | **Rejeu d'un grant expiré** | spike ne teste pas la consommation | Le `bindingDigest` rend un grant inutilisable hors de sa fenêtre car le `grantedAt` est dans le hash ; l'executor doit rejeter `bindingDigest` ≠ hash recomputed. |
| E6 | **Multi-tenancy inter-organisation** | testé via test 4 (principal `org-evil` vs `org-acme`) | OK. La règle `principal.scopes ⊇ requestedScope.ownershipScope` couvre l'isolation. |
| E7 | **Revocation mid-grant** | pas testé | Le `Grant` est immutable ; la révocation est portée par la capability source (déjà dans `CapabilityRegistry.revoke`). L'executor vérifie le grant **et** le state de la capability source. |

Ces 7 cas sont **informatifs** ; ils ne bloquent pas le spike. Le
contrat `EnforcementResult` du spike est suffisant pour que la
production les traite sans changement de forme.

## 8. Pourquoi cette carte est difficile à inverser (note de risque)

`M1-IMPLEMENTATION-PLAN.md` §7.3 :

> cette carte est **difficile à inverser** une fois qu'on a commencé
> à dépendre de l'enforcer.

Ce que ce spike prouve :

1. **L'API `enforce(...)` est stable et complète** (5 vecteurs, 4 deny reasons, 1 grant shape). Le coût d'inversion est nul tant qu'on n'a pas appelé la fonction en production.
2. **Le contrat `EnforcementResult` est liftable** dans `@unifia/contracts` en une seule PR d'une trentaine de lignes (cf. §4.2).
3. **Le `WorkerIdSchema` doit gagner un champ `scopes`** (§5). C'est le **seul vrai risque d'inversion** : si on commence à passer `PrincipalIdentity` (extension) à d'autres adapters, revenir en arrière forcera un refactor. Recommandation : lander la PR `WorkerIdSchema.scopes` *avant* que l'enforcer soit consommé par autre chose que les tests.

## 9. Statut

| Élément | Statut |
|---|---|
| Code de production modifié | **NON** |
| Spikes M0-01..06 cumulés | **DONE** (4/2/1/7, 8/1, 8/3/2, 8/8, 6/2, 6/0/1) |
| M1-05 spike (enforcer design) | **DONE** (5/0/0/0) |
| M1-05 lift en production | **M1-08**, après ce spike |
| WorkerIdSchema.scopes (finding) | **TODO**, à intégrer en M1-08 ou dans la carte contracts M1 |
| Décision ADR-002 | **DÉJÀ RENDUE** (DECIDED) |
| Décision ADR-020 | **DÉJÀ RENDUE** (DECIDED) |

## 10. Suite immédiate

1. **Review** : le owner de C-M1-08 (worker en M1) lit ce spike + l'evidence.
2. **Lift** : créer `packages/capability-runtime/src/enforcer.ts` à partir de ce spike (lift du `enforce()`, du `TrustClassSchema`, du `DenialReasonSchema`, du `GrantSchema`, et de la matrice `CAPABILITY_MIN_TRUST`).
3. **Add `scopes` to `WorkerIdSchema`** : PR de ~10 lignes dans `packages/contracts/src/identity.ts` + tests dans `packages/contracts/test/`.
4. **Wire `createSecureCapabilityRegistry` à `enforce`** : le registry devient l'**unique entrée** de vérification (TM-CP-01). Refactor structurel — tous les autres chemins (`signCapabilityManifest`, `Ed25519ManifestVerifier` direct) sont dépréciés.
5. **Add `enforcer.test.ts`** : 6 vecteurs du plan §3.8 (les 5 du spike + un test TTL/bindingDigest).

## Liens

- `docs/automation-v2/spikes/m1-05-capability-enforcer.ts`
- `docs/automation-v2/spikes/m0-06-capability-enforcement.ts` (le spike amont, 6 PASS / 1 MISSING)
- `docs/automation-v2/spikes/M0-06-EVIDENCE.md`
- `docs/automation-v2/M1-IMPLEMENTATION-PLAN.md` §3.8 (C-M1-08) + §5.5 (ce spike)
- `docs/automation-v2/MULTI_REVIEW.md` (C-AR-01, Medium)
- `docs/automation-v2/THREAT_MODEL.md` (TM-T-01, TM-T-02, TM-CP-01)
- `docs/adr/ADR-002-workflow-definition-version-ir.md` (DECIDED)
- `docs/adr/ADR-020-scope.md` (DECIDED, OwnershipScope / DeploymentScope)
- `packages/contracts/src/scope.ts` (OwnershipScope, DeploymentScope — déjà livré)
- `packages/contracts/src/identity.ts` (WorkerId — incomplet : pas de `scopes`, finding §5)
- `packages/contracts/src/capability-registry.ts` (vérificateur M0-06, à étendre en enforcer)
- `packages/capability-runtime/src/index.ts` (Ed25519ManifestVerifier + helpers, à étendre)
- `docs/automation-v2/spikes/M0-01..05-EVIDENCE.md` (5 spikes amont)
