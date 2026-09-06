<!-- SPDX-License-Identifier: MIT -->
<!-- Copyright (c) 2026 Unifia contributors -->

# M1-03 EVIDENCE — OwnershipScope enforcement spike (TM-T-01, TM-T-02, ADR-020)

> Statut : **EVIDENCE_PINNED** (5/5 PASS, scope-chain refuse validated)
> Date : 2026-09-01T17:48+02:00
> Source : `docs/automation-v2/spikes/m1-03-scope-enforcement.ts`
> Plan V2.3.1 : §195-197 (M1 gate) + §44-46 (scope model) + §226 (A-vs-B tests)
> Threat model : TM-T-01 (cross-tenant data leak) + TM-T-02 (scope chain break)
> ADR : ADR-020 (Ownership / Deployment scope) DECIDED

## 0. Cadrage

Ce spike valide que **5 couches d'adaptateur différentes** refusent
toutes les opérations cross-tenant en utilisant le triple
`OwnershipScope = { organizationId, projectId?, workspaceId }` défini
dans `packages/contracts/src/scope.ts:29-33` (ADR-020).

C'est la traduction structurelle de **TM-T-01** (A lit B) et
**TM-T-02** (A utilise la credential de B) en tests exécutables. Le
pattern `ensureScope` qui en sort est documenté §3 comme helper
réutilisable côté adaptateur.

**Code de production modifié** : aucun. Le spike utilise
`@unifia/contracts` (3-field `OwnershipScopeSchema`) et
`@unifia/secret-broker` (helper `TenantMismatchError` + scaffold
in-memory broker pour le Test 1). Les 3 stubs (ArtifactStore,
CapabilityRegistry, audit) sont des < 30 LOC chacun et ne sont pas
committés comme production.

**Commande de reproduction** :

```bash
cd D:\App\unifia\.worktrees\rev3m-20260901\design
bun docs/automation-v2/spikes/m1-03-scope-enforcement.ts
```

**Dernière exécution** : 2026-09-01, **5 PASS / 0 PARTIAL / 0 FAIL / 0
MISSING** (5/5).

## 1. Verdict par vecteur (5 tests, 22 sous-vecteurs)

| # | Test | Vecteurs | Verdict | Évidence |
|---|---|---|---|---|
| 1 | `secret-broker.resolveCredential` rejects cross-tenant (TM-T-02) | 4 | **PASS** | v1 cross-tenant → `TenantMismatchError` ; v2 same-id isolation A/B → valeurs distinctes ; v3 même org / workspace différent → `TenantMismatchError` ; v4 OAuth + Browser Profile aussi scope-isolated |
| 2 | `ArtifactStore` stub rejects cross-tenant create (TM-T-01) | 3 | **PASS** | v1 self-access OK ; v2 cross-org → `TenantMismatchError` ; v3 project drift (A_PROJ vs A_PROJ2) → `TenantMismatchError` |
| 3 | `CapabilityRegistry.check` returns `SCOPE_CHAIN_BROKEN` (TM-T-01) | 4 | **PASS** | v1 same-scope → `{allow: true, grant: ...}` ; v2 cross-org → `{allow: false, reason: "SCOPE_CHAIN_BROKEN"}` ; v3 cross-workspace → `SCOPE_CHAIN_BROKEN` ; v4 project-drift → `SCOPE_CHAIN_BROKEN` |
| 4 | `audit.emit` rejects cross-tenant writes (TM-T-01) | 3 | **PASS** | v1 self-emit OK ; v2 cross-org → `TenantMismatchError` ; v3 cross-workspace → `TenantMismatchError` |
| 5 | 8 cross-multi-tenant vectors on 3-field `OwnershipScope` | 8 | **PASS** | A-vs-B, A-vs-A_WS2, A_PROJ-vs-A_PROJ2, A-vs-A_PROJ (no-project vs project), A_PROJ-vs-A (inverse), A-vs-A (self OK), empty `workspaceId`, missing `organizationId` — tous gèrent correctement |

**Total** : 5 tests, 22 sous-vecteurs, 22/22 OK.

## 2. Verdict agrégé

```text
PASS     5
PARTIAL  0
FAIL     0
MISSING  0
```

