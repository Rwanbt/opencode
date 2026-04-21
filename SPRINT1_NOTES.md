# Sprint 1 — Notes d'implémentation

Date : 2026-04-18
Branche : `dev` (working tree non commité)
Référence : `PRODUCTION_REVIEW_2026-04.md`

---

## Statut par item

| Item | Statut | Fichier(s) touché(s) |
|------|--------|----------------------|
| B3 — Android cleartext LAN-only | FAIT (ajustement) | `packages/mobile/src-tauri/gen/android/app/src/main/res/xml/network_security_config.xml` |
| B4 — fetch sans timeout | FAIT (partiel, écart rapport) | `packages/opencode/src/local-models/ollama.ts` |
| W5 — circuit breaker `ensureCorrectModel` | NO-OP (déjà implémenté) | — |
| W7 — MCP scoping collision préfixe | FAIT | `packages/opencode/src/mcp/index.ts` |
| W8 — CORS allowlist explicite | FAIT (ajustement) | `packages/opencode/src/server/server.ts` |
| W9 — shell env allowlist | FAIT | `packages/desktop/src-tauri/src/cli.rs` |
| B5 — symlink bypass `File.read` | NO-OP (déjà implémenté) | — |
| B6 — dependabot + codeql + SBOM | FAIT | `.github/dependabot.yml`, `.github/workflows/codeql.yml`, `.github/workflows/sbom.yml` |
| B2 — WS auth cookie/header | SAUTÉ | — |

---

## Détails par item

### B3 — Android cleartext LAN-only (FAIT ajustement)

**ÉCART RAPPORT/CODE** : le rapport affirme `<base-config cleartextTrafficPermitted="true">` global ; en réalité le fichier pointé est déjà `false` avec un `domain-config` restreint à `127.0.0.1 / localhost / 10.0.2.2`. La recommandation du rapport (ajouter les ranges RFC1918) n'était donc que partielle.

Ajout effectué : les plages RFC1918 comme domain-config cleartext. `network_security_config.xml` d'Android ne supporte pas la notation CIDR — j'ai énuméré les anchors `10.0.0.0`, `172.16.0.0`..`172.31.0.0` et `192.168.0.0` avec `includeSubdomains="true"`. Android matche littéralement les IPs, et `includeSubdomains` sur un IP/préfixe est une astuce connue pour couvrir le sous-réseau.

**Risque** : `includeSubdomains` sur une IP n'est pas strictement standard AOSP ; certains devices OEM (MIUI notamment) peuvent l'ignorer et refuser la connexion à `192.168.1.42`. À valider sur device physique avant release.

**Test manuel** :
1. Sur un device réel, se connecter à un serveur opencode en `http://192.168.x.y:14097` en mode Remote Server → doit fonctionner.
2. Tenter de se connecter à un serveur public HTTP non-LAN (ex. `http://example.com:14097`) → doit échouer avec `CLEARTEXT_NOT_PERMITTED`.
3. Vérifier que `127.0.0.1` loopback (sidecar embarqué) reste OK.

---

### B4 — fetch sans timeout (FAIT partiel)

**ÉCART RAPPORT/CODE** : le rapport cite `packages/opencode/src/mcp/oauth-callback.ts` — ce fichier n'expose **aucun** `fetch()` sortant, uniquement `Bun.serve({ fetch(req) { ... } })` (handler serveur entrant, aucun timeout à poser). Pas d'action. Le POST token OAuth effectif passe par le SDK MCP et n'est pas dans ce fichier.

`ollama.ts` : ajout `AbortSignal.timeout(15000)` sur `isRunning` (déjà présent avec 2000ms, conservé), `listModels`, `show`, `remove`. `pull()` intentionnellement laissé sans timeout global car c'est un stream NDJSON long (plusieurs minutes sur gros modèles) — un timeout 15s casserait la feature. Un commentaire explicite le pourquoi.

**Test manuel** :
1. Couper le wifi en plein `listModels` via Ollama distant → l'erreur doit remonter après ~15s, pas hang.
2. `pull()` d'un modèle 7B doit toujours fonctionner jusqu'au bout (ne pas timeout à 15s).

---

### W5 — circuit breaker `ensureCorrectModel` (NO-OP)

Déjà implémenté dans `local-llm-server/index.ts` :
- `MAX_RESTARTS = 3`, `RESTART_WINDOW_MS = 120_000`, `_restartTimestamps`, `hasExceededRestartBudget()`, `recordRestart()`.
- Throw `new Error("llama-server restart loop detected (…)")` à la ligne 596.

Le rapport demandait un `NamedError` : l'erreur actuelle est un `Error` nu. Je ne le change pas — c'est un refactor de typage qui traverse tout le call path (propagation Effect) et n'apporte pas de sécurité supplémentaire. À faire dans un sprint ergonomie si besoin.

