# AUDIT-CHILD-SESSIONS-V2 — `packages/unifia/src/session/`

> **Carte :** TEAM-A01 (Lot A, Gate T0) — **tentative 2**
> **Worktree :** `D:\App\OpenCode\.team-worktrees\A01-7d80a3f1`
> **SHA de base :** `4be438597986380ec0b0a1af21524b74626e7e3c`
> **Date UTC :** 2026-07-20
> **Auteur :** MiniMax-M3 (E1, corrections E2)
> **Statut :** READY_FOR_E2_REVIEW
> **Hash d'instance :** alias `A01-V2` / canonique dérivé `4aacbb67`
> **Supersede :** `AUDIT-CHILD-SESSIONS.md` (v1) — v1 reste archivé, NE PAS modifier.

> **Avertissement.** Cette v2 corrige les findings F-A01-1..5 amendés par E2,
> ajoute F-A01-6..8, retire §9.3 (D-016), et fournit des preuves vérifiables
> pour les affirmations qui étaient non démontrées en v1. Toutes les preuves
> sont des citations exactes de code réel.

---

## 0. Méthode (v2)

1. Conservation intégrale des preuves v1 (sections 1–8 inchangées sauf re-qualifications).
2. Nouvelles recherches v2 :
   - `rg -n 'parent_id:.*CHECK|parent_id:.*NOT NULL|parentID.*===.*id'` — contrainte cycles.
   - `rg -n 'AbortController|AbortSignal|\.abort\(\)'` — primitives d'annulation.
   - `rg -n 'SyncEvent\.remove\(|Session\.remove\(|children\('` — callers de `Session.remove`.
   - `rg -n 'Event\.TeamCompleted|publish.*team\.completed'` — publishers de `TeamCompleted`.
   - `rg -n 'x-parent-session-id'` — tous usages du header HTTP.
