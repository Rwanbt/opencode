# Plan autonome — Viewer lecture seule : réactivité, cache et lignes dynamiques (v4, consolidé + review multi-IA)

Date : 2026-07-16
Projet : OpenCode
Statut : **v4 — corrections des reviews multi-IA, prêt pour review finale puis implémentation par étapes**
Branche d'implémentation : `opti-ui` (créée depuis `dev`)

Référence de code : le plan cible le checkout dev et doit être recollé au commit réellement ciblé avant implémentation.

Ce document est autonome : un agent qui n'a lu que ce fichier doit pouvoir exécuter le correctif de bout en bout sans contexte supplémentaire. Il remplace les versions précédentes (les addenda v1/v2 sont conservés en fin de fichier, section "Historique", pour traçabilité — mais toute la substance utile est déjà intégrée ci-dessous).

Copie miroir (vault Obsidian) : `D:\Documents\Obsidian\IA_Dev_Brain\OpenCode\Plan-Readonly-Viewer-Reactivity-2026-07-16.md`.

**Provenance** : ce plan a été vérifié trois fois indépendamment, par lecture directe du code (pas par inférence sur les noms), puis affiné par une passe de review multi-IA :
1. Diagnostic initial (auteur original).
2. Vérification root-cause n°1 — lecture intégrale du source non minifié de `node_modules/@pierre/diffs` (`WorkerPoolManager.js`, `FileRenderer.js`, `File.js`, `DiffHunksRenderer.js`, `ResizeManager.js`, `style.js`, `types.d.ts`), `git log -p` sur 3 commits, grep exhaustif des tests. Rapport complet : `d:\tmp\review-plan-viewer-reactivity-verification.md`.
3. Vérification root-cause n°2 — lecture directe de `viewer-panel.tsx`, `file-tabs.tsx`, `editor-panel.tsx`, `context/editor/store.ts`, `context/file/store.ts`, `context/file.tsx`, `components/file.tsx`, `pierre/file-runtime.ts`, `util/encode.ts`, plus vérification croisée dans `node_modules/@pierre/diffs` (`File.js`, `File.d.ts`, `areFilesEqual.js`, `types.d.ts`).
4. Review multi-IA (v4) : affine Phase 1 (stamp.hash prioritaire sur FNV-1a), Phase 2 (génération monotone par chemin anti-retour-obsolète, DocEffect à 3 états au lieu de "none" ambigu, intégration autosave), Phase 3 (idempotence stricte de `clearReadyWatcher`), Phase 6 (ne pas patcher `node_modules`/appeler d'API interne non publique pour C4 — préférer mise à jour de dépendance/patch versionné/contribution upstream).

Les deux vérifications indépendantes convergent sur la cause la plus importante (le pipeline de sauvegarde à double aller-retour, section 3 ci-dessous) sans s'être copiées l'une l'autre — c'est le signal de confiance le plus fort de ce document.

---

## 1. Objectif

Rendre le viewer lecture seule stable et réactif après sauvegarde, avec parité stricte desktop/Android :

- le nouveau contenu apparaît sans délai perceptible après sauvegarde ;
- les couleurs et le texte affiché correspondent toujours au contenu réellement sauvegardé, jamais à un contenu obsolète ;
- les hauteurs de lignes sont correctes dès l'apparition, sans correction visible après coup ;
- les numéros de ligne restent alignés avec leur ligne, y compris sur lignes wrapées ;
- aucune boucle d'observation, aucun scan DOM complet répété, aucune tâche différée ne continue après démontage ;
- le comportement est identique desktop Chrome / Android WebView.

## 2. Symptômes observés (rapportés par l'utilisateur)

- affichage qui arrive parfois avec une mauvaise mise en page avant de se corriger ;
- rafraîchissement tardif après sauvegarde ;
- latence perceptible entre la sauvegarde et l'apparition correcte de la vue read-only ;
- blocages ou ralentissements intermittents ;
- recalculs de hauteur/espacement après le premier rendu ;
- risque de désynchronisation contenu/lignes/numéros ;
- besoin de parité stricte desktop/Android.

---

## 3. Architecture réelle du pipeline sauvegarde → viewer (à lire avant tout fix)

Le plan initial parlait d'un pipeline "à deux stores". **Il y en a en réalité trois**, et la façon dont ils s'articulent est la cause la plus probable de la latence perçue par l'utilisateur — plus que tout ce qui se passe à l'intérieur de Pierre.

```
CodeMirror (buffer live, source de vérité pendant l'édition)
   │  Ctrl+S → handleCtrlS()                         editor-panel.tsx:165-194
   ▼
editorStore.save(path, content, format)               context/editor/store.ts:173-212
   │  1. deps.write() → SDK, écrit sur disque
   │  2. set(path, {baseline, dirty:false, ...})       ← EditorStore (état CM : dirty/saving/conflict)
   │  3. mirror(path, fs => fs.markClean(path, res.content, res.stamp))
   ▼
FileStore.markClean()                                  context/file/store.ts:100-117
   │  écrit `store.docs[path]` — SYNCHRONE, produce()
   │  ⚠️ ViewerPanel NE LIT PAS CE STORE.
   ▼
await props.onSave()  ────────────────────────────►  refreshAfterEditor()          file-tabs.tsx:75-79
   │                                                    await file.load(p, {force:true})
   ▼
context/file.tsx: load(path, {force:true})              context/file.tsx:160-222
   │  {force:true} CONTOURNE le skip-gate qui existe pourtant pour ce cas exact
   │  (commentaire ligne 168-175 : "editor.save()/editor.reload() update FileStore
   │   atomically... no need to re-read... force:true still bypasses this")
   │  → Promise.all([ sdk.client.file.read(...), sdk.client.file.readRaw(...) ])
   │  → DEUX appels backend (IPC/HTTP) AWAITÉS, qui relisent un fichier dont
   │    le contenu est déjà connu en mémoire (res.content de l'étape save()).
   ▼
setLoaded(path, content)  → store.file[path]            context/file.tsx:132-140, 246-254
   │  = LE VRAI cache lu par ViewerPanel (state()?.content?.content)
   ▼
props.setEditing(false)                                 editor-panel.tsx:190
   ▼
<Show when={!editing()}>  → démontage CM, MONTAGE COMPLET de ViewerPanel   file-tabs.tsx:228-239
   ▼
TextViewer (packages/ui/src/components/file.tsx) : nouvelle instance PierreFile,
nouveau shadow DOM, nouveaux workers de tokenisation, notifyShadowReady, etc.
```

**Point clé** : `await props.onSave()` (donc les deux appels SDK) bloque **avant** `setEditing(false)`. Le remount du viewer — donc tout ce que corrigent les Phases 1-6 de ce plan — ne démarre même pas tant que ce double aller-retour réseau n'est pas terminé. C'est la cause la plus directement actionnable de "latence perceptible entre sauvegarde et apparition de la vue read-only".

Le même chemin (`refreshAfterEditor`) est câblé sur `onSave`, `onReload`, `onOverwrite`, `onRecreate` (`file-tabs.tsx:194-198`) — pour `save`/`reload`/`resolveConflict`/`recreate`, `editorStore` a **déjà** appelé `mirror()` → FileStore est déjà à jour. Seul `onDiscard` (`editorStore.close()` supprime l'entrée FileStore) a structurellement besoin d'un rechargement.

---

## 4. Causes confirmées — table de synthèse par sévérité

| # | Cause | Sévérité | Statut | Preuve (fichier:ligne) | Source |
|---|---|---|---|---|---|
| C1 | `refreshAfterEditor()` force un aller-retour SDK complet (`file.read`+`readRaw`) après chaque save, awaité avant `setEditing(false)`, alors que FileStore a déjà le contenu frais via `mirror()`. Le skip-gate prévu pour ce cas est court-circuité par `{force:true}`. | 🔴 Critique | Non traité par le plan v1/v2 | `context/file.tsx:160-222`, `file-tabs.tsx:75-79,194-198`, `editor-panel.tsx:185-190` | Vérif. #2 — **corroboré indépendamment** par Vérif. #1 section 5a |
| C2 | L'objet `file` passé à Pierre (`viewer-panel.tsx:89-96`) est construit dans une IIFE inline non mémoïsée. `checksum(contents)` (hash O(n) sur tout le contenu) est donc recalculé à **chaque lecture** de `props.file` côté `file.tsx` (`text()` non mémoïsé, appelé depuis `draw()`, `applySelection()`, le callback `isReady` de `notifyShadowReady`, et l'effect de sélection qui se déclenche même sans changement de contenu). Sur un gros fichier, sélectionner une ligne recalcule un hash complet. | 🔴 Critique | Non traité — contredit l'objectif Phase 1 lui-même ("calculer `contents` une seule fois par rendu") | `viewer-panel.tsx:89-96`, `components/file.tsx` (`text` ~782, `lineCount` ~790, `bytes` memo ~796, `draw` ~963, `applySelection` ~827, effect de sélection dans `useFileViewer` ~284-286) | Vérif. #2 |
| C3 | `notifyShadowReady`/`clearReadyWatcher` : `clearReadyWatcher` déconnecte l'observer mais **ne bump jamais `state.token`**. Si le composant est démonté pendant la fenêtre `settleFrames` (entre "prêt" détecté et fin des frames d'attente), la chaîne `requestAnimationFrame` en vol s'exécute quand même (le check `token !== state.token` passe puisque token n'a pas changé) et exécute `onReady()` sur un composant démonté : réinstalle `watchViewerLineRows`/`watchViewerTokenStyles` (nouveaux Observers jamais nettoyés) et appelle `local.onRendered?.()` → `queueRestore()` en retard, potentiellement après que le nouveau montage se soit déjà stabilisé. | 🟠 Élevé | Non traité — le plan v1/v2 demande un `cleanUpPendingTasks()` générique sans localiser ce mécanisme précis | `pierre/file-runtime.ts:10-13` (`clearReadyWatcher`), `69-132` (`notifyShadowReady`, `runReady`/`step`) | Vérif. #2 |
| C4 | `FileRenderer.cleanUp()` (lib `@pierre/diffs`) n'appelle jamais `workerManager.cleanUpPendingTasks(this)`, contrairement à `DiffHunksRenderer.cleanUp()` dans la même lib qui le fait. Une tâche worker obsolète continue d'occuper un des 2 workers du pool **global partagé par toute l'app** jusqu'à sa fin naturelle — pas de corruption (4 garde-fous déjà présents l'empêchent, voir C4-bis), mais contention/latence sur le fichier courant lors de sauvegardes ou changements de fichier rapprochés. | 🟠 Élevé | Non traité — **et pas de fix côté app sans patcher la lib** (voir Phase 6) | `node_modules/@pierre/diffs/dist/renderers/FileRenderer.js:58-64` vs `DiffHunksRenderer.js:42-49` | Vérif. #1 |
| C4-bis | "Rendu obsolète écrasant le plus récent" (risque cité en Phase 4 du plan v1) : **non reproductible aujourd'hui**. 4 garde-fous déjà en place : `renderViewer()` fait `cleanUp()` synchrone avant nouvelle instance ; `FileRenderer.cleanUp()` nullifie `renderCache`/`onRenderUpdate` (callback obsolète → no-op) ; `File.cleanUp()` détache le node DOM ; l'app fait `innerHTML = ""` avant de dessiner. À reformuler : le vrai gap est C4 (contention), pas une race de corruption. | ℹ️ Info | Confirme le plan v1/v2 sur ce point, à reformuler | `file.tsx:476-482` (`renderViewer`), `FileRenderer.js:273-284`, `File.js:106-129` | Vérif. #1 |
| C5 | Root cause du bug de cache (Phase 1) confirmée à deux niveaux indépendants dans la lib : `FileRenderer.getOrCreateLineCache` (découpage en lignes brutes, `File.js:104-116`) **et** `WorkerPoolManager.getFileResultCache` (résultat de coloration syntaxique, LRUMap indexée uniquement par `cacheKey`, `WorkerPoolManager.js:44-56`) réutilisent leur cache sur seule égalité de `cacheKey`, sans comparer `contents`. `areFilesEqual` (qui compare aussi `contents`) existe mais ne sert qu'à dédupliquer une requête déjà en vol pour la même instance — **jamais consultée par les deux caches ci-dessus**. Le fix `checksum(contents)` est donc correct et nécessaire pour les deux, mais `File.render()` (`File.js:178-179`) a son propre garde-fou `areFilesEqual` qui empêchait déjà le pire cas ("aucun re-render du tout") — seul le contenu affiché en aval (lignes/couleurs) était affecté, pas l'absence totale de rendu. | ✅ Confirmé, fix correct | Phase 1 du plan bien orientée | `File.js:104-116,178-179`, `areFilesEqual.js`, `WorkerPoolManager.js:44-56` | Vérif. #1 + Vérif. #2 (convergent) |
| C6 | Remount dominant = démontage Solid complet via `<Show when={!editing()}>`, déclenché par `setEditing(false)` après save (commentaire source : *"viewer re-mounts"*), **pas** `options()`/`virtual()` changeant. Un rendu Pierre incrémental (Phase 4/6) ne couvre que le cas secondaire où le composant reste monté et seul le contenu change — pas le cas dominant du flux édition→Ctrl+S. | ✅ Confirmé | Le plan v1/v2 l'a déjà corrigé dans son addendum | `file-tabs.tsx:228-239`, `editor-panel.tsx:185-190` | Vérif. #1 + Vérif. #2 (convergent) |
| C7 | Resize sans mutation DOM détectable : DEUX causes indépendantes, pas une. (a) reflow CSS pur du wrap (`white-space: pre-wrap` sur `[data-overflow='wrap']`, forcé par `viewer-panel.tsx:88`). (b) `ResizeManager` interne de Pierre mute des propriétés CSS custom (`--diffs-column-content-width` etc.) sur `root.host`, débounce ~33ms — ce sont de vraies mutations DOM mais **invisibles** au `MutationObserver` de l'app qui n'observe que `{childList:true, subtree:true}`, jamais `attributes:true`. Le `ResizeObserver` sur `root.host` capte les deux, mais pour deux raisons différentes qu'il faut documenter séparément (sinon un futur refactor pourrait croire qu'une seule suffit). | ✅ Confirmé | Renforce la Phase 2/4 du plan | `node_modules/@pierre/diffs/dist/style.js`, `managers/ResizeManager.js:13-38,144-166` | Vérif. #1 |
| C8 | Troisième scan DOM complet, non compté dans la Phase 3 du plan v1 : `notifyShadowReady` fait `root.querySelectorAll("[data-line]")` à **chaque** callback de son propre `MutationObserver` tant que "prêt" n'est pas atteint (en plus de `watchViewerLineRows` et `watchViewerTokenStyles`). | ✅ Confirmé | À inclure explicitement dans la Phase "observers" | `pierre/file-runtime.ts:69-132`, `components/file.tsx:919-936` | Vérif. #1 + Vérif. #2 (convergent) |
| C9 | `checksum("")` retourne `undefined` par design (`!content` vrai pour `""`). `getOrCreateLineCache` traite `cacheKey == null` comme "jamais cacher" → le cache de lignes Pierre est **désactivé en permanence** pour tout contenu vide (pas un bug de correction, juste une non-optimisation permanente sur fichiers vides). | 🟡 Mineur | Non traité, à documenter | `util/encode.ts:22-30`, `File.js:104-107` | Vérif. #2 |
| C10 | `checksum` = FNV-1a 32 bits. `getOrCreateLineCache`/`getFileResultCache` ne comparent QUE le `cacheKey`, jamais `contents`. Une collision de hash (improbable mais non nulle sur 32 bits) reproduirait exactement le bug que corrige la Phase 1 — juste avec une probabilité bien plus faible qu'avec `.length`. **Review v4** : privilégier `stamp.hash` (SHA-256, déjà calculé côté backend pour l'optimistic locking d'`EditorStore`) comme identité de cache quand il est disponible, FNV-1a en fallback seulement. | 🟡 Mineur, mitigé en Phase 1 v4 | Non bloquant | `util/encode.ts:22-30`, `context/editor/store.ts` (`Stamp.hash`) | Vérif. #2 + review v4 |
| C11 | Edge case latent : `handleCtrlS` ne traite en early-return QUE `conflict/missing/error` ; si `editorStore.save()` retourne `{type:"none"}` (cas où `entry.saving` était déjà `true`, save() no-op — **y compris quand l'appelant est l'autosave**, `autosave.schedule(p)` appelant `editorStore.save()` directement), le code continue quand même vers `onSave()` + `setEditing(false)` **comme si la sauvegarde avait réussi**, alors que le contenu tapé depuis n'a pas été persisté. **Review v4** : `"none"` mélange deux cas distincts (save busy vs save réussie sans formatage) — il faut un DocEffect à 3 états (`saved`/`busy`/`clean`), et l'intégration autosave↔Ctrl+S concurrent doit être traitée explicitement (pas seulement le double Ctrl+S). | 🟡 Moyen → traité en priorité 1 dans l'ordre de livraison v4 | Scope étendu par la review v4 | `editor-panel.tsx:165-194`, `context/editor/store.ts:173-176` (`if (!entry \|\| entry.saving) return {type:"none"}`), module autosave (à localiser) | Vérif. #2 + review v4 |
| C12 | "Validation actuelle" du plan v1/v2 ("typecheck app/ui, test syntax highlighting et test file-tab-scroll passés") est **trompeuse**. Les 3 tests cités ne couvrent rien de la réactivité du viewer (CodeMirror sans rapport, substring `.toContain()` statique sur du CSS, scroll de barre d'onglets). Zéro test existant ne référence `watchViewerLineRows`, `watchViewerTokenStyles`, `fixSubgridLineRowCollapse`, `getSynchronizedGridRows`, ni le `checksum` de `viewer-panel.tsx`. Un test e2e Playwright pertinent existe (`packages/app/e2e/session/session-review.spec.ts`, *"review keeps scroll position after a live diff update"*) mais est **désactivé** (`test.fixme`, ligne 351). | 🔴 À corriger avant toute review multi-IA | Non traité | Vérif. #1, section 6 (recherche exhaustive par grep) | Vérif. #1 |

---

## 5. Fichiers concernés (liste corrigée et complète)

Fichiers déjà identifiés par le plan v1/v2 :
- `packages/app/src/pages/session/viewer-panel.tsx`
- `packages/app/src/pages/session/file-tabs.tsx`
- `packages/ui/src/components/file.tsx`
- `packages/ui/src/pierre/file-runtime.ts`
- `packages/util/src/encode.ts`
- `packages/app/src/context/editor/store.ts`

**Fichiers manquants, ajoutés par cette consolidation** (centraux pour C1/C11) :
- `packages/app/src/context/file.tsx` — le vrai cache lu par le viewer (`store.file[path]`), le `load({force:true})`, le skip-gate contourné. **Ne PAS commencer le fix de C1 sans avoir lu ce fichier en entier.**
- `packages/app/src/pages/session/editor-panel.tsx` — `handleCtrlS`, `handleReload`, `handleOverwrite`, l'ordre `onSave()` → `setEditing(false)`, et le bug C11.
- `packages/app/src/context/file/store.ts` — `FileStore.markClean`, pour bien distinguer ce store de celui de `context/file.tsx`.
- module autosave (référencé via `autosave.schedule(p)` dans `editor-panel.tsx` — **à localiser en premier**, avant le fix C11, review v4).

Fichiers de la lib tierce à lire (lecture seule, ne pas modifier — vendée dans `node_modules`) pour valider tout fix touchant C4/C5/C7 :
- `node_modules/@pierre/diffs/dist/renderers/FileRenderer.js`
- `node_modules/@pierre/diffs/dist/worker/WorkerPoolManager.js`
- `node_modules/@pierre/diffs/dist/components/File.js`
- `node_modules/@pierre/diffs/dist/managers/ResizeManager.js`
- `node_modules/@pierre/diffs/dist/utils/areFilesEqual.js`

Tests à créer/réactiver :
- `packages/app/e2e/session/session-review.spec.ts` (retirer `test.fixme` ligne 351, vérifier qu'il passe réellement plutôt que de le supprimer)
- nouveaux tests ciblés — voir section 8.

---

## 6. Plan de phases (ordre révisé v4)

### Phase 1 — Identité de contenu fiable (déjà partiellement faite — à compléter, pas à refaire)

- [x] `cacheKey: checksum(contents)` au lieu de `.length` — déjà fait dans `viewer-panel.tsx`.
- [x] **Corriger C2** : l'objet `file` est désormais construit via `createMemo` dans `renderFile()` (`viewer-panel.tsx`) au lieu de l'IIFE inline — `checksum()` ne se recalcule plus qu'au vrai changement de `source()`/`path()`, pas à chaque lecture downstream de `props.file` (sélection de ligne incluse). Vérifié par `bun typecheck` + suite complète (packages/app 588/588, packages/ui 74/74).
- [ ] **Décider l'identité de cache avant de figer C9/C10** : utiliser en priorité le `stamp.hash` autoritatif du backend ; fallback client (FNV-1a) seulement si le stamp est absent. **Vérifié en implémentant C2** : `FileState` (`context/file/types.ts`), le type que lit `ViewerPanel`, ne porte aujourd'hui aucun champ `stamp`/`hash` — seul `FileStore` (le miroir Phase 2 R1, store différent) en a un. Câbler `stamp.hash` dans le viewer nécessite donc de faire lire `ViewerPanel` depuis `FileStore` (ou d'y ajouter un champ équivalent) — **ce sous-point est donc repoussé dans la Phase 2** (il touche exactement la même unification de store que C1), pas traité comme un fix Phase 1 isolé.
- [ ] Si un fallback FNV-1a 32 bits reste nécessaire, documenter la garantie probabiliste. Ne pas utiliser `sampledChecksum` comme identité complète des gros fichiers.
- [x] Test : deux contenus de même longueur → deux clés différentes, deux rendus corrects — déjà couvert par le fix Phase 1 initial (checksum vs `.length`) ; pas de nouveau test requis pour C2 (mémoïsation), qui est un fix de performance/redondance pur, pas de correction fonctionnelle — pas de comportement observable différent, donc pas de nouvelle assertion possible sans instrumenter le nombre d'appels à `checksum()` (prévu en Phase 0).

### Phase 2 — Pipeline de sauvegarde : éliminer le round-trip SDK redondant

**⚠️ Cette phase touche `packages/app/src/context/` (providers). Règle "Architectural change discipline" du AGENTS.md : `graphify path` sur les symboles touchés, lecture d'au moins 3 call-sites de `file.load`/`refreshAfterEditor` hors chemin de sauvegarde, "Affects: [...]. Does not affect: [...]." explicite dans le commit, confirmation de scope utilisateur avant application si le diff touche ≥2 fichiers du périmètre.**

Options à évaluer (ne pas trancher sans mesure Phase 0) :
1. Faire lire `ViewerPanel.contents` directement depuis `FileStore` au lieu du cache viewer de `context/file.tsx`.
2. Exposer une méthode de seed direct sur le contexte `file` avec `content` et `stamp`, sans repasser par le SDK. Garder `file.load({force:true})` pour les chemins qui en ont besoin. **Cette option doit utiliser une génération monotone par chemin** : un load commencé avant un seed plus récent ne peut pas exécuter `setLoaded()` après ce seed (protection anti-retour-obsolète).
3. A minima (fix conservateur) : ne pas `await` le round-trip avant `setEditing(false)`.

**Recommandation par défaut (v4)** : seed direct + stamp + génération anti-retour-obsolète. Source de vérité explicite : EditorStore/CodeMirror pour le buffer dirty, FileStore miroir + stamp pour le contenu sauvegardé immédiat, contexte `file` pour raw/VCS/patch, SDK/watchers pour l'état disque. Choix final après mesure Phase 0, avec confirmation utilisateur.

- [x] **Corriger C11** : `DocEffect` distingue désormais `"none"` (sauvegarde réussie, pas de mutation CM nécessaire — y compris le cas legacy "aucune entrée éditeur", ex. close-guard sur un chemin fantôme) de `"busy"` (autre sauvegarde déjà en vol, rien n'a été tenté). `handleCtrlS`/`handleOverwrite`/`handleRecreate` (`editor-panel.tsx`) et `close-guard.tsx`'s `onSave` traitent désormais `busy` comme un non-succès et attendent la libération du verrou (`waitForSaveSlot`, poll 50ms, plafond 5s) avant de retenter avec le contenu le plus frais (`saveWithRetry`, borné à 2 tentatives). **Angle mort découvert en implémentant** : `close-guard.tsx` (dialogue "sauvegarder et fermer") avait exactement le même bug que `handleCtrlS` — un `busy` y aurait fermé l'onglet comme si la sauvegarde avait réussi, alors que rien n'avait été écrit. Corrigé dans le même commit (grep systématique des appelants de `editorStore.save`/`recreate`, règle AGENTS.md "grep the whole codebase for the same pattern").
- [x] **Intégrer l'autosave** : `autosave.ts` appelle déjà `mirror()`→`FileStore.markClean()` comme une sauvegarde manuelle ; vérifié qu'aucun chemin actuel ne permet de quitter le mode édition sans passer par `handleCtrlS`/`handleOverwrite`/`handleDiscard` (pas de bouton "fermer sans sauvegarder" dans l'UI actuelle) — donc pas de risque de viewer resté périmé après un autosave silencieux. Un Ctrl+S concurrent préserve désormais les frappes supplémentaires via `saveWithRetry` (testé : `editor-panel.test.ts` C.7/C.8/C.9, `close-guard-integration.test.ts` "busy (autosave in flight)").
- [ ] Tester un retour SDK obsolète : seed A, seed B, résolution tardive de A → B reste affiché. *(reporté à la Phase 2 proprement dite — nécessite la génération monotone par chemin, pas encore implémentée)*
- [ ] Tester un changement de fichier pendant une sauvegarde : la résolution tardive de A ne modifie pas B. *(idem)*

### Phase 3 — `notifyShadowReady` : fermer la fenêtre de tâche obsolète

- [x] **Corrigé, avec une nuance importante découverte en implémentant** : modifier `clearReadyWatcher` lui-même pour bumper le token cassait `notifyShadowReady` — cette fonction est réutilisée EN INTERNE par `notifyShadowReady` à deux endroits (juste avant d'installer un nouveau `MutationObserver`, et dans le callback de ce même observer une fois "prêt" détecté, juste avant `runReady()`) ; bumper le token à ces deux endroits invalide la génération en cours AVANT que son propre `onReady` ait pu s'exécuter — `notifyShadowReady` ne se déclenche alors plus jamais via le chemin `MutationObserver`. Solution retenue : `clearReadyWatcher` reste inchangé (reset interne, pas de bump de token) ; nouvelle fonction `disposeReadyWatcher` ajoutée pour la vraie destruction du composant — annule le RAF de settle-frame en cours (`cancelAnimationFrame`, pas seulement le check de token), bump le token, marque `disposed:true`. `useFileViewer`'s `onCleanup` (`packages/ui/src/components/file.tsx`) appelle désormais `disposeReadyWatcher` au lieu de `clearReadyWatcher` ; les deux usages internes de `clearReadyWatcher` dans `notifyShadowReady`/`renderViewer` restent inchangés. `notifyShadowReady` ajoute aussi un garde `if (opts.state.disposed) return` en tête, défensif.
- [x] Test : nouveau fichier `packages/ui/src/pierre/file-runtime.test.ts` (9 tests, aucune couverture n'existait avant — comble aussi une partie de C12) — couvre : ready immédiat, chaîne `settleFrames`, chemin `MutationObserver`, génération supersédée, démontage pendant la fenêtre `settleFrames` (RAF annulé, `onReady` jamais appelé), démontage après détection `MutationObserver` mais avant fin des settle frames, `clearReadyWatcher` seul NE annule PAS un settle-frame en vol (documente la distinction avec `disposeReadyWatcher`), idempotence de `disposeReadyWatcher`, no-op de `notifyShadowReady` sur un watcher déjà disposé.

### Phase 4 — Lignes dynamiques desktop/Android (déjà largement faite)

- `watchViewerLineRows` déjà en place.
- `ResizeObserver` sur `root.host` : documenter qu'il couvre C7a (reflow CSS) ET C7b (ResizeManager interne Pierre) séparément.
- Coalescer dans un seul `requestAnimationFrame` (déjà fait, à revalider par test).
- Tests : ligne simple, ligne vide, dernière ligne, fichier vide, lignes longues wrapées, resize étroit/large, desktop/mobile.

### Phase 5 — Observers de tokens ET readiness coalescés (scope étendu à C8)

- [ ] Remplacer le scan complet `querySelectorAll` de `watchViewerTokenStyles` par une file de nœuds ajoutés, coalescée en RAF.
- [ ] Étendre à `notifyShadowReady` (C8) : éviter de re-scanner tout le Shadow DOM à chaque callback — s'arrêter dès "prêt" stable, ou vérifier localement via le dernier `MutationRecord`.
- [ ] Garder un scan complet uniquement à l'initialisation ou si la mutation ne permet pas d'identifier les nœuds ajoutés.
- [ ] Vérifier que les styles inline Shiki restent présents après plusieurs rerenders.

### Phase 6 — Rendu Pierre incrémental / teardown propre

1. **Décider explicitement** si `ViewerPanel` doit rester monté pendant la transition édition↔lecture (masquer/afficher au lieu de démonter/remonter). Évaluer l'impact sur le cycle de vie CodeMirror.
2. Si le remount Solid reste retenu : transférer proprement le contenu final sans conteneur vidé visible.
3. **Corriger C4 seulement après vérification de l'API et de l'ownership** : ne pas appeler une API interne depuis l'application, ne pas modifier durablement `node_modules`. Préférer une mise à jour de dépendance, un patch versionné (`patch-package`), ou une contribution upstream à `@pierre/diffs`.
4. Fusionner le rerender des annotations avec le rendu principal (`active.rerender()` + `find.refresh()`).
5. Ne pas ajouter de garde-fou pour la corruption Pierre déjà protégée par C4-bis. Conserver la génération par chemin de la Phase 2 pour les retours SDK obsolètes.

### Phase 7 — Mesure et validation finale

- Compléter l'instrumentation Phase 0 (remounts, recalculs, scans DOM, tâches pending, callbacks annulés).
- Réactiver et faire passer `session-review.spec.ts` (retirer `test.fixme`).
- Validation réelle desktop + APK Android (voir section 10).

### Phase 0 — Instrumentation minimale (fait)

- [x] Nouveau module partagé `packages/util/src/viewer-timing.ts` (framework-agnostic, importable depuis `packages/app` ET `packages/ui`). Désactivé par défaut PARTOUT (dev et prod) — s'active explicitement via `enableViewerTiming()` ou `localStorage["opencode:debug:viewer-timing"] = "1"`, y compris sur un vrai build desktop/Android (pas seulement un serveur dev), puisque le but de la Phase 0 est de mesurer la latence réelle sur les deux plateformes. `markViewerTiming()` est un simple check booléen quand désactivé — coût négligeable sur le chemin chaud même si un appel est oublié non gardé. 8 tests unitaires (`viewer-timing.test.ts`).
- [x] Marks câblés :
  - `save-start` / `editing-false` — `editor-panel.tsx` (`handleCtrlS`, `handleOverwrite`)
  - `write-complete` / `store-mirror` — `context/editor/store.ts` (`save()`, autosave compris puisqu'il appelle la même fonction)
  - `refresh-sdk-start` / `refresh-sdk-complete` — `file-tabs.tsx` (`refreshAfterEditor`) — **mesure directe du coût C1**
  - `viewer-mount-start` — `packages/ui/src/components/file.tsx` (`TextViewer`, en tête de composant — un composant Solid ne s'exécute qu'une fois par montage, donc c'est bien "mount start", y compris pour le remount dominant via `<Show when={!editing()}>`)
  - `notify-shadow-ready-start/end` — `TextViewer`'s `notify()` — englobe tokenisation worker + peuplement DOM + détection "prêt" Pierre en un seul bloc
  - `layout-fix-start/end` — `watchViewerLineRows`'s `schedule()` callback (autour de `fixSubgridLineRowCollapse`)
  - `viewer-ready` — `viewer-panel.tsx`'s `onRendered` (le signal de fin réel, déjà utilisé par `queueRestore()`)
- [ ] **Angle mort documenté, pas de fix** : pas de mark `worker-result` séparé — le worker de tokenisation Pierre vit entièrement dans `node_modules/@pierre/diffs` (vendée), l'instrumenter nécessiterait de la patcher, ce que la Phase 6/C4 exclut explicitement (patch non versionné, écrasé au prochain `bun install`). `notify-shadow-ready-start/end` est le proxy le plus honnête disponible sans toucher la lib.
- [ ] **Hors scope délibéré** : `DiffViewer`'s propre `notify()` n'est pas instrumenté (seul le viewer lecture seule `TextViewer`, utilisé par `viewer-panel.tsx`, est dans le périmètre de ce plan).
- [x] **Mesure réelle obtenue (2026-07-19, desktop dev — `opencode serve` port 4097 + `packages/app` Vite dev, piloté via `/browse`, projet réel `D:\App\OpenCode\opencode` branche `opti-ui`, édition d'un vrai fichier `viewer-panel.tsx`, flag `opencode:debug:viewer-timing` activé)** :

```
save-start                 80091.0
write-complete              80212.9   (+121.9 ms — écriture disque backend, coût incompressible)
store-mirror                 80214.1   (+1.2 ms)
refresh-sdk-start             80214.8   (+0.7 ms)
refresh-sdk-complete           80415.4   (+200.6 ms  ← round-trip C1)
editing-false                   80421.1   (+5.7 ms)
viewer-mount-start                80424.3   (+3.2 ms)
notify-shadow-ready-start           80477.8   (+53.5 ms)
notify-shadow-ready-end               80514.6   (+36.8 ms)
viewer-ready                            80515.3   (+0.7 ms)

Total save-start → viewer-ready : 424.3 ms
Round-trip SDK (C1, refresh-sdk-start → refresh-sdk-complete) : 200.6 ms
Remount Pierre complet (editing-false → viewer-ready) : 94.2 ms
```

**Verdict chiffré** : le round-trip SDK redondant (C1) coûte **200.6 ms, soit plus du double du remount Pierre complet (94.2 ms)** — tokenisation worker, peuplement DOM et détection "prêt" inclus. Sur les ~300 ms de latence évitable (424 ms total − 121.9 ms d'écriture disque incompressible), C1 représente à lui seul **~67%**. Confirme sans ambiguïté que C1 est la priorité n°1, largement devant les phases Pierre (4-6).

*(Deuxième cycle de mesure tenté mais non exploitable — après le premier save, `setEditing(false)` a fermé l'éditeur avant le second clic, donc pas de second Ctrl+S réel ; le premier point de mesure est net et cohérent en interne, considéré suffisant pour la décision. Édition de test entièrement revert via `git checkout` après la mesure — aucune trace dans le diff.)*

- [ ] Mesure desktop Tauri packagé + Android — reportée à la Phase 7 (validation finale), pas nécessaire pour la décision Phase 2 ci-dessous.

Validé par `bun typecheck` + suite complète sur les 3 packages touchés (`util` 8/8, `ui` 74/74 dont le nouveau fichier, `app` 588/588) — aucune régression.

---

## 7. Matrice de cas de figure (edge cases exhaustifs)

| Catégorie | Cas | Couvert par quelle phase | Statut avant ce plan |
|---|---|---|---|
| Cache/contenu | Même longueur, contenu différent | Phase 1 | ✅ Fix en place (checksum) |
| Cache/contenu | Contenu identique sauvegardé deux fois | Phase 1 | ✅ `areFilesEqual` fait déjà un early-bail dans `File.render()` |
| Cache/contenu | Fichier vide (`checksum` → `undefined`) | Phase 1 | 🟡 Comportement safe mais cache Pierre désactivé en permanence (C9) |
| Cache/contenu | Fichier très volumineux | Phase 1 + 2 | 🔴 checksum recalculé plusieurs fois par interaction (C2) |
| Cache/contenu | Collision de hash 32 bits | Phase 1 | 🟡 Résiduel, évité par `stamp.hash` en priorité (C10) |
| Cycle de vie | Montage initial | Phase 6 | ✅ |
| Cycle de vie | Remount édition→lecture (dominant) | Phase 6 | 🔴 Non couvert par un rendu incrémental seul (C6) |
| Cycle de vie | Démontage pendant rendu (fenêtre settleFrames) | Phase 3 | 🔴 Non couvert (C3) |
| Cycle de vie | Cleanup appelé deux fois | Phase 3/6 | À tester — doit être idempotent |
| Cycle de vie | Aucun callback après destruction | Phase 3 | 🔴 Non garanti aujourd'hui (C3) |
| Sauvegarde | Sauvegarde simple | Phase 2 | 🔴 Latence du double round-trip SDK (C1) |
| Sauvegarde | Sauvegardes rapides successives | Phase 2 | 🔴 résultat busy distinct + sauvegarde de rattrapage obligatoire (C11) |
| Sauvegarde | Autosave concurrent avec Ctrl+S | Phase 2 | 🔴 non traité avant review v4 |
| Sauvegarde | Retour SDK obsolète après seed plus récent | Phase 2 | 🔴 nécessite génération monotone par chemin |
| Sauvegarde | Changement de fichier pendant une sauvegarde | Phase 2 | 🔴 idem |
| Sauvegarde | Erreur SDK write | déjà géré (`eff.type === "error"` → toast) | ✅ |
| Resize | Resize avant/pendant/après rendu | Phase 4 | ✅ scheduler RAF déjà en place |
| Resize | Reflow CSS pur sans mutation DOM | Phase 4 | ✅ Couvert par `ResizeObserver` (C7a) |
| Resize | `ResizeManager` interne Pierre | Phase 4 | ✅ Couvert, raison distincte à documenter (C7b) |
| Resize | Rotation mobile simulée | Phase 4 | À valider sur device réel |
| `notifyShadowReady` | Rendu partiel puis complet | Phase 5 | À tester |
| `notifyShadowReady` | Scan interrompu après succès | Phase 5 | 🔴 Scan complet à chaque callback (C8) |
| `notifyShadowReady` | Cleanup avant succès | Phase 3 | 🔴 Non garanti (C3) |
| Concurrence worker | Pool partagé, tâche obsolète | Phase 6 | 🔴 Pas de `cleanUpPendingTasks` accessible sans patch (C4) |
| Concurrence worker | Rendu obsolète écrasant le plus récent | — | ✅ Non reproductible (C4-bis) |
| Parité | Desktop Chrome vs Android WebView | Phase 4 + 7 | À valider sur device réel |
| Parité | Mode édition : scroll horizontal, pas de wrap forcé | Hors scope | ✅ à ne pas régresser |

---

## 8. Tests obligatoires

### A. Contenu et cache
- même longueur, contenu différent → deux `cacheKey` différents, deux rendus corrects ;
- contenu identique sauvegardé deux fois → pas de re-render Pierre ;
- fichier vide → `cacheKey` undefined géré sans crash, 1 ligne affichée ;
- modification d'une seule ligne → seule cette ligne change visuellement ;
- gros fichier → mesurer le nombre d'appels à `checksum()` par interaction — doit être ≤1 par changement réel de contenu après Phase 1/C2.

### B. Cycle de vie
- montage, remount, démontage pendant rendu, cleanup avant/après tâche, cleanup appelé deux fois, **aucun callback après destruction** (C3).

### C. Sauvegarde
- sauvegarde simple → latence `editing-false` sans round-trip SDK évitable (C1) ;
- sauvegardes rapides successives (C11) : aucune frappe perdue, pas de fermeture sur save no-op ;
- test save sans formatage → résultat `saved` distinct de `busy` ;
- test autosave concurrent + Ctrl+S → aucune frappe perdue ;
- test retour SDK obsolète après seed plus récent → contenu récent conservé ;
- test changement de fichier pendant une sauvegarde → aucune mutation tardive de l'ancien fichier ;
- erreur SDK write → reste en édition, toast affiché ;
- mise à jour du store miroir → `FileStore` à jour de manière synchrone après `save()`.

### D. Resize
- resize avant/pendant/après rendu, `ResizeObserver` + `MutationObserver` simultanés, rotation mobile simulée, absence de boucle infinie.

### E. `notifyShadowReady`
- rendu partiel puis complet, mutation multiple dans une même frame, scan interrompu après succès, cleanup avant succès, gros fichier sans explosion du nombre de scans.

### F. Parité
- desktop, Android, affichage read-only, mode édition avec scroll horizontal conservé.

### G. Réactivation
- `packages/app/e2e/session/session-review.spec.ts` : retirer `test.fixme` (ligne 351), faire passer réellement.

---

## 9. Critères de réussite

- le contenu affiché correspond toujours au dernier contenu sauvegardé ;
- deux contenus de même longueur ne partagent jamais incorrectement le même rendu ;
- la latence entre save-complete et viewer-ready est mesurée, et le round-trip SDK redondant (C1) est supprimé ou justifié explicitement ;
- la vue read-only est stable dès son apparition, hauteurs correctes sans correction visible ultérieure ;
- les numéros de ligne restent alignés, y compris sur lignes wrapées/multi-hauteur ;
- resize desktop et Android recalcule correctement, sans boucle ResizeObserver/MutationObserver ;
- aucun callback, mutation DOM ou effet applicatif ne continue après destruction du viewer ; l'arrêt physique d'un worker tiers non annulable n'est pas exigé (limite acceptée, cf. C4/Phase 6) ;
- sauvegardes rapides successives ne provoquent ni contenu obsolète ni perte silencieuse de frappes (C11 tranché) ;
- le mode édition conserve son scroll horizontal, ses couleurs, pas de régression CodeMirror ;
- aucune régression TypeScript/Biome/test ;
- les tests couvrent réellement la réactivité, pas seulement le rendu statique.

---

## 10. Validation

Dans `packages/app` : `bun typecheck` + `bun test`.
Dans `packages/ui` : `bun typecheck` + `bun test`.
Si la suite complète est trop longue, exécuter au minimum les tests ciblés section 8 et indiquer précisément ceux qui n'ont pas tourné.

Desktop : `TEMP`/`TMP` → `D:\App\OpenCode\.build-temp` ; builder depuis le worktree courant ; vérifier timestamps/chemins des artefacts et le raccourci barre des tâches ; validation visuelle réelle uniquement après ouverture effective.

Android : identifier l'APK réellement généré, vérifier son timestamp ; installer, vérifier `lastUpdateTime` ; tester sauvegarde/passage affichage-édition/resize-rotation/gros fichier ; screenshot si nécessaire.

Ne jamais déclarer une validation desktop ou Android réussie sans preuve réelle.

---

## 11. Risques et garde-fous

- `ResizeObserver` peut déclencher pendant un layout : ne jamais écrire directement dans son callback, uniquement planifier une frame.
- Les fichiers virtuellement rendus ne doivent pas être mesurés comme s'ils étaient entièrement montés.
- Les changements de thème peuvent modifier la line-height ; déclencher une nouvelle mesure sans reconstruire le renderer.
- Un contenu vide ou un langage inconnu doit rester affichable sans worker.
- Toute optimisation doit préserver sélection, annotations, recherche, scroll restoration et hover utilities.
- La Phase 2 a le blast radius le plus large — suivre "Architectural change discipline" (AGENTS.md) avant application.
- Ne pas supprimer `file.load({force:true})` globalement — `onDiscard` et d'autres appelants (tab activation, watcher) en ont structurellement besoin.
- Ne pas fusionner C1 et C11 dans le même commit si leur risque diverge trop.
- Ne pas patcher `node_modules/@pierre/diffs` directement pour C4 (non versionné, écrasé au prochain `bun install`) — utiliser `patch-package` si un patch est réellement nécessaire, sinon proposer upstream.

---

## 12. Ordre de livraison recommandé (v4)

1. Localiser le module autosave (`autosave.schedule(p)`), corriger C11 (DocEffect à 3 états) et intégrer l'autosave — préserver les frappes concurrentes.
2. Phase 0 — instrumentation, avec tentative de sauvegarde et génération par chemin en place pour pouvoir mesurer C1 correctement.
3. Petits fixes isolés à faible risque : C2 (mémoïser l'objet `file`), C3 (idempotence `clearReadyWatcher`).
4. Décision sur la Phase 2 (pipeline de sauvegarde, C1) avec l'utilisateur, à la lumière des mesures Phase 0 — appliquer seulement après confirmation de scope.
5. Phase 4 (lignes dynamiques — déjà largement faite, revalider par tests).
6. Phase 5 (observers de tokens + `notifyShadowReady` coalescés, C8).
7. Phase 6 (rendu Pierre incrémental, décision sur le maintien du montage édition↔lecture ; C4 seulement via patch-package/upstream si nécessaire).
8. Phase 7 — instrumentation complète + validation réelle desktop/Android + réactivation de `session-review.spec.ts`.
9. Review multi-IA finale avec ce plan et le diff complet.

---

## 13. Brief à copier-coller pour les IA reviewers

> Revois ce plan et le diff associé comme un reviewer senior spécialisé UI réactive (SolidJS + Shadow DOM + Web Workers). Le plan a déjà été vérifié par lecture directe du code source (app + lib tierce `@pierre/diffs` vendée) puis affiné par une passe de review multi-IA — les causes listées section 4 citent toutes un fichier:ligne vérifié. Concentre ta review sur : (1) la justesse du fix pour le pipeline de sauvegarde à 3 stores (C1) avec génération monotone par chemin, et son impact sur les autres appelants de `file.load()` ; (2) la mémoïsation de l'objet `file` (C2) et son impact sur la réactivité fine-grained Solid ; (3) l'idempotence de `clearReadyWatcher`/token (C3) sur tous les chemins de démontage ; (4) le DocEffect à 3 états et l'intégration autosave (C11) ; (5) le choix de NE PAS patcher `@pierre/diffs` pour C4 sans passer par patch-package/upstream ; (6) toute race entre le remount Solid (`<Show>`) et les phases Pierre/worker restantes. Vérifie aussi : fichiers vides, très gros fichiers, virtualisation, wrap après resize, thème clair/sombre, sélection/annotations/recherche/scroll restoration, parité desktop/Android, et que la stratégie de tests couvre réellement chaque cause. Signale chaque problème avec sévérité, fichier/lignes, scénario reproductible et correctif recommandé.

---

## 14. Décision attendue après review

Le correctif ne sera considéré terminé qu'après : tests automatisés réellement pertinents (section 8), validation desktop réelle, build APK, installation du dernier APK sur le téléphone, vérification visuelle du même fichier wrapé sur les deux plateformes, et mesure chiffrée de la latence save→viewer-ready avant/après.

---

## 15. Historique

<details>
<summary>v1 — plan initial + addendum review Claude (2026-07-16)</summary>

Voir git history de ce fichier pour le texte intégral du plan v1 et de son premier addendum. Conclusions reprises dans les sections 3-4.

</details>

<details>
<summary>v2/v3 — vérifications indépendantes (2026-07-16)</summary>

Rapport complet fichier:ligne : `d:\tmp\review-plan-viewer-reactivity-verification.md`. Conclusions reprises dans la table section 4.

</details>

<details>
<summary>v4 — review multi-IA (2026-07-16→19)</summary>

Affine Phase 1 (stamp.hash), Phase 2 (génération monotone, DocEffect 3 états, autosave), Phase 3 (idempotence stricte), Phase 6 (pas de patch node_modules non versionné pour C4). Éditée directement dans la copie Obsidian, reconciliée ici avant implémentation sur la branche `opti-ui`.

</details>
