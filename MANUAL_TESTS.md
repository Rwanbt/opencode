# Tests manuels — Sprints 1 / 2 / 3

Consolidation des tests manuels à exécuter avant de pousser `dev → main`.
Référence : [PRODUCTION_REVIEW_2026-04.md](./PRODUCTION_REVIEW_2026-04.md), [SPRINT1_NOTES.md](./SPRINT1_NOTES.md), [SPRINT2_NOTES.md](./SPRINT2_NOTES.md), [SPRINT3_NOTES.md](./SPRINT3_NOTES.md).

Commits :
- `09860cd9a` docs (README + audit doc)
- `0b5dac32f` sprint1
- `cd3780c8d` sprint2
- `d22962e07` sprint3

---

## Pré-requis

- Device Android physique (Sprint 1 B3). Émulateur insuffisant — tester aussi sur OEM (Samsung, Xiaomi) si possible.
- Accès à un serveur OpenCode LAN (`http://192.168.x.y:4096`) pour Sprint 1 B3.
- Un projet test avec un dépôt Git, et pouvoir créer un symlink `ln -s`.
- Deux serveurs MCP déclarés avec noms à risque (`github`, `github_enterprise`).
- `curl` ou Postman pour les endpoints REST.
- Un modèle GGUF principal + un drafter `*-0.5B-*.gguf` à côté (Sprint 2 W4).
- Accès à Settings → Actions côté GitHub pour Sprint 1 B6.

---

## Sprint 1 — Blockers & Warnings initiaux

### B3 — Android cleartext LAN-only
1. Connexion `http://192.168.x.y:4096` depuis l'app mobile en mode Remote → **doit fonctionner**.
2. Connexion `http://example.com:4096` (IP publique HTTP) → **doit échouer** `CLEARTEXT_NOT_PERMITTED`.
3. Loopback `127.0.0.1` (sidecar embarqué) → **OK**.
4. ⚠️ Vérifier sur Xiaomi (MIUI) et Samsung : `includeSubdomains` sur IP n'est pas 100% AOSP-standard.

### B4 — Timeouts Ollama
1. Couper le wifi pendant `listModels` Ollama distant → erreur après **~15s**, pas de hang.
2. `pull()` d'un modèle 7B doit aller jusqu'au bout (aucun timeout).

### W7 — MCP scoping collision
1. Config avec deux MCP `github` et `github_enterprise`, chacun un tool `list`.
2. Agent avec `scope.allow = ["github"]` → **seul** `github_list` est exposé.
3. `github_enterprise_list` **absent** de l'agent.

### W8 — CORS allowlist
1. XHR depuis `https://docs.opencode.ai` → header CORS OK.
2. XHR depuis `https://evil.opencode.ai` → **rejeté** (pas de header).
3. DevTools depuis `http://localhost:3000` → OK.

### W9 — Shell env allowlist
1. `export FOO_API_KEY=xxx && opencode` → la variable **n'apparaît pas** dans l'env sidecar (check logs).
2. `export LC_ALL=en_US.UTF-8 && opencode` → transmise.
3. `export OPENCODE_LLAMA_MODELS_DIR=/custom && opencode` → transmise.
4. ⚠️ Vérifier que les MCP qui dépendaient de `GITHUB_TOKEN` héritée fonctionnent toujours (ils devraient passer par config, pas env).

### W5 — Circuit breaker LLM (déjà en place)
1. Provoquer 3 mismatches modèle consécutifs en <120s → throw `"llama-server restart loop detected"`.

### B5 — Symlink escape (déjà en place)
1. `ln -s /etc/passwd docs/evil` puis `File.read("docs/evil")` → throw `"symlink escapes project directory"`.
2. Symlink interne `ln -s src/foo.ts docs/foo.ts` → OK.

### B6 — Supply chain (CI)
1. Push la branche → workflow **CodeQL** dans Actions, vert sur JS/TS.
2. `Actions → SBOM → Run workflow` → artifacts `opencode-sbom.spdx.json` + `opencode-sbom.cyclonedx.json`.
3. Settings → Security → Dependabot alerts : PRs weekly arrivent au prochain lundi.
4. ⚠️ Prévoir un batch review du premier run Dependabot (monorepo = beaucoup de deps).

---

## Sprint 2 — Hardening