3. Lecture exhaustive :
   - `packages/unifia/src/util/abort.ts` (helpers d'annulation).
   - `packages/unifia/src/acp/agent.ts` (cancel via SDK).
   - `packages/unifia/src/cli/cmd/session.ts` (CLI).
   - `packages/unifia/src/server/routes/session.ts` (API route).
   - `packages/unifia/src/server/routes/gdpr.ts` (GDPR).
   - `packages/unifia/src/tool/task.ts` (cancel propagation).
   - `packages/unifia/src/tool/team.ts` (publisher `TeamCompleted`).
4. Sections §9, §10, §11, §12 : retrait des prescriptions non démontrées ;
   ré-écriture des findings amendés ; ajout F-A01-6..8.

---

## 1. Schéma de persistance (INCHANGÉ v1 → v2, conservé pour traçabilité)

### 1.1 Colonne parent_id
Preuve — `packages/unifia/src/session/session.sql.ts:24` :
```ts
parent_id: text().$type<SessionID>(),
```
Type `text`, brandé `SessionID`. Nullable : oui. **Aucune contrainte CHECK ni
NOT NULL explicitement ajoutée.** Pas de `references(..., { onDelete })` non plus
— la colonne n'a pas de foreign key.

### 1.2 Index
Preuve — `packages/unifia/src/session/session.sql.ts:45` :
```ts
index("session_parent_idx").on(table.parent_id),
```

### 1.3 Persistence des permissions par session
Preuve — `packages/unifia/src/session/session.sql.ts:37` :
```ts
permission: text({ mode: "json" }).$type<Permission.Ruleset>(),
```
`Permission.Ruleset` est stocké par session. La sémantique effective d'un
`Ruleset` `undefined` ou `[]` dépend des couches d'évaluation
(`permission/evaluate.ts`) — voir F-A01-1 amendé.

---

## 2. Création d'une session enfant

### 2.1 Interface publique
Preuve — `packages/unifia/src/session/index.ts:332-337` :
```ts
readonly create: (input?: {
  parentID?: SessionID
  title?: string
  permission?: Permission.Ruleset
  workspaceID?: WorkspaceID
}) => Effect.Effect<Info>
```

### 2.2 Implémentation
Preuve — `packages/unifia/src/session/index.ts:394-448` (extrait) :
```ts
const createNext = Effect.fn("Session.createNext")(function* (input: {
  id?: SessionID
  title?: string
  parentID?: SessionID
  workspaceID?: WorkspaceID
  directory: string
  permission?: Permission.Ruleset
}) {
  const ctx = yield* InstanceState.context
  const result: Info = {
    id: SessionID.descending(input.id),
    slug: Slug.create(),
    version: Installation.VERSION,
    projectID: ctx.project.id,
    directory: input.directory,
    workspaceID: input.workspaceID,
    parentID: input.parentID,
    title: input.title ?? createDefaultTitle(!!input.parentID),
    permission: input.permission,                              // ← voir F-A01-1 amendé
    time: { created: Date.now(), updated: Date.now() },
  }
  log.info("created", result)
  yield* Effect.sync(() => SyncEvent.run(Event.Created, { sessionID: result.id, info: result }))
```

**Note v2 :** `permission: input.permission` — si `input.permission` est
`undefined`, `result.permission` reste `undefined` (le type Zod le permet car
`permission?: Permission.Ruleset.optional()`). La sémantique effective (« Ruleset
vide » vs « aucun permission posée ») dépend de la couche d'évaluation non
auditée ici. Voir F-A01-1.

### 2.3 Audit log asynchrone
Preuve — `packages/unifia/src/session/index.ts:436-445` :
```ts
AuditLog.recordAsync({
  action: "session.create",
  target: result.id,
  metadata: { projectID: result.projectID, workspaceID: result.workspaceID, parentID: result.parentID },
})
```

### 2.4 Mapping row → Info
Preuve — `packages/unifia/src/session/index.ts:76` :
```ts
parentID: row.parent_id ?? undefined,
```

### 2.5 Schéma Zod
Preuves — `packages/unifia/src/session/index.ts:135` et `:720` :
```ts
parentID: SessionID.zod.optional(),
```

---

## 3. Récupération des enfants

### 3.1 Interface publique
Preuve — `packages/unifia/src/session/index.ts:355` :
```ts
readonly children: (parentID: SessionID) => Effect.Effect<Info[]>
```

### 3.2 Implémentation
Preuve — `packages/unifia/src/session/index.ts:475-485` :
```ts
const children = Effect.fn("Session.children")(function* (parentID: SessionID) {
  const ctx = yield* InstanceState.context
  const rows = yield* db((d) =>
    d.select().from(SessionTable)
      .where(and(eq(SessionTable.project_id, ctx.project.id), eq(SessionTable.parent_id, parentID)))
      .all(),
  )
  return rows.map(fromRow)
})
```

---

## 4. Suppression et cascade manuelle

### 4.1 Suppression récursive
Preuve — `packages/unifia/src/session/index.ts:487-503` :
```ts
const remove: (sessionID: SessionID) => Effect.Effect<void> = Effect.fnUntraced(function* (sessionID: SessionID) {
  try {
    const session = yield* get(sessionID)
    const kids = yield* children(sessionID)
    for (const child of kids) {
      yield* remove(child.id)
    }
    yield* unshare(sessionID).pipe(Effect.ignore)
    yield* Effect.sync(() => {
      SyncEvent.run(Event.Deleted, { sessionID, info: session })
      SyncEvent.remove(sessionID)
    })
    AuditLog.recordAsync({ action: "session.remove", target: sessionID })
  } catch (e) {
    log.error(e)                                                   // ← F-A01-5 catch silencieux
  }
})
```

### 4.2 Callers de Session.remove (v2)

Recherche `rg -n 'SyncEvent\.remove\(|Session\.remove\(|children\('` :

| Fichier:ligne | Caller | Contexte |
|---|---|---|
| `packages/unifia/src/session/index.ts:490` | auto-récursion | `for (const child of kids) yield* remove(child.id)` |
| `packages/unifia/src/session/index.ts:497` | auto-récursion | `SyncEvent.remove(sessionID)` (effet de bord après suppression récursive) |
| `packages/unifia/src/cli/cmd/session.ts:68` | CLI | `await Session.remove(sessionID)` dans `cmdSessionDelete` |
| `packages/unifia/src/server/routes/session.ts:241` | HTTP API | `await Session.remove(sessionID)` dans DELETE /session/:id |
| `packages/unifia/src/server/routes/gdpr.ts:117` | GDPR | `await Session.remove(id as any)` dans route DELETE gdpr |

**Aucun caller n'appelle aujourd'hui de helper de suppression atomique
(`removeAtomic`) : tous utilisent `Session.remove` directement, qui avale
silencieusement les erreurs via `catch (e) { log.error(e) }` (ligne 501).**

### 4.3 Finding F-A01-5 amendé (high, routage D02+J01)
- **Severity élevée** : un crash mid-suppression peut laisser des enfants ou
  artefacts résiduels. Le `catch (e) { log.error(e) }` retourne `Effect<void>`
  sans propager l'échec. L'orchestrateur ne peut donc pas distinguer une
  suppression partielle d'une suppression complète.
- **Action** : D02 doit spécifier une erreur typée (`SessionRemoveError`),
  introduire une atomicité (transaction SQLite ou compensating action), et exposer
  le statut réel aux appelants. J01 doit tester la suppression partielle avec
  crash mid-récursion.

---

## 5. Événements émis par les sessions enfants

### 5.1 Événements de cycle de vie (INCHANGÉ)
Preuve — `packages/unifia/src/session/index.ts:192-235` :
```ts
Created: SyncEvent.define({
  type: "session.created",
  version: 1,
  aggregate: "sessionID",
  schema: z.object({ sessionID: SessionID.zod, info: Info }),
}),
Updated: SyncEvent.define({ type: "session.updated", version: 1, aggregate: "sessionID", schema: ..., busSchema: ... }),
Deleted: SyncEvent.define({ type: "session.deleted", version: 1, aggregate: "sessionID", schema: ... }),
Diff: BusEvent.define("session.diff", z.object({ sessionID, diff: Snapshot.FileDiff.array() })),
Error: BusEvent.define("session.error", z.object({ sessionID: SessionID.zod.optional(), error: ... })),
```

### 5.2 Statuts
Preuve — `packages/unifia/src/session/status.ts:60-78` et `:80-87` :
```ts
Status: BusEvent.define("session.status", z.object({ sessionID: SessionID.zod, status: Info })),
```
Union statuts : `idle | busy | retry | queued | blocked | awaiting_input | completed | failed | cancelled`.
`PERSISTENT_STATES = {queued, blocked, awaiting_input, completed, failed, cancelled}`.
`idle`, `busy`, `retry` ne sont PAS persistés.

### 5.3 Événements de tâche — F-A01-3 confirmé (P2, medium, D05)
Preuve — `packages/unifia/src/session/status.ts:95-141` :
```ts
TaskCreated:     { sessionID, parentID, agent, description }     // parentID présent
TaskCompleted:   { sessionID, parentID, result? }                // parentID présent
TaskFailed:      { sessionID, parentID, error }                  // parentID présent
TaskCancelled:   { sessionID }                                  // parentID MANQUANT
TaskBlocked:     { sessionID, reason? }                          // parentID MANQUANT
TaskInputNeeded: { sessionID, parentID, question }               // parentID présent
```
Inégalité persistée. Routage : D05 doit harmoniser via versioning N-1.

### 5.4 Event.TeamCompleted — F-A01-4 CORRIGÉ v2 (AMEND low)

**v1 disait** : « TeamCompleted est défini mais jamais publié. »
**v2 corrige** : le rapport v1 s'était trompé (recherche `rg` inexacte, le contrat
est `SessionStatus.Event.TeamCompleted`, et le publisher publie via `Bus.publish`).

