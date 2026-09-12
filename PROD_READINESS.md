# Production Readiness — Unifia Fork

> Point d'entrée unique pour évaluer l'état prod du fork
> `Rwanbt/unifia` (branche `dev`). Mis à jour à chaque fin de
> sprint. La source d'autorité pour l'audit initial reste
> `PRODUCTION_REVIEW_2026-04.md` ; ce document agrège l'état courant
> et pointe vers les docs détaillés.

Dernière mise à jour : **2026-08-11**
Branche cible merge : `feat/unifia-rebrand-complete → dev → main`
Verdict courant : **NO-GO** — les gates §0 ci-dessous ne sont pas closes.
Le verdict UX du 2026-04-19 (§3bis, 9 bugs QA REAL) reste ouvert **en plus**
des gates de rebrand.

> `PRODUCTION_READINESS.md` (2026-07-31) est **supersédé** par ce document.
> Ne pas l'utiliser pour décider d'une release.

---

## 0. Registre des gates — état au 2026-08-11

Ce registre est la seule liste qui décide d'une promotion. Une gate n'est
close que si la preuve citée existe et est reproductible. Rien ici ne peut
être coché sur la foi d'un résumé.

| # | Gate | Nature | État | Preuve / blocage |
|---|------|--------|------|------------------|
| G1 | Code & tests locaux | automatique | **PASS** | Mesuré sur `fix/unifia-security-and-e2e` le 2026-08-11 : `packages/unifia` typecheck vert + **4238 pass / 11 skip / 0 fail** (4249 tests, 363 fichiers) ; `packages/app` typecheck vert + **689 pass / 0 fail** (88 fichiers) ; `packages/mobile` typecheck vert + **76 pass / 0 fail** et `cargo test` **9 passed / 0 failed** ; `bunx biome check .` vert sur **1250 fichiers** ; `git diff --check` propre. ⚠️ Dans `packages/mobile`, utiliser `bun run test` et non `bun test` : le script du paquet ajoute `--preload ./happydom.ts`, sans quoi 31 tests échouent faute de DOM |
| G2 | CI — unit, rust, identity, brand, conformance, SDK, LOC, mobile | automatique | **PASS** | 18 checks verts sur la PR #25 |
| G3 | CI — `e2e (linux)` | automatique | **FAIL préexistant — cause racine nommée, correctif en revue (PR #29)** | Échouait aussi sur la branche de base : run 31411233633 (13 échecs) vs 31480610511 (14 échecs), **12 échecs communs** (le registre indiquait 11 — décompte corrigé le 2026-08-11). **Non causé par le rebrand.** **Hypothèse LSP : RÉFUTÉE.** Trois runs locaux des deux mêmes tests donnent LSP actif → pass (43,7 s), LSP désactivé → **fail**, LSP désactivé → pass (37,3 s). Le drapeau `UNIFIA_DISABLE_LSP` supprime bien 4 timeouts `initialize` de 45 s et tout `spawned lsp server`, mais c'est un **coût, pas la cause**. Le défaut par défaut a été retiré du runner (`e2e-local.ts`) et le commentaire qui l'affirmait est corrigé, ici et dans la doc du drapeau ; le drapeau reste disponible en opt-in avec ses 4 tests. **Cause racine réelle, lue dans le call log Playwright du run 31480610511, pas déduite** : `submit.ts:306` refuse le prompt quand l'agent ou le modèle manque — il affiche le toast « Choose an agent and model before sending a prompt » et sort, donc rien n'est envoyé et le mock LLM n'est jamais appelé. Le helper `fixtures.ts` tapait dès que le champ était *visible*, alors qu'agent et modèle proviennent de la liste de providers servie par le backend, qui arrive après le rendu. Le reste est de la cascade : `started` ne bouge pas, le repli clique sur Send, le clic est intercepté, le test brûle ses 120 s, et le teardown du fixture `llm` rapporte `TestLLMServer still has 1 queued response(s)` — 4 des 12 échecs communs n'étaient que ce message de teardown. **Second défaut, indépendant, même call log** : la barre `<aside aria-label="Development performance diagnostics">` est `fixed bottom-3 right-3 z-50 pointer-events-auto` sur 324 px et recouvre le bouton Send — `208 × retrying click action`. Correctifs dans la PR #29 ; comparaison CI avant/après à consigner ici une fois les deux runs terminés |
| G4 | Revue sécurité humaine (CodeQL P3) | **humaine** | **OUVERTE, mais réduite** | Alertes ouvertes sur le ref `refs/heads/dev` : 2 critical, 2 high, 2 medium. Leurs chemins sont en `packages/opencode/` parce que **`dev` n'a pas encore le renommage C9** — ils sont exacts pour cette branche, pas périmés. Le scan est à jour : CodeQL a tourné avec succès sur `6cca33be34`, la tête actuelle de la PR #23. **Les deux `critical` sont déjà corrigées sur `feat/unifia-rebrand-complete`** et se fermeront à la fusion : `script/cargo-proxy.mjs` porte désormais l'allowlist `ALLOWED_TOOLS` qu'il promettait sans l'avoir, et `github-run.ts` vérifie le préfixe **après** normalisation d'URL. Les 4 alertes restantes ont été traitées le 2026-08-11 (PR #29), **sans en fermer aucune** : `js/polynomial-redos` (#278) → **vrai positif, corrigé** ; mesuré à 8 001 ms sur 100 000 `/` contre 0,004 ms pour un parcours arrière, et la classe est corrigée aux 5 sites qui normalisent une URL saisie par l'utilisateur. `js/file-system-race` (#334) → **vrai positif, corrigé** ; `existsSync` puis `writeFileSync` remplacés par le drapeau `wx` (O_CREAT\|O_EXCL). `js/log-injection` (#323) → **déjà corrigé** sur `feat/unifia-rebrand-complete` : `github-run.ts` ne journalise plus l'URL, seulement l'index et le statut. `js/http-to-file-access` (#333) → **vrai positif de flux de teinte, non exploitable** : la destination est la constante de module `auth.ts:22`, jamais la donnée réseau, et le contenu repasse par `JSON.parse`. Classement soumis à Erwan, alerte laissée ouverte. La ligne signalée portait en revanche un vrai défaut, corrigé : `mode` ne s'applique qu'à la création, et le temp fixe `github-auth.json.tmp` faisait persister le token OAuth avec les permissions qu'il avait déjà. Vérifié aussi soi-même : les 2 `critical` (#280 `cargo-proxy.mjs`, #322 `github-run.ts`) sont bien corrigées sur la branche. Aucune alerte modifiée ni fermée par l'agent |
| G5 | Protections de branche GitHub | **humaine → appliquée** | **PASS (partiel)** | Appliqué le 2026-08-11 sur `main` **et** `dev`, sur décision d'Erwan : 7 required status checks, 1 approbation, `dismiss_stale_reviews`, `required_linear_history`, force-push et suppression interdits, résolution des conversations exigée. `enforce_admins: false` **délibérément** (§0bis) et `require_code_owner_reviews: false`. Reste ouvert : signatures de commit non exigées, et la revue par CODEOWNERS n'est pas contraignante tant que le dépôt est mono-mainteneur |
| G6 | Dependabot | automatique | **PASS (activation)** / triage ouvert | Alertes et security updates **activées le 2026-08-11** (vérifié : `dependabot_security_updates: enabled`). 26 alertes ouvertes : 6 high, 16 medium, 4 low. Aucune PR de dépendance fusionnée |
| G7 | Signature APK release + preuve device | **humaine** | **BLOCKED_HUMAN_INPUT** — blocage précisé | Ce qui est **disponible** : device ADB `b7163823` (Mi 10 Pro, `cmi_eea`) connecté, `ai.unifia.mobile` et `ai.opencode.mobile` y coexistent déjà ; `apksigner` présent en `%LOCALAPPDATA%\Android\Sdk\build-tools\35.0.0\` (hors PATH). Ce qui **manque** : aucun keystore Unifia n'existe sur cette machine (seuls `opencode-release.keystore` dans le checkout `D:\App\OpenCode\opencode` et `~/.android/debug.keystore`), et aucune des variables `UNIFIA_ANDROID_KEYSTORE`, `_KEY_ALIAS`, `_KEYSTORE_PASSWORD`, `_KEY_PASSWORD`, `_CERT_SHA256` n'est définie. **Conséquence à anticiper** : l'app installée est signée `848419ed` et marquée `DEBUGGABLE` (`lastUpdateTime=2026-08-10 01:05:04`) — un APK release ne s'installera pas par-dessus, il faudra désinstaller d'abord et perdre les données de l'app. Aucun keystore n'a été généré et aucune empreinte fabriquée : créer la clé de signature est une décision d'identité durable qui appartient au propriétaire. **Ce qui est prouvé le 2026-08-11, sur décision d'Erwan (build non signé uniquement)** : `bun run build:android` passe de bout en bout, bundle mobile régénéré compris — APK `app-universal-release-unsigned.apk`, 1067 Mo, 2026-08-11 16:19:45, SHA-256 `8E4EFD5C4BCB86F0132147D2CB1F789B29AF73A9E0954D9645BF80EA4C6291E3`. `apksigner verify` répond `DOES NOT VERIFY — Missing META-INF/MANIFEST.MF`, ce qui **prouve qu'aucune clé n'a été utilisée**, en particulier pas la clé debug. La chaîne de build n'est donc pas le blocage ; seule la clé l'est |
| G8 | Identité produit | automatique | **PARTIEL** | Gate `identity` verte (surfaces, app IDs, adaptateurs générés). Résidus produit corrigés dans le runtime livré ; reste classé §0ter, dont `packages/web` bloqué par G9 |
| G9 | Domaine / site de documentation | **humaine** | **DÉCIDÉE le 2026-08-11 — appliquée aux surfaces livrées** | Décision du propriétaire : **aucun domaine acquis**, le projet ne publie pas de site et sa localisation canonique est `github.com/Rwanbt/unifia`. Voir §0quater pour le périmètre exact, ce qui a été purgé et ce qui reste délibérément hors périmètre |
| G10 | Publication externe | **humaine** | **NON DEMANDÉE** | Aucun paquet npm publié, aucune release GitHub créée, aucun APK/image Docker publié, `UNIFIA_ALLOW_UPSTREAM_PUBLISH` jamais défini |

**Règle de promotion.** `feat/unifia-rebrand-complete → dev` (PR #23) ne peut
pas être fusionnée tant que G4, G5 et G7 sont ouvertes. G9 est close depuis le
2026-08-11 (§0quater). G3 est une dette
de la branche de base : elle doit être traitée pour elle-même, pas en bloquant
les lots qui ne l'ont pas causée.

### 0bis. Durcissement de branche appliqué — et pourquoi `enforce_admins` reste `false`

Contrainte structurelle : le dépôt a **un seul mainteneur**. GitHub interdit
d'approuver sa propre PR, donc `required_approving_review_count: 1` combiné à
`enforce_admins: true` verrouillerait définitivement `main` et `dev` — aucune
PR ne pourrait plus être fusionnée par personne. La posture retenue est donc
**1 approbation avec `enforce_admins: false`** : la règle est visible et
s'imposera à tout contributeur futur, tandis que l'admin conserve une porte de
sortie explicite. `enforce_admins: true` ne devra être activé qu'à partir du
moment où un second mainteneur peut approuver.

`require_code_owner_reviews` reste `false` pour la même raison, bien que
`.github/CODEOWNERS` soit désormais correct : l'activer aujourd'hui ne ferait
qu'ajouter une exigence que seul l'admin peut contourner.

`strict: false` (branche pas obligatoirement à jour avant fusion) est
délibéré : avec des PR empilées, `strict: true` impose un rebase à chaque
fusion en amont de la pile.

Configuration exacte appliquée : `D:\tmp\unifia-gov\protection-target.json`.
État antérieur sauvegardé dans `protection-main.json` et `protection-dev.json`
du même dossier, hors dépôt — le changement est donc réversible.

Checks exigés — chacun vérifié **dans son fichier de workflow** comme ayant un
déclencheur `pull_request` (ou `pull_request_target`) **sans filtre `paths`**,
donc exécuté sur toute PR :

```
check-compliance, check-standards   ← pr-standards.yml       (pull_request_target)
conformance                          ← unifia-conformance.yml (paths sur push seulement)
rust unit tests, unit (linux), unit (windows) ← test.yml      (pull_request nu)
sdk in sync with server              ← sdk-sync.yml           (pull_request nu)
```

> **Piège évité, à ne pas réintroduire.** `sdk-drift` avait d'abord été retenu
> parce qu'il apparaissait sur les PR #23, #24 et #25. Il ne s'est pas déclenché
> sur la PR #28 : son workflow `observability-sdk-drift.yml` est filtré par
> `paths` sur `pull_request`. Un check requis qui ne se déclenche pas reste
> éternellement « Expected — waiting for status », donc **bloque définitivement**
> toute PR ne touchant pas ces chemins. Constater qu'un check apparaît sur
> quelques PR ne prouve pas qu'il est inconditionnel : seul le fichier de
> workflow le prouve.

Exclus délibérément : `e2e (linux)` (G3, échec permanent — l'exiger bloque
tout), `sdk-drift` (filtré par chemin, voir ci-dessus), `check` (nom ambigu,
porté par les workflows `identity` **et** `brand`), `unit results (*)`
(check-runs de reporting), et tout check filtré par chemin (`typecheck`,
`CodeQL`, `nix-eval`, `storybook build`, `android cross-compile check`,
`license-upstream`, `app LOC budget`, `schema-and-snapshot`,
`snapshot-freshness`, `runtime.rs unit tests`).

### 0ter. Références `opencode` restantes — classement

Le but n'est pas zéro occurrence : c'est zéro occurrence **produit non
justifiée**. Classement des occurrences restantes :

| Catégorie | Exemples | Décision |
|---|---|---|
| **D — contrat externe** | id de provider `opencode/*` et `ProviderID.opencode`, `engines.opencode`, `sst-dev.opencode`, `ai.opencode.desktop` (lu pour coexistence), `ai.opencode.managed`, `providerOptions.opencode`, `$schema` `opencode.ai/config.json`, `User-Agent: opencode/*` | **Conserver** |
| **C — compatibilité** | `.opencode` en lecture, `LEGACY_CONFIG_FILES`, `LEGACY_DATABASE_FILE`, `opencode-<canal>.db`, `OPENCODE=1` (marqueur lu par des scripts utilisateurs, aucun consommateur interne) | **Conserver en lecture, écrire en Unifia** |
| **E — amont** | `docs/autonomy/UPSTREAM-*`, `github-remote.test.ts`, `script/publish.ts` gardé par `UNIFIA_ALLOW_UPSTREAM_PUBLISH`, mentions explicites d'OpenCode dans README/SECURITY/AGENTS | **Conserver, marqué comme amont** |
| **F — généré** | `assets/runtime/unifia-cli.js` et sa copie `gen/android/…` (contiennent encore `OPENCODE_CLIENT`) | **Aucune action** : `build:android` lance `bundle-mobile.mjs` avant tout build, donc la copie suivie est un cache régénéré, pas ce qui ship |
| **G — web/domaine** | `packages/web/**`, `packages/console/**` | **Hors périmètre par décision G9** — surfaces de site non publiées par le fork ; voir §0quater |
| **B — interne, différé** | ~50 tags de service Effect `@opencode/*` (clés de DI, jamais persistées ni visibles), thèmes `opencode.json`, `team/opencode-application.ts` | **Différé** : renommage mécanique à risque non nul et gain nul côté utilisateur ; ne pas le faire pour faire tomber un compteur |
| **H — incertain** | `runtime/server.rs` exporte `UNIFIA_SERVER_USERNAME="opencode"` | **Ne pas toucher sans preuve device** : le nom d'utilisateur est saisi côté app ; le changer sans vérifier le chemin complet casserait l'auth mobile |

### 0quater. Décision G9 — aucun domaine, localisation canonique GitHub

**Décision du propriétaire, 2026-08-11** : le projet n'acquiert aucun domaine, ne
publie aucun site, et sa localisation canonique est `github.com/Rwanbt/unifia`.

Le point de départ était pire que « `packages/web` cite `opencode.ai` ». Le
rebrand avait **fabriqué** `unifia.ai` dans des surfaces exécutables, alors que
ce domaine n'est enregistré par personne — donc revendicable par un tiers.
Corrigé ici :

| Surface | Ce qui était écrit | Correctif |
|---|---|---|
| `infra/stage.ts` | `unifia.ai` comme domaine de production | Garde `UNIFIA_ALLOW_UPSTREAM_DEPLOY`, sur le modèle de `script/publish.ts` ; le domaine de production redevient celui d'amont, atteignable uniquement sous opt-in |
| `.github/workflows/deploy.yml` | `push: [dev, production]` | `workflow_dispatch` avec confirmation explicite. **C'était le risque le plus concret : fusionner la PR #23 dans `dev` déclenchait un `sst deploy` vers une infrastructure qui n'est pas la nôtre** |
| `CODE_OF_CONDUCT.md`, `SECURITY-INCIDENT-RESPONSE.md` | `conduct@` / `security@unifia.ai`, handle `@Unifia` | Signalement privé GitHub ; aucune adresse ni handle exposés |
| `packages/desktop`, `packages/desktop-electron` | menu Documentation → `https://unifia.ai/docs` | → `github.com/Rwanbt/unifia#readme` |
| `packages/app/src/i18n/*` (17 locales) | libellé `unifia.ai/zen` **alors que le `href` pointait sur `opencode.ai/zen`** | Libellé aligné sur la destination réelle |
| `packages/app/src/entry.tsx` | branche `hostname.includes("unifia.ai")` | Supprimée : code mort, le fork ne sert depuis aucun domaine |
| `packages/unifia/src/team/fencing.ts`, test helper | identités git `@unifia.ai` | `.invalid` (RFC 2606), non résoluble par construction |
| TUI `tips-view`, ADR-0014, plan P15, README VS Code | domaine cité comme destination | Mention du domaine retirée |

Un motif s'est répété : le rebrand a renommé le **texte** sans le **lien**
(`[unifia.ai/zen](https://opencode.ai/zen)`, bouton copiant `opencode.ai/install`
sous un libellé `unifia.ai/install`). Vérifier les deux sens à chaque renommage.

**Délibérément hors périmètre** : `packages/web` et `packages/console` sont les
surfaces de site. Le fork ne les publie pas et leur déploiement est neutralisé
ci-dessus ; les réécrire n'apporterait rien tant qu'aucun site n'existe. Elles
restent classées **G**. Les occurrences subsistant ailleurs sont **descriptives**
(rapports d'audit, plans, interdictions explicites) et ne dirigent personne vers
le domaine.

---

## 1. État en un coup d'œil

| Axe | État | Ref |
|-----|------|-----|
| Blockers sécurité B1–B6 | Fermés ou opt-in gaté | `PRODUCTION_REVIEW_2026-04.md` §2 |
| Warnings W1–W9 | Fermés (W9 breaking change documenté) | `PRODUCTION_REVIEW_2026-04.md` §3 |
| Supply-chain baseline | Dependabot + CodeQL + SBOM live ; cosign + SLSA livrés dormants | `.github/workflows/release-sign.yml`, `slsa.yml` |
| Release notes | Template prêt | `RELEASE_NOTES_TEMPLATE.md` |
| QA mobile OEM | Checklist prête, **sign-off à exécuter** | `QA_ANDROID_DEVICES.md` |
| Dependabot first batch | Workflows en place, **triage batch à exécuter** | `.github/DEPENDABOT_TRIAGE.md` |
| Crash observability | Reporter + rotation 50 fichiers | `SPRINT3_NOTES.md` I1 |
| GDPR endpoints | export + delete + purge worktrees | `SPRINT3_NOTES.md` I3, `SPRINT4_NOTES.md` #3 |
| Audit log | instrumenté 6 call sites + retention purger | `SPRINT4_NOTES.md` #1–#2 |
| Keychain desktop | commandes Tauri + IPC endpoint + Auth.layer wire + migration auto | `SPRINT4_NOTES.md` #6, `SPRINT5_NOTES.md` #4–#5, `SPRINT6_NOTES.md` #2 |
| Provider fallback | câblé + cloud providerID customisable (`experimental.provider.fallback_cloud_providerID`) | `SPRINT5_NOTES.md` #2, `SPRINT6_NOTES.md` #5 |
| WS ticket flow | serveur + terminal migré ; 2 autres sites NOT APPLICABLE | `SPRINT4_NOTES.md` #7, `SPRINT5_NOTES.md` #6, `SPRINT6_NOTES.md` #3 |
| Thermal listener Android | JNI impl Rust cfg-gated, validation via `tauri android build` | `PRE_EXISTING_FIXES.md` I9 |
| E2E DAG team | full e2e | `RESIDUAL_DEBT_CLEANUP.md` |
| Keychain runtime test | mock endpoint TS + round-trip test | `RESIDUAL_DEBT_CLEANUP.md` |

---

## 2. Ce qui est DONE

### Sécurité

- **B3** Android cleartext LAN-only (RFC1918 anchors) — `SPRINT1_NOTES.md`.
- **B4** `AbortSignal.timeout(15000)` sur Ollama probes — `SPRINT1_NOTES.md`.
- **B5** `File.read` rejette les symlinks échappés — `SPRINT1_NOTES.md`.
- **B6** Dependabot, CodeQL, SBOM, cosign, SLSA — workflows livrés.
- **W7** MCP scoping exact-match (Set.has) — `SPRINT1_NOTES.md`.
- **W8** CORS allowlist explicite — `SPRINT1_NOTES.md`.
- **W9** Shell env allowlist — **breaking change** documenté dans
  `RELEASE_NOTES_TEMPLATE.md`.
- **I7** Scanner étendu Slack/Stripe/GH/Google/Anthropic/OpenAI/Datadog
  + prompt-injection tool-output — `SPRINT3_NOTES.md`.

### Fiabilité

- **W1** Cost cap per-session + 429 — `SPRINT2_NOTES.md`.
- **W2** `getWorktreeInfo` typé + log — `SPRINT2_NOTES.md`.
- **W3** Helper `getMessageCost` typé — `SPRINT2_NOTES.md`.
- **W4** llama-server flags (`--mmap --slots --slot-save-path
  --cache-reuse`) + speculative decoding gated — `SPRINT2_NOTES.md`.
- **W5** Circuit breaker `ensureCorrectModel` vérifié — `SPRINT1_NOTES.md`.
- **W6** Background semaphore `max_parallel` — `SPRINT2_NOTES.md`.

### Observabilité / compliance

- **I1** Crash reporter + rotation + opt-in upload — `SPRINT3_NOTES.md`.
- **I3** GDPR export / delete (DB + crashes + worktrees) — `SPRINT3_NOTES.md`, `SPRINT4_NOTES.md`.
- **I4** Audit log + retention purger + 6 call sites instrumentés —
  `SPRINT3_NOTES.md`, `SPRINT4_NOTES.md`.

### Supply-chain

- `.github/workflows/codeql.yml`, `sbom.yml` livrés Sprint 1.
- `.github/workflows/release-sign.yml` livré (cosign keyless + attest).
- `.github/workflows/slsa.yml` livré (Level 3, reusable).
- `.github/dependabot.yml` live.

### Auth & WS

- **B1** Desktop keychain (crate `keyring` v3) + IPC endpoint
  localhost + migration `auth.json` → keychain (gaté
  `UNIFIA_AUTH_STORAGE=keychain`) — `SPRINT4_NOTES.md`, `SPRINT5_NOTES.md`.
- **B2 serveur** `/auth/ws-ticket` + middleware cookie/subprotocol +
  legacy flag — `SPRINT4_NOTES.md`.

---

## 3. Ce qui RESTE

### Release-blocking

- [ ] **QA Android physique signé** sur les 4 OEM (voir
      `QA_ANDROID_DEVICES.md`). Owner : QA.
- [ ] **Dependabot first batch triagé** (voir
      `.github/DEPENDABOT_TRIAGE.md`). Owner : Infra.
- [ ] **Release notes remplies** depuis `RELEASE_NOTES_TEMPLATE.md`
      avec checksums réels. Owner : Release manager.

### 3 bis. QA REAL — 9 bugs UX bloquants (Mi 10 Pro MIUI 13 + Desktop Win)

Source : QA utilisateur réel 2026-04-19, détail dans `NEXT_SESSION_PLAN.md`.

| # | Sévérité | Titre | Fichier principal |
|---|----------|-------|-------------------|
| 1 | HAUTE    | Terminal portrait first-prompt invisible (scheduleSize manquant dans refits) | `packages/app/src/components/terminal.tsx` |
| 2 | HAUTE    | `vim` → `toybox: unknown command vi` (bundler busybox-static) | `packages/mobile/src-tauri/assets/runtime/bin/` + `runtime.rs` |
| 3 | HAUTE    | Kokoro TTS download silencieux mobile (surfacer erreurs/progress) | `packages/mobile/src-tauri/src/speech.rs` + `use-speech.ts` |
| 4 | HAUTE    | Voice clone desktop sans son (désync ttsVoice + test button) | `packages/desktop/src-tauri/src/speech.rs` + `settings-audio.tsx` |
| 5 | WONT-FIX | OAuth Gemini + Anthropic impossibles (API-key only, voir NEXT_SESSION_PLAN.md) | `packages/unifia/src/plugin/codex.ts` (pattern de référence) |
| 6 | HAUTE    | CLI TUI ne spawn pas llama-server à la sélection modèle local | `cli/cmd/tui/component/dialog-model.tsx` |
| 7 | MOY      | Panneau git changes lent (memoization + virtualization) | `packages/app/src/pages/session/session-side-panel.tsx` |
| 8 | CRITIQUE | QR internet mode "impossible de joindre" (bind 0.0.0.0 + fingerprint + /health) | `packages/desktop/src-tauri/src/server.rs` + `tls.rs` |
| 9 | BASSE    | LLM lent : UX badge "Recommandé par device class" + preset Eco | `packages/mobile/src/components/dialog-local-llm.tsx` |

Ordre : Terminal (1+2) → Speech (3+4) → Local LLM (6+9) → OAuth (5) →
Remote (7+8). Estimation ~10 h. Time-box priorité : 1, 2, 3, 6, 8 avant
4, 7 avant 5, 9.

### Non release-blocking (backlog sprint 6+)

- [ ] **B2 clients WS** migrer `packages/app/src/hooks/use-collaborative.ts`,
      `components/terminal.tsx`, `packages/web/src/components/Share.tsx`
      et mobile vers `createAuthenticatedWebSocket`. Puis flip
      `experimental.ws_auth_legacy` à `false`.
- [ ] **I9 thermal JNI** câbler `PowerManager.getCurrentThermalStatus()`
      (crates `jni` + `ndk-context` absents de `Cargo.toml`).
- [ ] **Provider fallback "cloud" resolver** sélection explicite
      d'un secondary (actuellement "premier provider listé").
- [ ] **E2E DAG team full harness** implémenter `Instance.runForTest(fn)`
      pour débloquer les tests skippés.
- [ ] **Keychain Android** `EncryptedSharedPreferences` via plugin
      Tauri dédié (design-only aujourd'hui).
- [ ] **CLI fallback AES-GCM** pour les environnements sans keychain
      (Argon2id TOFU).
- [ ] **Keychain endpoint fuzzing** audit du parser HTTP fait main.
- [ ] **Audit log config.update** capturer les clés imbriquées (pas
      seulement top-level).

---

## 4. Decision log

| Décision | Raison | Réversible ? |
|----------|--------|--------------|
| `experimental.ws_auth_legacy` default `true` | 4 clients WS non migrés ; flip casserait le mode LAN pairing | Oui, flip à `false` une fois clients migrés |
| `UNIFIA_AUTH_STORAGE` default `file` | Keychain storage pas branché dans le layer Effect `Auth` ; `FileStorage` reste backend actif | Oui, activer en `keychain` une fois layer Effect refactoré |
| `experimental.provider.fallback` default `null` | Comportement byte-identical pour les utilisateurs existants ; fallback est opt-in explicite | Oui |
| `experimental.audit.enabled` default `false` | Overhead DB sur call sites critiques ; opt-in pour users compliance | Oui |
| `experimental.dlp.scan_tool_outputs` default `false` | Coût scanner sur chaque tool-output, faux positifs possibles | Oui |
| Thermal listener retourne `"nominal"` par défaut | Binding JNI non câblé (crates absents), stub sûr | Non — nécessite implémentation |
| Cosign / SLSA gated `if: repository == 'Rwanbt/unifia'` | Empêcher le spam sur les forks downstream | Oui |
| SPRINT1 B2 **SAUTÉ** | Risque régression non maîtrisé sans baseline e2e Playwright | N/A — repris en Sprint 4 |
| `cleartextTrafficPermitted` via `includeSubdomains` sur IP | Android ne supporte pas CIDR en network_security_config | À valider en QA MIUI |
| Shell env filtering (W9) strict allowlist + prefixes | Défense en profondeur contre exfiltration via spawn | Oui mais breaking (doc RN) |

---

## 5. Dépendances de release

Les étapes suivantes ont des dépendances **strictes** dans cet ordre :

```
[1] Merge dev → main
  ├─ dep: Dependabot first batch triaged (§3)
  ├─ dep: QA Android sign-off 4 OEM (§3)
  └─ dep: Tous les tests verts (bun test + cargo check)

[2] Create release tag
  └─ dep: [1]

[3] publish.yml build (release.published)
  ├─ dep: [2]
  └─ produit les artefacts (APK/DMG/MSI/deb/rpm)

[4] release-sign.yml (release.published auto)
  ├─ dep: [3]  (artefacts présents sur la release)
  ├─ permissions: id-token:write + attestations:write + contents:write
  └─ produit: .sig, .cert, .sha256

[5] slsa.yml (release.published ou appelé par publish.yml)
  ├─ dep: [3] ou [4]
  └─ produit: .intoto.jsonl (SLSA L3)

[6] Fill RELEASE_NOTES_TEMPLATE.md
  ├─ dep: [4] .sha256 disponibles
  └─ coller les checksums réels dans la section Checksums

[7] Announce / Publish release notes
  └─ dep: [6]
```

Contraintes transverses :

- `release-sign.yml` exige que le workflow ait `id-token: write` —
  configuré dans le yaml. Vérifier que la **org settings** GitHub
  autorise ce permission pour `Rwanbt/unifia`.
- `slsa.yml` via `slsa-framework/slsa-github-generator@v2.0.0` est
  une action réutilisable ; elle nécessite que le repo soit
  **public** (Fulcio OIDC exige) ou qu'une config privée ait été
  enrôlée. Vérifier avant publication.

---

## 6. Contacts / owners

| Item | Owner | Backup |
|------|-------|--------|
| QA Android | QA lead | Dev mobile |
| Dependabot triage | Infra | Dev backend |
| Release notes | Release manager | PM |
| Cosign / SLSA workflows | Infra / Security | — |
| Keychain migration (activation) | Dev desktop | Dev backend |
| WS ticket clients migration | Dev frontend (app/web) | Dev desktop/mobile |
| Thermal JNI câblage | Dev Android natif | Dev mobile |
| Crash reporter endpoint | SRE / Observability | — |
| GDPR endpoints ops | Legal / Compliance | Dev backend |

Pour toute question : ouvrir un issue `Rwanbt/unifia` avec le
label correspondant (`qa-android`, `dependencies`, `release`,
`supply-chain`, `auth`, `observability`).

---

## 7. Index des documents

### Audits et plans
- `PRODUCTION_REVIEW_2026-04.md` — audit staff-level pré-prod (B1–B6, W1–W9, P-NEW).
- `AUDIT_REPORT.md` — audit général.
- `SECURITY_AUDIT.md` — audit sécurité dédié.
- `ANDROID_AUDIT.md` — audit mobile dédié.
- `PERFORMANCE_REPORT.md` — audit perf.
- `KNOWN_ISSUES.md` — bugs connus (non bloquants).
- `PRE_EXISTING_FIXES.md` — patches de base pré-sprint.

### Sprint notes
- `SPRINT1_NOTES.md` — B3/B4/W5/W7/W8/W9/B5/B6 ; B2 sauté.
- `SPRINT2_NOTES.md` — W1/W2/W3/W4/W6 ; B1 design only.
- `SPRINT3_NOTES.md` — I1 crash / I3 GDPR / I4 audit / I7 scanner /
  I9 thermal stub / I10 fallback helper / I11 DAG skeleton.
- `SPRINT4_NOTES.md` — audit purger & instrumentation, GDPR purge
  étendu, keychain Rust, WS ticket serveur.
- `SPRINT5_NOTES.md` — mock provider, fallback câblé, in-process
  server, keychain IPC, migration auth.json, helper WS client.
- `SPRINT6_NOTES.md` — fallback cloud providerID config, Auth.layer
  keychain selection + initAuthStorage boot, terminal WS migré,
  keychain-smoke + DAG e2e skeleton.
- `RESIDUAL_DEBT_CLEANUP.md` — dette résiduelle finalisée (DAG full
  e2e + keychain mock test).

### Livrables infra (ce pack)
- `.github/workflows/release-sign.yml` — cosign keyless + attest-build-provenance.
- `.github/workflows/slsa.yml` — SLSA L3 generator.
- `RELEASE_NOTES_TEMPLATE.md` — template release notes.
- `.github/DEPENDABOT_TRIAGE.md` — procédure first batch.
- `QA_ANDROID_DEVICES.md` — checklist OEM-par-OEM.
- `PROD_READINESS.md` — ce document.

### QA / tests
- `MANUAL_TESTS.md` — checklist générique cross-platform.
- `QA_ANDROID_DEVICES.md` — checklist Android OEM.

### Config & workflows déjà en place
- `.github/dependabot.yml`
- `.github/workflows/codeql.yml`
- `.github/workflows/sbom.yml`
- `.github/workflows/publish.yml`
- `.github/workflows/android.yml`
