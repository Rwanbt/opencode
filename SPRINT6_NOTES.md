# Sprint 6 — Notes d'implémentation (2026-04-18)

Branche `dev`. Aucun commit effectué.

## Validation

- `bun run typecheck` (monorepo, via turbo) → **0 erreur** sur les 14 packages (`@opencode-ai/{app,mobile,desktop,ui,opencode,...}`).
- `cd packages/opencode && bun test` complet → **2114 pass, 26 skip, 1 todo, 0 fail** en ~350 s (174 fichiers, 6121 assertions).
- `cd packages/opencode && bun test test/auth/` → **4 pass, 0 fail**.
- `cd packages/opencode && bun test test/provider/ test/e2e/dag-team.test.ts test/server/ws-ticket.test.ts test/lib/in-process-server.test.ts` → **280 pass, 2 skip, 0 fail**.
- `cd packages/desktop/src-tauri && cargo check --release` → 0 warning, 0 erreur.
- `cd packages/mobile/src-tauri && cargo check` → 0 warning, 0 erreur (le `println!("cargo:warning=...")` affiché provient du `build.rs` ORT et est purement informatif, pas un warning rustc).

## Statut par item

### 5 — Fallback resolver cloud customisable — FAIT

- `packages/opencode/src/config/config.ts` : schema élargi — `experimental.provider.fallback_cloud_providerID: z.string().nullable().optional()`.
- `packages/opencode/src/session/llm.ts::resolveSecondaryLanguageModel` : branche override en tête du cas `direction === "cloud"`. Validation :
  - providerID absent de `Provider.list()` → `log.warn` + fallback sur l'ordre d'itération historique.
  - providerID === primary → `log.warn` (éviterait un no-op) + fallback default.
  - provider trouvé mais sans modèle ou `getLanguage` échoue → `log.warn` + fallback default.
- Pattern documenté : déclarer un provider rapide/bon marché (Haiku, Gemini Flash) et le pointer ici — ex. `experimental.provider.fallback_cloud_providerID: "anthropic"`.
- Gate global inchangé : `experimental.provider.fallback=null` par défaut → resolver jamais appelé.
- Test manuel : `Config` + mock provider dans `test/provider/mock-provider.test.ts` couvre l'exercice de `withStreamingFallback` ; le override est une décision pré-handshake isolée, validable par inspection.
- **Risque résiduel** : si le config JSON loguait fallback_cloud_providerID d'un provider qui n'a plus de modèle après un upgrade models.dev, le resolver dégrade silencieusement — warn visible, comportement correct.

### 2 — Auth.layer → KeychainStorage + initAuthStorage() au boot — FAIT

- `packages/opencode/src/auth/index.ts` :
  - Nouveau `selectKeychain()` : retourne `KeychainStorage` si `OPENCODE_AUTH_STORAGE=keychain` **et** `kc.available()` (URL + token injectés par le sidecar). Sinon retourne `undefined`. Warn one-shot si l'env dit "keychain" mais l'URL manque (cas CLI headless).
  - `Auth.layer` : lecture/écriture routées vers `keychain.load()` / `keychain.save()` quand activé ; sinon `FileStorage` comme avant.
  - Lecture keychain : si l'endpoint lève une erreur transitoire (ex. endpoint mort), on catch dans le `try` du `Effect.tryPromise`, on log warn, et on retombe sur `auth.json`. Jamais de crash.
  - Écriture keychain : propagée comme `AuthError` via `Effect.tryPromise.catch` — seule voie de remontée d'erreur métier (pas de fallback silencieux à l'écriture sinon données divergentes).
- `packages/opencode/src/cli/cmd/serve.ts` : `await initAuthStorage()` appelé juste avant `Server.listen()` (donc après `CrashReporter.init()` qui tourne dans `index.ts` avant tout CLI command). Garantit qu'un `auth.json` existant est migré **avant** que la première route Auth ne soit servie.
- **Sécurité** : `OPENCODE_AUTH_STORAGE=keychain` sans `OPENCODE_KEYCHAIN_URL` → warn + `FileStorage`. Jamais de crash boot.
- Test manuel CLI : `OPENCODE_AUTH_STORAGE=keychain bun packages/opencode/src/index.ts serve` → warn visible, fonctionne sur file.
- Test manuel desktop : à dérouler manuellement avec le sidecar (non scripté ici — voir item 4 pour le round-trip endpoint isolé).
- Tests automatisés : `bun test test/auth/` reste vert (4 pass) — par défaut `AUTH_STORAGE_BACKEND=file`, aucun changement de comportement.
- **Risque résiduel** : la sélection est capturée **au moment** de l'évaluation du layer (memoized par `makeRuntime`). Un test qui flip `OPENCODE_AUTH_STORAGE` runtime n'aura aucun effet ; il faut instancier un nouveau runtime.