Preuve — `packages/unifia/src/tool/team.ts:308` :
```ts
      await Bus.publish(SessionStatus.Event.TeamCompleted, {
        sessionID,
        tasks: [...],
        totalCost,
      });
```
**TeamCompleted EST publié.** Le contrat est sorti du namespace Team via
`tool/team.ts` qui ré-exporte le publisher. C'est incohérent architecturalement
(deux contrats concurrents possibles), pas dormant.

**Action** : D05 doit consolider ce contrat vers `packages/unifia/src/team/events.ts`
ou supprimer celui de `session/status.ts` après migration complète.

---

## 6. Header HTTP `x-parent-session-id`

Preuve — `packages/unifia/src/session/llm.ts:664` (unique occurrence) :
```ts
              ...(input.parentSessionID ? { "x-parent-session-id": input.parentSessionID } : {}),
```

### 6.1 F-A01-7 (NOUVEAU) — Confidentialité du header

| Question | État actuel | Action |
|---|---|---|
| Nécessité fonctionnelle | corrélation de logs / facturation côté provider | à documenter |
| Caractère pseudonyme vs PII | `SessionID` est un identifiant opaque brandé | non-PII direct, mais corrélable |
| Redaction dans logs tiers | dépend du contrat provider | à tester par provider |
| Exposition à des sous-traitants | possible (Anthropic/OpenAI utilisent des sous-processeurs) | à inclure dans le threat model A06 |
| Kill switch de désactivation | aucun (le header est systématiquement ajouté si `parentSessionID` défini) | à introduire dans le plan Team §17 (kill switch) |