**Test manuel** :
1. Provoquer un mismatch de modèle répété (modèle absent après un swap) → au 3e restart en 120s, doit throw "llama-server restart loop detected".

---

### W7 — MCP scoping collision préfixe (FAIT)

Diagnostic : les clés de tool sont `sanitize(clientName) + "_" + sanitize(toolName)`. Le filtre utilisait `key.startsWith(sanitize(serverName) + "_")` → collision prouvée pour deux serveurs `github` et `github_enterprise` (ce dernier étant sanitizé identique à `github_enterprise_<tool>`, passant le préfixe `github_`).

Correctif : construction d'une `Map<serverName, Set<toolKey>>` depuis `s.defs[serverName]`, avec le même schéma de clé. Match exact via `Set.has(key)` au lieu de `startsWith`. Call sites inchangés (toolsForAgent renvoie toujours `Record<string, Tool>`).

**Test manuel** :
1. Déclarer deux MCP servers dans la config, noms `github` et `github_enterprise`, chacun avec un tool `list`. Dans un agent avec `scope.allow = ["github"]`, seul `github_list` doit remonter, pas `github_enterprise_list`.

---

### W8 — CORS allowlist explicite (FAIT ajustement)

**ÉCART RAPPORT/CODE** : le fichier pointé (`server.ts:64-88`) n'utilise déjà plus de regex `*.opencode.ai`. Une allowlist explicite était en place mais incluait `app.opencode.ai / api.opencode.ai / dev.opencode.ai`. J'ai aligné sur la liste demandée : `opencode.ai / www.opencode.ai / docs.opencode.ai / console.opencode.ai`. `localhost` / `127.0.0.1` / `tauri.localhost` restent whitelistés pour dev.

**Risque** : si le front déployé utilisait `app.opencode.ai` ou `dev.opencode.ai` pour le pairing, ils sont maintenant bloqués. À confirmer avec l'équipe front avant merge.

**Test manuel** :
1. Requête XHR depuis `https://docs.opencode.ai` → doit avoir `Access-Control-Allow-Origin` OK.
2. Requête XHR depuis `https://evil.opencode.ai` → doit être rejetée (pas de header CORS).
3. DevTools web depuis `http://localhost:3000` → toujours OK.

---

### W9 — shell env allowlist (FAIT)

Ajout de `SHELL_ENV_ALLOWLIST` (exact-match) + `SHELL_ENV_ALLOWED_PREFIXES` (prefix-match pour `LC_*` et `OPENCODE_*`). Filtrage appliqué dans `merge_shell_env` sur la partie `shell_env` (env lu depuis `zsh -il` / `bash -l`). Les `envs` explicites passés par le caller opencode ne sont pas filtrés (non-user-controlled).

Contenu allowlist : `PATH HOME USER LANG LANGUAGE TERM TMPDIR TMP TEMP NO_COLOR FORCE_COLOR NODE_ENV BUN_INSTALL SHELL XDG_*`. Préfixes : `LC_`, `OPENCODE_`. Tout `*_API_KEY`, `*_TOKEN`, `*_SECRET`, `GITHUB_TOKEN`, `AWS_*` est désormais strippé avant passage au sidecar.

**Risque** : si un utilisateur avancé exportait `ANTHROPIC_API_KEY` dans son `.zshrc` en s'attendant à ce que le sidecar le lise, ça ne passera plus. `auth.json` reste la source of truth officielle, donc régression minime mais à mentionner dans les release notes. `GITHUB_TOKEN` notamment utilisé par certains MCP : à valider si les MCP qui en dépendent le reçoivent via un autre canal (ils devraient : via config explicite, pas par inherit env).

**Test manuel** :
1. `export FOO_API_KEY=xxx && opencode` → dans le sidecar (log env), `FOO_API_KEY` ne doit pas apparaître.
2. `export LC_ALL=en_US.UTF-8 && opencode` → doit être transmis.
3. `export OPENCODE_LLAMA_MODELS_DIR=/custom && opencode` → doit être transmis (OPENCODE_* whitelist prefix).

---

### B5 — symlink bypass `File.read` (NO-OP)

Déjà implémenté via `assertInsideProject` qui appelle `AppFileSystem.resolve(full)` → `realpathSync` → re-vérifie `Instance.containsPath(real)`. `Effect` throw `"Access denied: symlink escapes project directory"` si échappement détecté. Aucune modification nécessaire.

**Test manuel** :
1. Dans un projet, `ln -s /etc/passwd docs/evil` puis tenter `File.read("docs/evil")` → doit throw "symlink escapes project directory".
2. Symlink interne (`ln -s src/foo.ts docs/foo.ts`) → doit fonctionner.

---

### B6 — dependabot + codeql + SBOM (FAIT)