### W1 — Cost-cap REST tasks
1. `opencode.json` : `experimental.task.cost_cap: 0.01`.
2. Lancer une task, dépenser au-delà de $0.01.
3. `POST /task/:id/followup` → **HTTP 429** `{error:"cost_cap_exceeded", used, cap}`.
4. `GET /task/:id` → champs `costUsed` et `costCap` présents.

### W2 — WorktreeInfo typing
1. Forcer une erreur DB Workspace (ligne corrompue, ID inexistant).
2. Log `warn "getWorktreeInfo failed"` avec le `workspaceID` en contexte (plus de silence).

### W3 — MessageCost helper
1. `GET /task/:id/team` → le champ `cost` par membre reste correct.
2. `bun run typecheck` → 0 erreurs.

### W4 — llama-server flags
1. Démarrer llama-server. Inspecter les args lancés → doit contenir :
   `--mmap --slots --slot-save-path <tmp>/opencode-llm-14097/kv-slots --cache-reuse 256`.
2. Déposer un `*-0.5B-*.gguf` à côté du modèle principal → logs doivent afficher `speculative decoding enabled` si VRAM ≥4 GiB, sinon `skipping speculative decoding`.
3. `OPENCODE_DRAFT_MODEL=<abs>` → force le drafter indiqué.
4. `OPENCODE_DRAFT_FORCE=1` → bypass le guard VRAM.
5. ⚠️ Surveiller stderr sur petite VRAM (4 GiB est une heuristique).

### W6 — Semaphore background tasks
1. `opencode.json` : `experimental.task.max_parallel: 2`.
2. Orchestrator lance 5 tâches `mode:"background"`.
3. Les 2 premières passent `queued → busy`, les 3 autres **restent `queued`**.
4. À chaque Completed/Failed/Cancelled, une tâche queued démarre **FIFO**.

### B1 — Design seulement
Aucun test runtime — design inline dans `auth/index.ts`. Implémentation Sprint 4.

---

## Sprint 3 — Observabilité & Enterprise

### I1 — Crash reporter
1. Provoquer un `throw` dans un middleware CLI (ex. patch temporaire).
2. Fichier `<datadir>/crashes/<iso>_<kind>.json` créé avec stack, version, platform.
3. Vérifier le mode 0o600 (POSIX : `stat -c %a`).
4. Générer 51 crashes → le plus ancien est purgé.
5. Avec `experimental.crash.upload_endpoint: "https://…"`, le POST est émis (timeout 10s).

### I3 — RGPD export / delete
1. `curl -X GET localhost:4096/user/data/export` → stream JSON `{version, exportedAt, sessions:[…], providers:[…]}`.
2. `curl -X DELETE localhost:4096/user/data` → **400** `missing_confirmation`.
3. `curl -X DELETE -H "X-Confirm-Delete: yes" localhost:4096/user/data` → **204**.
4. Vérifier : `auth.json`, `opencode.jsonc|json`, `config.json` supprimés.
5. ⚠️ Limite connue : `<datadir>/crashes/`, la DB et les worktrees ne sont **pas** purgés (Sprint 4).

### I4 — Audit log
1. `experimental.audit.enabled: true` dans la config.
2. Depuis REPL : `AuditLog.record({ action: "test", target: "x", force: true })`.
3. `GET /audit` → entry visible.
4. `GET /audit?from=<iso>&to=<iso>&action=test&limit=10` → filtrage OK.
5. ⚠️ Non branché sur session/auth/permission/task/config — seuls GDPR endpoints émettent pour l'instant.

### I7 — Scanner étendu
1. `bun test test/security/scanner.test.ts` → **tous verts**, 12 nouveaux cas.
2. Smoke : écrire un fichier avec `xoxb-1234567890-abc`, `sk_live_1234…`, `ghp_…`, `AIza…`, `sk-ant-…`, `sk-proj-…` → scanner doit flagger chacun.
3. Tester SQL injection Ruby `"SELECT * WHERE id = %{user}"`, Python f-string `f"SELECT * WHERE id = {user}"` → flagged.
4. Avec `experimental.dlp.scan_tool_outputs: true`, injecter dans un tool output `ignore previous instructions` → flag `prompt-injection`.

