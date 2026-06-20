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

## État vérifié de la codebase

| Domaine | État réel | Fichier de référence |
|---|---|---|
| Éditeur | ❌ Read-only (pierre/diffs, pas de buffer éditable) | `packages/ui/src/components/file.tsx`, `packages/app/src/context/file.tsx` |
| API fichier | ⚠️ `list/content/status/mkdir/find` seulement ; pas de write/rename/move/delete | `packages/opencode/src/server/routes/file.ts`, `packages/opencode/src/file/index.ts` |
| LSP backend | ✅ hover/def/refs/symbols/diagnostics + 9 ops | `packages/opencode/src/lsp/index.ts`, `packages/opencode/src/tool/lsp.ts` |
| LSP UI humain | ❌ Inexistant ; `/find/symbol` renvoie `[]` (LSP commenté) | `packages/opencode/src/server/routes/file.ts:109-114` |
| Git backend | ⚠️ Lecture seule (pas de commit/stage/push/pull/blame) | `packages/opencode/src/git/index.ts` |
| Git UI | ❌ Inexistant (juste diff/review read-only) | `packages/app/.../session-vcs.ts` |
| Terminal | ✅ Complet (PTY/tabs/toolbar mobile/WebSocket) | `packages/opencode/src/pty/index.ts`, `packages/app/src/pages/session/terminal-panel.tsx` |
| Build/Test/Debug utilisateur | ❌ Task runner = Turbo/Bun pour le dev du repo, pas pour le projet ouvert ; pas de test explorer ni DAP exposé | `turbo.json`, `package.json` |
| Plugins backend | ✅ 14+ hooks, plugins internes/npm/locaux, custom tools, events | `packages/opencode/src/plugin/index.ts` |
| Plugin manager UI | ⚠️ MCP toggle/status seulement | `packages/app/src/components/dialog-select-mcp.tsx` |
| Permissions Android | ⚠️ Runtime déjà câblé en Kotlin. Manque = **UX** (état visible, assistant, diagnostic) | `MainActivity.kt:174-276` ; doc `ANDROID_DEVELOPMENT.md §5` stale |
| Skills system | 📄 Design doc existant (SKILL.md text/js/native) | `docs/SKILLS-SYSTEM-DESIGN.md` |

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

### Phase 0+ — Durcissement mobile (PRÉ-REQUIS de la Phase 4)
Issu de l'audit dette mobile (élevée). À traiter avant tout chantier build/test on-device :
- Documenter la chaîne shebang + LD_PRELOAD dans `KNOWN_FAILURE_PATTERNS.md` (diagramme) + tests
  d'idempotence de `prepare_toolchain_wrappers()`.
- Supprimer le swallow d'erreurs silencieux (`let _ =` sur symlink/fs dans `runtime.rs`) → logging.
- Unifier le bundling CLI (`prepare-android-runtime.sh` vs `bundle-mobile.mjs`) → source unique.
- (Optionnel) décomposer `runtime.rs` (1869 LOC) en {extraction, toolchain, server_lifecycle}.

### Phase 1 — Éditeur MVP + API fichier write (PRIORITÉ)

**Pré-implémentation obligatoire — mini-contrat technique** (à figer avant code, après `/plan-eng-review` + mini-ADR) :
- **Routes** : `POST /file/write`, `POST /file/rename`, `POST /file/move`, `DELETE /file` + fonctions
  `write/rename/move/delete` du service `file/index.ts`.
- **Sécurité** : réutiliser `assertInsideProject` + `AppFileSystem.resolve` (guard anti-escape, file/index.ts:513-526).
- **Modèle de conflit** : le client envoie le `mtime`/hash attendu au save ; rejet si changé sur disque depuis le `read`.
- **Events** : publier `File.Event.Edited` (déjà déclaré file/index.ts:77-78) à chaque write.
- **Tests** : store éditeur (dirty/save/conflict) + routes fichier (succès, escape refusé, conflit).

