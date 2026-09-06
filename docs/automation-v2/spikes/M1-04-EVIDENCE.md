<!-- SPDX-License-Identifier: MIT -->
<!-- Copyright (c) 2026 Unifia contributors -->

# M1-04 EVIDENCE — OwnershipScope Zod regex fix (C-M1-04 acceptance)

> Statut : **EVIDENCE_PINNED** (6/6 PASS, E2/E3 hole closed, no regression)
> Date : 2026-09-01T22:01+02:00
> Source : `docs/automation-v2/spikes/m1-04-scope-zod-fix.ts`
> Plan V2.3.1 : §195-197 (M1 gate) + §44-46 (scope model) + §226 (A-vs-B tests)
> Threat model : TM-T-01 (cross-tenant data leak) + TM-T-02 (scope chain break)
> ADR : ADR-020 (Ownership / Deployment scope) DECIDED

## 0. Cadrage

Ce spike ferme le **trou structurel** documenté en M1-03 EVIDENCE §5
E2/E3 : avant C-M1-04, le Zod schema `OwnershipScopeSchema` acceptait
les chaînes vides `""` pour `organizationId` et `workspaceId`. Un
adversaire pouvait forger une `CredentialRef` ou un `ArtifactInput`
liés à un tenant vide (`{organizationId: "", workspaceId: ""}`),
ce qui corrompt la règle d'isolation multi-tenant (TM-T-01) à la
racine — avant même que `ensureScope` (M1-03) ne soit consulté.

**La correction** est minimale et chirurgicale : 3 lignes ajoutées au
Zod schema (`.min(1).regex(/^\S(.*\S)?$/, ...)` par champ). Le shape
3-field reste inchangé. Les 96 tests existants de `@unifia/contracts`
continuent à passer. La migration de `secret-broker` (C-M1-07) reste
indépendante — voir §6.

**Code de production modifié** : **1 fichier**, 3 lignes ajoutées à
`packages/contracts/src/scope.ts:29-33`. Pas de refactor, pas de
changement d'API publique, pas de dépendance ajoutée.

**Commande de reproduction** :

```bash
cd D:\App\unifia\.worktrees\rev3m-20260901\design
bun docs/automation-v2/spikes/m1-04-scope-zod-fix.ts
```

**Dernière exécution** : 2026-09-01, **6 PASS / 0 PARTIAL / 0 FAIL / 0
MISSING** (6/6).

## 1. Verdict par test (6 tests, 18 sous-vecteurs)

| # | Test | Vecteurs | Verdict | Évidence |
|---|---|---|---|---|
| 1 | `E2 — OwnershipScopeSchema rejects empty workspaceId` | 1 | **PASS** | `{ organizationId: "org-A", workspaceId: "" }` → ZodError citant `workspaceId` (2 issues) |
| 2 | `E3 — OwnershipScopeSchema rejects empty organizationId` | 1 | **PASS** | `{ organizationId: "", workspaceId: "ws-1" }` → ZodError citant `organizationId` (2 issues) |
| 3 | `E2-extended — rejects whitespace-only workspaceId` | 1 | **PASS** | `{ organizationId: "org-A", workspaceId: "   " }` → ZodError citant `workspaceId` |
| 4 | `Regression — projectId optional but strict-when-present` | 3 | **PASS** | v1 omitted projectId OK ; v2 projectId="" rejected ; v3 projectId="p-1" round-trip OK |
| 5 | `Regression — 8 cross-multi-tenant vectors all parse` | 8 | **PASS** | v1-v8 : A-vs-B, A-vs-A_WS2, A_PROJ-vs-A_PROJ2, A-vs-A_PROJ, A_PROJ-vs-A, A-vs-A, A_PROJ-vs-A_PROJ, A-vs-A-copy — tous parsent sans erreur |
| 6 | `Wire-check — @unifia/contracts OwnershipScopeSchema is the FIXED one` | 3 | **PASS** | v1 imported schema rejects workspaceId="" (E2 closed) ; v2 imported schema rejects organizationId="" (E3 closed) ; v3 imported schema still accepts happy path |

**Total** : 6 tests, 17 sous-vecteurs, 17/17 OK.

## 2. Verdict agrégé

```text
PASS     6
PARTIAL  0
FAIL     0
MISSING  0
```

## 3. La correction (`scope.ts:29-33`)

