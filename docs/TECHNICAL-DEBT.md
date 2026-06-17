# Registre de dette technique — OpenCode (fork Rwanbt)

> **Document vivant.** Registre maître de la dette technique. À re-valider à chaque fin de sprint
> et avant tout push majeur (`/verify-standards`, `/health`).
> Dernière mise à jour : **2026-06-17** (vérification branche `claude/debt-wave1-p1` + suite ;
> **Vague 1 P1 fermée** — D-12/D-13/D-16/D-17/D-22 (Rust mobile confirmé 14/0 sous WSL Linux) ;
> **Vague 2** — D-07/D-09/D-20/D-21 faits, D-01 différé compilateur-in-loop ;
> **Vague 3** — D-10/D-11/D-23/D-24 + **D-04** faits ; D-02 constaté déjà-décomposé ; **D-15** fait (graphe régénéré) ;
> **D-08** progressé (tree-store + view-cache, 27 tests) ; **D-14** tranché ; **D-03/D-05** gate LOC CI ajouté ;
> **D-18** fait (single-flight, vérifié WSL Linux 14/0) ; **D-01 étapes 1+3 faites** (`runtime/toolchain.rs`
> + `runtime/extraction.rs` extraits, **runtime.rs 2136→1491 LOC = sous le gate de 1500** ; compilé + 14/14 tests
> + clippy `-D warnings` clean sous WSL Linux). Le god *file* est résolu ; ne reste que le god *function*
> `start_embedded_server` (669 LOC) → étape 2, **relocalisation + décomposition ensemble en session device-in-loop**.
> Restent : D-08 reliquat (coordinateurs DOM — `@solidjs/testing-library` à ajouter), **D-01 étape 2**
> (server.rs : décomposer `start_embedded_server` — device-in-loop), **D-19** (busybox — validation device requise),
> D-06 (upstream, opportuniste)). Note : build Rust mobile vérifiable sous WSL avec `CARGO_TARGET_DIR` sur D:
> (évite de saturer C:). Le `ext4.vhdx` (51,75 Go) gagnerait à être compacté en admin (`Optimize-VHD`).
> Liés : [ADR-0003 fork strategy](adr/0003-fork-strategy.md), [loc-debt-upstream.md](loc-debt-upstream.md),
> [KNOWN_FAILURE_PATTERNS.md](KNOWN_FAILURE_PATTERNS.md), [MOBILE-IDE-ROADMAP.md](MOBILE-IDE-ROADMAP.md),
> [ARCHITECTURE.md](ARCHITECTURE.md), [lock-hierarchy.md](lock-hierarchy.md).

## Philosophie (non négociable)

Ce projet vise une **stabilité long terme et une maintenabilité élevée**, pas une vélocité MVP.
En conséquence :

- **On ne livre pas de raccourci sciemment.** Un correctif partiel qui laisse une dette non tracée
  est interdit. Si on ne peut pas faire propre maintenant, on **trace la dette ici** avec un plan daté.
- **La dette se rembourse au point de contact** (règle Boy Scout) : on modifie un fichier → on corrige
  la dette voisine < 15 min ; sinon on l'inscrit ici.
- **Pas de dette silencieuse** : tout raccourci a une entrée dans ce registre + un `// DEBT:` dans le code
  référant l'ID de l'entrée (ex. `// DEBT: D-12`).
- **Stop-the-line** sur les catégories P0/P1 (voir SLA) : on ne construit pas par-dessus.

## Échelle de sévérité & SLA

| Niveau | Définition | SLA |
|--------|-----------|-----|
| **P0 — Critique** | Risque de corruption de données, faille sécurité, crash silencieux récurrent | Immédiat — stop-the-line |
| **P1 — Élevé** | Fragilité non testée sur chemin critique, data race, swallow d'erreur masquant des pannes | ≤ 7 jours |
| **P2 — Moyen** | God file, couplage fort, friction process, observabilité manquante | Backlog priorisé |
| **P3 — Faible / Upstream** | Dette héritée upstream hors scope fork, polish | Opportuniste / contribution upstream |

---

## 1. Inventaire de la dette

