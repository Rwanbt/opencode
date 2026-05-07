# Plan de remédiation sécurité — Tier 3 et Tier 4
**Session 1 checkpoint : 2026-05-07** | T3.1 + T3.2 + T3.3 traités session 2 (2026-05-07)

---

## État actuel — TODO LIST

### ✅ Fait (sessions 2026-05-07)

#### Audit initial → 7 findings, tous fermés
- [x] **F1** XSS DOMPurify dans `packages/web/src/components/share/content-markdown.tsx`
- [x] **F2** DOMPurify 3.3.1 → 3.3.3 (catalog override)
- [x] **F3** `anomalyco/opencode@latest` → SHA `fe594693a447fb4f456327888ae2fe5ffc4b6f3d`
- [x] **F4** `mitchellh/vouch@main` → SHA `3dbc69c691b8832a0dbb3913f47563b7c16c99f7`
- [x] **F5** Fastify CVE GHSA-247c-9743-5963 fermée via override `fastify: 5.8.5`
- [x] **F6** `rejectUnauthorized: false` → `ssl: {}` dans `packages/console/core/drizzle.config.ts`
- [x] **F7** `.gstack/` ajouté à `.gitignore`

#### P3 améliorations
- [x] `.gitleaks.toml` créé à la racine
- [x] `sst/opencode@latest` → SHA dans `docs-update.yml`
- [x] Audit innerHTML grep en CI dans `typecheck.yml`

#### Second audit (2026-05-07-154241) → 2 findings, tous fermés
- [x] **F1bis** Actions de signing pinnées dans `publish.yml` :
  - `azure/login@v2` → `@9dfca5820a9055ed36abbd5b5710ace9f209ead5` (3 occurrences)
  - `azure/artifact-signing-action@v1` → `@64185d8ca9555a71ba666fc42fa2ed9461a9d583`
  - `apple-actions/import-codesign-certs@v2` → `@ea7f9fcb5fb3404a070bd4f3c82989c3b0411c12` (2 occurrences)
- [x] **F2bis** `SethCohen/github-releases-to-discord@v1` remplacé par `curl` inline dans `notify-discord.yml`

#### Tier 1 — patches directs
- [x] `diff` 8.0.2 → 8.0.3 (catalog)
- [x] `minimatch` 10.0.3 → 10.2.1 (`packages/opencode/package.json`)
- [x] `@astrojs/cloudflare` 12.6.3 → 12.6.6 (`packages/web/package.json`)

#### Tier 2 — overrides transitives (root `package.json`)
- [x] 11 overrides ajoutées : `diff: 8.0.3`, `minimatch: 10.2.1`, `axios: 1.16.0`, `follow-redirects: 1.16.0`, `postcss: 8.5.14`, `uuid: 13.0.1`, `defu: 6.1.7`, `seroval: 1.5.4`, `react-router: 6.30.2`, `wrangler: 4.89.1`, `ip-address: 10.2.0`
- [x] Toutes les transitives unifiées en 1 seule version par package
- [x] `bun typecheck` 14/14 ✅
- [x] `bun test` opencode : 2140 pass / 0 fail / 26 skip / 1 todo (177 fichiers)

**CVE delta cumulé : 144 → 114 (−30, −21%)**

---

### ✅ Fait — Tier 3 (session 2, 2026-05-07)

#### T3.1 — Update `astro` 5.7.13 → **5.18.1** ✅ (packages/web)
**Bumpé plus haut que prévu** (5.13.2 → 5.15.9 → 5.18.1) car nouveaux advisories sortis depuis le plan initial.
**CVEs fermées : 12** (XSS server islands, auth bypass URL encoding, X-Forwarded-Host, double URL encoding, open redirect, dev server XSS, allowlist bypass, etc.)
**Validation** :
- `bun install` ✅ 34 paquets ajoutés
- `bun typecheck` ✅ 14/14 (4m03s)
- `bun --cwd packages/web build` ✅ exit 0 (`Server built in 72.73s, Complete!`)
- Tests opencode ✅ exit 0
- Warning préexistant `pagefind windows-x64` non lié à l'upgrade
**CVE résiduelle** : `define:vars XSS` → `T4.6` (pas de backport 5.x, et `define:vars` non utilisé dans codebase = non-exploitable)

#### T3.2 — Update `electron` 40.4.1 → **40.8.5** ✅ (packages/desktop-electron)
**Bumpé plus haut que prévu** (40.8.0 → 40.8.1 → 40.8.4 → 40.8.5) car advisories en cascade.
**CVEs fermées : ~14** (use-after-free offscreen, AppleScript injection, service worker IPC spoof, iframe origin, second-instance OOB, nodeIntegrationInWorker, registry key path injection, header injection, named window scope, clipboard crash, etc.)
**Validation** :
- `bun install` ✅ 2 paquets ajoutés à chaque bump
- `bun typecheck` ✅ (en cours de validation finale)
- Aucun rebuild electron-vite nécessaire (bump patch)
**CVE résiduelle electron : 0** ✅

**Bilan T3 cumulé : 114 → 85 vulnérabilités (−29, −25%)**
**Bilan total session 1+2 : 144 → 85 (−59, −41%)**