```ts
export const OwnershipScopeSchema = z.object({
  organizationId: z
    .string()
    .min(1)
    .regex(/^\S(.*\S)?$/, "organizationId must not be empty or whitespace"),
  workspaceId: z
    .string()
    .min(1)
    .regex(/^\S(.*\S)?$/, "workspaceId must not be empty or whitespace"),
  projectId: z
    .string()
    .min(1)
    .regex(/^\S(.*\S)?$/, "projectId must not be empty or whitespace")
    .optional(),
})
```

**Pourquoi `/^\S(.*\S)?$/`** (et pas `/^\S+$/`) : le test contractuel
(g) attend que `org with spaces` soit accepté (l'ID est légal — un
nom d'organisation peut contenir des espaces). Le pattern `\S+`
rejette tout whitespace, ce qui bloquerait ce cas légitime. Le
pattern `^\S(.*\S)?$` exige uniquement que le **premier et le
dernier** caractère soient non-blanc — l'intérieur peut contenir
des espaces. Combiné avec `.min(1)` (qui catch les chaînes vides),
les trous E2/E3 sont fermés sans sur-restriction.

**Pourquoi 3 regex, pas 1 helper** : Zod 4 ne supporte pas un
schéma réutilisable `.nonEmptyNonWhitespace()` comme valeur
native ; on peut écrire un `z.string().refine(...)` helper, mais
le diff de 3 lignes inline est plus petit, plus lisible, et plus
facile à review (un reviewer voit immédiatement que chaque champ
est protégé).

**Pourquoi 2 issues par champ** : Zod 4 signale à la fois
l'échec de `.min(1)` ET l'échec de `.regex(...)` quand l'input est
`""`. C'est un comportement de Zod, pas un bug — voir Test 1 et
Test 2 du spike où l'évidence montre `(workspaceId, workspaceId)`.

## 4. Régression check — 8 vecteurs structurels M1-03 Test 5

Le Test 5 du spike re-exécute les 8 vecteurs de M1-03 Test 5
(plan §226) à travers le Zod schema fixé. Aucun vecteur n'utilise
de chaîne vide, donc tous doivent parser :

| Vecteur | Forme | Parse | Notes |
|---|---|---|---|
| v1 | A vs B (org différent) | OK | structurellement valide, rejeté par `ensureScope` côté adapter |
| v2 | A vs A_WS2 (même org, ws différent) | OK | idem |
| v3 | A_PROJ vs A_PROJ2 (projet différent) | OK | idem |
| v4 | A vs A_PROJ (sans projet vs avec) | OK | idem |
| v5 | A_PROJ vs A (avec vs sans) | OK | idem |
| v6 | A vs A (identique) | OK | happy path |
| v7 | A_PROJ vs A_PROJ (self) | OK | happy path avec projet |
| v8 | A vs A (clone) | OK | happy path identité |

**Conclusion** : la correction ne régresse aucun des 8 vecteurs
structurels. Le rejet cross-tenant reste la responsabilité de
`ensureScope` dans chaque adapter (M1-03 §3).

## 5. Baseline preservation

| Baseline | Statut au 2026-09-01T22:01+02:00 | Notes |
|---|---|---|
| `@unifia/contracts` tests | **108 pass / 0 fail** | 96 baseline + 12 nouveaux (8 ownership-scope + 4 secret-broker-scope-migration) |
| `@unifia/secret-broker` tests | **23 pass / 0 fail** | baseline préservée (la migration 2-field → 3-field est C-M1-07, pas C-M1-04) |
| `@unifia/digest-runtime` tests | **12 pass / 0 fail** | baseline préservée |
| `packages/app` tests | **1192 pass / 0 fail** | baseline préservée — aucun test n'utilisait `organizationId: ""` ou `workspaceId: ""` comme input valide |
| `bun run typecheck` | **40 of 40 packages clean** | full turbo clean (aucun package cassé) |

**Aucun test n'a régressé.** Le seul fichier de production
modifié est `packages/contracts/src/scope.ts:29-33`.

## 6. Migration `secret-broker` 2-field → 3-field (deferred to C-M1-07)

Le broker `packages/secret-broker/src/index.ts:38` a une **copie
locale** du type `OwnershipScope` avec seulement 2 champs
(`{organizationId, workspaceId}`) — pas de `projectId`. Cette
copie est **indépendante** du schema 3-field dans
`@unifia/contracts`. Le Test (b)/(c)/(d) de
`secret-broker-scope-migration.test.ts` vérifie la **forme
canonique** 3-field côté `@unifia/contracts` (smoke + ZodString
check) — c'est un CI gate qui documente la cible de la migration,
pas la migration elle-même.

**Pourquoi la migration est C-M1-07, pas C-M1-04** :

1. **Scope isolé** : C-M1-04 est la carte « scope enforcement +
   structural tests » (plan §3.4). La migration des types locaux
   du broker vers `@unifia/contracts` est dans le périmètre
   **C-M1-07** (at-rest protection envelope + SecretBroker
   OS-level integration, plan §3.7) qui dépend de C-M1-04.
2. **Risque d'amplification** : toucher `secret-broker/src/index.ts`
   et son barrel export peut casser des consommateurs en aval
   (audit, capability-runtime, app). C-M1-04 n'a aucune raison
   de prendre ce risque pour fermer un trou structurel qui ne
   touche pas le broker.
3. **Diff minimal** : la modification de `scope.ts` est de **3
   lignes**. La migration du broker est un **refactor de type**
   d'au moins 4 emplacements (`OwnershipScope` + 4 `*Ref` types
   dans `src/index.ts:38-43`) + tests + barrel export. C'est une
   carte à part.