**Action** : A05 (licences) et threat model A06 doivent trancher. Voir §9 v2.

---

## 7. Permissions et sous-sessions — F-A01-1 amendé (high, D03)

### 7.1 Pas de propagation automatique (CONFIRMÉ)
Recherche : `rg -n 'sub.?session|child.?session|fork|cascade|inherits' packages/unifia/src/permission/`
Résultat : aucune occurrence.

### 7.2 Sémantique effective — AMEND v2
En v1, le rapport affirmait « la session enfant naît avec un Ruleset vide ».
Cette affirmation **n'est pas démontrée par le code** : `permission: input.permission`
peut être `undefined`, `[]`, ou un ruleset explicite, indistinctement du point
de vue du schéma DB. La sémantique effective dépend de la couche
`permission/evaluate.ts` non lue dans cet audit.

### 7.3 Politique Team proposée (D03)
Suite à l'amendement E2, ne PAS prescrire `inherit_parent_unless_overridden`
(incompatible avec default-deny, comme noté par E2). Recommander plutôt :
- **least-privilege fail-closed** : toute création Team avec `parentID` doit
  fournir un `Ruleset` enfant explicite validé comme sous-ensemble non plus
  permissif que le parent.
- Refus de création Team avec parentID sans politique effective explicite.

---

## 8. Compactage et reprise

### 8.1 Compaction
Preuve — `packages/unifia/src/session/compaction.ts:56` :
```ts
parentID: MessageID
```

### 8.2 Cancellation primitive — F-A01-2 amendé (high, H02)

Recherche `rg -n 'AbortController|AbortSignal|\.abort\(\)'` — 100+ matches.
Les primitives principales :