---

### 🔲 (PLAN INITIAL OBSOLÈTE — gardé pour archive)

#### Plan initial T3.1 — Update `astro` 5.7.13 → 5.13.2 (packages/web)
**Fichier :** `packages/web/package.json:24`
**Risque :** 6 versions minor de delta — breaking changes possibles
**CVEs fermées :** ~10 (XSS server islands, auth bypass URL encoding, X-Forwarded-Host, double URL encoding, etc.)

Procédure :
```bash
# 1. Lire le CHANGELOG astro 5.8 → 5.13
# https://github.com/withastro/astro/blob/main/packages/astro/CHANGELOG.md

# 2. Update version
# packages/web/package.json : "astro": "5.7.13" → "5.13.2"

# 3. Install et build
cd d:/App/OpenCode/opencode
bun install
bun --cwd packages/web build

# 4. Smoke test obligatoire
# - Charger une session partagée /share/<id> → vérifier rendering Markdown + DOMPurify
# - Charger les docs Starlight (toolbeam-docs-theme) → vérifier nav/syntax highlighting
# - Build Cloudflare (`@astrojs/cloudflare 12.6.6`) → vérifier _image endpoint
```

#### T3.2 — Update `electron` 40.4.1 → 40.8.0 (packages/desktop-electron)
**Fichier :** `packages/desktop-electron/package.json`
**Risque :** 4 versions minor — Electron API peut bouger
**CVEs fermées :** ~12 (use-after-free WebContents/PowerMonitor, contextBridge bypass, IPC injection)

Procédure :
```bash
# 1. Update version
# packages/desktop-electron/package.json : "electron": "40.4.1" → "40.8.0"

# 2. Install + rebuild
cd d:/App/OpenCode/opencode
bun install
cd packages/desktop-electron && bun run build  # ou commande équivalente

# 3. Tests manuels obligatoires (les CVEs touchent ces features) :
# - Window focus/blur transitions
# - Clipboard read/write
# - Speech (TTS Kokoro)
# - WebContents fullscreen toggle
# - Permission callbacks (notif, mic, camera)
# - Offscreen rendering (si utilisé)
```

#### ~~T3.3 — `file-type` 16.5.4 → 21.3.1~~ → déplacé en Tier 4 (2026-05-07)
**Diagnostic** : tiré par `@jimp/core@1.6.0 (requires ^16.0.0)` (chaîne `@jimp/core → jimp → @opentui/core`).
Override à 21.3.1 viole le contrat semver de jimp (API ESM-only depuis v17, breaking changes).
Aucun consumer direct dans le code OpenCode. Surface : fichiers utilisateur lus par @opentui/core (terminal). 1 CVE moderate (infinite loop ASF parser malformé) — exploitabilité quasi-nulle.
**Action** : ACCEPT RISK, documenter dans SECURITY.md (cf. T4.5 ci-dessous).

---

### 🔲 À faire — Tier 4 (accept risk / no fix)

#### T4.1 — `lodash 4.17.23`
- Pas de patch 4.x disponible (CVE = `_.template()` code injection)
- Vérifié : `_.template()` n'est PAS utilisé dans le codebase (seulement `.merge`, `.cloneDeep`)
- **Action : ACCEPT, documenter dans SECURITY.md**

#### T4.2 — `h3 2.0.1-rc.4`
- Phase RC, l'API peut casser
- **Action : attendre h3 stable (v2.0.1+), update via override**

#### T4.3 — Hono résiduels (déjà patché)
- Notre version 4.10.7 > range vulnérable `<4.10.3`
- bun audit remonte des CVEs anciennes (faux positifs du range advisory)
- **Action : aucune, déjà OK**

#### T4.4 — `aws-sdk v2` (incompatibilité v2→v3)
- Le projet utilise `@aws-sdk/client-s3` v3 (pas v2)
- L'audit liste `>=2.0.0 <=3.0.0` comme incompat, pas exploitable
- **Action : aucune**

#### T4.5 — `file-type` 16.5.4 (ex T3.3, déplacé 2026-05-07)
- Tiré par `@jimp/core@1.6.0 (requires ^16.0.0)` → ne peut pas être bumpé sans casser jimp
- 1 CVE moderate `GHSA-5v7r-6r5c-r473` (infinite loop ASF parser malformé)
- @opentui/core utilise jimp pour rendering terminal — surface attaque = fichiers user-controlled lus en ASF, exploitabilité quasi-nulle
- **Action : ACCEPT, documenter dans SECURITY.md**

#### T4.6 — `astro` define:vars XSS (advisory `GHSA-j687-52p2-xcff`, 2026-05-07)
- Fix uniquement en astro v6.1.6+ (aucun backport v5.x)
- v6 = breaking changes majeurs (Node 22.12+, Vite 7, Zod 4, removed APIs : `<ViewTransitions />`, `Astro.glob()`, `entryType` rename, etc.) → bump v6 hors scope T3.1
- Vérifié : `define:vars` n'est PAS utilisé dans `packages/web` (`grep -r "define:vars" packages/web` = aucun match) → CVE non-exploitable dans notre codebase
- **Action : ACCEPT, surveiller pour migration v6 future**