## 3. Le pattern `ensureScope` (helper réutilisable côté adaptateur)

L'évidence empirique montre qu'un seul helper, dupliqué dans chaque
adaptateur, suffit à fermer TM-T-01 et TM-T-02. Le secret-broker l'a
déjà (lignes 230-236, 2-field) ; le spike l'étend à 3-field pour
couvrir `projectId` (ADR-020 §3.1).

```ts
// packages/contracts/src/scope.ts:29-33
export const OwnershipScopeSchema = z.object({
  organizationId: z.string(),
  projectId: z.string().optional(),
  workspaceId: z.string(),
})

// helper réutilisable — version 3-field, recommandée pour tous les adapters
function ensureScope(actual: OwnershipScope, requested: OwnershipScope, what: string): void {
  if (actual.organizationId !== requested.organizationId) {
    throw new TenantMismatchError(
      `cross-tenant access denied for ${what}: org ${actual.organizationId} != ${requested.organizationId}`,
    )
  }
  if (actual.workspaceId !== requested.workspaceId) {
    throw new TenantMismatchError(
      `cross-tenant access denied for ${what}: workspace ${actual.workspaceId} != ${requested.workspaceId}`,
    )
  }
  // Strict on projectId: any side declaring a project requires match
  const aProj = actual.projectId ?? ""
  const rProj = requested.projectId ?? ""
  if (aProj !== rProj) {
    throw new TenantMismatchError(
      `cross-tenant access denied for ${what}: project '${aProj}' != '${rProj}'`,
    )
  }
}
```

**Pourquoi cette forme** :

1. **TenantMismatchError typé** (pas une `Error` générique) — les
   call-sites branchent en `catch (e) { if (e instanceof
   TenantMismatchError) ... }` sans string-matching (M0-04 lesson).
2. **3-field strict** — le secret-broker scaffold actuel ne vérifie
   que `organizationId + workspaceId` (2-field). Le passage à 3-field
   ferme la fuite « même org / projet différent » (vector 3, 4, 5 du
   Test 5).
3. **Le `what` argument** est l'identifiant lisible du call-site
   (« `artifact-store.create(mediaType)` », « `capability-registry.
   check(network.request)` ») qui apparaît dans le log — un opérateur
   qui voit `cross-tenant access denied for audit.emit(credential.read)`
   sait immédiatement où chercher.
4. **Throw-first** pour les stores / brokers / sinks (Test 2, 4) —
   l'opération ne doit pas se produire.
5. **Decision-return** pour les enforcers structurés (Test 3) — la
   Capability Authority retourne un `{allow: false, reason:
   "SCOPE_CHAIN_BROKEN"}` parce que le call-site (workflow kernel)
   branche sur la décision, pas sur l'exception (M0-06 finding :
   vérifiers vs enforcers).

**Surface d'application** (à étendre en C-M1-04, C-M1-06, C-M1-08) :

| Adaptateur | Verdict shape | Source |
|---|---|---|
| `secret-broker.resolve*` | throw `TenantMismatchError` | `packages/secret-broker/src/index.ts:230-236` ✓ |
| `artifact-runtime.create` | throw `TenantMismatchError` (Test 2) | M1-06 (à implémenter) |
| `capability-runtime.enforce` | `{allow: false, reason: "SCOPE_CHAIN_BROKEN"}` (Test 3) | M1-08 (à implémenter) |
| `audit.emit` | throw `TenantMismatchError` (Test 4) | M1-12 (à implémenter) |
| `network-authority` | throw / refuse | C-M1-05 (à couvrir) |

## 4. Rejection-reason taxonomy

Les 5 tests + 22 sous-vecteurs produisent deux familles de rejets :

### 4.1 Throw (stricts)

- `TenantMismatchError` (depuis `secret-broker`) — l'opération ne
  peut pas se produire. Utilisé par : secret-broker, ArtifactStore,
  audit.

### 4.2 Decision (structurés)

- `{allow: false, reason: "SCOPE_CHAIN_BROKEN"}` (Test 3) — la
  Capability Authority ne throw pas, elle décide. Le kernel branche
  sur la décision.