**Frontend (révisé par l'audit — respect frontière fork)** : ne PAS modifier `file.tsx` upstream.
Injecter un composant éditable via `useFileComponent()` (`packages/app/src/app.tsx:147`). Code 100% dans
`packages/app/src` :
- `components/editable-file-tab.tsx` (~500 LOC) — wrapper **CodeMirror 6**.
- `stores/editor-store.ts` (~150 LOC) — buffers, dirty, save/discard/reload, undo/redo, conflit.
- `context/file.tsx` — étendre `FileState` (`buffer?`, `dirty?`) ; brancher dans `file-tabs.tsx` (~20 LOC).
- **Dual-mode** : `hooks/use-view-mode.ts` (~60 LOC) + `session-header-view-toggle.tsx` (~50 LOC) — NE PAS
  gonfler session.tsx/layout.tsx (budgets : session ≤ +80, layout ≤ +30).
- **Tests** (dette ui 0%) : tests d'intégration file-tabs + editor-store **avant merge**.

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

**Stretch (Phase 3+)** : Shift+F12 references panel, autocomplete (`completionProvider`), rename, code actions, line-level scroll post navigation (`EditorHandle.scrollToLine`).

### Phase 3 — Workspace + Git (backend ET UI)
Créer d'abord la couche **backend git d'écriture** sur le wrapper `run()` existant (effort 3-4h)
(`commit/stage/unstage/push/pull/branch-switch/blame/log` dans `git/index.ts`, blocs `// FORK:`).
**Sous-chantier à part entière : auth push/pull** (SSH key / token, stockage sécurisé, UX mobile) —
ne pas sous-estimer. Puis UI Source Control (stage/commit/branches/pull/push/blame/history/conflict
resolver) + UI workspace (clone/ouvrir/créer, fichiers récents). Routes → régén SDK.

### Phase 4 — Build / Test / Debug (re-scopée par l'audit)
**Pré-requis : Phase 0+ (durcissement mobile) terminée.** Cœur réaliste : task runner du projet *ouvert*
(package.json/Cargo.toml/Makefile, distinct du Turbo/Bun interne), exécuté via le PTY existant, logs
structurés, problem matchers ; test explorer. **DAP / debug on-device → démoté en *stretch*** (6-8 semaines,
chaîne shebang fragile, faible ROI) : préférer le debug via desktop/remote-control. L'émulateur CI
(Phase 4 mobile) reste un investissement lourd à planifier séparément.

### Phase 5 — Plugins / Skills / MCP mobile
Plugin manager (install npm/local, activer/désactiver, permissions/trust, logs, update/uninstall).
Implémenter le format `SKILL.md` (`docs/SKILLS-SYSTEM-DESIGN.md`).

### Phase 6 — Pro Android / Tablette
Split panes, command palette, barre clavier contextuelle, raccourcis hardware, mode tablette,
export/import settings, diagnostics, surveillance thermique/mémoire/batterie, quotas disque.
**Permissions** : le flux Kotlin existe déjà — travail = UX (état visible, assistant, diagnostic, retry,
commande Tauri `request_permissions` unifiée). Mettre à jour `ANDROID_DEVELOPMENT.md §5` (stale).

## Priorité nette

**Phase 1 d'abord** — tout en dépend : le LSP humain (P2) n'a de sens que dans un éditeur, et le
Git/Workspace (P3) s'appuie sur les opérations fichiers. Le dual-mode se pose dès la Phase 1.

## Vérification (end-to-end, par phase)

- **P1** : ouvrir/modifier/sauver un fichier en Mode IDE → relire via `GET /file/content` ; vérifier
  dirty/undo/conflit. Tests unitaires store. Build mobile + test device.
- **P2** : diagnostics gutter, go-to-definition, hover ; `/find/symbol` renvoie des symboles.
- **P3** : commit + push depuis l'UI, vérifier via `git log` ; tester conflict resolver.
- **P4** : lancer un script détecté (`cargo test`), logs + problem matcher ; breakpoint + variable.
- **P5** : installer/désactiver un plugin et un skill SKILL.md, logs et permissions.
- **P6** : tablette + clavier hardware, flux permissions complet.

### Phase 7 — Notifications système + Deep-link étendu

**Pré-requis : Phase 6 terminée.** Compléter les deux couches d'intégration système
manquantes après le chantier IDE, puis nettoyer la documentation stale produite en Phase 6.

**1. NotificationBridge — câblage (code mort → actif)**

La classe `NotificationBridge` (`packages/mobile/src/notifications.ts`) existe depuis la Phase 5
mais n'est jamais instanciée. La brancher dans `FullApp` (`entry.tsx`) pour que les événements
SSE déclenchent des notifications natives quand l'app est en arrière-plan :
- `session.updated` status=`completed`/`failed` → notification agent terminé/échoué
- `llm.status` event=`loaded` → notification modèle prêt
- Notification "Model Ready" au chargement LLM (via `llm-loading-progress` window event)
- Cleanup `disconnect()` dans `onCleanup`

**2. Deep-link étendu — au-delà du connect**

Actuellement seul `opencode://connect?...` est géré (`applyPairingDeepLink`). Ajouter :
- `opencode://open?file=<path>&project=<dir>` → dispatch `ide-open-file` CustomEvent
  (pour ouvrir un fichier depuis un autre app ou une URL partagée)
- `opencode://session?id=<sessionId>` → dispatch `navigate-to-session` CustomEvent
  (pour reprendre une session depuis une notification ou un raccourci)
- Factoriser la résolution via `handleDeepLink(url)` qui essaie les 3 handlers en cascade

**3. Mise à jour docs stale (chantier obligatoire en sortie de Phase 6)**
- `ANDROID_DEVELOPMENT.md §5 « Permissions runtime »` : remplacer le bloc "à implémenter"
  par l'état réel (Kotlin implémenté dans `MainActivity.kt:51-61 + 174-214`, TS via `platform.notify`)
- `ANDROID_DEVELOPMENT.md §6 « Lifecycle »` : remplacer le pseudo-code par les références
  à l'implémentation réelle (`entry.tsx:197-218`, `MainActivity.kt:216-276`) + ajouter §6.1
  deep-link et §6.2 notifications

**Vérification (end-to-end, Phase 7)**
- Mettre l'app en arrière-plan → finir une session agent → notification native reçue
- Ouvrir `opencode://connect?...` depuis navigateur → form pré-rempli (régression)
- Ouvrir `opencode://session?id=xyz` → event `navigate-to-session` dispatchée dans la console
- Ouvrir `opencode://open?file=/path/to/file.ts` → event `ide-open-file` dispatchée

---

## Tâche suivante (chantier séparé) : refonte `docs/ANDROID_DEVELOPMENT.md`

Review MiniMax de ce doc (≠ roadmap). À traiter après. **4 trous** : CI, stratégie QA (tests Rust NDK,
WebView, golden LLM, Maestro étendu), environnements multiples (Windows/POSIX, section Linux, dual-boot),
OTA/model upgrade. **9 incohérences** : keystore double chemin, `.cargo/config.toml` sans template,
multi-`--target` à vérifier (Tauri 2.4.x), warning MANAGE_EXTERNAL_STORAGE + alternative SAF, typage
`request_permissions`, `check_llm_health` port:null, `RunEvent::Exit` ≠ backgrounding, ports 14097/14099
hardcodés, `keystore.properties` dans `gen/`, deep-link 2 causes (assetlinks absent OU fingerprint).