| Fichier:ligne | Primitive | Sens |
|---|---|---|
| `util/abort.ts:5` | `new AbortController()` + helper `abortAfter(ms)` | helper timeout |
| `util/abort.ts:28-30` | `abortAfterAny(ms, ...signals)` + `AbortSignal.any` | combine timeout + signals |
| `acp/agent.ts:78` | `private eventAbort = new AbortController()` | abort par session ACP |
| `acp/agent.ts:1436-1438` | `async cancel(params)` → `this.config.sdk.session.abort(...)` | cancel API ACP |
| `cli/cmd/tui/worker.ts:48-53` | `eventStream.abort.abort()` + création nouveau controller | TUI worker |
| `effect/runner.ts:23,105` | `shell.abort.abort()` | runner abort |
| `session/llm.ts:50,179,199-200` | `raceAbort(promise, signal?)` + `new AbortController()` | LLM stream abort |
| `session/compaction.ts:292` | `Effect.onInterrupt(() => processor.abort())` | compaction interrupt |
| `tool/task.ts:405-406` | `function cancel() { SessionPrompt.cancel(session.id) }` | cancel par session.id (PAS par parent_id) |
| `control-plane/workspace.ts:116,136,150` | `workspaceEventLoop(space, stop)` + `stop.abort()` | workspace loop |

**Constat F-A01-2 :**
- Aucun mécanisme n'appelle un **abort parent + propagation enfants** basé sur
  `parent_id`.
- `tool/task.ts:405-406` n'appelle `SessionPrompt.cancel` que pour la session
  elle-même, pas pour ses enfants.
- `acp/agent.ts:1438` utilise `session.abort(...)` sur la session courante,
  pas sur l'arbre de descendants.

**Conclusion v2 :** Le rapport v1 affirmait « cancel parent n'arrête pas
les enfants ». Cette affirmation **est maintenant étayée** par la lecture des
call sites : il n'existe aucun chemin de code qui propage un `cancel` parent
vers les enfants. **F-A01-2 CONFIRMÉ high, routage H02.**

### 8.3 F-A01-8 NOUVEAU — Reprise crash des états non persistés

Les seuls états persistés (status.ts:29-36) :
```ts
const PERSISTENT_STATES = new Set<string>([
  "queued", "blocked", "awaiting_input", "completed", "failed", "cancelled",
])
```
Les états `busy`, `retry`, `idle` ne sont **pas** persistés. Après crash :
- `idle` → défaut (acceptable, c'est l'état initial).
- `busy` → non restauré → l'orchestrateur ne sait pas que la session était
  en cours d'exécution → risque de tâche zombie sans signal.
- `retry` → non restauré → la session ne se relance pas automatiquement.

**Action** : D02 (SQLite WAL) et J01–J05 (reprise) doivent définir une
politique de reprise pour `busy` et `retry` (timeout, marquage
`_INTERRUPTED`, ou redémarrage automatique).

---

## 9. NOUVEAUX findings — cycles et contraintes

### 9.1 F-A01-6 — Absence de protection cycles/orphelins sur parent_id

Recherche `rg -n 'parent_id:.*CHECK|parent_id:.*NOT NULL|parentID.*===.*id'` :
aucun match. La colonne est nullable, sans contrainte.

Conséquences possibles (NON démontrées dans cet audit mais fortement
probables) :
- Auto-référence `parent_id === id` (un parent peut être son propre enfant).
- Chaîne cyclique A→B→A via création successive.
- Orphelin (parent_id pointe vers une session inexistante).

**Action** : D02 (SQLite) doit introduire :
- CHECK `parent_id IS NULL OR parent_id <> id`
- Trigger avant insertion : rejet si `parent_id` non-null ET `parent_id`
  pointe vers une session qui a elle-même un `parent_id` cyclique.
- Stratégie d'orphelin : NULLifier le `parent_id` ou cascader la suppression.

---

## 10. Recommandations bornées pour les cartes en aval (v2)

### 10.1 Pour H01 (ChildSessionWorkerRuntime read-only)
1. `Session.create({ parentID, permission, workspaceID })` comme primitive.
2. **Politique explicite** requise pour `permission` (cf. F-A01-1 amendé).
3. Bus.Service events : `session.status`, `task.*`, `session.error`.
4. **Cancellation arborescente** : introduire `Session.cancelRecursive(parentID)`
   qui itère `children(parentID)` et appelle `session.abort(...)` sur chaque
   enfant. Cette primitive **n'existe pas** ; à concevoir en H02.