### I9 — Thermal listener (squelette)
1. `OPENCODE_THERMAL_FORCE=1` + `invokeThermal` mocké retournant `"severe"`.
2. `detectProfile().thermalState` → `"critical"`.
3. `deriveConfig` applique `thermalMult = 0.5`.
4. ⚠️ Android physique : `get_thermal_state` renvoie toujours `"nominal"` (JNI non câblé, Sprint 4).

### I10 — Cascading fallback
1. REPL : `withFallback(() => { throw Object.assign(new Error("x"), {status:503}) }, () => "ok")` → `"ok"`.
2. `withFallback(() => { throw new Error("fetch failed") }, () => "ok")` → `"ok"`.
3. `withFallback(() => { throw new DOMException("", "AbortError") }, () => "ok")` → **re-throw** (intent utilisateur).
4. ⚠️ Helper non câblé dans `streamText` — aucun changement de comportement par défaut.

### I11 — DAG team (squelette)
1. `bun test test/e2e/dag-team.test.ts` → **3 passed, 2 skipped**.
2. Les 3 unit-guards couvrent : waves correctes (explore+critic deps tester), rejet cycles, chaîne linéaire.
3. Full e2e : instructions de setup dans le `describe.skip`, à câbler Sprint 4 avec mock provider.

---

## Tests transverses avant merge

### Typecheck
- [ ] `cd packages/opencode && bun run typecheck` → 0 erreurs.
- [ ] `bun run typecheck` root → 0 erreurs sur les packages touchés.

### Tests unitaires
- [ ] `bun test packages/opencode/test/security` → tous verts.
- [ ] `bun test packages/opencode/test/e2e/dag-team.test.ts` → 3 passed.
- [ ] Suite globale `bun turbo test:ci` → vert.

### Rust
- [ ] `cd packages/desktop/src-tauri && cargo check --release` → vert.
- [ ] `cd packages/mobile/src-tauri && cargo check --release` → vert.
- [ ] `cargo clippy -- -D warnings` → propre.

### Build
- [ ] `cd packages/opencode && bun run build --single` → sidecar TS à jour (prérequis avant tauri build, cf. CLAUDE.md).
- [ ] `bun tauri build` desktop → APK/MSI/dmg signés (quand cosign sera ajouté).
- [ ] `bun tauri android build` → APK release (ORT_LIB_LOCATION à positionner, cf. memory).

### Scans sécurité CI (une fois la branche poussée)
- [ ] CodeQL workflow passe (JS/TS).
- [ ] Dependabot first run : triage des PRs.
- [ ] SBOM run manuel → artifacts SPDX + CycloneDX présents.
- [ ] `bun audit` → 0 high/critical (à lancer localement).
- [ ] `cargo audit` → 0 high/critical (local).
- [ ] `gitleaks detect --redact` → 0 finding (local).

### Compat & régression
- [ ] Cold start desktop <2s hors chargement modèle.
- [ ] Cold start mobile <6s sur milieu de gamme.
- [ ] 100 messages + 10 abort/retype → heap WebView stable (invalide/valide AUDIT_REPORT A.3).
- [ ] Kill -9 pendant inference → reprise propre, état 9 restauré.
- [ ] Kill -9 pendant téléchargement modèle → resume HTTP Range OK.

---

## Dette documentée (hors scope sprints)

- **B2** — WS auth query-string → Bearer. Sprint 4 avec e2e harness préalable.
- **B1 runtime** — keychain OS (design livré, impl à faire).
- **AuditLog call-sites** — greffe sur session/auth/permission/task/config.
- **GDPR delete étendu** — purger `<datadir>/crashes/`, DB, worktrees sandbox.
- **Thermal JNI** — brancher `PowerManager.getCurrentThermalStatus()` + listener push (crates `jni` + `ndk-context` à ajouter).
- **Provider fallback câblage** — injecter `withFallback` dans `streamText`.
- **Cosign/sigstore** — signature artefacts release (dépend de secrets repo).
- **Retention purger audit_log** — job périodique selon `retention_days`.

---

## Sign-off

- [ ] Tous les tests Sprint 1 OK
- [ ] Tous les tests Sprint 2 OK
- [ ] Tous les tests Sprint 3 OK
- [ ] Tests transverses OK
- [ ] Release notes rédigées (mentionner breaking change W9 shell env)
- [ ] PR `dev → main` ouverte
