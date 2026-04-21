# Pre-production Review — OpenCode Fork (2026-04-18)

> Audit staff-level de pré-production du fork OpenCode.
> Périmètre : monorepo Bun (`packages/*`), crates Rust (`crates/*`), app mobile Android (`packages/mobile`), sidecar CLI (`packages/opencode`).
> Méthode : lecture directe + recoupement des audits existants (AUDIT_REPORT.md, SECURITY_AUDIT.md, ANDROID_AUDIT.md, PERFORMANCE_REPORT.md, KNOWN_ISSUES.md). Les findings déjà listés sont référencés (`cf. AUDIT_REPORT.md A.x`), les findings **nouveaux** détectés par cette passe sont préfixés `P*`.
> Aucun `bun audit` / `cargo audit` / `gitleaks` n'a été exécuté (non disponibles dans l'environnement) — les points de vérification sont explicitement listés dans la checklist.

---

## 1. Résumé exécutif

Le fork est **architecturalement mûr** (auto-config llama.cpp, DAG d'agents, worktrees isolés, 9 états de tâches, scanner vulns, prompt caching Anthropic). Les 4 passes d'audit précédentes ont fermé la majorité des findings critiques (CSP, cost underflow, devtools, tokenizer, reasoning budget, lifecycle Android). Cependant **plusieurs blockers ouverts empêchent un merge `dev → main` immédiat** : `auth.json` plaintext, WebSocket auth via query-string visible dans les logs, cleartext global sur Android, absence de signature/SBOM des artefacts, aucun scan dépendance automatisé, absence de budget cost-cap côté utilisateur (task REST `POST /:id/followup` sans rate-limit ni quota).

**Note : 72 / 100**
**Verdict : GO CONDITIONNEL** — merge possible sous réserve de traiter les BLOCKERS B1–B6 ci-dessous. Les warnings W1–W9 peuvent suivre dans les deux sprints post-merge.

---

## 2. BLOCKERS (bloquent merge main)

### B1 — `auth.json` tokens OAuth/API en clair sur disque
- **Sévérité** : critique
- **Fichier** : `packages/opencode/src/auth/index.ts` (cf. SECURITY_AUDIT S1.S2)
- **Impact utilisateur** : une sauvegarde complète du `$HOME` (Time Machine, Backblaze, `adb backup` côté Android) exfiltre les tokens Anthropic/OpenAI/Copilot. Mode 0o600 ne protège que les autres utilisateurs locaux.
- **Remédiation** : migration keychain OS (`keytar` côté desktop, `EncryptedSharedPreferences` via plugin Tauri côté Android). Au minimum : chiffrement AES-GCM avec clé dérivée DPAPI / Keychain / libsecret.
- **Effort** : L

### B2 — WebSocket auth en query-string `?authorization=` logguée
- **Sévérité** : critique
- **Fichier** : `packages/opencode/src/server/auth-jwt.ts:110-145` (cf. SECURITY_AUDIT S1.S1)
- **Impact utilisateur** : credentials Basic-auth visibles dans `logcat`, proxies d'entreprise, access logs nginx. En pairing LAN sur Wi-Fi partagé, un sniffeur passif récupère la session.
- **Remédiation** : header custom via Tauri command native (tauri-plugin-http + tungstenite) ; en desktop, handshake cookie one-shot avant upgrade. Limiter le WS à `127.0.0.1` pour le desktop (déjà partiellement le cas).
- **Effort** : M

### B3 — Android `network_security_config.xml` `cleartextTrafficPermitted="true"` global
- **Sévérité** : critique
- **Fichier** : `packages/mobile/src-tauri/gen/android/app/src/main/res/xml/network_security_config.xml` (cf. SECURITY_AUDIT S2.S2)
- **Impact utilisateur** : combiné avec B2, un attaquant sur le même Wi-Fi peut intercepter les credentials en HTTP non TLS. Scope global au lieu du LAN RFC1918 uniquement.
- **Remédiation** : `<base-config cleartextTrafficPermitted="false" />` + `<domain-config cleartextTrafficPermitted="true">` uniquement pour `10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`. QA sur device physique requis.
- **Effort** : S

### B4 — Fetch sans timeout (Ollama probe + OAuth token POST)
- **Sévérité** : haute (blocker car impacte fiabilité en production)
- **Fichier** : `packages/opencode/src/mcp/oauth-callback.ts`, `packages/opencode/src/local-models/ollama.ts` (cf. SECURITY_AUDIT S1.V2)
- **Impact utilisateur** : un IdP/serveur Ollama lent bloque indéfiniment l'Effect scope, fuite de file descriptors et abonnés SSE. DoS trivial depuis un serveur malicieux déclaré par l'utilisateur.
- **Remédiation** : wrapper `AbortSignal.timeout(15000)` (pattern déjà utilisé dans `webfetch.ts` / `websearch.ts`).
- **Effort** : S

### B5 — `File.read` ne normalise pas les symlinks
- **Sévérité** : critique
- **Fichier** : `packages/opencode/src/file/index.ts:305-665` (cf. SECURITY_AUDIT S1.V3)
- **Impact utilisateur** : exfiltration arbitraire. `Instance.containsPath` empêche `..` mais un symlink `project/docs -> /etc/shadow` contourne le guard. Un repo Git malicieux (dep npm, git clone) plante un symlink, l'agent est incité à `read("docs/...")`.
- **Remédiation** : `fs.lstat(resolved)` + rejet si `isSymbolicLink()` et la cible résolue n'est pas sous `Instance.directory`.
- **Effort** : M

### B6 — Pas de scan dépendances / pas de SBOM / pas de signature d'artefacts
- **Sévérité** : critique (supply chain)
- **Fichier** : `.github/workflows/*.yml` — aucun `dependabot.yml`, aucun `codeql.yml`, aucun `trivy`/`grype`, aucun `cosign`/`sigstore` (vérifié : 33 workflows, aucun ne matche `dependa|codeql|trivy|sbom|cosign|sign`)
- **Impact utilisateur** : aucun signalement de CVE critique dans `bun.lock` / `Cargo.lock`. APKs / binaires desktop non signés cryptographiquement → impossible pour un utilisateur de vérifier la provenance.
- **Remédiation** :
  1. Ajouter `.github/dependabot.yml` (npm/Bun + cargo + github-actions).
  2. Activer GitHub secret scanning + push protection côté repo settings.
  3. Workflow `codeql.yml` (JS/TS + Rust via `codeql-action`).
  4. Générer SBOM SPDX/CycloneDX via `anchore/sbom-action` sur release.
  5. Signer APK/dmg/msi via `sigstore/cosign` ou GitHub attestation `actions/attest-build-provenance`.
- **Effort** : M

---

## 3. WARNINGS (≤2 semaines post-merge)

### W1 — Pas de per-session cost-cap ni rate-limit sur `POST /task/:id/followup` (P-NEW)
- **Sévérité** : haute
- **Fichier** : `packages/opencode/src/server/routes/task.ts:318-399`
- **Impact** : si le serveur REST est exposé au-delà de `127.0.0.1` (mode LAN pairing), un client authentifié peut enchaîner `followup` sans plafond token/coût → facture cloud explosive, local-llm saturé. Le handler `await SessionStatus.set(id, { type: "busy" })` est la seule barrière, pas de quota cumulé.
- **Remédiation** : budget cumulé par session (token + USD), refus 429 au-delà. Expose la limite via `GET /task/:id` (`costCap`, `costUsed`).
- **Effort** : M

### W2 — `getWorktreeInfo` avale toute erreur silencieusement (P-NEW)
- **Sévérité** : moyenne
- **Fichier** : `packages/opencode/src/server/routes/task.ts:20-27`
- **Impact** : un bug Workspace (DB corrompue, permission) renvoie `undefined` silencieusement → l'UI affiche "pas de worktree" au lieu d'une erreur traçable. Plus `as any` sur `workspaceID` ligne 21.
- **Remédiation** : log warn, typage strict `WorkspaceID`.
- **Effort** : S

### W3 — `(msg.info as any).cost` dans l'agrégat `team` (P-NEW)
- **Sévérité** : moyenne
- **Fichier** : `packages/opencode/src/server/routes/task.ts:505`
- **Impact** : si le schéma `MessageV2.Assistant` ajoute/supprime `cost`, silence pendant le typecheck — l'UI peut faire passer `0` pour un vrai coût.
- **Remédiation** : extraire dans un helper typé `getCost(msg)` avec narrowing.
- **Effort** : S

### W4 — Auto-config sans prompt cache / slot KV / mmap (P-NEW)
- **Sévérité** : haute (perf)
- **Fichier** : `packages/opencode/src/local-llm-server/index.ts:464-489` (`buildArgs`)
- **Impact** : aucun `--slots` / `--cache-reuse` / `--n-predict`, `--mmap` non explicitement activé (défaut llama.cpp), pas de `--draft-model` / speculative decoding. Sur Qwen3-Coder 32B + drafter 0.6B, perte de 40–60% de tokens/s et zéro réutilisation de préfixe entre tours → chaque message relance la prefill complète. Impact utilisateur direct : latence perçue 2–3×.
- **Remédiation** :
  1. Ajouter `--slot-save-path` + `--cache-reuse 256` + `--mmap` explicite.
  2. Exposer `OPENCODE_DRAFT_MODEL` pour speculative decoding ; auto-probe si un drafter `*-0.5B-*.gguf` est présent à côté du modèle principal.
  3. Persister le KV cache du tour précédent (`--prompt-cache`).
- **Effort** : L

### W5 — Restart loop `ensureCorrectModel` sans circuit breaker
- **Sévérité** : haute
- **Fichier** : `packages/opencode/src/local-llm-server/index.ts:508-554` (cf. AUDIT_REPORT A.8, **toujours ouvert**)
- **Impact** : VRAM churn + batterie Android si mismatch de nom.
- **Remédiation** : compteur module-level, fail-hard après 3 restarts/2 min.
- **Effort** : S

### W6 — `background` task sans limite de concurrence (P-NEW)
- **Sévérité** : haute
- **Fichier** : `packages/opencode/src/tool/task.ts:159-292`
- **Impact** : un agent orchestrator peut lancer N tâches `mode: "background"` en parallèle → N worktrees Git créés (disque), N prompts llama-server qui se battent pour la VRAM, N connexions SSE. Pas de sémaphore, pas de queue.
- **Remédiation** : semaphore par projet (max 4 par défaut), queue FIFO ; les tâches en excès passent en `queued` au lieu de `busy`. Config : `experimental.task.max_parallel`.
- **Effort** : M

### W7 — MCP scoping : `.startsWith(sanitize(serverName) + "_")` peut collider (P-NEW)
- **Sévérité** : moyenne
- **Fichier** : `packages/opencode/src/mcp/index.ts:681-687`
- **Impact** : deux serveurs MCP `foo` et `foo_bar` — une tool `foo_bar_list` est attribuée aux deux si scoping strict. Préfixe non suffixé par séparateur unique.
- **Remédiation** : séparer name + tool via un délimiteur non-ambigu (`::` ou un Map name→toolKeys maintenue au `listTools`).
- **Effort** : S

### W8 — CORS regex subdomains `*.opencode.ai`
- **Sévérité** : moyenne
- **Fichier** : `packages/opencode/src/server/server.ts:64-88` (cf. SECURITY_AUDIT S2.A1)
- **Impact** : sous-domaine de preview compromis → CSRF le serveur local.
- **Remédiation** : allowlist explicite.
- **Effort** : S

### W9 — Shell env `*_API_KEY` propagée au sidecar
- **Sévérité** : moyenne
- **Fichier** : `packages/desktop/src-tauri/src/cli.rs:371-480` (cf. SECURITY_AUDIT S2.S1)
- **Remédiation** : allowlist `SHELL_ENV_KEYS`.
- **Effort** : S

---

## 4. AMÉLIORATIONS (backlog)

- **I1** — Observabilité : pas de crash reporter opt-in (Sentry/Bugsnag absent). Les stack traces llama-server sont tronquées 4096 B (cf. AUDIT_REPORT A.17). Ajouter un crash reporter local-first (log rotatif) + opt-in upload.
- **I2** — Feature flags : `cfg.experimental?.*` utilisé mais pas de système centralisé (toggle runtime, kill switch). Introduire un module `flags/` consommé par les call sites.
- **I3** — Export / suppression RGPD : aucun endpoint `DELETE /user/data` ni export JSON. Pour un mode "entreprise", obligatoire.
- **I4** — Audit logs multi-tenant : les events `SessionStatus.Event.*` sont publiés sur le bus mais non persistés pour audit. Ajouter `audit_log` Drizzle table.
- **I5** — BYOK : actuellement les API keys sont en `auth.json` et inhérentes au user. Un mode BYOK par projet (override `.opencode/byok.json` chiffré) manque pour un usage entreprise.
- **I6** — Batch API : pas d'utilisation de `messages/batches` Anthropic ni OpenAI batch. Pour les tâches `background` non urgentes, économie 50%.
- **I7** — Scanner vulnérabilités intégré (`security/scanner.ts`) : bonnes règles de base, **mais**
  - `sql-injection` pattern ne détecte que `${...}` ou `+ user` — manque `%{user}`, format-strings Python, heredocs.
  - Pas de scan de `tool.output` avant affichage côté UI (prompt injection → exfil de secrets).
  - Pas de détection Slack/Stripe/Datadog/GitHub token modernes (regex limités à AWS/JWT/generic).
- **I8** — `auto-config.ts` ne détecte pas le NPU (Qualcomm Hexagon, Apple Neural Engine, Intel NPU). Pour mobile Snapdragon 8 Gen 3, une delegation NPU (via ExecuTorch / QNN) gagnerait 3–5× tokens/s vs GPU Adreno.
- **I9** — Thermal listener Android JNI documenté comme "deferred mobile work" (KNOWN_ISSUES). À prioriser pour une release publique.
- **I10** — Cascading models : un helper "si modèle local échoue → cloud fallback" absent. Seul `deriveConfig` throw si pas de GPU ; pas de chemin de dégradation.
- **I11** — Tests : aucun test E2E qui couvre le DAG d'agents (orchestrator → explore → critic), seulement des unit tests par tool. Écrire un E2E fixture "debug + propose patch + review".
- **I12** — Dupliquer `auth-jwt` côté mobile vs desktop — pas de test d'intégration qui vérifie qu'une session survit à un kill + restart sidecar (reprise 9 états).

---

## 5. Détail par pilier

### 5.1 Fiabilité

- **Gestion d'erreur** : 70 occurrences de `as any` dans `packages/opencode/src/` (vérifié par grep), dont 10 dans `session/index.tsx` TUI et 3 dans `session/prompt.ts`. Un seul `catch {}` strictement vide (`global/index.ts`). Les erreurs de task REST (`/resume`, `/followup`) ont un **double catch** imbriqué pour être sûres de publier `TaskFailed` — cf. `task.ts:294-313` — ce qui est bien, mais rend le code dense.
- **Tests** : pipeline `unit + e2e (Playwright)` sur linux/windows (`.github/workflows/test.yml`). Pas de matrice Android/iOS. Pas de bench régression (cf. PERFORMANCE_REPORT §3).
- **Reprise après crash** : 9 états persistés (`session/status.ts:29-36`) — bien. `SessionStatus.set` écrit en DB **avant** d'updater l'in-memory → OK si DB write fail (état in-memory restera cohérent). `Database.use` dans `persistToDb` / `readFromDb` protégé par `try/catch` silencieux (`status.ts:173`, `192`) — acceptable car best-effort documenté.
- **Worktree lifecycle** (`worktree/index.ts`) : `remove` va jusqu'à `branch -D`, `reset` fait `submodule update --recursive` + `clean -ffdx`. Manque : `git worktree prune --verbose` appelé au démarrage pour nettoyer les worktrees orphelins (après crash desktop).
- **Task DAG** : `TaskTool` crée session enfant, Publish `TaskCreated`/`Completed`/`Failed`. Bug potentiel → W6 (pas de limite concurrence).

### 5.2 Performance

- Cold start : cf. PERFORMANCE_REPORT §1 (HP1 = +400 ms CLI, +1-2 s mobile dû à 20+ SDKs importés statiquement). Non fixé.
- llama.cpp config : W4 ci-dessus, trou significatif (pas de prompt caching local, pas de speculative decoding, pas de slot save).
- Scalabilité backend : serveur Hono + Bun. Pas de pool DB visible (SQLite Drizzle, single-writer → OK mais limite concurrence).
- Mobile énergie : KNOWN_ISSUES mentionne thermal listener deferred. Pas de warning batterie <40%.

### 5.3 Sécurité code

- Scanner intégré (`security/scanner.ts`) : règles pertinentes mais limitées (cf. I7). Exécution manuelle, pas de CI intégrée (à lier à B6 CodeQL).
- `bun audit` / `cargo audit` **non exécuté** dans cet audit (outil non disponible) — le lockfile comporte des milliers d'entrées, je ne peux pas certifier l'absence de CVE critique sans run outillé.
- Secrets : pas de match positif sur `AKIA|-----BEGIN|sk-[A-Za-z0-9]{20}` dans `packages/`. Seuls les regex du scanner + test fixtures (`test/security/scanner.test.ts`) matchent — **pas de secret committé détecté**. Confirmation gitleaks toutefois recommandée.
- CSP : desktop + mobile désormais strictes (cf. KNOWN_ISSUES, commit A.10).
- Binds réseau : sidecar binding `127.0.0.1` → `packages/opencode/src/local-llm-server/index.ts:469`. OK.
- Signature : aucune (B6).

### 5.4 Sécurité données

- Collecte : telemetry OpenTelemetry uniquement si `experimental.openTelemetry === true` (`config.ts:1031`) — opt-in, bon.
- Chiffrement at-rest : **absent** (B1). `auth.json` 0o600.
- Chiffrement in-transit : B2 + B3.
- Local-first : ✅ sauf pairing LAN (cleartext par défaut, B3).
- RGPD : pas d'endpoint export/delete (I3).
- Multi-tenant : mono-user, pas de namespace ; audit logs absents (I4).

### 5.5 Liberté utilisateur

- BYOM : ✅ via `auth.json` + `config.provider`.
- Portabilité : ✅ CLI standalone + SDK TS, Python, Go.
- Transparence : ✅ modèle + provider affichés dans la status line TUI. Tools visibles (permission ruleset).
- Offline-first : ✅ llama-server embarqué.
- Politique contenu : aucune censure visible (pas de liste de refus serveur-side).

### 5.6 Adaptativité device (`auto-config.ts`)

- Détection RAM / CPU big.LITTLE / GPU backend (CUDA/ROCm/Vulkan/Metal) : ✅ bien implémenté (`auto-config.ts:42-110`).
- Décision n_gpu_layers selon VRAM : ✅ `(vramBudget / mbPerLayer)` ligne 142.
- Thermal : champ `thermalState` existe mais n'est **jamais mis à jour dynamiquement** (le probe retourne toujours `"nominal"` ligne 107). Le `thermalMult` ligne 121 n'agit donc jamais. Cf. KNOWN_ISSUES "Thermal listener JNI" deferred.
- KV cache quant adaptatif : ✅ f16/q8_0/q4_0 ligne 155.
- Pas de détection NPU (I8).
- `OPENCODE_ALLOW_CPU_ONLY=1` obligatoire si pas de GPU : ✅ cohérent avec la règle "Never CPU-only" (memory).

### 5.7 Optimisation modèles locaux

- `mmap` : **implicite** (défaut llama.cpp), pas d'opt-in explicite dans `buildArgs`.
- Prompt caching : ❌ absent (W4).
- KV cache persistant : ❌ absent (W4).
- Speculative decoding : ❌ pas de `--draft-model` (W4).
- Context compression : ✅ `session/compaction.ts` avec seuils scalés au `model.limit.context`.
- Token budget : `Token.estimate` corrigé (cf. KNOWN_ISSUES A.1).

### 5.8 Optimisation modèles cloud

- Prompt caching Anthropic ephemeral : ✅ `provider/transform.ts:250-262` pose `cacheControl: { type: "ephemeral" }` + `cache_control` + `copilot_cache_control`.
- Streaming SSE : ✅ `Stream.fromAsyncIterable` côté server ; SSE heartbeat avec double-stop race mineure (SECURITY_AUDIT S2.L1).
- Batch API : ❌ I6.
- Cascading (cloud ↔ local) : ❌ I10.
- Abstraction provider : ✅ via `ai` SDK + `transform.ts`.

### 5.9 Observabilité

- Télémétrie : opt-in OTel uniquement.
- Logs : `Log.create({ service: ... })` standard ; pas de PII détectée dans les tags couverts.
- Crash reporting : ❌ I1.
- Feature flags : partiellement via `experimental` dans config (I2).
- Rollback / compat stockage : Drizzle migrations présentes (`packages/opencode/src/session/session.sql.ts`). Pas de stratégie de rollback visible pour schémas down-migration.

### 5.10 CI/CD & supply chain

- 33 workflows, dont `test.yml`, `typecheck.yml`, `android.yml`, `publish.yml`. Correct.
- **Absent** : `dependabot.yml`, `codeql.yml`, `trivy/grype`, `cosign`, SBOM. → **B6**.
- Pas de branch protection visible dans le repo (à confirmer en settings GitHub).
- `.github/actions/setup-bun` custom action, à auditer (non lu).
- Pas de reproductibilité documentée (build hashes).

---

## 6. Checklist pré-merge

### Tests automatisés à passer
- [ ] `bun turbo test:ci` vert sur linux + windows
- [ ] `bunx playwright test` vert (`packages/app`)
- [ ] `bun typecheck` dans chaque `packages/*` concerné
- [ ] `cargo check --release` dans `packages/*/src-tauri` + `crates/*`
- [ ] `cargo clippy -- -D warnings` propre

### Scans sécurité (à ajouter en CI — B6)
- [ ] `bun audit` sans high/critical
- [ ] `cargo audit` sans high/critical
- [ ] `gitleaks detect --redact` → 0 finding
- [ ] `codeql-action/analyze` (JS/TS + Rust) sans error

### Vérifications manuelles
- [ ] B1..B5 fixés et testés
- [ ] B3 testé sur device Android physique (pairing LAN HTTP → doit refuser)
- [ ] Reprise session post-kill : état 9 correctement restauré
- [ ] Lancer 10 tâches background → le semaphore W6 limite à N parallèles
- [ ] Cold start mobile <6 s (milieu de gamme)
- [ ] Heap snapshot WebView stable après 100 messages + 10 abort/retype (valide ou invalide AUDIT_REPORT A.3)
- [ ] Signature APK + attestation build-provenance présentes sur release candidate

---

## 7. Plan d'action

### Sprint 1 (2 semaines) — bloquants merge
1. **B3** (S) — `network_security_config.xml` LAN-only cleartext. QA device physique.
2. **B4** (S) — `AbortSignal.timeout(15000)` sur les 4 fetch identifiés.
3. **B5** (M) — `lstat + resolve` anti-symlink dans `file/index.ts`.
4. **B6** (M) — `dependabot.yml` + `codeql.yml` + secret scanning + SBOM job de release + attestation build-provenance.
5. **B2** (M) — WS auth via cookie one-shot (desktop) + header natif Tauri (mobile).
6. **W5** (S), **W7** (S), **W8** (S), **W9** (S) — quick wins incorporables dans le même sprint.

### Sprint 2 (2 semaines) — hardening
7. **B1** (L) — migration keychain OS.
8. **W1** (M) — cost-cap + rate-limit REST tasks.
9. **W6** (M) — semaphore background tasks.
10. **W4** partiel (M) — prompt-cache + mmap explicite ; `--draft-model` via env (I8 reste backlog).
11. **W2/W3** (S/S) — typing `task.ts`.

### Sprint 3 (2 semaines) — observabilité & UX enterprise
12. **I1** — crash reporter local-first + opt-in upload.
13. **I3, I4, I5** — export/delete RGPD + audit_log table + BYOK projet.
14. **I10** — cascading cloud/local automatique.
15. **I7** — scanner : élargir les regex tokens modernes, scanner les tool outputs avant render.
16. **I9** — thermal listener JNI Android branché à `resetProfileCache()`.
17. **I11** — E2E fixture DAG agents.

---

## Annexe — Findings déjà suivis (pour mémoire)

Les findings suivants, listés dans les audits antérieurs, restent ouverts et sont couverts ci-dessus :

| Origine | ID | Statut |
|---|---|---|
| AUDIT_REPORT | A.3 stream cleanup | 🔎 à mesurer (heap snapshot) |
| AUDIT_REPORT | A.5 runtime permissions Android | ouvert |
| AUDIT_REPORT | A.6 `Promise.all` sans abort | ouvert |
| AUDIT_REPORT | A.8 ensureCorrectModel restart loop | **W5** |
| AUDIT_REPORT | A.9 secrets localStorage mobile | ouvert (lié B1) |
| AUDIT_REPORT | A.12 `_ownedChildPid` stale | ouvert |
| AUDIT_REPORT | A.17 stderr 4096 B | ouvert (→ I1) |
| SECURITY_AUDIT | S1.L2 markdown cache 200 | ouvert |
| SECURITY_AUDIT | S1.L3 session-prefetch cache | ouvert |
| SECURITY_AUDIT | S2.A2 deep-link providerID | ouvert |
| SECURITY_AUDIT | S2.V1 RPC worker ID reuse | ouvert |
| SECURITY_AUDIT | S2.V2 embedding response non validée | ouvert |
| KNOWN_ISSUES | Vim/altscreen terminal, mouse tracking, virtual keybinding row, thermal listener, neural voice clone | deferred |

---

**Auditeur** : Claude Opus 4.7 (1M) — 2026-04-18
**Contact** : barat.erwan@gmail.com