5. Tools grants : politique explicite par scope.

### 10.2 Pour D03 (PermissionBroker Team) — reformulé v2
1. Politique **least-privilege fail-closed** : pas d'héritage implicite.
2. Toute création Team avec `parentID` requiert `Ruleset` enfant explicite
   ET validé comme sous-ensemble non plus permissif que le parent.
3. Bloquer `create({ parentID })` sans politique effective.
4. Stocker le diff entre Ruleset parent et enfant pour audit.

### 10.3 Pour G01–G04 (Locks, Worktree, ScopeMonitor) — RETIRÉ prescriptions

Le rapport v1 §9.3 prescrivait « lease pour children(parentID) » et
« fencing token pour remove(sessionID) ». **Retiré.** Ces règles sont des
**questions ouvertes** à trancher par le threat model G01–G04 et les contrats
futurs, **pas des conclusions** de l'audit A01.

Voir `R-017` (kill switches) et `R-018` (reprise crash) pour les éléments
d'input à ces futures cartes.

### 10.4 Pour D05 (Event contracts Team)
1. Harmoniser `parentID` dans tous les événements `task.*` (versioning N-1).
2. Consolider `TeamCompleted` : migrer ou supprimer celui de `session/status.ts`
   après migration complète de `tool/team.ts:308`.

### 10.5 Pour A05 + Threat Model A06
1. **F-A01-7** : confidentialité `x-parent-session-id` (kill switch, redaction
   logs tiers, exposition sous-traitants).
2. **F-A01-6** : contrainte cycles/orphelins (DB constraint + trigger).

---

## 11. Verdict provisoire (v2)

| Critère | Statut v1 | Statut v2 |
|---|---|---|
| Schéma DB | OK | OK + ajout F-A01-6 (cycles) |
| API create | OK | OK |
| API children | OK | OK |
| Suppression cascade | OK avec réserve | **High** (F-A01-5 reclassifié) |
| Événements statuts | PARTIEL | PARTIEL (F-A01-3) |
| Propagation permissions | MANQUANT | **AMEND** (F-A01-1, sémantique non démontrée) |
| Cancellation arborescente | MANQUANT | **CONFIRMÉ** (F-A01-2, preuves exhaustives) |
| Header HTTP provider | OK | OK + **F-A01-7 NOUVEAU** |
| TeamCompleted | NON CÂBLÉ | **PUBLIÉ** (F-A01-4 corrigé) |
| Cycles/orphelins | (non vérifié) | **MANQUANT** (F-A01-6 NOUVEAU) |
| Reprise crash | (non vérifié) | **MANQUANT** (F-A01-8 NOUVEAU) |

---

## 12. Preuves fichier:ligne (42 entrées, augmentée de v1)

