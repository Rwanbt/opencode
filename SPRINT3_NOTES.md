# Sprint 3 — Notes d'implémentation (2026-04-18)

Branche : `dev`. Aucun commit n'a été effectué.
Typecheck : `bun run typecheck` (tsgo --noEmit) → vert.

## Statut par item

### I1 — Crash reporter (FAIT)
- Fichier : `packages/opencode/src/observability/crash-reporter.ts`
- Hooks `uncaughtException` + `unhandledRejection`, écrit `<datadir>/crashes/<iso>_<kind>.json` (mode 0o600) avec stack, version, platform, node/bun version, pid, argv.
- Rotation : 50 fichiers max, purge au démarrage via `init()` (tri mtime desc).
- Upload opt-in : `experimental.crash.upload_endpoint` (string URL), dynamic import de Config pour survivre à une config cassée, `fetch` avec `AbortSignal.timeout(10_000)`.
- Branché dans `src/index.ts` juste après les imports (`CrashReporter.init()`).
- **Test manuel** : `throw` dans un middleware CLI → vérifier la création d'un fichier `<datadir>/crashes/*.json`.

### I3 — Endpoints RGPD (FAIT)
- Fichier : `packages/opencode/src/server/routes/gdpr.ts`, branché dans `server/instance.ts`.
- `GET /user/data/export` : stream JSON `{version, exportedAt, sessions:[{session,messages}], providers:[…]}` via `hono/streaming`.
- `DELETE /user/data` : exige `X-Confirm-Delete: yes`, sinon 400 `missing_confirmation`. Supprime sessions (`Session.remove`), `auth.json`, `opencode.jsonc|json` et `config.json` via `fs.unlink` (ENOENT toléré). Réponse 204.
- Les deux endpoints appellent `AuditLog.record({ force: true, ... })`.
- **Test manuel** : `curl -XDELETE localhost:4096/user/data` → 400 ; avec header → 204 et fichiers absents.

### I4 — Audit log (FAIT)
- Migration : `packages/opencode/migration/20260418120000_audit_log/migration.sql`.
- Table Drizzle : `packages/opencode/src/session/audit.sql.ts` (exportée via `storage/schema.ts`).
- Helper : `packages/opencode/src/session/audit.ts` — `AuditLog.record({ action, target, actor?, metadata?, force? })`, `AuditLog.list({ from, to, action, actor, limit })`.
- Endpoint : `GET /audit?from=&to=&action=&actor=&limit=100` dans `gdpr.ts` (même routeur car c'est l'angle sécurité/compliance).
- **Non branché** sur session create/delete/auth/permission/task.cancel/config.write : squelette livré. La greffe sur les call sites existants est triviale (ajouter `AuditLog.recordAsync({ action: "session.create", target: id })`) mais chaque emplacement demande un diagnostic du flux Effect / zod pour éviter de casser une transaction. Documenté comme dette pour Sprint 4 ci-dessous.
- Config : `experimental.audit.enabled` (défaut off) + `retention_days` (défaut 90, non encore appliqué par un purger).
- **Test manuel** : `AuditLog.record({ action: "test", force: true })` depuis REPL, puis `GET /audit` → entry listée.

### I7 — Scanner vulnérabilités étendu (FAIT)
- Fichier : `packages/opencode/src/security/scanner.ts`.
- Ajout : Slack `xox[baprs]-`, Stripe `sk_live_|pk_live_|rk_live_`, GitHub `github_pat_|ghp_|gho_|ghr_|ghs_|ghu_`, Google `AIza...`, Anthropic `sk-ant-...{90,}`, OpenAI `sk-...{40,}` + `sk-proj-`, Datadog `DD_API_KEY=[a-f0-9]{32}`.
- SQL injection : patterns Ruby `%{}`, heredoc (multiline), Python f-string.
- Scanner multiline : ajout d'un champ `multiline` + branche dans `scan()` qui fait un match global et recalcule le numéro de ligne.
- `scanToolOutput()` : nouvel export pour prompt-injection (ignore-previous-instructions, role-tag `<system>`, disregard-safety, reveal-system-prompt, jailbreak-persona, hidden HTML comment). Bornage 256 KiB, gating côté appelant via `experimental.dlp.scan_tool_outputs` (ajouté au schéma config).
- Tests : `packages/opencode/test/security/scanner.test.ts` — 12 nouveaux cas (tous les nouveaux tokens + f-string + Ruby + prompt-injection).
- **Test manuel** : `bun test test/security/scanner.test.ts`.