### 3 — Migrer les 3 call sites WS legacy — FAIT (1 migré, 2 documentés non-applicable)

Analyse des 3 call sites WS client identifiés par grep `new WebSocket` :

| Call site | Décision | Raison |
|-----------|----------|--------|
| `packages/app/src/components/terminal.tsx` (`/pty/:id/connect`) | **MIGRÉ** | Basic auth → `createAuthenticatedWebSocket` (ticket flow). |
| `packages/app/src/hooks/use-collaborative.ts` (`/ws/events`) | **N/A** | Endpoint sur le tenant SST, auth par `token=` opaque — pas consommable par `/auth/ws-ticket` local. Commentaire ajouté. |
| `packages/web/src/components/Share.tsx` (`/share_poll`) | **N/A** | Endpoint public anonyme (read-only share viewer), aucune credential à passer. Commentaire ajouté. |

- `packages/app/src/components/terminal.tsx` :
  - Ajout de l'import `createAuthenticatedWebSocket`.
  - Remplacement du `new WebSocket(next)` par `createAuthenticatedWebSocket(auth.url, wsPath, { authorization: "Basic ..." })`.
  - La fonction `open()` reste sync ; le socket est désormais construit dans un `.then()`. Les listeners (`handleOpen/Message/Error/Close`) et le `drop = stop` sont câblés **dans** le `.then()` pour respecter le cleanup :
    - Si `disposed === true` avant la résolution du ticket → `ws2.close(1000)` et on retourne sans câbler.
    - `retry()` est appelé dans le `.catch()` si la fetch échoue — le backoff existant re-tente `open()`.
  - Le reconnect existant (backoff exponentiel via `retry()`) est préservé intégralement.
- `packages/app/src/utils/ws-auth.ts` : checklist de tête mise à jour (terminal.tsx coché).
- **Gate inchangé** : `experimental.ws_auth_legacy = true` (défaut) — le serveur accepte encore la query-string, donc même si `/auth/ws-ticket` échoue, le fallback legacy dans le helper repasse par le comportement précédent.
- Test manuel : ouvrir un terminal PTY dans l'app desktop, vérifier qu'un POST `/auth/ws-ticket` passe dans devtools puis que le WS upgrade se fait via `Sec-WebSocket-Protocol: bearer,<jwt>` (inspecter la frame d'upgrade). En cas d'indispo du ticket endpoint (serveur < sprint 4), vérifier le fallback query-string.
- **Risque résiduel** : le cas `disposed` pendant la fetch est couvert, mais le `open()` synchrone retourne désormais avant que le socket soit monté — si l'appelant mesurait `ws.readyState` immédiatement après `open()`, le résultat serait `CONNECTING` (garanti) ou même `undefined` (pendant la fetch). Le code existant ne lit `ws` qu'à travers `ws?.close()` et `ws?.send()` (null-safe), donc pas de régression identifiée.

### 1 — Instance.runForTest refactor — SQUELETTE (describe.skip inchangé)

- **Livré** : `packages/opencode/test/lib/with-instance-for-test.ts` — `withInstanceForTest(fn, opts?)` qui wrappe `fn` dans `Instance.provide` sur un tmpdir frais (ou `opts.directory`), expose `Instance.directory/worktree/project` via ALS, dispose l'instance en cleanup (best-effort) et purge le tmpdir.
- **Non livré (scope >2h confirmé)** : installation de Layer in-memory pour `InstanceState`, `Bus`, `SessionStatus`, `Session`, `Task`, `Permission`, plus seed du `Provider` registry vers le mock provider. Ces services dépendent d'une refactorisation Effect.Layer non-triviale qui risque d'impacter le suite session existante (270 pass actuels).
- **Checklist détaillée** inscrite en tête du fichier (ce qui est `[x]` fait vs `[ ]` à faire). Idem commentaire actualisé dans `test/e2e/dag-team.test.ts::describe.skip(...)`.
- **Conséquence** : le `describe.skip("DAG team — full e2e")` reste skip. Les tests `dispatchDag` actifs (6 pass) continuent de garder le contrat d'ordonnancement.

### 4 — Runtime test keychain endpoint — FAIT

- `packages/opencode/test/lib/keychain-smoke.ts` : script Bun standalone (`#!/usr/bin/env bun`). Lit `OPENCODE_KEYCHAIN_URL` + `OPENCODE_KEYCHAIN_TOKEN`, fait PUT → GET (match) → DELETE → GET (404), exit 0 si tout OK sinon 1.
- Documentation inline (header JSDoc) : procédure pour récupérer les env vars depuis les logs du shell desktop.
- **Commande de test manuel** :
  ```bash
  # 1. Lancer le desktop et relever dans ses logs :
  #    keychain endpoint listening at http://127.0.0.1:XXXXX  (port)
  #    (le token apparaît aussi dans les logs au même endroit)
  export OPENCODE_KEYCHAIN_URL=http://127.0.0.1:XXXXX
  export OPENCODE_KEYCHAIN_TOKEN=<token>
  bun run packages/opencode/test/lib/keychain-smoke.ts
  ```
- **Non exécuté ici** (aucune session desktop disponible en CI). À valider manuellement avant release.

## Risques résiduels

1. **Item 1 (DAG e2e)** : toujours skippé. `withInstanceForTest` ne couvre que l'ALS — manque Provider mock seam + Permission in-memory. Reportable sans impact utilisateur (c'est du test infra).
2. **Item 2 (Auth.layer)** : sélection capturée à la construction du Layer. Si un utilisateur flip `OPENCODE_AUTH_STORAGE` à chaud (relance sidecar), le comportement ne change qu'au prochain boot — attendu. Documenté.
3. **Item 3 (terminal.tsx)** : `open()` devient async de facto. Le cleanup `disposed` est couvert. Aucun autre call site ne mesure `ws.readyState` immédiatement après `open()`.
4. **Item 4 (smoke test)** : non exécuté en CI, requiert un desktop vivant.
5. **Item 5 (fallback resolver)** : validation providerID se fait au runtime de chaque stream — pas de pre-check boot. Première requête avec un override invalide log un warn au lieu d'échouer fast. Acceptable (le fallback est opt-in, une direction null suffit à désactiver).
6. **Keychain endpoint jamais testé e2e** : on a `cargo check` + smoke script isolé, mais aucun passage `sidecar → endpoint → OS keychain → retour` vérifié automatiquement. Reste une tâche manuelle pré-release.

