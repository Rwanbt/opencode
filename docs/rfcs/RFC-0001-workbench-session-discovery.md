<!-- SPDX-License-Identifier: MIT -->

# RFC-0001 : Découverte de nouvelles sessions workbench sans polling nominal
**Auteur** : MiniMax-M3 (carte E13) | **Date** : 2026-08-24 | **Statut** : Review (carte E13 du plan performance)

## Motivation

Le serveur Workbench (`packages/workbench-server/src/index.ts`,
méthode `#workspaceEvents`) ouvre **un** flux SSE par workspace mais
doit fusionner les événements de **toutes** les sessions de ce workspace.
`RuntimeAdapter` (contrat `@unifia/contracts/runtime`) est strictement
session-scoped — `subscribeEvents({ sessionId })` existe, mais aucune
primitive `subscribeEvents({ workspaceId })` ou `onSessionCreated()`
n'est exposée.

Le code compense par un `setInterval(listSessions, 5_000)` :

```ts
pollTimer = setInterval(() => {
  this.#runtime.listSessions({ workspaceId }).then((sessions) => {
    for (const session of sessions) addSession(session.id)
  }).catch(() => { /* transient listSessions failure: keep streaming already-known sessions */ })
}, this.#workspaceEventsPollMs)  // 5_000 ms
```

Trois problèmes documentés dans le plan P1-A :

1. **Polling nominal** : 12 appels `listSessions`/minute par workspace
   actif, alors qu'en régime stable aucune nouvelle session n'est créée
   (les utilisateurs ouvrent un workspace puis tapent des prompts, ils
   ne créent pas 12 sessions/minute). Le coût n'est pas linéairement
   catastrophique mais il est inutile et il s'ajoute à la charge du
   runtime.
2. **Erreurs avalées** : le `.catch(() => {})` masque les pannes
   transitoires du runtime. Le client ne voit jamais que la
   découverte est dégradée ; le polling continue, le client continue
   d'envoyer des prompts, mais les sessions créées pendant la panne
   sont perdues.
3. **Pas de pause inactive** : le polling tourne alors que l'onglet
   est caché, alors que la quasi-totalité des `listSessions` qui
   découvrent quelque chose le font en foreground. L'API
   `document.visibilityState` n'est consultée nulle part.

## Proposition détaillée

**Option recommandée (push + fallback borné).**

### Étape 1 — Étendre `RuntimeAdapter` avec un hook push

```ts
// packages/contracts/src/runtime.ts
export interface RuntimeAdapter {
  // ... existing
  /** Fires when a session is created in the given workspace.
   *  WHY: the workbench stream needs to discover new sessions in
   *  O(1) instead of polling listSessions every 5 s. Returns an
   *  unsubscribe handle — the caller MUST call it on stream close. */
  onSessionCreated(scope: WorkspaceScope, callback: (session: Session) => void): () => void
}
```

Implémentations :

- **FakeRuntimeAdapter** (in-memory) : trivial, `$callback(session)` après
  `createSession()`. Test : `fake.test.ts` ouvre deux sessions, vérifie
  que le callback est appelé deux fois et que le `unsubscribe()` coupe
  la troisième.
- **OpenCodeRuntimeBackend** (runtime OpenCode existant) : c'est là
  que le travail est réel. Le backend écoute l'event bus interne
  (`Session.created` dans le projet OpenCode) et appelle le callback.
  Si l'event bus n'expose pas cet événement : fallback de polling
  **interne au backend**, invisible pour le workbench server. La
  surface contractuelle reste le push, la performance est l'affaire
  du backend.
- **UnifiaRuntimeAdapter** (futur) : hérite de l'event bus interne.

### Étape 2 — Workbench server consomme le hook

```ts
// #workspaceEvents
const unsubscribeNewSessions = this.#runtime.onSessionCreated(
  { workspaceId },
  (session) => addSession(session.id),  // existing helper
)
cancel: async () => {
  unsubscribeNewSessions()  // symmetric with the SSE cancel
  // ... existing teardown
}
```

### Étape 3 — Polling borné en fallback (optionnel mais documenté)

Le polling actuel est conservé UNIQUEMENT si le runtime ne supporte
pas `onSessionCreated` (détection via `typeof adapter.onSessionCreated
!== "function"`). Dans ce cas, le polling applique :

- **Backoff exponentiel** quand `listSessions` ne découvre rien de
  nouveau (1 s → 2 s → 5 s → 10 s, plafond 30 s).
- **Reset au tick productif** : dès qu'une nouvelle session est
  trouvée, retour à 1 s.
- **Pause sur onglet caché** : `document.visibilityState === "hidden"`
  côté client envoie un signal (header `x-unifia-visibility: hidden`)
  que le serveur respecte en ne polant pas.
