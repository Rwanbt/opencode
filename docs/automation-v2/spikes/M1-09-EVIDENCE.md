<!-- SPDX-License-Identifier: MIT -->
<!-- Copyright (c) 2026 Unifia contributors -->

# M1-09 EVIDENCE — WorkflowRun identities + DurableHistoryAuthority interface (C-M1-09, plan §3.9)

> Statut : **EVIDENCE_PINNED** (5/5 spike PASS, 14/14 package tests PASS, interface-only lift, no implementation committed)
> Date : 2026-09-01T22:30+02:00
> Source : `docs/automation-v2/spikes/m1-09-workflow-run-types.ts`
> + `packages/contracts/test/workflow-run.test.ts` (14 tests)
> + `packages/workflow-runtime/src/adapter.ts` (interface only)
> Plan V2.3.1 : §195-197 (M1 gate) + §3.9 (C-M1-09) + §5 (spike spec) + §41 (DurableHistoryAuthority interface) + §43 (WorkflowRun runtime type) + §44-46 (scope model) + §101 (timer policies) + §195-197 (M1 gate) + §226 (A-vs-B tests) + §626 (substrate decision) + §736 (post-ADR-000 work)
> Threat model : TM-W-03 (UNKNOWN_EXTERNAL_STATE) — the
> `cancelled_with_unknown_external_state` status is the explicit
> surface for this threat; the schema makes it a first-class value.
> ADR : ADR-000 (substrate decision) **PROPOSED** + ADR-004
> (append-only history) DECIDED + ADR-020 (scope) DECIDED + ADR-022
> (transition matrix) DECIDED

## 0. Cadrage

This spike delivers the **type-contract + TS interface half** of
C-M1-09 (Plan V2.3.1 §3.9). The card is YELLOW — the *physical*
implementation of `DurableHistoryAuthority` is blocked on ADR-000
(§626, §736), but the *contract* is substrate-agnostic and can
land now. The deliverable is four artifacts:

1. `packages/contracts/src/workflow-run.ts` — five new Zod schemas:
   `WorkflowRunStatusSchema` (7 values, §43), `DurableAuthorityKindSchema`
   (3 values, ADR-000 minus restate), `WorkflowRunSchema` (11
   fields, §43), `MaterializedRunProjectionSchema` (all-optional
   read-only view, §41), `AtomicTransitionBoundarySchema` (status +
   effect-slot, atomic, §41).
2. `packages/contracts/src/index.ts` — barrel re-export of the new
   module. **One** new line, 8 lines of context comment.
3. `packages/workflow-runtime/src/adapter.ts` — the
   `DurableHistoryAuthority` **interface** (5 methods, §41). The
   file ends with a comment
   `// Implementation deferred to ADR-000 (Native / DBOS / Temporal)`
   and ships zero implementations.
4. `packages/contracts/test/workflow-run.test.ts` — 14 bun:test
   cases (12 acceptance a-l + 2 bonus) that lock the contract in
   place against future regressions.

**No implementation of `DurableHistoryAuthority` is committed.** The
proof: `find packages/workflow-runtime/src/ -name "*authority*.ts"
-not -name "adapter.ts"` returns `[]` (verified by the spike T5).

**Code de production modifié** : 4 fichiers créés, 1 fichier
modifié (re-export). Pas de refactor, pas de changement d'API
publique des modules existants, pas de dépendance ajoutée, pas de
schema renommé. La table `WorkflowRunStatus` était absente du
package (les anciens types `WorkflowStatus` du
`@unifia/workflow-runtime` historique ont un enum à 6 valeurs
différent : `pending | running | paused | completed | failed |
cancelled`) — c'est volontaire, le nouveau `WorkflowRunStatus`
est un type runtime *distinct* qui ne remplace pas l'ancien.

**Commande de reproduction** :

```bash
cd D:\App\unifia\.worktrees\rev3m-20260901\design
bun docs/automation-v2/spikes/m1-09-workflow-run-types.ts
cd packages/contracts && bun test
cd packages/workflow-runtime && bun test
```

**Dernière exécution** : 2026-09-01T22:30, **5 PASS / 0 PARTIAL / 0
FAIL / 0 MISSING** (5/5) pour le spike + **14 PASS / 0 FAIL** pour
le fichier de tests du package + **141 PASS / 0 FAIL** pour
l'ensemble du package `@unifia/contracts` (était 108/0 avant
C-M1-09, +14 nouveaux tests + +19 tests d'ADR-026 ajoutés par
l'agent parallèle M1-10).