## Découpage de commits proposé

1. `feat(provider): customisable cloud fallback providerID via experimental.provider.fallback_cloud_providerID` — `config/config.ts`, `session/llm.ts`.
2. `feat(auth): wire KeychainStorage into Auth.layer with file fallback on transport errors` — `auth/index.ts`.
3. `feat(cli): call initAuthStorage() at serve boot (after CrashReporter.init)` — `cli/cmd/serve.ts`.
4. `refactor(app): migrate terminal WS to createAuthenticatedWebSocket (ticket flow + legacy fallback)` — `components/terminal.tsx`.
5. `docs(app): annotate ws-auth checklist and non-applicable call sites` — `utils/ws-auth.ts`, `hooks/use-collaborative.ts`, `packages/web/src/components/Share.tsx`.
6. `test(lib): withInstanceForTest helper skeleton (ALS only, service layers TODO)` — `test/lib/with-instance-for-test.ts`, update `test/e2e/dag-team.test.ts` skip block.
7. `test(lib): keychain endpoint runtime smoke script` — `test/lib/keychain-smoke.ts`.
8. `docs: SPRINT6_NOTES.md`.

## Fichiers modifiés / créés

### Créés
- `packages/opencode/test/lib/with-instance-for-test.ts` (~90 L)
- `packages/opencode/test/lib/keychain-smoke.ts` (~85 L)
- `SPRINT6_NOTES.md` (ce fichier)

### Modifiés
- `packages/opencode/src/config/config.ts` (+9 L — fallback_cloud_providerID schema)
- `packages/opencode/src/session/llm.ts` (+35 L — override resolver + warns)
- `packages/opencode/src/auth/index.ts` (+60 L net — selectKeychain, keychain branches in all/set/remove)
- `packages/opencode/src/cli/cmd/serve.ts` (+12 L — initAuthStorage call + import)
- `packages/app/src/components/terminal.tsx` (refactor bloc ~50 L — async socket construction via helper, listeners câblés dans `.then()`)
- `packages/app/src/utils/ws-auth.ts` (header checklist à jour)
- `packages/app/src/hooks/use-collaborative.ts` (commentaire N/A)
- `packages/web/src/components/Share.tsx` (commentaire N/A)
- `packages/opencode/test/e2e/dag-team.test.ts` (skip block commentaire actualisé)