- **Jitter ±20 %** sur le délai.
- **Métriques** : `workbench.polling.ticks_total`, `.ticks_productive`,
  `.ticks_empty`, `.errors_total` (exportées via le canal de
  télémétrie existant).
- **Erreurs exposées** : `.catch(reason => log.error(...))` au lieu
  de `.catch(() => {})`. Si `listSessions` échoue 3 fois de suite,
  le stream émet un événement de status `discovery.degraded` que le
  client peut afficher dans l'UI (« La découverte des sessions est
  momentanément indisponible »).

### Étape 4 — Côté client

`WorkbenchEventDispatcher` ne change pas (il reçoit déjà un `WorkspaceEvent`
parsé, pas la liste des sessions). Le seul changement est que la
boucle `for await (const event of client.events(...))` reçoit
désormais les nouvelles sessions au moment où elles sont créées
plutôt qu'au prochain tick 5 s plus tard. Pas d'API publique à
modifier côté app.

## Alternatives considérées

### A. Workspace-scoped `subscribeEvents`

`RuntimeAdapter.subscribeEvents({ workspaceId })` qui retourne un
seul `AsyncIterable<RuntimeEvent>` déjà fusionné.

**Pourquoi rejetée** : le runtime OpenCode (et la majorité des
runtimes agentiques existants) modélise les sessions comme des
unités indépendantes avec leurs propres `sessionId` et leur propre
backpressure. Fusionner en amont côté runtime force le runtime à
maintenir l'ordre cross-session, ce qu'il ne sait pas faire
correctement (les `sequence` numbers sont per-session dans le
contrat actuel, donc une fusion naïve perd la garantie
monotone-par-session que `WorkbenchEventDispatcher` exploite pour
détecter les gaps et demander un resync).

### B. Polling plus intelligent seul (sans push)

Backoff, jitter, pause, métriques — sans étendre le contrat.

**Pourquoi rejetée comme solution unique** : le plafond reste
borné par la latence du polling (au mieux 1 s après création d'une
session, au pire 30 s en backoff). Pour une UX d'agent conversationnel
où l'utilisateur attend la confirmation de création, 30 s est
inacceptable. Le push est nécessaire pour ramener la latence à
« dès que l'event bus du runtime le sait ».

### C. HTTP long-poll avec un endpoint dédié

`POST /v1/workspaces/:id/sessions/wait` qui hang jusqu'à la
prochaine création de session (timeout 30 s, retry immédiat).

**Pourquoi rejetée** : complique le transport (le client a déjà
un SSE ouvert, devoir en parallèle gérer un long-poll double la
surface d'erreur), n'apporte rien que le push ne fait pas
mieux, et consomme un descripteur de fichier par workspace
au lieu d'un event interne.

### D. WebSocket

`/v1/workspaces/:id/ws` qui remplace complètement le SSE.

**Pourquoi rejetée à ce stade** : SSE suffit pour des événements
unilatéraux serveur→client. WebSocket ajoute de la bidirectionnalité
qu'on n'utilise pas (le client a déjà `POST /v1/sessions/.../prompt`
pour les commandes). Migration à considérer le jour où on a besoin
d'événements client→server persistés, mais hors scope de ce RFC.

## Questions ouvertes

1. **OpenCodeRuntimeBackend** : l'event bus interne expose-t-il
   réellement `Session.created` ou faut-il monkey-patcher le
   `Session.create()` du package ? La réponse change le périmètre
   de E13i (le fallback polling-interne-augmented-si-push-impossible
   est acceptable mais doit être documenté comme tel).
2. **Multiples subscribers par workspace** : si le client A et le
   client B ouvrent chacun un SSE sur le même workspace, doit-on
   avoir UN `onSessionCreated` callback par workspace partagé entre
   les deux SSE, ou un par SSE ? Le contrat push est côté runtime,
   pas côté workbench, donc c'est au workbench d'agréger. Décision
   triviale : un `Set<callback>` par workspace côté workbench,
   démantelé quand le dernier SSE ferme.
3. **Backwards compat** : `FakeRuntimeAdapter` est utilisé dans
   `real-transport.test.ts` (test qui today poll 5 s). Si on
   implémente le push, le polling devient un test mort. Le test
   devrait être réécrit pour vérifier le push (c'est l'objet
   d'E13i, pas de ce RFC).

## Délai de review : 2026-08-31

Une fois accepté, E13i implémente l'option recommandée. Le critère
d'acceptation d'E13i est :

- 0 polling nominal quand le runtime supporte `onSessionCreated`.
- Si fallback polling, backoff exponentiel + jitter + pause onglet
  caché + métriques exposées + erreurs loggées (pas avalées).
- `0 listSessions`/`30s` mesuré sur un workspace Work stable
  (vs `12 listSessions`/`30s` aujourd'hui).
- Le test `real-transport.test.ts` est réécrit pour piloter le
  push et prouve l'arrivée d'un événement de session < 100 ms après
  `createSession()`.
