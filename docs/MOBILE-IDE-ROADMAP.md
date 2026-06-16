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

## Phases

### Phase 0 — Baseline device QA
Matrice réelle : Xiaomi/Pixel/tablette × Android 12-15, stockage externe, terminal, modèle local,
STT/TTS, deep-link remote, permissions. Corriger les docs stale (en priorité permissions runtime).

### Phase 1 — Éditeur MVP + API fichier write (PRIORITÉ)

**Pré-implémentation obligatoire — mini-contrat technique** (à figer avant code, après `/plan-eng-review` + mini-ADR) :
- **Routes** : `POST /file/write`, `POST /file/rename`, `POST /file/move`, `DELETE /file` + fonctions
  `write/rename/move/delete` du service `file/index.ts`.
- **Sécurité** : réutiliser `assertInsideProject` + `AppFileSystem.resolve` (guard anti-escape, file/index.ts:513-526).
- **Modèle de conflit** : le client envoie le `mtime`/hash attendu au save ; rejet si changé sur disque depuis le `read`.
- **Events** : publier `File.Event.Edited` (déjà déclaré file/index.ts:77-78) à chaque write.
- **Tests** : store éditeur (dirty/save/conflict) + routes fichier (succès, escape refusé, conflit).

**Frontend** : intégrer **CodeMirror 6** dans `packages/ui` (partagé desktop+mobile+iOS) ; store éditeur
(buffers, dirty, save/discard/reload, undo/redo, recherche/remplacement, conflit, gros fichiers read-only,
sélection tactile). **Dual-mode** : poser le toggle Mode Agent ⇄ Mode IDE.

### Phase 2 — LSP exposé à l'humain
Réactiver `/find/symbol` (file.ts:109-114). Brancher dans l'éditeur : diagnostics gutter, hover,
go-to-definition, references, document symbols (outline), workspace symbols. Ensuite : autocomplete,
rename, code actions.

### Phase 3 — Workspace + Git (backend ET UI)
Créer d'abord la couche **backend git d'écriture** (`commit/stage/unstage/push/pull/branch-switch/blame/log`
dans `git/index.ts`). Puis UI Source Control (stage/commit/branches/pull/push/blame/history/conflict resolver)
+ UI workspace (clone/ouvrir/créer, fichiers récents).

### Phase 4 — Build / Test / Debug
Task runner du projet *ouvert* (package.json/Cargo.toml/Makefile, distinct du Turbo/Bun interne),
exécuté via le PTY existant, logs structurés, problem matchers. Test explorer. DAP (breakpoints/stack/variables).

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

## Tâche suivante (chantier séparé) : refonte `docs/ANDROID_DEVELOPMENT.md`

Review MiniMax de ce doc (≠ roadmap). À traiter après. **4 trous** : CI, stratégie QA (tests Rust NDK,
WebView, golden LLM, Maestro étendu), environnements multiples (Windows/POSIX, section Linux, dual-boot),
OTA/model upgrade. **9 incohérences** : keystore double chemin, `.cargo/config.toml` sans template,
multi-`--target` à vérifier (Tauri 2.4.x), warning MANAGE_EXTERNAL_STORAGE + alternative SAF, typage
`request_permissions`, `check_llm_health` port:null, `RunEvent::Exit` ≠ backgrounding, ports 14097/14099
hardcodés, `keystore.properties` dans `gen/`, deep-link 2 causes (assetlinks absent OU fingerprint).
