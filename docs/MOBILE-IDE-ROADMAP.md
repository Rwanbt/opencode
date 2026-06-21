# Roadmap — OpenCode Mobile → IDE Android complet (dual-mode Agent ⇄ IDE)

> Statut : approuvée 2026-06-16. Reviews croisées Codex + MiniMax, vérifiée contre la codebase.
> Décisions : moteur éditeur = **CodeMirror 6** ; identité = **dual-mode switchable** (Mode Agent ⇄ Mode IDE).

## Context

Transformer une excellente console agentique mobile (viewer/diff read-only) en IDE Android où
l'humain peut éditer / naviguer / build / versionner à la main *quand il le veut*, l'agent restant
copilote — les deux expériences coexistant via un toggle de vue. Le frontend `packages/app` /
`packages/ui` étant mutualisé, chaque chantier (éditeur, LSP, Git UI) atterrit d'un coup sur
desktop + Android (+ iOS futur).

### Ajustements issus de la vérification directe du code

1. **Le manque Git est plus profond que l'analyse initiale** : le backend `git/index.ts` est lui-même
   en lecture seule (`status/diff/show/stats/fetch/upstream/revCount` — pas de
   `commit/stage/unstage/push/pull/blame/log`). La phase Git n'est pas qu'un chantier UI : il faut
   d'abord créer la couche backend d'écriture.
2. **`docs/SKILLS-SYSTEM-DESIGN.md` existe déjà** → la phase plugins/skills part d'une base réelle.
3. **Permissions Android** (vérifié dans `MainActivity.kt`) : `MANAGE_EXTERNAL_STORAGE` n'est PAS
   « non implémenté ». `requestStoragePermission()` (MainActivity.kt:174-214) ouvre déjà l'écran All
   Files Access via `ACTION_MANAGE_APP_ALL_FILES_ACCESS_PERMISSION`, et `onResume` (235-276) détecte
   la transition OFF→ON et respawn pty_server pour rafraîchir le mount FUSE. Le vrai manque est **UX**.
   La doc `docs/ANDROID_DEVELOPMENT.md §5 "à implémenter"` est **stale**.
4. **Briques de la Phase 1 déjà présentes à réutiliser** : guard anti-escape symlink
   (`assertInsideProject` + `AppFileSystem.resolve`, file/index.ts:513-526) et l'event
   `File.Event.Edited` (déjà déclaré file/index.ts:77-78).

## État vérifié de la codebase (mis à jour 2026-06-20)

| Domaine | État réel | Fichier de référence |
|---|---|---|
| Éditeur | ✅ CodeMirror 6 éditable (dirty/save/conflit/undo-redo), dual-mode Agent⇄IDE | `packages/app/src/context/editor/store.ts`, `file-tabs.tsx:638` |
| API fichier | ✅ `write/rename/move/delete` + garde anti-escape + modèle de conflit hash | `packages/opencode/src/server/routes/file.ts`, `file/index.ts` |
| LSP backend | ✅ hover/def/refs/symbols/diagnostics + 9 ops | `packages/opencode/src/lsp/index.ts`, `packages/opencode/src/tool/lsp.ts` |
| LSP UI humain | ✅ diagnostics gutter, hover, F12 go-to-def, `/find/symbol` réactivé | `packages/ui/src/components/code-mirror-lsp.ts`, `routes/lsp.ts` |
| Git backend | ✅ add/reset/commit/push/pull/log/blame/branches/createBranch/switchBranch | `packages/opencode/src/git/index.ts` |
| Git UI | ✅ Source Control panel — staged/unstaged/commit/push/pull/branch switcher | `packages/app/src/components/source-control.tsx` |
| Terminal | ✅ Complet (PTY/tabs/toolbar mobile/WebSocket) | `packages/opencode/src/pty/index.ts`, `terminal-panel.tsx` |
| Build/Test/Debug utilisateur | ✅ Task runner — détecte npm/cargo/make, exécute via PTY | `packages/app/src/components/task-panel.tsx` |
| Plugins backend | ✅ 14+ hooks, plugins internes/npm/locaux, custom tools, events | `packages/opencode/src/plugin/index.ts` |
| Plugin manager UI | ✅ MCP full CRUD — add/remove/toggle/auth, remote + local | `packages/app/src/components/settings-plugins.tsx` |
| Permissions Android | ✅ UX complète — diagnostics thermique/RAM, bouton permissions, état visible | `packages/app/src/components/settings-android.tsx` |
| Notifications système | ✅ NotificationBridge — session completed/failed + model ready | `packages/mobile/src/notifications.ts`, `entry.tsx:540` |
| Deep-link étendu | ✅ connect + open + session — handleDeepLink() router | `packages/mobile/src/entry.tsx:296` |
| Mobile hardening (Phase 0+) | ✅ logging toolchain, runtime décomposé, bundling unifié | `packages/mobile/src-tauri/src/runtime/` |
| Skills system | ✅ Liste + install via URL + uninstall (global skills) | `packages/opencode/src/skill/index.ts`, `settings-plugins.tsx` |
| Split panes | ✅ Ctrl+\ volet droit, drag resize, focus mode tablette | `file-tabs.tsx`, `session-side-panel.tsx`, `layout.tsx` |