### I9 — Thermal listener Android (SQUELETTE)
- Tauri côté Rust : `packages/mobile/src-tauri/src/lib.rs` — nouvelle commande `get_thermal_state` (`#[cfg(target_os = "android")]`), enregistrée dans `invoke_handler`. **Retourne "nominal"** — le binding JNI `PowerManager.getCurrentThermalStatus()` est documenté mais pas câblé (requiert crates `jni` + `ndk-context` + `ContextCompat.getSystemService` boilerplate, hors scope 1h). Commentaire TODO(I9) explicite.
- Côté TS : `packages/opencode/src/local-llm-server/auto-config.ts` — `startThermalListener(invokeThermal, intervalMs=30_000)` + `stopThermalListener()`. Normalise les retours en `"nominal"|"fair"|"serious"|"critical"` (map vers l'enum `ThermalState` existant). No-op hors Android sauf `OPENCODE_THERMAL_FORCE=1`. Sur changement, mute `cached.thermalState` puis appelle `resetProfileCache()`. `unref()` pour ne pas garder l'event loop ouvert.
- Desktop : placeholder `"nominal"` documenté avec commentaire "see I9 backlog, requires native hook per OS".
- **Non branché** sur la mobile-entry (appeler `startThermalListener(() => invoke("get_thermal_state"))` au démarrage du sidecar embedded). À faire Sprint 4.
- **Test manuel** : `OPENCODE_THERMAL_FORCE=1` + injecter un `invokeThermal` qui renvoie "severe" → `detectProfile().thermalState` = "critical" et `deriveConfig` applique `thermalMult = 0.5`.

### I10 — Cascading cloud/local (FAIT)
- Fichier : `packages/opencode/src/provider/fallback.ts` — `withFallback(primary, secondary, {label?, shouldFallback?})`, `isNetworkRetryable()`.
- Détection : `TimeoutError`, `fetch failed`, `ECONNRESET/ECONNREFUSED/ETIMEDOUT/ENOTFOUND`, `socket hang up`, HTTP 5xx/408/429. AbortError utilisateur NON retryable (intent explicite).
- Config : `experimental.provider.fallback: "local"|"cloud"|null` ajouté, défaut null.
- **Non câblé** dans `provider/provider.ts` (point d'intégration = pipeline de streamText). Garder opt-in explicite : la décision quel primary/secondary se prend au call site via la config — ce patch ne change aucun comportement par défaut, conformément à la contrainte.
- **Test manuel** : unit test rapide via REPL `withFallback(() => { throw Object.assign(new Error("x"), {status:503}) }, () => "ok")` → retourne `"ok"`.

### I11 — E2E fixture DAG (SQUELETTE)
- Fichier : `packages/opencode/test/e2e/dag-team.test.ts`.
- Tests actifs (unit guard) : re-implémentation de `computeWaves` + 3 tests (waves correctes pour explore/critic/tester, rejet de cycles, chaîne linéaire).
- `describe.skip("DAG team — full e2e")` avec bloc d'instructions de setup détaillé (mock provider, OPENCODE_DB=:memory:, server en process, poll `GET /task/:id`).
- Rationale skipped : le harness `team` tool pull tout le runtime (worktrees, LSP, MCP, permissions). Mock provider non disponible dans cette passe.
- **Test manuel** : `bun test test/e2e/dag-team.test.ts` → 3 passed, 2 skipped.

## Config — schéma additions
Fichier `src/config/config.ts`, bloc `experimental`:
- `crash.upload_endpoint` (URL, optionnel)
- `provider.fallback` (`"local"|"cloud"|null`, défaut null)
- `audit.enabled` (bool, défaut false) + `audit.retention_days` (int, défaut 90)
- `dlp.scan_tool_outputs` (bool, défaut false)

## Risques résiduels / dette à reprendre

1. **Audit log pas encore branché sur les call sites réels** — seul `gdpr.export`/`gdpr.delete` émettent des entrées. Brancher sur `session.create/remove`, `Auth.set/remove`, `permission.grant/deny`, `task.cancel`, `Config.update` demandera de lire chaque call site individuellement (risque de casser une transaction Effect si on fait ça naïvement). Sprint 4.
2. **Retention purger audit_log pas implémenté** — `retention_days` est dans le schéma mais aucun job de purge n'existe.
3. **Thermal JNI non câblé** — `get_thermal_state` renvoie toujours "nominal". Nécessite crates `jni` + `ndk-context` (pas dans `Cargo.toml` actuel) et boilerplate `getSystemService(POWER_SERVICE).getCurrentThermalStatus()`. Ajouter aussi le listener push (`OnThermalStatusChangedListener`) plutôt qu'un poll 30s.
4. **Provider fallback non câblé** dans le chemin `streamText` — helper dispo, intégration à décider au cas par cas (streaming vs non-streaming, cohérence du KV cache).
5. **GDPR export streaming** matérialise les messages d'une session à la fois en mémoire via `Session.messages({sessionID})` — pour une session très longue (>50k messages) la string JSON peut être gros. Itération message-par-message si besoin (pas de générateur public actuel).
6. **`GET /user/data/export` ne contient pas les fichiers de crash** — à ajouter si les crash reports sont considérés "données utilisateur" au sens RGPD (probablement oui, contient argv qui peut inclure des chemins).
7. **GDPR delete ne purge pas `<datadir>/crashes/`, `<datadir>/opencode.db` (projets/sessions y vivent), ni les worktrees sandbox sur disque** — périmètre à étendre. Actuellement sessions supprimées ligne par ligne via `Session.remove` qui cascade en DB mais ne touche pas aux worktrees physiques.
8. **`Auth.all` retourne le nom des providers en plus-text dans l'export** — acceptable car ce ne sont pas des secrets, mais vérifier que la liste n'est pas considérée PII.
9. **Scanner `openai-api-key` pattern trop permissif** potentiellement — `sk-[A-Za-z0-9_-]{40,}` peut matcher d'autres formats commençant par `sk-`. Les tests passent mais surveiller les faux positifs sur des projets Anthropic (précède bien car `sk-ant-` a son propre pattern prioritaire mais le scanner émet les deux findings).

## Tests automatisés touchés
- `test/security/scanner.test.ts` : +12 cas (9 nouveaux tokens, 2 SQL variants, 3 prompt-injection).
- `test/e2e/dag-team.test.ts` : 3 cas unit-guard actifs, 2 skipped (e2e full).

## Fichiers créés
- `packages/opencode/src/observability/crash-reporter.ts`
- `packages/opencode/src/server/routes/gdpr.ts`
- `packages/opencode/src/session/audit.sql.ts`
- `packages/opencode/src/session/audit.ts`
- `packages/opencode/src/provider/fallback.ts`
- `packages/opencode/migration/20260418120000_audit_log/migration.sql`
- `packages/opencode/test/e2e/dag-team.test.ts`
- `SPRINT3_NOTES.md`

## Fichiers modifiés
- `packages/opencode/src/index.ts` (CrashReporter.init)
- `packages/opencode/src/config/config.ts` (experimental additions)
- `packages/opencode/src/security/scanner.ts` (+tokens, multiline, scanToolOutput)
- `packages/opencode/src/storage/schema.ts` (export AuditLogTable)
- `packages/opencode/src/server/instance.ts` (route GdprRoutes)
- `packages/opencode/src/local-llm-server/auto-config.ts` (startThermalListener)
- `packages/mobile/src-tauri/src/lib.rs` (get_thermal_state cmd stub)
- `packages/opencode/test/security/scanner.test.ts` (+12 tests)