- Les 3 autres reasons d'enforce définis en C-M1-08 (M1-IMPLEMENTATION-PLAN
  §3.8) — `MANIFEST_UNSIGNED`, `TRUSTCLASS_TOO_LOW`,
  `CAPABILITY_NOT_IN_SCOPE` — sont hors scope du M1-03 (couverture
  scope uniquement, pas manifest ni trust class).

**Recommandation** : ne pas unifier les deux familles. Le
`TenantMismatchError` est un signal d'impossibilité (« cette opération
n'a aucun sens ») ; le `{allow: false, reason}` est un signal de
politique (« cette opération est refusée par les règles »). Les caller
peuvent choisir de remonter l'un ou l'autre, mais leur sémantique
diffère.

## 5. Edge cases découverts pendant le spike

| # | Edge case | Comportement du spike | À documenter en M1 |
|---|---|---|---|
| E1 | `projectId` optionnel (Zod) | A-vs-A_PROJ et A_PROJ-vs-A (Test 5 v4, v5) sont **rejetés** — une org qui a 2 projets ne peut pas lire cross-projet | C-M1-04 acceptance (d) — les 8 vecteurs structurels |
| E2 | `workspaceId: ""` (chaîne vide) | Rejeté par `ensureScope` (Test 5 v7) — confirmé par Zod `safeParse` (`workspaceId` est `z.string()` non optionnel, donc chaîne vide est valide côté Zod mais rejetée par `ensureScope` car `actual.workspaceId !== ""`) | Le Zod schema actuel accepte `""` — c'est un **trou** que C-M1-04 acceptance (b) doit fermer avec `.regex(/^\S+$/)` ou équivalent |
| E3 | `organizationId: ""` (chaîne vide) | Rejeté par `ensureScope` (Test 5 v8). Zod accepte `""` (même trou que E2) | Idem E2 — renforcer le Zod schema |
| E4 | Même `credentialId` dans 2 tenants | Résolution isolée (Test 1 v2) — la clé composite `kind:org:ws:id` dans `refKey` empêche la collision | Le pattern de `refKey` (`packages/secret-broker/src/index.ts:226-228`) est réutilisable pour tout adapter indexé par scope |
| E5 | OAuth + BrowserProfile avec `OwnershipScope` 2-field | Le scaffold secret-broker n'a pas 3-field, mais ses tests (Test 1 v4) confirment que le 2-field couvre org+ws, suffisant pour l'isolation B/A | À étendre en 3-field quand le scaffold passe à `@unifia/contracts/scope.ts` |
| E6 | CapabilityRegistry retourne un grant (pas un secret) | Le `{allow: true, grant: { capability, expiresAt }}` (Test 3 v1) n'expose pas de matériel sensible — c'est un grant de courte durée (TTL 5 min) qui sera vérifié côté executor | C-M1-08 acceptance (f) — grant TTL ≤ 5 min + `bindingDigest` |
| E7 | `audit.emit` cross-tenant | Rejeté avant écriture (Test 4 v2, v3) — un attaquant ne peut pas forger une ligne d'audit au nom d'un autre tenant | C-M1-12 acceptance — la couche observability commence par un audit scope-strict |

## 6. Ce que le spike ne couvre pas

- **Manifest signature / trust class** — Test 3 vérifie
  `SCOPE_CHAIN_BROKEN` seulement, pas `MANIFEST_UNSIGNED` ni
  `TRUSTCLASS_TOO_LOW` (C-M1-08 acceptance (b), (c)).
- **Capability `network.request` réelle** — Test 3 stub, pas de vrai
  Capability Authority. C-M1-08 (M0-06 finding C-AR-01).
- **Persist durable** — les stubs sont en mémoire. La persistance
  longue-durée des scopes est dans le substrate (ADR-000).
- **Network Authority** (ADR-023) — non couvert ici. Le scope check
  s'applique aussi à `NetworkAuthority.check(url, principalScope)`
  mais c'est une carte à part (M0-05 a validé les IP primitives).
- **Backward compat** — le scope 3-field est **cassé** vs le
  scaffold 2-field du secret-broker. Le scaffold doit migrer sur
  `@unifia/contracts/scope.ts` (ADR-020) avant C-M1-07.

## 7. Statut