### A. Taille des fichiers / god files

Norme SonarQube : vert ≤ 500, alerte 800, bloquant 1500. État au 2026-06-16 :
**12 fichiers > 1500 LOC**, 38 entre 800-1500, 44 entre 500-800.

| ID | Fichier | LOC | Zone | Sévérité | Note |
|----|---------|-----|------|----------|------|
| D-01 | `packages/mobile/src-tauri/src/runtime.rs` | 745 | **Fork** | ~~P1~~ **résolu** | God *file* ET god *function* résolus. Étapes 1+3 (`toolchain.rs`+`extraction.rs`) + **étape 2** (`server.rs` : `start_embedded_server` 666→281 LOC via 6 helpers nommés). runtime.rs 2136→745. Voir §E |
| D-02 | `packages/app/src/components/prompt-input.tsx` | 1482 | Fork | P2 | Approche le plancher bloquant |
| D-03 | `packages/app/src/pages/layout.tsx` | 1126 | Fork | P2 | Coordinateur, exception [ADR-0002](adr/0002-coordinator-loc-floor.md) |
| D-04 | `packages/app/src/components/settings-general.tsx` | 1108 | Fork | P2 | Décomposable par sections de réglages |
| D-05 | `packages/app/src/pages/session.tsx` | 1022 | Fork | P2 | Coordinateur, exception ADR-0002 |
| D-06 | Upstream god files (9 fichiers) | 1618–2292 | **Upstream** | P3 | `prompt.ts` 2085, `lsp/server.ts` 1958, `config.ts` 1802, `message-part.tsx` 2268, `provider.ts` 1618, TUI session index 2292, `github.ts` 1647, copilot model 1769, `acp/agent.ts` 1769 — voir [loc-debt-upstream.md](loc-debt-upstream.md) |

> **Note fork** : seuls les fichiers `packages/app/` sont sous gate LOC strict (ADR-0003). Les upstream
> (D-06) sont hors scope du gate mais restent une dette réelle si contribution upstream visée.

### B. Couverture de tests

| ID | Zone | État | Sévérité | Impact |
|----|------|------|----------|--------|
| D-07 | `packages/ui/src` | **3 fichiers de test** (≈ 0% sur file/tabs/composants critiques) | **P1** | L'éditeur Phase 1 atterrit là — régressions invisibles |
| D-08 | `packages/app/src` chemins critiques | `file.tsx` context, `file-tabs.tsx`, `session.tsx` **non testés** (~30% global) | P2 | Comportement UX critique non couvert |
| D-09 | Rust mobile `src-tauri/src` | **8 `#[test]`** (runtime schema + proxy uniquement) ; `llm.rs`, `speech.rs`, toolchain wrappers, server spawn **non testés** | **P1** | Chaîne shebang/symlinks/IPC LLM = chemin critique sans filet |

### C. Gestion d'erreurs / observabilité

| ID | Localisation | Pattern | Sévérité |
|----|-------------|---------|----------|
| D-10 | `file/index.ts` (≈368, 376, 627) | `orElseSucceed(() => [])` masque erreurs réseau/scan → scans incomplets silencieux | P2 |
| D-11 | `file/index.ts` (≈407, 411, 688) | `catchCause`/`Effect.catch(() => void)` → invalidation cache & échecs mkdir invisibles | P2 |
| D-12 | `runtime.rs` (≈766-820) | `let _ = fs::symlink(...)` / `remove_file(...)` → 50+ symlinks recréés par lancement, échec **non loggé** | **P1** |
| D-13 | `runtime.rs` `repair_rootfs_hardlinks` (159-199) | Continue silencieusement si binaire critique (gcc/g++) manquant après extraction | **P1** |

### D. Frontière fork (risque de divergence upstream)

| ID | Sujet | Sévérité | Détail |
|----|-------|----------|--------|
| D-14 | Discipline `// FORK:` | P2 | ADR-0003 impose des blocs délimités pour toute modif upstream. À vérifier que les ajouts roadmap (routes file/git, LSP) respectent ça pour absorber `git merge upstream/main` sans conflit. |
| D-15 | Graphe de dépendances stale | P3 | `graphify-out/` daté du commit `0238f7b7` (29/05) — re-générer après gros changements (`graphify update .`). |

