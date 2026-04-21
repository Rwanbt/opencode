# Sprint 4 — Notes d'implémentation (2026-04-18)

Branche : `dev`. Aucun commit effectué (commit proposé par thématique, voir §Découpage).
Validation :
- `bun run typecheck` (tsgo) → **0 erreurs**.
- `bun test` ciblé (dag-team, ws-ticket, jwt, scanner, auth, permission, session) → **245+115+14 pass, 0 fail**.
- `cargo check --release` desktop → **0 warning, 0 erreur** (keyring v3.6.3 ajouté).
- `cargo check` mobile → **0 warning, 0 erreur**.

## Statut par item

### 1 — Retention purger audit_log — **FAIT**
- `packages/opencode/src/session/audit.ts` : ajout `purgeExpired()` (DELETE WHERE ts < now - retention_days\*86400000), `startRetentionTimer()` (setInterval 24h + `unref()` + premier passage immédiat), `stopRetentionTimer()`.
- Gate `experimental.audit.enabled === true`.
- Branchement : `packages/opencode/src/cli/cmd/serve.ts` appelle `AuditLog.startRetentionTimer()` juste après `Server.listen`.
- **Test manuel** : inserer 2 rows (`ts` < now-100j), lancer serve → compter rows → attendu 0.

### 2 — AuditLog call-sites — **FAIT**
Points instrumentés (tous via `recordAsync`, best-effort, gate `experimental.audit.enabled`):
- `Session.createNext` (couvre `create` et `fork`) → `action: "session.create"`.
- `Session.remove` → `action: "session.remove"`.
- `Auth.set` / `Auth.remove` (dynamic import pour casser le cycle `audit → config → auth`) → `action: "auth.set|remove"`.
- `/task/:id/cancel` route → `action: "task.cancel"`.
- `Permission.reply` (reject→`permission.deny`, approved→`permission.grant` avec scope `once|always`).
- Route `PATCH /config` → `action: "config.update"` avec `metadata.changedKeys` (clés top-level seulement, jamais les valeurs).
- **Cycle évité** via dynamic import côté Auth uniquement (Config → Auth est statique, Auth → Audit → Config fermerait la boucle).
- **Test manuel** : `POST /session` + `DELETE /session/:id` avec `audit.enabled=true` + `GET /audit?action=session.remove` → entry visible.