- `.github/dependabot.yml` : ecosystems `npm`, `cargo` (x3 : root + desktop + mobile src-tauri), `github-actions`. Weekly, minor+patch groupés.
- `.github/workflows/codeql.yml` : JS/TS uniquement (Rust CodeQL pas GA en 2026-04 selon la checklist — documenté en commentaire dans le workflow). Trigger push/PR sur main+dev + cron weekly.
- `.github/workflows/sbom.yml` : `anchore/sbom-action@v0`, SPDX + CycloneDX, sur `workflow_dispatch` et `release`. Upload artifacts + release assets.
- Cosign / signature d'artefacts : NON fait (nécessite secrets repo — hors scope sprint).

**Risque** : dependabot va probablement ouvrir un gros paquet de PRs au premier run (npm monorepo = beaucoup de deps). Prévoir d'augmenter `open-pull-requests-limit` ou de faire passer l'équipe en review batch.

**Test manuel** :
1. Push la branche → `CodeQL` workflow doit apparaître dans l'onglet Actions et passer sur JS/TS.
2. `Actions → SBOM → Run workflow` → vérifier artefacts `opencode-sbom.spdx.json` + `opencode-sbom.cyclonedx.json`.
3. Dans Settings → Security → Dependabot alerts, vérifier que les PRs weekly arrivent au prochain lundi.

---

### B2 — WS auth cookie/header (SAUTÉ — risque régression non maîtrisé)

**Raison du saut** :

1. **ÉCART RAPPORT/CODE** partiel : le query-string n'est pas `?authorization=` Basic mais `?authorization=Bearer+<jwt>`, explicitement gated sur `Upgrade: websocket` (lignes 117-124). Le commentaire inline rappelle déjà la contrainte WS browser (pas de custom headers) et assume un JWT court-lived.

2. **Surface de régression trop large** :
   - Le seul client WS identifié qui met réellement de l'auth en query-string est `packages/app/src/components/terminal.tsx:646` qui utilise **Basic** (`authorization=Basic <base64>`) — pas Bearer. Ce path ne match PAS le gate `startsWith("Bearer ")` côté serveur, donc est déjà rejeté par JWT middleware. Soit cette route désactive le JWT middleware en amont, soit le terminal web est cassé aujourd'hui — à investiguer avant toute modif.
   - Migrer vers cookie one-shot + sous-protocole `Sec-WebSocket-Protocol: bearer,<token>` demande de toucher :
     - serveur Hono : nouvel endpoint `POST /auth/ws-ticket` + acceptation cookie + sous-protocole
     - client web terminal (fetch ticket avant `new WebSocket` + handshake avec `Sec-WebSocket-Protocol`)
     - client desktop (même logique, via `tauri-plugin-http` si custom header nécessaire)
     - client mobile (explicitement remis à sprint 2 par le rapport)
   - Tests : il n'existe pas de couverture e2e WS-auth dans le repo (grep `auth-jwt` : aucun test spec). Toute régression ne serait détectée qu'au QA manuel.

3. **Mobile explicitement hors-scope** pour ce sprint, ce qui crée une incohérence temporaire entre desktop et mobile si je migre uniquement desktop.

**Recommandation** : traiter B2 dans un sprint dédié avec :
- (a) ajouter d'abord une spec e2e `playwright` du handshake WS,
- (b) implémenter l'endpoint `/auth/ws-ticket` + cookie en additif (sans casser l'existant),
- (c) migrer les clients un par un derrière un feature flag,
- (d) supprimer le fallback query-string une fois tous les clients migrés.

---

## Risques résiduels globaux

- **B1 (auth.json plaintext)** : non traité, reste le blocker critique #1. Sprint 2.
- **B2 (WS auth query-string)** : non traité, voir ci-dessus.
- **W9 breaking change env** : utilisateurs avancés exportant des API keys dans leur shell rc seront silencieusement dé-authentifiés pour certains providers. Release notes OBLIGATOIRES.
- **B3 RFC1918 anchors** : approche `includeSubdomains` sur IP pas 100% standard ; à valider sur Android 11+, OneUI, MIUI, ColorOS avant release.
- **W8 CORS** : retrait de `app.opencode.ai / api.opencode.ai / dev.opencode.ai` — confirmer avec équipe infra que ces sous-domaines ne sont plus en prod.
- **B6 sans cosign** : supply chain à moitié couverte ; signature d'artefacts toujours manquante (dépend de secrets repo).

---

## Fichiers modifiés / créés

Modifiés :
- `packages/mobile/src-tauri/gen/android/app/src/main/res/xml/network_security_config.xml`
- `packages/opencode/src/local-models/ollama.ts`
- `packages/opencode/src/mcp/index.ts`
- `packages/opencode/src/server/server.ts`
- `packages/desktop/src-tauri/src/cli.rs`

Créés :
- `.github/dependabot.yml`
- `.github/workflows/codeql.yml`
- `.github/workflows/sbom.yml`
- `SPRINT1_NOTES.md` (ce fichier)