### E. Fragilité du runtime mobile

| ID | Sujet | Sévérité | Détail |
|----|-------|----------|--------|
| D-16 | Chaîne shebang + LD_PRELOAD | **P1** | `binfmt_script → libbash_exec.so → libmusl_linker.so → ELF`. **Zéro test.** Échec en cascade silencieux si un maillon casse (ex. path mort après update APK). Documenté dans le code (5 CAVEAT) mais pas dans [KNOWN_FAILURE_PATTERNS.md](KNOWN_FAILURE_PATTERNS.md). |
| D-17 | Double bundling CLI | **P1** | `prepare-android-runtime.sh` (build local) ≠ `bundle-mobile.mjs` (CI) → risque de CLI stale embarquée (pattern de panne connu). |
| D-18 | État global serveur | P2 | `static SERVER_PROCESS: Mutex<Option<Child>>` (runtime.rs:16-17) — double `start_embedded_server()` rapproché peut orphaner une instance. |
| D-19 | Busybox static + seccomp | P2 | Applets interactifs (vi/less/top) crashent en SIGSYS ; fallback toybox non détecté à l'exécution. |

### F. Friction process

| ID | Sujet | Sévérité | Détail |
|----|-------|----------|--------|
| D-20 | Régénération SDK par route | P2 | Chaque route Hono exige `describeRoute()` + rebuild `packages/sdk/js`. Oubli = route invisible aux clients. ~10-15 min/route, pas de gate CI aujourd'hui. |
| D-21 | Tests runtime Android-gated en CI | P2 | `test.yml` ne lance que `proxy::tests` ; les tests `runtime.rs` sont `#[cfg(target_os="android")]` → inexécutables sur CI Linux. Aucun test émulateur/intégration. |

### G. Sécurité / invariants