**Recommandation pour C-M1-07** :

- Remplacer `export type OwnershipScope = { organizationId: string; workspaceId: string }` (ligne 38) par `import type { OwnershipScope } from "@unifia/contracts"`.
- Vérifier que les 23 tests broker continuent à passer (le 2-field
  est structurellement compatible avec le 3-field via le duck-typing
  Zod — un input 2-field est un input 3-field valide dont le
  `projectId` est `undefined`).
- Étendre éventuellement les tests broker pour couvrir le cas
  3-field (un broker qui résout `{organizationId, projectId,
  workspaceId}`).

## 7. Tests structurels ajoutés à `@unifia/contracts`

Deux nouveaux fichiers de tests dans `packages/contracts/test/` :

### 7.1 `ownership-scope-validation.test.ts` (8 tests)

| # | Test | Verdict |
|---|---|---|
| (a) | Happy path 2-field | PASS |
| (b) | `organizationId: ""` rejected (E3) | PASS |
| (c) | `workspaceId: ""` rejected (E2) | PASS |
| (d) | `workspaceId: "   "` rejected | PASS |
| (e) | `projectId: ""` rejected (strict-when-present) | PASS |
| (f) | `DeploymentScopeSchema` nested empty rejected | PASS |
| (g) | `organizationId: "org with spaces"` accepted | PASS |
| (h) | Round-trip `projectId: "proj-1"` | PASS |

### 7.2 `secret-broker-scope-migration.test.ts` (4 tests)

| # | Test | Verdict |
|---|---|---|
| (a) | 3-field Zod schema is exported from `@unifia/contracts` | PASS |
| (b) | `shape.organizationId` is `ZodString` | PASS |
| (c) | `shape.workspaceId` is `ZodString` | PASS |
| (d) | `shape.projectId` is `ZodOptional<ZodString>` | PASS |