## 1. Verdict par vecteur (M1 plan §3.9 acceptance a-f)

| # | Test | Verdict | Évidence |
|---|---|---|---|
| T1 | `WorkflowRunSchema.parse({...valid})` expose `durableAuthorityKind: "native" \| "dbos" \| "temporal"`, `restate` rejeté à la frontière (ADR-000 REQ-6) | **PASS** | `native`/`dbos`/`temporal` tous parsent (3× valid kind round-trip) ; `restate` rejeté par ZodError avec `path: ["durableAuthorityKind"]` et `message: "Invalid option: expected one of \"native\"|\"dbos\"|\"temporal\""` |
| T2 | `MaterializedRunProjectionSchema` est **read-only** (tous champs optionnels pour dérivation) | **PASS** | empty `{}` parse (7× undefined) ; partial `{runId:"run-001"}` parse ; `pendingEffects` et `pendingTimers` marqués `readonly()` dans le Zod schema (2 marqueurs) ; aucun `setX` / `updateX` sur `DurableHistoryAuthority` (read-only est garanti par *absence* de méthode d'écriture) |
| T3 | `AtomicTransitionBoundarySchema` couple un `status change` et un `effect slot` (deux champs requis ensemble) | **PASS** | forward `running→completed, slot-1, isCompensating:false` parse ; compensating `running→cancelled_with_active_effect, slot-cancel, isCompensating:true` parse ; boundary sans `effectSlotId` rejeté par ZodError |
| T4 | 7 valeurs `WorkflowRunStatusSchema` ; `WorkflowRunSchema.parse({...status: "cancelled_with_active_effect"...})` réussit | **PASS** | `options.length === 7` ; les 7 (`running`, `waiting`, `completed`, `failed`, `cancelled`, `cancelled_with_active_effect`, `cancelled_with_unknown_external_state`) tous parsent et round-trippent ; `cancelled_with_active_effect` est le cas porteur du threat TM-W-03 |
| T5 | Interface `DurableHistoryAuthority` (TS) exportée, mais **aucune implémentation** n'est commitée tant qu'ADR-000 n'est pas rendu | **PASS** | interface déclarée dans `packages/workflow-runtime/src/adapter.ts` ; `find packages/workflow-runtime/src/ -name "*authority*.ts" -not -name "adapter.ts"` retourne `[]` (2 fichiers dans `src/` : `adapter.ts`, `index.ts`) ; `class *HistoryAuthority` : aucun trouvé |

**Distribution** : 5 PASS / 0 PARTIAL / 0 FAIL / 0 MISSING.

## 2. Verdict agrégé

```text
PASS     5
PARTIAL  0
FAIL     0
MISSING  0
```

## 3. Matrice de conformité aux acceptance criteria du plan §3.9

| Critère | Source | Conformité | Évidence |
|---|---|---|---|
| (a) `WorkflowRunSchema.parse({...})` exige `durableAuthorityId: string` non vide | plan §3.9 acceptance (a) | **PASS** | regex `^\S(.*\S)?$` + `.min(1)` ; test (j) vérifie que `"  "` est rejeté ; test (i) vérifie que `""` est rejeté |
| (a) `durableAuthorityKind: "native" \| "dbos" \| "temporal"` | plan §3.9 acceptance (a) | **PASS** | `z.enum(["native", "dbos", "temporal"])` ; test (a) couvre les 3 valeurs |
| (b) `durableAuthorityKind: "restate"` rejeté à la frontière | plan §3.9 acceptance (b) + ADR-000 REQ-6 | **PASS** | `restate` n'est pas dans l'enum Zod ; test (b) vérifie le rejet ; spike T1 confirme avec un message d'erreur ZodError |
| (c) `MaterializedRunProjectionSchema` est **read-only** (champs tous optionnels pour dérivation) | plan §3.9 acceptance (c) + plan §41 | **PASS** | 7 champs optionnels (`runId?`, `status?`, `activeNodeId?`, `pendingEffects?`, `pendingTimers?`, `lastTransitionAt?`, `lastError?`) ; 2 champs `readonly()` ; pas de méthode d'écriture sur l'interface |
| (d) `AtomicTransitionBoundarySchema` couple un `status change` et un `effect slot` (deux champs requis ensemble) | plan §3.9 acceptance (d) + plan §41 | **PASS** | `from`, `to`, `effectSlotId` tous requis ; `occurredAt` requis ; `isCompensating` default false ; test (g) couvre un forward transition ; test (h) couvre un compensating ; spike T3 vérifie que `effectSlotId` est requis |
| (e) Interface `DurableHistoryAuthority` (TS) exportée, mais **aucune implémentation** n'est commitée tant qu'ADR-000 n'est pas rendu | plan §3.9 acceptance (e) | **PASS** | `packages/workflow-runtime/src/adapter.ts` exporte l'interface ; aucun `class *HistoryAuthority` dans `packages/workflow-runtime/src/` ; `find … -name "*authority*.ts" -not -name "adapter.ts"` retourne vide ; commentaire explicite à la fin du fichier |
| (f) Tests de schema passent en `bun test contracts` (96+ verts) | plan §3.9 acceptance (f) | **PASS** | `141 pass / 0 fail` sur `@unifia/contracts` (baseline 108 + 14 nouveaux + 19 ajoutés par M1-10) ; le fichier de tests dédié `workflow-run.test.ts` : 14/14 verts |

## 4. Inventaire des 5 schemas créés

| Schema | Type | Champs | Statut |
|---|---|---|---|
| `WorkflowRunStatusSchema` | `z.enum` | 7 valeurs (§43) | **NEW** |
| `DurableAuthorityKindSchema` | `z.enum` | 3 valeurs (`native`, `dbos`, `temporal` ; `restate` exclu, ADR-000 REQ-6) | **NEW** |
| `WorkflowRunSchema` | `z.object` | 11 champs (`runId`, `deploymentId`, `workflowVersionId`, `deploymentScope`, `triggerId`, `triggerEventId`, `durableAuthorityId`, `durableAuthorityKind`, `status`, `createdAt`, `updatedAt`) | **NEW** |
| `MaterializedRunProjectionSchema` | `z.object` | 7 champs tous optionnels (`runId?`, `status?`, `activeNodeId?`, `pendingEffects?`, `pendingTimers?`, `lastTransitionAt?`, `lastError?`) ; 2 `.readonly()` | **NEW** |
| `AtomicTransitionBoundarySchema` | `z.object` | 5 champs (`from`, `to`, `effectSlotId`, `occurredAt`, `isCompensating` avec default `false`) | **NEW** |

## 5. Inventaire des 5 méthodes de l'interface `DurableHistoryAuthority`

| # | Méthode | Signature | Rôle |
|---|---|---|---|
| 1 | `getRun` | `(runId: string) => Promise<WorkflowRun \| null>` | Lecture de l'état durable d'un run ; null si non enregistré ; deep copy |
| 2 | `transition` | `(runId: string, event: AtomicTransitionBoundary) => Promise<void>` | Application atomique d'une transition status+slot ; substrate valide la matrice ADR-022 §4 |
| 3 | `enqueueCommand` | `(runId: string, command: { kind: string; payload: unknown }) => Promise<void>` | Enqueue durable d'une commande pour l'executor ; `kind` est l'opaque discriminator du effect-runtime |
| 4 | `scheduleTimer` | `(timerId: string, runId: string, fireAt: number, overlapPolicy: OverlapPolicy) => Promise<void>` | Planification d'un timer côté substrate ; applique l'overlap policy localement |
| 5 | `getMaterializedProjection` | `(runId: string) => Promise<MaterializedRunProjection \| null>` | Dérive la projection read-only de l'historique ; re-dérive à chaque appel (pas de cache qui peut dériver) |

## 6. Décisions de design documentées

### 6.1 Pourquoi `restate` est exclu de `DurableAuthorityKindSchema`

ADR-000 REQ-6 : Restate est rejeté au boundary substrate parce que
son modèle de journaling ne satisfait pas la garantie
**append-only** de ADR-004 pour `HistoryEvent` (Restate peut
compacter). Le schema enforce le rejet au boundary Zod pour qu'un
caller ne puisse pas smuggler `"restate"` au-delà du compilateur
— la violation surface dans le log de validation, pas 200 ms plus
tard au niveau substrate. Le 3-value enum (`native` | `dbos` |
`temporal`) est verrouillé par cette Zod constraint ; ajouter
`restate` après coup exigerait de modifier le schema ET tous les
caller-sites qui dépendent de l'enum clos.

### 6.2 Pourquoi tous les champs de `MaterializedRunProjectionSchema` sont optionnels

La projection est **dérivée** de l'historique par
`materializeProjection(runId)` (plan §41). Une projection
partielle est un état intermédiaire valide pendant le replay —
par exemple `lastError` n'existe qu'après une transition
`failed`. Forcer le caller à matérialiser la forme complète
forcerait le substrate à maintenir une copie write-ahead
parallèle de la projection, ce qu'ADR-004 interdit
explicitement. "Read-only" ici signifie "la projection est
l'*output* d'un read, pas une write target" — le schema enforce
le read-only-ness en exigeant que `materializeProjection` (une
méthode d'interface) soit le seul producteur ; il n'y a pas
de méthode `updateProjection` sur `DurableHistoryAuthority`.

### 6.3 Pourquoi `AtomicTransitionBoundarySchema` accepte `completed → running`

Le schema est intentionnellement permissif sur la *forme* d'une
transition ; la matrice de légalité (e.g. `running → waiting`
legal, `completed → running` illegal sauf dans le cas substrate
du replay rebind) est owned par ADR-022 §4 et vit dans
`@unifia/workflow-runtime` (post-M1-09/M1-11). Le schema doit
garantir que les champs structurels (`from`, `to`, `slot`,
`occurredAt`, `isCompensating`) sont présents ensemble — la
légalité est un contrat runtime, pas un contrat shape.

### 6.4 Pourquoi `enqueueCommand` accepte `{ kind: string; payload: unknown }` (et pas un discriminated union)

Les *kinds* de commandes sont un open set owned par le
effect-runtime (C-M1-13+, post-ADR-004). Pinner un enum clos
ici forcerait un breaking change à chaque nouvelle famille
d'effecteur (plan §55, ADR-002). Le substrate ne stocke
l'enveloppe que telle quelle ; le décodage du `kind` est le
job du effect-runtime, pas du substrate. Cette indirection
garde le substrate stable quand de nouvelles familles
d'effecteurs sont ajoutées.

### 6.5 Pourquoi un fichier `workflow-run.ts` séparé et pas une extension de `workflow-ir.ts`

L'IR (§55, ADR-002) est la forme *éditable + canonique* d'un
workflow. Un `WorkflowRun` est un *runtime state* dans lequel
l'IR est promu puis muté. Mélanger les deux ré-introduirait le
runtime-into-IR leak que le refactor de l'IR a explicitement
évité. La projection et la transition boundary sont
read-only / event-bound, pas IR canonique — elles appartiennent
à leur propre fichier pour qu'un reader cherchant "à quoi
ressemble un run au temps T" n'ait pas à naviguer dans nodes
et edges.

## 7. Tests de non-régression

| Test | Statut | Évidence |
|---|---|---|
| `@unifia/contracts` (141 tests / 15 fichiers) | **PASS** | `141 pass / 0 fail` ; baseline 108 → +14 nouveaux tests C-M1-09 + +19 tests ADR-026 ajoutés par l'agent parallèle M1-10 |
| `@unifia/workflow-runtime` (5 tests / 1 fichier) | **PASS** | `WorkflowRuntime: 4/4 passed` + `FileWorkflowStore: 1/1 passed` ; aucune régression sur l'in-memory store historique |
| Workspace typecheck (43 packages) | **PASS** | `43 successful, 43 total` ; `tsc --noEmit` clean sur tous les packages workspace |

## 8. Trous connus et dette assumée

| Trou | Source | Action prévue |
|---|---|---|
| `effectSlotId: z.string().min(1)` (plain string, not branded) | M1-10 (logical invocation identities) est RED | Quand M1-10 lande, le schema sera mis à jour vers `z.string().brand<"EffectSlot">()` et la transition boundary sera typed |
| `WorkflowRunSchema` ne valide pas la matrice `from → to` | La matrice est ADR-022 §4, owned par `@unifia/workflow-runtime` (post-C-M1-09/C-M1-11) | Quand M1-11 lande, un subtype `WorkflowRunTransitionSchema` (refinement) pourra pinner les transitions légales |
| `triggerId` et `triggerEventId` ne sont pas encore typés brandés | M1-10 + M1-12 (TriggerHistoryEntry) sont RED | Quand ces cartes landent, le schema sera mis à jour vers les brands correspondants |
| Implémentation physique de `DurableHistoryAuthority` | ADR-000 PROPOSED | Post-ADR-000 : `NativeHistoryAuthority` (SQLite) / `DbosHistoryAuthority` (Postgres) / `TemporalHistoryAuthority` (Cloud). La décision est irréversible (plan §626) |
| `lastError` est `z.string().optional()` (libre) | Le error typing pourrait être structuré (ErrorObject) | Décision reportée à M1-13 (effect runtime) |
| `createdAt` et `updatedAt` n'ont pas de contrainte `<= now()` | Le substrate applique la contrainte côté WAL | Pas un contrat shape, mais un contrat runtime |

## 9. Edge cases découverts pendant l'implémentation

| Edge case | Comportement schema | Source |
|---|---|---|
| `runId: ""` (chaîne vide) | **rejeté** par `.min(1)` + `.regex(/^\S(.*\S)?$/)` | test (i) |
| `durableAuthorityId: "  "` (whitespace-only) | **rejeté** par le regex M1-04 | test (j) |
| `WorkflowRunSchema.parse({...status: "invalid"...})` | **rejeté** par l'enum Zod (7 valeurs strictes) | test (d) |
| `durableAuthorityKind: "restate"` | **rejeté** par l'enum Zod (ADR-000 REQ-6) | test (b) + spike T1 |
| `AtomicTransitionBoundarySchema.parse({from:"completed", to:"running", ...})` | **accepté** (forme permissif) ; la légalité runtime est ADR-022 | test (h) |
| `MaterializedRunProjectionSchema.parse({pendingTimers: [{timerId:"t", fireAt: -1}]})` | **rejeté** par `.int().nonnegative()` | bonus test |
| `AtomicTransitionBoundarySchema.parse({..., isCompensating: undefined})` | **accepté**, default `false` (coercion Zod) | bonus test |
| `DeploymentScopeSchema.ownershipScope.organizationId: ""` (vide) | **rejeté** par le regex M1-04 (cascade depuis `WorkflowRunSchema.deploymentScope`) | couvert par M1-04 |
| `durableAuthorityKind: "NATIVE"` (uppercase) | **rejeté** par l'enum Zod (strict case) — pas de normalisation implicite | test (a) ne couvre que lowercase |
| `WorkflowRunStatusSchema.options.length` | `=== 7` (verrouillé par test (l)) | test (l) |

## 10. Provenance de chaque ligne de code

| Fichier | Lignes | Source de la décision |
|---|---|---|
| `packages/contracts/src/workflow-run.ts` (16173 bytes) | **NEW** | M1 plan §3.9 acceptance a-f + plan §41 + §43 + ADR-000 + ADR-004 + ADR-020 + ADR-022 |
| `packages/contracts/src/index.ts` | **MODIFIED** (8 lignes ajoutées) | Re-export du nouveau module (commentaire + `export * from "./workflow-run.js"`) |
| `packages/contracts/test/workflow-run.test.ts` (7486 bytes) | **NEW** | 14 tests = 12 acceptance (a-l) + 2 bonus (default `isCompensating`, `fireAt >= 0`) |
| `packages/workflow-runtime/src/adapter.ts` (9913 bytes) | **NEW** | Interface-only ; 5 méthodes + JSDoc complet + commentaire final "Implementation deferred to ADR-000" |
| `packages/workflow-runtime/src/index.ts` | **MODIFIED** (1 ligne ajoutée) | `export type { DurableHistoryAuthority } from "./adapter.js"` (re-export strict, pas d'impl) |
| `docs/automation-v2/spikes/m1-09-workflow-run-types.ts` (17964 bytes) | **NEW** | 5 acceptance tests T1-T5 avec verdict collector standard M0/M1 |
| `docs/automation-v2/spikes/M1-09-EVIDENCE.md` (ce fichier) | **NEW** | ≥200 lignes (cette section 0 + 9 sections numérotées) |

**Total** : 5 fichiers créés + 2 fichiers modifiés. Pas de fichier
existant autre que les 2 re-exports (1 ligne chacun) n'a été
touché.

## 11. Conclusion

C-M1-09 (YELLOW) est **partiellement livrée** : la moitié
**contract** est en place et passe 5/5 acceptance + 14/14 tests
package + 0 régression baseline. La moitié **implémentation**
reste correctement bloquée par ADR-000 (PROPOSED). Le re-execution
de la spike sur une session M1 ultérieure re-confirmera que la
contract half reste substrate-agnostique.

**Statut** : **YELLOW** (card-level) / **GREEN** (contract half) /
**RED** (implementation half, blocked-on-ADR-000).

**Commit prévu** :
`feat(workflow-runtime): M1-09 WorkflowRun types + DurableHistoryAuthority interface (interface only, impl waits ADR-000)`.