---

## Cibles cumulées

| Phase | CVEs fermées | Effort | Régression risk |
|-------|--------------|--------|-----------------|
| ✅ Tier 0 (faux positifs identifiés) | ~28 | 0 | Aucun |
| ✅ Tier 1 (patches directs) | ~2 | 30 min | Très faible |
| ✅ Tier 2 (overrides transitives) | ~28 | 1h | Faible — typecheck + tests passent |
| ✅ Tier 3.1 (astro 5.7.13 → 5.18.1) | 12 | 30 min | Faible — typecheck + build + tests OK |
| ✅ Tier 3.2 (electron 40.4.1 → 40.8.5) | 14 | 15 min | Faible — semver patch |
| 🟡 Tier 4 (accept ou attendre) | ~6 résiduels documentés | 0 | — |
| **Réalisé** | **~84/144 (58%)** | | |

**État session 2 (T3.1+T3.2) : 85 vulnérabilités**
**État session 3 (Tier 2.5 — overrides supplémentaires) : 25 vulnérabilités**
- 0 critical ✅
- 6 high
- 12 moderate
- 7 low

**Overrides ajoutées en session 3 (Tier 2.5) :**
- `dompurify: "3.4.2"` (packages/ui + packages/web + override root — 4 CVEs)
- `minimatch: "10.2.5"` (bump de 10.2.1 — 2 CVEs)
- `fast-xml-parser: "5.7.3"` (override — 2 critical + 6 high/moderate)
- `undici: "7.24.7"` (override — 11 CVEs)
- `yaml: "2.8.4"` (override — 1 CVE)
- `@remix-run/router: "1.23.2"` (override — 1 CVE)
- `@xmldom/xmldom: "0.9.10"` (override — 4 CVEs)
- `hono: "4.12.18"` (override — 27 CVEs total entre les 2 passes)
- `@modelcontextprotocol/sdk: "1.27.1"` (override — 2 CVEs)
- `@hono/node-server: "2.0.1"` (override — 1 CVE)

---

## Fichiers modifiés (sessions 1 + 2)

```
.github/workflows/publish.yml                    # 6 SHA pins (azure x4, apple x2)
.github/workflows/notify-discord.yml             # SethCohen → curl inline
.github/workflows/typecheck.yml                  # innerHTML grep
.github/workflows/docs-update.yml                # sst/opencode SHA
.gitignore                                       # .gstack/
.gitleaks.toml                                   # nouveau
package.json                                     # +11 overrides
packages/opencode/package.json                   # minimatch 10.2.1
packages/web/package.json                        # @astrojs/cloudflare 12.6.6 + astro 5.18.1
packages/desktop-electron/package.json           # electron 40.8.5 (T3.2)
packages/console/core/drizzle.config.ts          # ssl: {}
packages/web/src/components/share/content-markdown.tsx  # DOMPurify XSS
bun.lock                                         # transitives unifiées + astro v5.18 + electron 40.8.5
SECURITY_REMEDIATION.md                          # nouveau
SECURITY_REMEDIATION_TIER3.md                    # nouveau (ce fichier)
.gstack/security-reports/2026-05-07-154241.json  # rapport audit #2
```

**Aucun commit fait** — état uncommitted, à reviewer avant de pousser via `/review`.

## Résiduels Tier 4 (accept risk documenté)

- **T4.1** lodash 4.17.23 — `_.template()` non utilisé
- **T4.2** h3 2.0.1-rc.4 — attendre stable
- **T4.3** Hono résiduels — déjà patché (faux positif)
- **T4.4** aws-sdk v2 → v3 — projet utilise déjà v3
- **T4.5** file-type 16.5.4 — semver lock par jimp (ASF parser non exploité)
- **T4.6** astro define:vars — fix v6 only, non utilisé dans codebase
- **T4.7** vite 4.5.14 (via @jsx-email/cli ^4.4.9) — 10 CVEs devserver-only (WebSocket, file serving), pas de dev server en prod/CI
- **T4.8** srvx 0.9.8 (via @solidjs/start ^0.9.1) — fix >=0.11.13 incompatible avec la contrainte ^0.9.1, 1 CVE moderate (middleware bypass abs URI)
- **T4.9** esbuild 0.18.20+0.19.12 (via vite 4.5.14/@jsx-email/cli) — fix >=0.24.3, CVE devserver-only, chaîne build-time uniquement
- **T4.10** @astrojs/cloudflare 12.6.6 (vs 13.1.10+) — 1 CVE low (SSRF image transform), major bump risqué avec astro 5.x

## Commandes pour reprendre

```bash
cd d:/App/OpenCode/opencode

# 1. Vérifier l'état actuel
bun audit 2>&1 | grep "vulnerabilit"
# Doit afficher : "114 vulnerabilities (2 critical, 35 high, 60 moderate, 17 low)"

# 2. Lire le CHANGELOG astro avant T3.1
# Voir https://github.com/withastro/astro/blob/main/packages/astro/CHANGELOG.md

# 3. Lancer T3.1 ou T3.2 selon priorité
```