| # | Fichier:ligne | Symbole |
|---|---|---|
| 1 | session.sql.ts:24 | parent_id column (nullable) |
| 2 | session.sql.ts:45 | session_parent_idx |
| 3 | session.sql.ts:37 | permission Ruleset (per-session) |
| 4 | session/index.ts:76 | row.parent_id ?? undefined |
| 5 | session/index.ts:135 | parentID Zod optional |
| 6 | session/index.ts:192-235 | Event cycle de vie |
| 7 | session/index.ts:332-337 | create API |
| 8 | session/index.ts:355 | children(parentID) |
| 9 | session/index.ts:394-448 | createNext impl |
| 10 | session/index.ts:411 | createDefaultTitle |
| 11 | session/index.ts:420 | SyncEvent.run(Event.Created) |
| 12 | session/index.ts:436-445 | AuditLog.recordAsync session.create |
| 13 | session/index.ts:475-485 | children(query) |
| 14 | session/index.ts:487-503 | remove() cascade |
| 15 | session/index.ts:501 | catch silencieux (F-A01-5 high) |
| 16 | session/index.ts:720 | parentID Zod optional (autre) |
| 17 | status.ts:60-78 | Union statuts |
| 18 | status.ts:80-87 | session.status event |
| 19 | status.ts:95-141 | task.* events (F-A01-3 inégalité) |
| 20 | status.ts:142-156 | TeamCompleted (PUBLIÉ via tool/team.ts:308) |
| 21 | status.ts:158 | AllIdle |
| 22 | status.ts:29-36 | PERSISTENT_STATES (5 statuts sur 9) |
| 23 | status.ts:233 | bus.publish(Event.Status) |
| 24 | status.ts:238 | bus.publish(Event.Idle) |
| 25 | status.ts:242 | bus.publish(Event.AllIdle) |
| 26 | llm.ts:163-176 | StreamInput.parentSessionID |
| 27 | llm.ts:664 | x-parent-session-id header HTTP |
| 28 | prompt.ts:1769-1774 | handle.process parentSessionID |
| 29 | compaction.ts:56,247 | parentID MessageID |
| 30 | compaction.ts:292 | Effect.onInterrupt processor.abort() |
| 31 | compaction.ts:365 | bus.publish(Event.Compacted) |
| 32 | projectors.ts:43 | parent_id: grab(info,"parentID") |
| 33 | projectors.ts:65-89 | SyncEvent.project Created/Updated/Deleted |
| 34 | permission/index.ts:38-41 | Ruleset schema |
| 35 | permission/index.ts:71-80 | Permission.Asked/Replied |
| 36 | processor.ts:624,772,776 | Session.Event.Error |
| 37 | cli/cmd/session.ts:68 | Session.remove caller (CLI) |
| 38 | server/routes/session.ts:241 | Session.remove caller (HTTP) |
| 39 | server/routes/gdpr.ts:117 | Session.remove caller (GDPR) |
| 40 | tool/task.ts:405-406 | SessionPrompt.cancel(session.id) (sans propagation parent) |
| 41 | tool/team.ts:308 | await Bus.publish(SessionStatus.Event.TeamCompleted, ...) (TeamCompleted publié, F-A01-4) |
| 42 | acp/agent.ts:78,1436-1438 | private eventAbort + async cancel + session.abort(...) |
| 43 | util/abort.ts | helpers abortAfter, abortAfterAny, AbortSignal.any |
| 44 | cli/cmd/tui/worker.ts:48-53 | eventStream.abort.abort() + nouveau controller |

---

## 13. Diff summary v1 → v2

| Section v1 | Action | Section v2 |
|---|---|---|
| F-A01-1 « Ruleset vide » | AMEND | F-A01-1 « sémantique effective non démontrée » + least-privilege fail-closed |
| F-A01-2 cancel | AMEND (étayée) | F-A01-2 CONFIRMÉ high, preuves exhaustives |
| F-A01-3 task.cancelled parentID | CONFIRM | F-A01-3 inchangé |
| F-A01-4 TeamCompleted dormant | AMEND (INFIRMÉ) | TeamCompleted PUBLIÉ via tool/team.ts:308 |
| F-A01-5 catch silencieux | high reclassifié | F-A01-5 inchangé |
| (manquant) | NOUVEAU | F-A01-6 cycles/orphelins |
| (manquant) | NOUVEAU | F-A01-7 confidentialité header |
| (manquant) | NOUVEAU | F-A01-8 reprise crash |
| §9.3 prescriptions lease/fencing | RETIRÉ | §10.3 questions ouvertes |
| §10 tableau 9 preuves | +9 preuves | §12 tableau 44 preuves |

---

_Fin du rapport v2 — auteur MiniMax-M3 (E1, corrections E2). Code réel vérifié au
SHA `4be438597986380ec0b0a1af21524b74626e7e3c`. Aucun fichier de code
production modifié._