### 3 — GDPR delete étendu — **FAIT**
`packages/opencode/src/server/routes/gdpr.ts` handler DELETE purge maintenant :
- Worktrees sandbox : itère `Project.list()` → `Workspace.list(project)` → `Workspace.remove(ws.id)` (qui délègue à l'adaptor, `git worktree remove` inclus).
- Répertoire `<datadir>/crashes/*.json` + `rmdir` best-effort.
- `Database.close()` **avant** `fs.unlink` du DB file (évite EBUSY Windows sur SQLite).
- SQLite sidecars : supprime `-wal`, `-shm`, `-journal`.
- `Database.Path` ajouté à la liste unlink (préservant ENOENT tolerance).
- **Test manuel** : `curl -XDELETE -H "X-Confirm-Delete: yes" localhost:4096/user/data` → 204 ; `<datadir>/` ne contient plus `opencode.db`, `crashes/`, ni worktrees sur disque.

### 4 — Provider fallback câblage — **SQUELETTE**
- `packages/opencode/src/provider/fallback.ts` : ajout `resolveFallbackDirection()` qui lit `experimental.provider.fallback` et retourne `"local"|"cloud"|null`.
- Design du wrapper streamText détaillé en commentaire bloc (gestion handshake-vs-mid-stream, stratégie "propager si fail après first chunk") — non implémenté.
- **Pourquoi pas câblé** : le pipeline `session/llm.ts` utilise `streamText()` du SDK `ai`, pas de point d'injection trivial (primary/secondary doivent être résolus *avant* de construire le `LanguageModelV2`, et le retry sur handshake demande de buffer la première lecture du stream — risque de régression non maîtrisé sans harness provider mock).
- **Risque résiduel** : B2/provider fallback encore désactivé par défaut. Pas de breaking change.
- **Test manuel** : `withFallback(() => Promise.reject(Object.assign(new Error("x"), {status:503})), () => Promise.resolve("ok"))` → "ok". `resolveFallbackDirection()` retourne `null` hors config.

### 5 — E2E DAG harness — **PARTIEL (harness enrichi + skeleton e2e)**
- `packages/opencode/test/e2e/dag-team.test.ts` :
  - Ajout d'un `dispatchDag()` qui simule l'ordonnancement réel (parallélisme intra-vague, séquentialité inter-vagues, passage des outputs comme contexte).
  - 3 nouveaux tests : ordre explore+critic→tester, pas d'orphelins, propagation d'échec.
  - Le bloc `describe.skip("full e2e")` conserve les instructions de setup ; nouveau commentaire explicite sur la pièce manquante (`withInProcessServer` helper, team tool runtime bootstrap).
- **Rationale skip maintenu** : le vrai harness demande la suite complète (permission/Instance/Workspace scopes) qui n'est pas montée par `test/preload.ts`.
- **Test manuel** : `bun test test/e2e/dag-team.test.ts` → 6 pass, 2 skip.

### 6 — B1 Keychain — **SQUELETTE PROPRE + impl Rust**
- **Desktop (Rust) FAIT** : `packages/desktop/src-tauri/src/auth_storage.rs` — 4 commandes Tauri (`auth_storage_{get,set,delete,list}`) basées sur `keyring = "3"` (features `apple-native`, `windows-native`, `sync-secret-service`, `vendored`).
  - Namespace `opencode.<service>` ; registry JSON `<data_dir>/auth.keychain-index.json` pour permettre l'énumération cross-platform.
  - `get` tolère `NoEntry` (retourne `None`) pour permettre migration.
  - Enregistré dans `lib.rs::make_specta_builder()` et `collect_commands![...]`.
- **Côté TypeScript SQUELETTE** : `packages/opencode/src/auth/index.ts` expose `AuthStorage` interface + `KeychainStorage` stub + `AUTH_BACKEND` env switch (`OPENCODE_AUTH_STORAGE`, défaut `"file"`).
  - **KeychainStorage.load/save throw** pour l'instant car le sidecar (Bun) n'a pas de channel `invoke` direct vers le shell Tauri — la solution (localhost-only endpoint avec token one-shot au spawn sidecar) est documentée dans le commentaire de la classe.
- **Android** : design-only en commentaire (EncryptedSharedPreferences + plugin Tauri dédié).
- **CLI fallback AES-GCM** : design-only (Argon2id TOFU non-rotatable).
- **Migration transparente** : logique documentée (load→keychain sinon `auth.json`→keychain→rename `auth.json.migrated`→purge 7j). Non activée.
- **Aucune régression** : `FileStorage` existant reste le backend actif.
- **Test manuel** : `cargo check --release` desktop OK (keyring compile). Côté TS pas de test runtime (adapter dormant).

### 7 — B2 WS auth refactor — **FAIT (serveur) + SQUELETTE clients**
- `packages/opencode/src/server/auth-jwt.ts` :
  - `issueWsTicket(user)` / `verifyWsTicket(token)` — JWT 60s avec `kind:"ws-ticket"` pour bloquer la confusion access-token ↔ ws-ticket.
  - Middleware : ordre 1) `Authorization` header, 2) `Sec-WebSocket-Protocol: bearer,<jwt>`, 3) cookie `opencode_ws_ticket`, 4) query-string legacy (gated `experimental.ws_auth_legacy`, défaut true).
- `packages/opencode/src/server/routes/auth.ts` : endpoint `POST /auth/ws-ticket` consomme la session courante (Basic ou JWT), émet un ticket, set-cookie HttpOnly+SameSite=Strict+Max-Age=60+Secure (si TLS). Répond `{ticket, expiresAt}`.
- `packages/opencode/src/config/config.ts` : `experimental.ws_auth_legacy: z.boolean().optional()` ajouté.
- **Clients non migrés** : desktop/mobile/web continuent d'utiliser la query-string pour cette sprint (legacy flag = true par défaut). À migrer Sprint 5 en consommant `/auth/ws-ticket` avant le upgrade WS et en passant le subprotocol `bearer,<jwt>`.
- **Baseline Playwright non ajouté** : `packages/app` n'a pas de Playwright installé. À la place, `packages/opencode/test/server/ws-ticket.test.ts` couvre le contrat crypto (issue/verify, rejet kind-mismatch, expiry).
- **Test manuel** : `curl -X POST -u opencode:pw localhost:4096/auth/ws-ticket` → `{ticket, expiresAt}`. Vérifier Set-Cookie `opencode_ws_ticket=...; HttpOnly; SameSite=Strict; Max-Age=60`.