## Audit dette technique (2026-06-16) & révisions

Audit ciblé sur les modules roadmap-critiques (déterministe LOC/TODO/tests/docs + 3 agents).

**Frontend — dette FAIBLE/MOYENNE.** `packages/ui/src/components/file.tsx` (1097 LOC, upstream) est un
viewer **pur à API props** : l'éditeur s'ajoute **sans le modifier**, via le point d'injection
`useFileComponent()` (`FileComponentProvider`, `packages/app/src/app.tsx:147`). Tout le code éditeur
(~1100 LOC) vit dans `packages/app/src` (domaine fork). `context/file.tsx` (280 LOC) accueille le dirty
state. **Risques** : `session.tsx` (1022) et `layout.tsx` (1126) sont au plancher ADR-0002 ; `packages/ui`
a **0 test** sur file/tabs/session.

**Backend — dette BASSE, effort ~10-12h.** `AppFileSystem` (`writeWithDirs/ensureDir`) et le wrapper git
`run()` rendent write-routes (2-3h) et git-write (3-4h) peu risqués. **Mais** : (a) `assertInsideProject`
n'est PAS encore appliqué à l'écriture → à étendre ; (b) `/find/symbol` a été désactivé par effet de bord
d'une régénération OpenAPI (commit f969b1dac), pas pour perf → réactivable avec timeout ; (c) **friction SDK** :
chaque route Hono exige `describeRoute()` + régénération `packages/sdk/js` (~10-15 min/route, footgun si oubli).

**Mobile — dette ÉLEVÉE (7.5/10).** `runtime.rs` (1869 LOC, 7 responsabilités) documenté mais fragile :
chaîne shebang+LD_PRELOAD **sans test**, swallow d'erreurs `let _ =` sur symlinks, double bundling CLI.
CI : APK build+sign OK, mais seuls `proxy::tests` tournent (runtime tests Android-gated), **zéro test
émulateur**. → Phase 4 on-device = 6-8 semaines, bloquée sur durcissement préalable.

### Révisions appliquées

1. **Frontière fork** : éditeur 100% `packages/app` via `useFileComponent` (zéro modif `file.tsx`) ;
   ajouts backend en blocs `// FORK:` avec interfaces publiques propres (ADR-0003).
2. **Budgets LOC durs** : `file.tsx` +0 ; `session.tsx` ≤ +80 ; `layout.tsx` ≤ +30 ; tout nouveau
   fichier `packages/app` < 500 LOC.
3. **CI/QA enrichi** : gate de synchro SDK + tests `packages/app`/`ui` (file-tabs + editor-store dès P1).
4. **Nouveau pré-requis Phase 0+ (durcissement mobile)** avant Phase 4.
5. **Phase 4 re-scopée** : DAP on-device → *stretch* (préférer debug desktop/remote).
6. **Détails** : timeout sur `/find/symbol` (P2) ; auth push/pull (SSH/token) = sous-chantier (P3).