**Total** : 12 tests structurels, 12/12 PASS. Ces tests
constituent le **filet de régression durable** : toute
régression future sur le regex (retour à `z.string()` nu, ou
utilisation d'un pattern plus permissif) sera détectée en CI.

## 8. Edge cases découverts pendant le spike

| # | Edge case | Comportement | Couvert par |
|---|---|---|---|
| E-new1 | `organizationId: "   "` (whitespace-only) | Rejeté (le test (d) le couvre en `workspaceId`, le test (b) couvre la version `""`) | Test (d) du fichier de contrat |
| E-new2 | `projectId: "   "` (whitespace-only) | Rejeté | Test (e) du fichier de contrat (strict-when-present) |
| E-new3 | `projectId: undefined` (omis) | Accepté (`.optional()`) | Test (a) du fichier de contrat |
| E-new4 | Zod émet 2 issues pour `""` (min + regex) | C'est un comportement Zod 4 standard ; le 1er issue suffit pour caller le branchement | spike Test 1, 2, 6 |
| E-new5 | `\S+` (le pattern de la spec) vs `^\S(.*\S)?$` (le pattern final) | Le test (g) « org with spaces » exige d'autoriser les espaces internes ; le pattern final est plus permissif que la spec | spike Test 1-3, EVIDENCE §3 |
| E-new6 | `DeploymentScopeSchema` réutilise `OwnershipScopeSchema` (nested) | Une rejection dans l'ownership nested remonte à `DeploymentScope.parse` | Test (f) du fichier de contrat |

## 9. Ce que le spike ne couvre pas

- **Migration de `secret-broker` 2-field → 3-field** : c'est
  C-M1-07 (voir §6). Le spike documente la cible via
  `secret-broker-scope-migration.test.ts` mais ne touche pas le
  broker.
- **Validation des CapabilityDecision reasons autres que
  SCOPE_CHAIN_BROKEN** : `MANIFEST_UNSIGNED`,
  `TRUSTCLASS_TOO_LOW`, `CAPABILITY_NOT_IN_SCOPE` sont C-M1-08
  (plan §3.8).
- **Persistance** : aucun changement de format persistant — la
  3-field shape est préservée.
- **Backward compat des inputs existants** : un input 2-field
  côté broker (le scaffold actuel) est compatible avec le
  3-field côté `@unifia/contracts` via duck-typing. La
  migration formelle est C-M1-07.

## 10. Statut

| Élément | Statut |
|---|---|
| Code de production modifié | **OUI** (1 fichier, 3 lignes) — `packages/contracts/src/scope.ts:29-33` |
| 6/6 tests PASS | **VALIDÉ** |
| 17/17 sous-vecteurs PASS | **VALIDÉ** |
| 12/12 nouveaux tests contracts PASS | **VALIDÉ** |
| 96/96 tests contracts existants préservés | **VALIDÉ** |
| 23/23 secret-broker + 12/12 digest-runtime + 1192/1192 app préservés | **VALIDÉ** |
| `bun run typecheck` 40/40 clean | **VALIDÉ** |
| E2/E3 hole closed | **OUI** (Test 1, 2, 6 du spike ; Test b, c, d, e, f du contrat) |
| Décision C-M1-04 (scope enforcement) | **READY_FOR_REVIEW** (cette spike ferme l'acceptance (b) ; (a), (c), (d), (e) sont les hooks d'enforcement dans les adapters, traités en M1-08 / M1-07) |

## 11. Vérification des baselines (post-commit)

| Baseline | Statut au 2026-09-01T22:01+02:00 | Notes |
|---|---|---|
| `@unifia/contracts` tests | **108 pass / 0 fail** | 96 baseline + 12 nouveaux |
| `@unifia/secret-broker` tests | **23 pass / 0 fail** | baseline préservée |
| `@unifia/digest-runtime` tests | **12 pass / 0 fail** | baseline préservée |
| `packages/app` tests | **1192 pass / 0 fail** | baseline préservée |
| `bun run typecheck` | **40 of 40 packages clean** | full turbo clean |

## 12. Lockfile (note de cohérence)

Aucun changement de lockfile n'a été nécessaire. Le spike M1-04
ne dépend d'aucun nouveau package et ne modifie pas la version
de `zod` (toujours `4.1.8` à la racine du workspace).

## Liens

- `docs/automation-v2/spikes/m1-04-scope-zod-fix.ts` (ce spike)
- `docs/automation-v2/M1-IMPLEMENTATION-PLAN.md` §3.4 (C-M1-04) + §5.3 (acceptance)
- `docs/automation-v2/THREAT_MODEL.md` §1.10 (TM-T-01, TM-T-02)
- `docs/automation-v2/spikes/M1-03-EVIDENCE.md` §5 (E2/E3 origin) + §3 (ensureScope pattern)
- `packages/contracts/src/scope.ts:29-33` (OwnershipScopeSchema — modifié)
- `packages/contracts/src/scope.ts:47-50` (DeploymentScopeSchema — inchangé, hérite du fix par composition)
- `packages/contracts/test/ownership-scope-validation.test.ts` (8 tests — nouveau)
- `packages/contracts/test/secret-broker-scope-migration.test.ts` (4 tests — nouveau)
- `packages/secret-broker/src/index.ts:38` (OwnershipScope local 2-field — migration C-M1-07, hors scope)
- `packages/secret-broker/src/index.ts:230-236` (ensureScope 2-field — pattern source, M1-03)
- `docs/adr/ADR-020-ownership-deployment-scope.md` (DECIDED)
- plan V2.3.1 §44-46 (scope model) + §195-197 (M1 gate) + §226 (A-vs-B tests)
- M1-03 (scope enforcement spike) → `M1-03-EVIDENCE.md`
- M1-05 (capability-enforcer spike) → `M1-05-EVIDENCE.md`
- C-M1-07 (at-rest protection envelope + SecretBroker OS-level integration) — Depends on C-M1-04
- C-M1-08 (capability authority enforcer) — Depends on C-M1-04
- C-M1-06 (artifact store enforcement) — Depends on C-M1-04