## Risques résiduels

1. **Provider fallback non câblé sur streamText** — helper + resolver prêts, wrapper LMv2 non implémenté. Design complet en commentaire dans `fallback.ts`.
2. **KeychainStorage TS non wirable depuis le sidecar** — manque channel IPC. Deux options documentées (localhost endpoint w/ one-shot token, stdin IPC). Sprint 5.
3. **Clients WS non migrés** — `ws_auth_legacy` défaut `true` pour éviter breakage. Flip à `false` bloqué jusqu'à migration app/desktop/mobile.
4. **Audit Config.update capture top-level keys only** — sous-niveaux (ex: `experimental.collaborative.jwt_secret`) ne remontent pas dans `changedKeys`. Acceptable car un log de "quelque chose sous `experimental` a changé" est tracé.
5. **Retention purger exécute un DELETE synchrone** en cas de purge massive — acceptable car sur timer 24h, mais un premier passage sur un DB énorme pourrait lock brièvement. Mitigation naturelle : indexed on `ts`.
6. **GDPR delete après DB close** — les appels post-close à `Session.remove` sont déjà terminés avant la purge de worktrees, mais si `Workspace.remove` ré-ouvre une connexion (via l'adaptor) ça pourrait ressusciter le DB. Audit manuel : `Workspace.remove` n'utilise Database.use *qu'avant* la purge (tous appels via adaptor Git/fs restants sont hors-DB).
7. **`auth.keychain-index.json` n'est pas chiffré** — acceptable : il contient seulement les *noms* de providers (déjà exportés via `/user/data/export`), pas les secrets.

## Découpage de commits proposé

1. `feat(audit): retention purger + daemon timer` — audit.ts, serve.ts.
2. `feat(audit): instrument session/auth/permission/task/config call sites` — session/index.ts, auth/index.ts, permission/index.ts, server/routes/{task,config}.ts.
3. `feat(gdpr): extend DELETE to purge DB, crashes, worktrees` — server/routes/gdpr.ts.
4. `feat(provider): fallback direction resolver + streamText wrapper design` — provider/fallback.ts.
5. `test(e2e): dispatch-level DAG harness (explore/critic/tester)` — test/e2e/dag-team.test.ts.
6. `feat(desktop): Tauri keychain commands via `keyring` crate` — packages/desktop/src-tauri/{src/auth_storage.rs,src/lib.rs,Cargo.toml}.
7. `feat(auth): AuthStorage interface + KeychainStorage stub (not wired)` — auth/index.ts.
8. `feat(server): /auth/ws-ticket endpoint + cookie/subprotocol middleware` — server/auth-jwt.ts, server/routes/auth.ts, config/config.ts.
9. `test(server): ws-ticket crypto baseline` — test/server/ws-ticket.test.ts.
10. `docs: SPRINT4_NOTES.md` — SPRINT4_NOTES.md (ce fichier).

## Fichiers modifiés

- `packages/opencode/src/session/audit.ts` (+60L — purger, timer)
- `packages/opencode/src/session/index.ts` (+14L — AuditLog hook)
- `packages/opencode/src/auth/index.ts` (+80L — AuthStorage scaffold, AuditLog dynamic)
- `packages/opencode/src/permission/index.ts` (+20L — AuditLog hooks)
- `packages/opencode/src/cli/cmd/serve.ts` (+4L — startRetentionTimer)
- `packages/opencode/src/server/routes/task.ts` (+2L — AuditLog on cancel)
- `packages/opencode/src/server/routes/config.ts` (+8L — AuditLog on update)
- `packages/opencode/src/server/routes/gdpr.ts` (+60L — worktrees, crashes, DB close)
- `packages/opencode/src/server/routes/auth.ts` (+45L — /ws-ticket endpoint)
- `packages/opencode/src/server/auth-jwt.ts` (+80L — ticket issue/verify, middleware ordering)
- `packages/opencode/src/provider/fallback.ts` (+60L — streamText wrapper design, resolver)
- `packages/opencode/src/config/config.ts` (+6L — ws_auth_legacy)
- `packages/desktop/src-tauri/src/lib.rs` (+6L — module + commands)
- `packages/desktop/src-tauri/Cargo.toml` (+5L — keyring dep)

## Fichiers créés

- `packages/desktop/src-tauri/src/auth_storage.rs`
- `packages/opencode/test/server/ws-ticket.test.ts`
- `SPRINT4_NOTES.md`