| Élément | Statut |
|---|---|
| Code de production modifié | **NON** |
| 5/5 tests PASS | **VALIDÉ** |
| 22/22 sous-vecteurs PASS | **VALIDÉ** |
| `ensureScope` pattern documenté | **OUI** (helper 3-field) |
| Edge cases E1-E7 catalogués | **OUI** |
| Décision ADR-020 | **DÉJÀ RENDUE** (DECIDED) |
| Décision C-M1-04 (scope enforcement) | **READY_FOR_IMPL** (le spike ferme la question structurelle) |

## 8. Vérification des baselines

| Baseline | Statut au 2026-09-01T17:48+02:00 | Notes |
|---|---|---|
| Spike runs 5 PASS / 0 PARTIAL / 0 FAIL / 0 MISSING | **OUI** | `bun docs/automation-v2/spikes/m1-03-scope-enforcement.ts` |
| `@unifia/contracts` tests | **96 pass / 0 fail** | baseline préservée (`packages/contracts/test/*`) |
| `packages/app` tests | **1192 pass / 0 fail** | baseline préservée |
| `bun run typecheck` | **39 of 40 packages clean** | 1 package en échec : `@unifia/workbench-server` (Agent B refactor en parallèle, fichiers untracked — DO-NOT-TOUCH per instructions) |

**Note baselines** : le typecheck workspace montre 8 erreurs dans
`packages/workbench-server/src/{handlers/documents,server-context,
server-helpers,server,types}.ts`. Toutes ces erreurs sont dans des
fichiers **untracked** (`git status` les montre comme « Untracked
files »), donc ils appartiennent au refactor parallèle d'Agent B
(`packages/workbench-server/src/approval-gate.ts`, `audit-context.ts`,
`constants.ts`, `handlers/`, `http.ts`, `server-context.ts`,
`server-helpers.ts`, `server.ts`, `types.ts`). Le spike ne touche
aucun de ces fichiers.

## 9. Lockfile (note de cohérence)

`bun install` a modifié `bun.lock` pour ajouter `@unifia/secret-broker`
(qui manquait depuis le commit M0-06 `cdddfc798e`). Le spike fonctionne
parce que `node_modules/@unifia/secret-broker/` est déjà symlinké sur
cette machine, mais une installation from-scratch (CI, autre clone)
exigera un `bun install` non-`--frozen-lockfile`.

**Recommandation** : un commit de follow-up
`chore(deps): bun.lock for @unifia/secret-broker (M0-06 collateral)`
est à planifier par un worker séparé. Le spike M1-03 ne le fait pas
parce que le scope de cette tâche est limité aux 2 fichiers
`docs/automation-v2/spikes/m1-03-scope-enforcement.ts` +
`M1-03-EVIDENCE.md`.

## Liens

- `docs/automation-v2/spikes/m1-03-scope-enforcement.ts` (ce spike)
- `docs/automation-v2/M1-IMPLEMENTATION-PLAN.md` §3.4 (C-M1-04) + §5.3 (5 tests)
- `docs/automation-v2/THREAT_MODEL.md` §1.10 (TM-T-01, TM-T-02)
- `packages/contracts/src/scope.ts:29-52` (OwnershipScopeSchema + DeploymentScopeSchema)
- `packages/contracts/src/credential.ts:37-119` (4 typed refs, tous avec `scope: OwnershipScope`)
- `packages/contracts/src/artifact-record.ts:72-87` (ArtifactRecord avec `ownershipScope`)
- `packages/secret-broker/src/index.ts:230-236` (helper `ensureScope` 2-field — pattern source)
- `packages/secret-broker/test/secret-broker.test.ts:133-167` (4 multi-tenant tests, base)
- `docs/adr/ADR-020-ownership-deployment-scope.md` (DECIDED)
- plan V2.3.1 §44-46 (scope model) + §226 (A-vs-B tests)
- M0-04 (secure-storage, ADR-010) → `M0-04-EVIDENCE.md`
- M0-05 (network-authority, ADR-023) → `M0-05-EVIDENCE.md`
- M0-06 (capability-enforcement, ADR-002) → `M0-06-EVIDENCE.md`
- C-M1-04 (scope enforcement) acceptance (a)-(e)
- C-M1-06 (artifact store enforcement) Depends on C-M1-04
- C-M1-08 (capability authority enforcer) Depends on C-M1-04