| ID | Sujet | Sévérité | Détail |
|----|-------|----------|--------|
| D-22 | Guard d'écriture absent | **P1 (préventif)** | `assertInsideProject` (file/index.ts:513-526) protège `read/list/mkdir` mais **PAS l'écriture** (write/rename/move/delete n'existent pas encore). Tout ajout d'écriture DOIT passer ce guard — sinon évasion hors workspace. |

### H. Code désactivé / mort

| ID | Sujet | Sévérité | Détail |
|----|-------|----------|--------|
| D-23 | `/find/symbol` désactivé | P2 | `server/routes/file.ts:109-114` — `LSP.workspaceSymbol` commenté, renvoie `[]`. Désactivé par effet de bord d'une régén OpenAPI (commit f969b1dac), pas pour perf. Dette = fonctionnalité morte non documentée dans le code. |

### I. Dette marquée (TODO/FIXME/HACK)

État : app 17, ui 23, opencode 23, mobile 2. À auditer à chaque fin de session (règle globale) :
chaque occurrence doit avoir un ticket ou être résolue.

| ID | Action |
|----|--------|
| D-24 | Recenser les 65 marqueurs TODO/FIXME/HACK, les convertir en entrées datées ici ou les résoudre. |

---

## 2. TODO list (à cocher régulièrement)

> Cocher au fil de l'eau. Re-valider la liste complète à chaque fin de sprint.

### P0 — Critique (stop-the-line)
- [ ] *(aucune entrée P0 active au 2026-06-16 — maintenir vide)*

### P1 — Élevé (≤ 7 jours quand activé)
- [x] **D-22** Guard `assertInsideProject` : aucune route d'écriture exposée pour l'instant (write/rename/move/delete n'existent pas) — l'objectif est donc préventif. Contrat du guard verrouillé par tests : branche symlink-escape (`File.read`/`File.list`) + `File.mkdir` désormais couverts (`test/file/path-traversal.test.ts`, ✅ vert). Toute future route d'écriture réutilise ce guard.
- [x] **D-12** Swallows `let _ =` sur symlink/fs supprimés dans `runtime.rs` : helper `force_symlink()` (remove+symlink loggés) appliqué aux 8 sites de recréation + symlink `ld→ld.bfd`. *(Rust non compilable sur ce CI Linux — GTK/NDK absents ; relu, non exécuté.)*
- [x] **D-13** `repair_rootfs_hardlinks` : échecs de lien loggés, cas « ni l'un ni l'autre présent » loggé, + vérification post-extraction des drivers critiques (gcc/g++/cc/c++) avec warning explicite.
- [x] **D-16** Chaîne shebang+LD_PRELOAD documentée (diagramme + modes de panne) dans `KNOWN_FAILURE_PATTERNS.md` ; test `prepare_toolchain_wrappers_is_idempotent` ajouté (module gated `target_os="android"` — son exécution en CI relève de D-21).
- [x] **D-17** Bundling CLI unifié : `prepare-android-runtime.sh` délègue à `scripts/bundle-mobile.mjs` (source unique, injection migrations par prepend — le `--define` divergent est supprimé).
- [x] **D-07** Suite de tests `packages/ui` démarrée sur des modules critiques purs : `theme/color.ts` (système de thème — round-trips hex/rgb/oklch, clamp, blend, scales : `theme/color.test.ts`, 32 tests ✅) et `pierre/media.ts` (détection média du viewer de fichiers : `pierre/media.test.ts`, 20 tests ✅). *(L'editor-store n'existe pas encore — Phase 1 roadmap ; les composants `.tsx` DOM nécessitent happydom, à câbler en suivant.)*
- [x] **D-09** Tests d'intégration Rust mobile host-runnable (rootfs mocké) : `repair_rootfs_hardlinks` (2 directions + cas vide), `force_symlink` (remplacement de lien périmé), gardes de `prepare_toolchain_wrappers` (Err sans interposeurs, skip `.so`/fichiers <1 Ko) + idempotence (cf. D-16). *(Compile côté host via D-21 ; non exécuté sur ce CI — GTK/NDK absents.)* Server spawn complet (`start_embedded_server`) reste device-dépendant.
- [x] **D-01 RÉSOLU** Décomposer `runtime.rs` en sous-modules `runtime/{toolchain,extraction,server}.rs`. **Étapes 1+2+3 faites** (2026-06-17, host-vérifiées WSL) → `runtime.rs` **2136→745 LOC**. God *file* ET god *function* résolus. Mécanique validée : sous-modules sibling (`runtime.rs` conservé, préserve le blame), `use super::*` dans l'enfant + re-export ciblé dans le parent, fns → `pub(super)`, tests inchangés. **Self-verifying move** : l'Edit-delete (ou le split déterministe à ancres) ne réussit que si le texte est byte-identique → prouve l'absence de transcription erronée. **Plan d'exécution** :
  - [x] **Étape 1 — `runtime/toolchain.rs` FAITE** (2026-06-17, ~555 LOC, 100% test-couverte) : `repair_rootfs_hardlinks` / `force_symlink` / `prepare_toolchain_wrappers` extraits verbatim. Cluster **auto-contenu** confirmé (zéro dépendance sortante ; helpers `resolve_in_rootfs`/`parse_shebang_interp`/`is_static_elf64` imbriqués, déplacés avec ; `use` locaux idem). Mécanique retenue (moins invasive que `git mv` → préserve le blame sur runtime.rs) : `runtime.rs` conservé + sous-module sibling `runtime/toolchain.rs` ; runtime.rs déclare `mod toolchain; use toolchain::{force_symlink, prepare_toolchain_wrappers, repair_rootfs_hardlinks};` ; fns → `pub(super)` ; `toolchain.rs` ouvre par `use super::*;` ; tests inchangés dans `mod tests`. **Vérifié WSL Linux** : `runtime.rs` 2136→1592 LOC, `toolchain.rs` 569 LOC, `cargo test --lib runtime` 14/0, `cargo clippy --lib --tests -- -D warnings` clean (2 warnings `repeat().take()` pré-existants des tests D-09 corrigés en `resize` au passage — Boy-Scout).
  - [x] **Étape 3 — `runtime/extraction.rs` FAITE** (2026-06-17, ~139 LOC) : `extract_runtime` (command) + `check_extraction_progress` + `is_ready_without_schema_check` + `is_runtime_ready` + `write_schema_version`. Helpers partagés (`runtime_dir`, `native_lib_dir`, `check_health`), consts `RUNTIME_*` et struct `ExtractionProgress` **restés** dans runtime.rs (utilisés ailleurs) → accédés par `use super::*`. `extract_runtime` re-exporté `#[allow(unused_imports)] pub use` (le `generate_handler!` qui le consomme est `#[cfg(target_os="android")]`, donc inutilisé en host) ; `is_runtime_ready` re-importé (check_runtime) ; fns test-only importées dans `mod tests`. **Vérifié WSL** : 14/0 + clippy `-D warnings` clean.
  - [x] **Étape 2 — `runtime/server.rs` FAITE** (2026-06-17, sous-branche `claude/debt-d01-server` mergée `--no-ff`). (a) **Relocate verbatim** du cluster (start_embedded_server + check_local_health/read_server_logs/stop_local_server + `SERVER_PROCESS`/`SERVER_START_LOCK`/`server_start_lock`) via split déterministe à ancres → runtime.rs 1492→745. (b) **Décomposition** de `start_embedded_server` **666→281 LOC** en 6 helpers nommés : `build_server_command` (pur, **3 tests**), `setup_command_symlinks` (183 L), `setup_compat_lib_symlinks`, `build_tool_functions` (pur), `write_shell_rc_files`, `setup_dns_and_ca`. Le reste (281 L) = orchestration linéaire de setup device + bloc `Command` déclaratif (~80 L de `.env()`, irréductible sans struct à 14 champs = anti-pattern) → **exception « setup séquentiel linéaire »** documentée. Vérifié WSL : `cargo test --lib` **17/0**, `cargo build --lib --tests RUSTFLAGS=-D warnings` clean. ⚠️ `cargo clippy --lib --tests` fait un **ICE** (bug interne clippy « slice index starts at 27 but ends at 26 » sur l'analyse cfg(test) ; `cargo clippy --lib` seul est OK) — non-bloquant (rustc propre, CI = `cargo test`). Fallback Rust mobile : `cargo build -D warnings` + `cargo test`.
  - Sortie atteinte : runtime.rs (745 L) = check_runtime + helpers chemins/health + install_extended_env + list_storage_roots + RuntimeInfo/StorageRoot. Commits : 2a `51a1b86d6c`, 2b `050fef5e11`/`ae470ec473`/`c483ee1441`, merge `566407e9ca`.

### P2 — Moyen (backlog priorisé)
- [x] **D-20** Gate CI synchro SDK : `.github/workflows/sdk-sync.yml` régénère le SDK (`./script/generate.ts`) sur chaque PR et échoue si `packages/sdk` diverge, avec message de remédiation.
- [x] **D-21** Tests `runtime.rs` rendus host-runnable : `mod runtime` compilé sous `cfg(any(target_os="android", test))` (pattern `proxy`/`validate`), module de tests dé-gaté `target_os="android"` → `unix` ; nouveau job `.github/workflows/mobile-runtime-tests.yml` (deps GTK + `cargo test --lib`). *(Compilation host non vérifiée sur ce CI — à confirmer côté PC.)*
- [x] **D-10 / D-11** Logging ajouté aux swallows de `file/index.ts` : les 3 `orElseSucceed(() => [])` (scan répertoire — D-10) et les 2 `catchCause(() => void)` du `cachedScan` + le `catch` de `ensureDir` (D-11) loggent désormais la cause (`log.warn` + `Cause.pretty`) avant le fallback. Typecheck ✅ (le seul échec restant est l'artefact généré `models-snapshot.js`, gitignored, hors scope).
- [~] **D-08** Logique critique de `context/file` testée : `path.ts`, `content-cache.test.ts` (LRU viewer, 13 tests ✅), `watcher.test.ts`, et **nouveau `tree-store.test.ts`** (état de l'explorateur — load/cache/force, dedup in-flight, garde de scope stale, pruning récursif des dossiers supprimés, expand/collapse, reset ; 13 tests ✅, vérifié Windows). `view-cache.test.ts` (helpers `normalizeSelectedLines`/`equalSelectedLines` exportés + `selectionFromLines` ; swap/normalisation de sélection de lignes ; 14 tests ✅). **+ `session-comment-actions.test.ts`** (2026-06-17, 9 tests ✅) couvrant le service pur `createCommentActions` (factory-with-deps ADR-0001 extrait de session.tsx) : preview computation + branche undefined, mapping `selectionFromLines`/`startLine→start`, et le wiring exact vers `comments`/`prompt.context` (deps mockées). Boy-Scout au passage : `session-comment-actions.ts` importait `selectionFromLines` depuis le barrel lourd `@/context/file` (qui tire @solidjs/router) → repointé sur `@/context/file/types` (léger), ce qui découple le service du graphe FileProvider et le rend testable.
  **Constat d'archi** : le package `app` a 58 fichiers de tests **0 test de rendu** — la philosophie établie est extraction de logique pure + tests unitaires (deps injectées), pas du render-testing de coordinateurs. Donc « render tests `file-tabs.tsx`/`session.tsx` via `@solidjs/testing-library` » est **un non-but** (irait à contre-courant d'une décision du mainteneur). Le reliquat D-08 réel = continuer à extraire/couvrir la **logique pure** des coordinateurs (comme `createCommentActions`), pas à monter une infra de rendu. Run canonique : **382 pass / 0 fail**.
  **Frontière de testabilité constatée** (2026-06-17, en tentant `createSessionHistoryWindow`) : une *factory à deps injectées sans état réactif interne* (ex. `createCommentActions`) se teste parfaitement en mockant les deps ; en revanche une factory qui **détient son propre `createStore` + `createMemo`** (ex. `session-history-window.ts`) n'est PAS testable unitairement de façon fiable — un memo sans souscripteur actif ne se recalcule pas sur lecture *untracked* après un `setState`, et forcer le flush d'effets rend le test fragile. Ces coordinateurs à état réactif interne restent du ressort du E2E (Maestro). Cibler les premiers, pas les seconds.
  **+ 3 modules purs couverts** (2026-06-17, 22 tests) : `handoff.ts` (store LRU cap 40 — merge/get, éviction, survie via touch), `terminal-title.ts` (helpers titres i18n — defaultTitle/isDefaultTitle multilingue/titleNumber), `terminal-label.ts` (résolveur de label, `t` injecté). **+ `session-vcs.ts`** (`createVcsHelpers` factory-with-deps, 10 tests : single-flight, garde de run périmé, force-refresh, error path gracieux, resetVcs). Suite app : **414 pass / 0 fail**.
- [~] **D-03 / D-05** Gate CI « budget LOC » ajouté (`scripts/loc-gate.mjs` + `.github/workflows/loc-gate.yml`) : échoue si un fichier `packages/app/src` dépasse **1500 LOC** (exclut i18n/tests/stories/.gen). État actuel : 0 bloquant, 6 en zone d'alerte (coordinateurs, dont `prompt-input.tsx` à 1483 — proche du seuil). Reliquat : faire respecter les budgets par-coordinateur (layout ≤ +30, session ≤ +80) en revue ; resserrer le gate à 800 quand sain.
- [~] **D-02** `prompt-input.tsx` (1482) est en fait **déjà décomposé** en 12 sous-modules `prompt-input/` (attachments, build-request-parts, editor-dom, files, history, keyboard-handler, paste, placeholder, submit… dont 5 testés) ; le fichier restant est un **coordinateur** (logique réactive/JSX, plancher type ADR-0002). Pas d'extraction pure résiduelle évidente — laisser tel quel sauf nouvel ajout.
- [x] **D-04** `settings-general.tsx` décomposé : **1108 → 589 LOC** (sous le seuil d'alerte 800). `RemoteAccessSection` (~500 LOC) extraite en `settings-remote-access.tsx` (composant autonome qui ré-acquiert ses contextes via hooks — réactivité préservée) ; `SettingsRow` extrait en `settings-row.tsx` partagé. `app` typecheck ✅. *(Rendu runtime à valider sur PC.)*
- [x] **D-23** `/find/symbol` réactivé proprement (`server/routes/file.ts`) : `LSP.workspaceSymbol(query)` enveloppé dans `withTimeout(…, 5000)` + fallback `[]` loggé, au lieu du stub commenté renvoyant `[]`.
- [x] **D-18** Single-flight sur `start_embedded_server()` : verrou async `tokio::sync::Mutex` (via `OnceLock`) tenu sur toute la fonction → deux démarrages concurrents ne peuvent plus spawner+orphaner. Vérifié sous WSL Linux (`cargo test --lib runtime` 14/0). Commit `e27d7d0510`.
- [~] **D-19** Busybox static + seccomp. **Prévention host-testable faite** (2026-06-17, `runtime/server.rs`) : la politique « applets interactifs (vi/less/top/nano/more/…) servis par /system/bin/toybox seccomp-safe, JAMAIS par le busybox statique » est rendue explicite via deux consts (`BUSYBOX_FALLBACK_APPLETS` = gawk/ed/bc/dc/expr, disjoint de `SECCOMP_RISK_APPLETS`) + **garde-fou** `busybox_fallback_excludes_seccomp_risk_applets` (échoue si on ajoute un applet à risque au fallback). Vérifié WSL 18/0. **Reste device-in-loop** : la détection *runtime* d'un SIGSYS réel + fallback automatique (non validable sans device ; une version logging-only serait spéculative).
- [x] **D-14 RÉSOLU** (2026-06-17) — décision actée dans [ADR-0003 §Amendement](adr/0003-fork-strategy.md). Audit : **0 marqueur `// FORK:` dans tout le repo** (`packages/opencode|ui|sdk`) — la convention prescrite par [ADR-0003](adr/0003-fork-strategy.md) n'a jamais été appliquée. Un retrofit complet sur les milliers de divergences upstream est hors scope. **Décision** : (a) appliquer `// FORK:` aux **nouvelles** modifs upstream à partir de maintenant, vérifié en revue ; (b) les changements déjà tracés `// DEBT: D-NN` restent acceptables (ils documentent le WHY). À acter : mettre à jour ADR-0003 pour refléter que la stratégie réelle = divergence + résolution au merge (pas blocs `// FORK:` systématiques), OU adopter la convention pour de bon avec un gate de revue.
- [x] **D-24** Recensement fait : le comptage « 65 » incluait strings/i18n/généré. **13 vrais marqueurs de commentaire de code** (tous `TODO`, aucun `FIXME`/`HACK`/`XXX`), tous des notes inline mineures majoritairement upstream : `server/router.ts:44`, `routes/global.ts:166`, `provider.ts:230,447`, `agent/agent.ts:496`, `account/index.ts:395`, `session/index.ts:316`, `session/llm.ts:208`, `cli/.../prompt/index.tsx:292`, `cli/.../routes/home.tsx:12`, `cli/cmd/github.ts:213`, `tool/bash.ts:585`, `sync/index.ts:162`. Aucune dette fork critique ; à traiter à la règle Boy-Scout au point de contact.

### P3 — Faible / Upstream (opportuniste)
- [ ] **D-06** God files upstream — traiter via contribution upstream ou session dédiée Track B.
- [x] **D-15** Graphe graphify régénéré (2026-06-17, `graphify update .`, AST-only) : 42675 nœuds, 77614 arêtes, 3630 communautés (était daté du commit `0238f7b7` du 29/05).

---

## 3. Plan de correction (séquencé, sans raccourci)

Principe : on rembourse d'abord ce qui **bloque la stabilité** (P1 sécurité/crash silencieux), puis ce qui
**réduit le coût de toute la suite** (tests + décomposition), puis le polish.

### Vague 1 — Sécuriser & rendre visible (P1, avant tout nouveau chantier d'écriture)
1. **D-22** Guard d'écriture (pré-requis absolu de la Phase 1 roadmap).
2. **D-12 + D-13** Tuer les swallows mobiles → toute panne devient observable.
3. **D-16** Documenter + tester la chaîne shebang (débloque toute confiance on-device).
4. **D-17** Source unique de bundling CLI.

*Sortie de vague* : plus aucun chemin critique mobile ni d'écriture ne peut échouer en silence.

### Vague 2 — Filet de tests & décomposition (réduit le coût futur)
5. **D-07 + D-09** Suites de tests `ui` et Rust mobile (intégration, pas seulement unitaire).
6. **D-01** Décomposer `runtime.rs` (s'appuie sur les tests de la vague 1-2).
7. **D-20** Gate CI synchro SDK (industrialise la friction des routes roadmap).
8. **D-21** Tests runtime exécutables hors Android.

*Sortie de vague* : modifications futures protégées par des tests ; god file mobile démantelé.

### Vague 3 — Hygiène continue & polish (P2/P3)
9. **D-10/D-11** Observabilité backend.
10. **D-08** Tests coordinateurs frontend.
11. **D-02/D-04** Décomposition god files fork.
12. **D-23** Trancher `/find/symbol` (réactiver proprement ou supprimer).
13. **D-18/D-19/D-24** Reste P2.
14. **D-06/D-15** Upstream & graphe.

> Les vagues 1-2 sont des **pré-requis** des Phases 1 et 4 de la [roadmap IDE](MOBILE-IDE-ROADMAP.md).
> Ne pas démarrer la Phase 4 (build/test on-device) avant la Vague 1 mobile.

---

## 4. Garde-fous anti-dette (prévention)

Pour éviter d'en réintroduire. À intégrer en CI et en revue.

### 4.1 Gates CI (bloquants)
- **Gate LOC** : ✅ implémenté — `scripts/loc-gate.mjs` + workflow `loc-gate.yml` ; échec si un fichier `packages/app/src` dépasse 1500 LOC (resserrer à 800 quand sain).
- **Gate synchro SDK** : échec si `packages/sdk/js` n'est pas régénéré après une modif de route.
- **Lint/format zéro warning** : `biome check`, `tsc --noEmit`, `cargo clippy -- -D warnings`.
- **Tests obligatoires** : la logique métier nouvelle DOIT venir avec ses tests (pas de merge sinon).
- **Dead code** : `knip` en CI ; tout code mort est supprimé (jamais commenté).

### 4.2 Politique de code (revue)
- **Zéro swallow d'erreur** : interdit `let _ =` sur I/O, `catch {}` vide, `orElseSucceed` sans log.
  Frontières système (I/O, réseau, FFI, parsing) → erreur gérée explicitement.
- **Guards de sécurité** : toute opération FS passe par `assertInsideProject` (ou équivalent).
- **Budgets** : fonction ≤ 50 LOC, complexité ≤ 10, imbrication ≤ 3 ; fichier ≤ 500 LOC (alerte 800).
- **Single Responsibility** : avant d'ajouter à un fichier, vérifier que le code y appartient.
- **Frontière fork** : modif upstream uniquement en blocs `// FORK:` ; préférer l'injection.
- **`// DEBT: D-NN`** : tout raccourci consenti est tracé ici + référencé dans le code.

### 4.3 Discipline documentaire
- **ADR** pour toute décision architecturale non triviale (`docs/adr/`).
- **`// See ADR-XXXX`** dans le code qui implémente une décision.
- **Invariants = assertions** : tout invariant documenté a un `assert`/`debug_assert` correspondant.
- **KNOWN_FAILURE_PATTERNS.md** : tout contournement fragile y est documenté avec sa cause racine.

### 4.4 Définition de « terminé » (Definition of Done)
Une tâche n'est terminée que si : code propre (pas de raccourci non tracé) · tests passants couvrant la
logique · zéro warning lint · pas de croissance de god file · SDK régénéré si route · doc/ADR à jour si
décision · dette éventuelle inscrite ici avec plan daté.

### 4.5 Rituels
- **Fin de session** : audit TODO/FIXME (D-24), mise à jour de ce registre si dette créée.
- **Fin de sprint** : re-validation complète de la TODO §2.
- **Avant push majeur** : `/verify-standards` + `/health` + relecture des entrées P0/P1.