## Principe transversal : Dual-mode Agent ⇄ IDE

À introduire **dès la Phase 1** et à respecter dans chaque phase suivante :

- **Toggle de vue persistant** (préférence utilisateur, stockée dans les settings) :
  - **Mode Agent** : layout actuel (chat + viewer/diff + terminal) — l'agent pilote.
  - **Mode IDE** : layout éditeur-centré (file tree + éditeur multi-onglets + panneaux LSP/Git/Terminal).
- **Même état partagé** (buffers, fichiers ouverts, session) pour les deux vues. Pas de fork d'état.
- Réutiliser l'infra layout/onglets existante (`file-tabs.tsx`, `terminal-panel.tsx`, Kobalte Tabs).

## Track transversal : CI + QA automatisée

Projet à **builds natifs signés de 5+ min** (Rust + NDK + ORT) → la QA manuelle ne suffit pas.
Ce track court **en parallèle** de toutes les phases.

- **CI mobile** (démarrable immédiatement, ne bloque rien) :
  - Job PR : build `arm64-v8a` debug + `cargo test --target aarch64-linux-android` (aucun test natif en CI aujourd'hui).
  - Job nightly : AAB release signé.
  - Cache agressif `~/.cargo/registry` + `~/.gradle/caches` + build-tools.
  - Respecter le gate LOC sur le nouveau code éditeur/LSP/Git.
- **QA automatisée** (s'étoffe phase par phase) :
  - Tests unitaires : store éditeur (P1), couche git d'écriture (P3).
  - Flows Maestro étendus : permissions, settings, model switch, ouverture projet, édition+save.
  - Golden tests sortie LLM Android (déterminisme).
- **Cross-platform / dual-boot** : CI build depuis Linux → `ORT_LIB_LOCATION` par env var, pas en dur.
- **Gate synchro SDK** (issu de l'audit) : CI échoue si `packages/sdk/js` est désynchronisé du serveur
  (route ajoutée sans `describeRoute()` ou SDK non régénéré). Évite les routes invisibles aux clients.
- **Observabilité** (dette différée) : ajouter du logging aux `orElseSucceed(() => [])` / `let _ =`
  silencieux (file/index.ts backend, runtime.rs mobile) — non bloquant MVP, mais à tracer.

## Phases

### Phase 0 — Baseline device QA
Matrice réelle : Xiaomi/Pixel/tablette × Android 12-15, stockage externe, terminal, modèle local,
STT/TTS, deep-link remote, permissions. Corriger les docs stale (en priorité permissions runtime).

### Phase 0+ — Durcissement mobile (PRÉ-REQUIS de la Phase 4) ✅
Issu de l'audit dette mobile (élevée). À traiter avant tout chantier build/test on-device :
- [x] Documenter la chaîne shebang + LD_PRELOAD dans `KNOWN_FAILURE_PATTERNS.md` (diagramme) + tests
  d'idempotence de `prepare_toolchain_wrappers()` (`runtime.rs::prepare_toolchain_wrappers_is_idempotent`).
- [x] Supprimer le swallow d'erreurs silencieux (`let _ =` sur symlink/fs) → logging. D-12/D-13 ont
  couvert `force_symlink`/`repair_rootfs_hardlinks` ; le durcissement final couvre le chemin `wrap_one`
  (cc1/collect2/binutils/rustlib), la réécriture de wrapper, la restauration `liblto_plugin.so` et le
  seed `/etc/resolv.conf` — tous loggés (`[OpenCode] … failed to …`), best-effort par binaire conservé.
- [x] Unifier le bundling CLI (`prepare-android-runtime.sh` → `scripts/bundle-mobile.mjs`) → source unique (D-17).
- [x] Décomposer `runtime.rs` (1869 → ~848 LOC) en `runtime/{extraction,toolchain,server}.rs` (D-01).

### Phase 1 — Éditeur MVP + API fichier write ✅

**Implémenté** (Phase 1a : commit session 2026-06-19 ; Phase 1b : commit `6872bad85e`).

| Fonctionnalité | Fichier | État |
|---|---|---|
| API fichier write — `POST /file/write` (conflit hash stateless, écriture atomique), `POST /file/rename`, `POST /file/move`, `DELETE /file` | `packages/opencode/src/server/routes/file.ts` | ✅ |
| Backend file service — `write/rename/move/delete` + `assertInsideProject` guard + `File.Event.Edited` | `packages/opencode/src/file/index.ts` | ✅ |
| ADR-0004 — modèle de conflit hash + écriture atomique documenté | `docs/adr/ADR-0004-file-write-conflict-model.md` | ✅ |
| Editor store — state machine dirty/save/discard/reload/conflict, undo/redo | `packages/app/src/context/editor/store.ts` | ✅ |
| Editor store tests (124 tests) | `packages/app/src/context/editor/store.test.ts` | ✅ |
| EditorProvider — pont store ↔ SDK transport + watcher events | `packages/app/src/context/editor.tsx` | ✅ |
| CodeMirrorEditor intégré dans file-tabs.tsx (lazy-loaded, ~400 KB bundle) | `packages/app/src/pages/session/file-tabs.tsx:638` | ✅ |
| Dual-mode hook Agent ⇄ IDE | `packages/app/src/hooks/use-view-mode.ts` | ✅ |
| Bannières inline (conflit/stale/non-trouvé) | `packages/app/src/pages/session/editor-banner.tsx` | ✅ |

### Phase 2 — LSP exposé à l'humain ✅

**Implémenté** (commit `e174a0bb9a`).

| Fonctionnalité | Fichier | État |
|---|---|---|
| `/find/symbol` réactivé (withTimeout 5 s + fallback `[]`) | `routes/file.ts:150` | ✅ |
| Routes LSP humain : `/lsp/diagnostics`, `/lsp/hover`, `/lsp/definition`, `/lsp/references`, `/lsp/document-symbol` | `routes/lsp.ts` | ✅ |
| SDK v2 régénéré — `sdk.client.lsp.{diagnostics,hover,definition,references}` | `packages/sdk/js/src/v2/gen/sdk.gen.ts` | ✅ |
| Extensions CM6 : diagnostics gutter + linter (750 ms debounce) | `packages/ui/src/components/code-mirror-lsp.ts` | ✅ |
| Extensions CM6 : hover tooltip (300 ms, MarkupContent aware) | idem | ✅ |
| Extensions CM6 : F12 go-to-definition → ouvre fichier cible | idem | ✅ |
| LSP callbacks câblés dans l'éditeur | `packages/app/src/pages/session/file-tabs.tsx:208-226` | ✅ |

**Stretch (partiellement implémenté)** :
- **Shift+F12 références panel** ✅ (commit `6dd63051b7`) — keybinding CM6 → `callbacks.references()` → panneau inline liste cliquable, bouton ✕, navigation vers fichier cible.
- **Autocomplete** ✅ (commit `d949e89e4d`) — `POST /lsp/completion` + `buildLspCompletionSource()` CM6, `activateOnTyping: false`, mapping kinds LSP→CM6, `@codemirror/autocomplete 6.20.3`.
- **Rename symbol** ✅ (commit `8f534ac755`) — `POST /lsp/rename` + `applyTextEdits()` + panneau F2 → dialog inline pré-rempli, Enter/Escape, toast multi-fichiers.
- **Code actions** ✅ (commit `fe9b924722`) — `POST /lsp/code-action` + `POST /lsp/execute-command` + `Ctrl+.` CM6 + panneau liste actions avec badge `isPreferred`.

### Phase 3 — Workspace + Git (backend ET UI) ✅

**Implémenté** (commit `e174a0bb9a`).

| Fonctionnalité | Fichier | État |
|---|---|---|
| Backend git write : `add/reset/commit/push/pull/log/blame/branches/createBranch/switchBranch` | `git/index.ts` | ✅ |
| Routes HTTP : `/git/working-status`, `/git/add`, `/git/reset`, `/git/commit`, `/git/push`, `/git/pull`, `/git/log`, `/git/blame`, `/git/branches`, `/git/branch` | `routes/git.ts` | ✅ |
| SDK v2 régénéré — classe `Git` avec toutes les méthodes | `packages/sdk/js/src/v2/gen/sdk.gen.ts` | ✅ |
| UI Source Control — staged/unstaged, commit, push, pull, branch switcher, historique | `components/source-control.tsx` | ✅ |
| Intégration side panel — onglet "git" dans `SessionSidePanel` | `pages/session/session-side-panel.tsx` | ✅ |

**Auth push/pull** : délibérément via le credential store système (SSH/token = sous-projet séparé non implémenté). **Workspace** (clone/ouvrir/créer) : déféré Phase 3+.

### Phase 4 — Build / Test / Debug ✅

**Implémenté** (commit `e174a0bb9a`).

| Fonctionnalité | Fichier | État |
|---|---|---|
| Détection tâches : `package.json` (scripts npm), `Cargo.toml` (build/test/clippy/run), `Makefile` (targets) | `components/task-panel.tsx` | ✅ |
| Exécution via PTY existant — `terminal.newWithCommand(command, title)` | `context/terminal.tsx:415` | ✅ |
| Onglet "tasks" dans le side panel | `pages/session/session-side-panel.tsx:412` | ✅ |

**Stretch (partiellement implémenté)** :
- **Problem matchers** ✅ (commit `a7f40d58f1`) — `Pty.tail(id, maxChars)` + `GET /pty/:id/tail` (ANSI strippé) ; parseurs Rust (`--> file:line:col`) / TS (`file(line,col): error TSxxxx`) / GCC (`:line:col: error:`) ; bouton "Analyser" + panneau erreurs/avertissements dans le task panel. `terminal.newWithCommand()` retourne l'ID PTY. | `packages/opencode/src/pty/index.ts`, `routes/pty.ts`, `components/task-panel.tsx`
- **Test explorer** — parser la sortie `cargo test` / `npm test` (patterns `test … ok` / `FAILED`) dans une vue séparée. Partage l'infra `Pty.tail()` déjà implémentée.
- **DAP debug on-device** — démoté (chaîne shebang fragile, faible ROI vs desktop remote-control).

### Phase 5 — Plugins / Skills / MCP mobile ✅

**Implémenté** (commit `e174a0bb9a`).

| Fonctionnalité | Fichier | État |
|---|---|---|
| Plugin manager MCP — liste serveurs (statut connected/failed/needs_auth), toggle activer/désactiver, authentification OAuth | `components/settings-plugins.tsx` | ✅ |
| Ajout serveur MCP Remote (HTTP) ou Local (stdio) — formulaire inline | idem | ✅ |
| Suppression serveur MCP | idem | ✅ |
| Intégration dans dialog-settings onglet "Plugins" | `pages/session/dialog-settings.tsx` | ✅ |

**Stretch (partiellement implémenté)** :
- **SKILL.md liste** ✅ (commit `a7f40d58f1`) — `SkillsSection` affiche les skills installés via `sdk.client.app.skills()` (SolidJS `createResource`), avec nom, description et chemin relatif. Format doc replié dans `<details>`. Le backend `GET /skill` + `Skill.all()` existait déjà.
- **SKILL.md install/manage** ✅ (commit `02c99c485b`) — `POST /skill/install` (URL directe SKILL.md ou index discovery) + `DELETE /skill/:name` (global seulement) + UI champ URL + bouton ✕ par skill global + refetch liste automatique.
- **npm plugin local install/uninstall** — non implémenté.

### Phase 6 — Pro Android / Tablette ✅

**Implémenté** (commit `e174a0bb9a`).

| Fonctionnalité | Fichier | État |
|---|---|---|
| Command palette — overlay Mod+Shift+P, search par titre/description/catégorie, suspend autres keybinds | `components/dialog-command-palette.tsx` | ✅ |
| Android diagnostics — thermique (polling 15s), RAM utilisée/totale, barre progress | `components/settings-android.tsx` | ✅ |
| Permissions Android UX — état visible, request_permissions via Tauri, retry flow | idem | ✅ |
| Export / Import configuration globale | `components/settings-general.tsx` | ✅ |

**Stretch** : split panes, barre clavier contextuelle hardware, quotas disque, mode tablette dédié.

## État d'avancement global (2026-06-20)

**Toutes les phases principales sont ✅.** Reste :
- **Phase 0** — Device QA matrix (Xiaomi/Pixel × Android 12-15) : non bloquante, tests manuels à planifier.
- **Stretch Phase 2** : Shift+F12 ✅ + autocomplete ✅ + rename symbol ✅ + code actions ✅ (commits `6dd63051b7` / `d949e89e4d` / `8f534ac755` / `fe9b924722`) — **LSP triad complet**.
- **Stretch Phase 4** : problem matchers ✅ (commit `a7f40d58f1`) ; test explorer (parser `cargo test`/`npm test`).
- **Stretch Phase 5** : SKILL.md liste ✅ + install/uninstall via URL ✅ (commits `a7f40d58f1` / `02c99c485b`) — **skills complets** ; npm plugin local reste hors scope.
- **Stretch Phase 6** : split panes ✅ + mode tablette dédié ✅ (commit `c700aaa097`) — **split panes complet** ; Ctrl+\ toggle volet droit, drag pour redimensionner, bouton focus éditeur dans l'en-tête.
- **Sous-projet auth push/pull** : SSH key / token, stockage sécurisé Tauri Store.

## Vérification (end-to-end, par phase)

- **P1** : ouvrir/modifier/sauver un fichier en Mode IDE → relire via `GET /file/content` ; vérifier
  dirty/undo/conflit. Tests unitaires store. Build mobile + test device.
- **P2** : diagnostics gutter, go-to-definition, hover ; `/find/symbol` renvoie des symboles.
- **P3** : commit + push depuis l'UI, vérifier via `git log` ; tester conflict resolver.
- **P4** : lancer un script détecté (`cargo test`), logs + problem matcher ; breakpoint + variable.
- **P5** : installer/désactiver un plugin et un skill SKILL.md, logs et permissions.
- **P6** : tablette + clavier hardware, flux permissions complet.

### Phase 7 — Notifications système + Deep-link étendu ✅

**Implémenté** (commit `803796f33e`).

| Fonctionnalité | Fichier | État |
|---|---|---|
| NotificationBridge instanciée dans `FullApp` — session.updated (completed/failed) + llm.status (loaded) | `packages/mobile/src/entry.tsx:540` | ✅ |
| `handleDeepLink(url)` — router en cascade pour 3 schémas | `packages/mobile/src/entry.tsx:296` | ✅ |
| `opencode://open?file=…&project=…` → dispatch `ide-open-file` CustomEvent | `packages/mobile/src/entry.tsx:26-40` | ✅ |
| `opencode://session?id=…` → dispatch `navigate-to-session` CustomEvent | `packages/mobile/src/entry.tsx:51-63` | ✅ |
| `ANDROID_DEVELOPMENT.md §5-6` mis à jour — permissions, lifecycle, notifications, deep-link | `docs/ANDROID_DEVELOPMENT.md` | ✅ |

---

## Tâche suivante (chantier séparé) : refonte `docs/ANDROID_DEVELOPMENT.md`

Review MiniMax de ce doc (≠ roadmap). À traiter après. **4 trous** : CI, stratégie QA (tests Rust NDK,
WebView, golden LLM, Maestro étendu), environnements multiples (Windows/POSIX, section Linux, dual-boot),
OTA/model upgrade. **9 incohérences** : keystore double chemin, `.cargo/config.toml` sans template,
multi-`--target` à vérifier (Tauri 2.4.x), warning MANAGE_EXTERNAL_STORAGE + alternative SAF, typage
`request_permissions`, `check_llm_health` port:null, `RunEvent::Exit` ≠ backgrounding, ports 14097/14099
hardcodés, `keystore.properties` dans `gen/`, deep-link 2 causes (assetlinks absent OU fingerprint).
