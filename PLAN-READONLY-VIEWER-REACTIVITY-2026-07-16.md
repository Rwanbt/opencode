# Plan autonome — Viewer lecture seule : réactivité, cache et lignes dynamiques (v3, consolidé)

Date : 2026-07-16
Projet : OpenCode
Statut : **v3 — consolidation de 3 passes de vérification indépendantes, prêt pour review multi-IA puis implémentation**

Ce document est autonome : un agent qui n'a lu que ce fichier doit pouvoir exécuter le correctif de bout en bout sans contexte supplémentaire. Il remplace les versions précédentes (les addenda v1/v2 sont conservés en fin de fichier, section "Historique", pour traçabilité — mais toute la substance utile est déjà intégrée ci-dessous).

**Provenance** : ce plan a été vérifié trois fois indépendamment, par lecture directe du code (pas par inférence sur les noms) :
1. Diagnostic initial (auteur original).
2. Vérification root-cause n°1 — lecture intégrale du source non minifié de `node_modules/@pierre/diffs` (`WorkerPoolManager.js`, `FileRenderer.js`, `File.js`, `DiffHunksRenderer.js`, `ResizeManager.js`, `style.js`, `types.d.ts`), `git log -p` sur 3 commits, grep exhaustif des tests. Rapport complet : `d:\tmp\review-plan-viewer-reactivity-verification.md`.
3. Vérification root-cause n°2 (celle-ci) — lecture directe de `viewer-panel.tsx`, `file-tabs.tsx`, `editor-panel.tsx`, `context/editor/store.ts`, `context/file/store.ts`, `context/file.tsx`, `components/file.tsx`, `pierre/file-runtime.ts`, `util/encode.ts`, plus vérification croisée dans `node_modules/@pierre/diffs` (`File.js`, `File.d.ts`, `areFilesEqual.js`, `types.d.ts`).

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
| C1 | `refreshAfterEditor()` force un aller-retour SDK complet (`file.read`+`readRaw`) après chaque save, awaité avant `setEditing(false)`, alors que FileStore a déjà le contenu frais via `mirror()`. Le skip-gate prévu pour ce cas est court-circuité par `{force:true}`. | 🔴 Critique | Non traité par le plan v1/v2 | `context/file.tsx:160-222`, `file-tabs.tsx:75-79,194-198`, `editor-panel.tsx:185-190` | Vérif. #2 (celle-ci) — **corroboré indépendamment** par Vérif. #1 section 5a |
| C2 | L'objet `file` passé à Pierre (`viewer-panel.tsx:89-96`) est construit dans une IIFE inline non mémoïsée. `checksum(contents)` (hash O(n) sur tout le contenu) est donc recalculé à **chaque lecture** de `props.file` côté `file.tsx` (`text()` non mémoïsé, appelé depuis `draw()`, `applySelection()`, le callback `isReady` de `notifyShadowReady`, et l'effect de sélection qui se déclenche même sans changement de contenu). Sur un gros fichier, sélectionner une ligne recalcule un hash complet. | 🔴 Critique | Non traité — contredit l'objectif Phase 1 lui-même ("calculer `contents` une seule fois par rendu") | `viewer-panel.tsx:89-96`, `components/file.tsx` (`text` ~782, `lineCount` ~790, `bytes` memo ~796, `draw` ~963, `applySelection` ~827, effect de sélection dans `useFileViewer` ~284-286) | Vérif. #2 (celle-ci) |
| C3 | `notifyShadowReady`/`clearReadyWatcher` : `clearReadyWatcher` déconnecte l'observer mais **ne bump jamais `state.token`**. Si le composant est démonté pendant la fenêtre `settleFrames` (entre "prêt" détecté et fin des frames d'attente), la chaîne `requestAnimationFrame` en vol s'exécute quand même (le check `token !== state.token` passe puisque token n'a pas changé) et exécute `onReady()` sur un composant démonté : réinstalle `watchViewerLineRows`/`watchViewerTokenStyles` (nouveaux Observers jamais nettoyés) et appelle `local.onRendered?.()` → `queueRestore()` en retard, potentiellement après que le nouveau montage se soit déjà stabilisé. | 🟠 Élevé | Non traité — le plan v1/v2 demande un `cleanUpPendingTasks()` générique sans localiser ce mécanisme précis | `pierre/file-runtime.ts:10-13` (`clearReadyWatcher`), `69-132` (`notifyShadowReady`, `runReady`/`step`) | Vérif. #2 (celle-ci) |
| C4 | `FileRenderer.cleanUp()` (lib `@pierre/diffs`) n'appelle jamais `workerManager.cleanUpPendingTasks(this)`, contrairement à `DiffHunksRenderer.cleanUp()` dans la même lib qui le fait. Une tâche worker obsolète continue d'occuper un des 2 workers du pool **global partagé par toute l'app** jusqu'à sa fin naturelle — pas de corruption (4 garde-fous déjà présents l'empêchent, voir C4-bis), mais contention/latence sur le fichier courant lors de sauvegardes ou changements de fichier rapprochés. | 🟠 Élevé | Non traité | `node_modules/@pierre/diffs/dist/renderers/FileRenderer.js:58-64` vs `DiffHunksRenderer.js:42-49` | Vérif. #1 (non re-vérifié par moi dans cette passe) |
| C4-bis | "Rendu obsolète écrasant le plus récent" (risque cité en Phase 4 du plan v1) : **non reproductible aujourd'hui**. 4 garde-fous déjà en place : `renderViewer()` fait `cleanUp()` synchrone avant nouvelle instance ; `FileRenderer.cleanUp()` nullifie `renderCache`/`onRenderUpdate` (callback obsolète → no-op) ; `File.cleanUp()` détache le node DOM ; l'app fait `innerHTML = ""` avant de dessiner. À reformuler : le vrai gap est C4 (contention), pas une race de corruption. | ℹ️ Info | Confirme le plan v1/v2 sur ce point, à reformuler | `file.tsx:476-482` (`renderViewer`), `FileRenderer.js:273-284`, `File.js:106-129` | Vérif. #1 |
| C5 | Root cause du bug de cache (Phase 1) confirmée à deux niveaux indépendants dans la lib : `FileRenderer.getOrCreateLineCache` (découpage en lignes brutes, `File.js:104-116`) **et** `WorkerPoolManager.getFileResultCache` (résultat de coloration syntaxique, LRUMap indexée uniquement par `cacheKey`, `WorkerPoolManager.js:44-56`) réutilisent leur cache sur seule égalité de `cacheKey`, sans comparer `contents`. `areFilesEqual` (qui compare aussi `contents`) existe mais ne sert qu'à dédupliquer une requête déjà en vol pour la même instance — **jamais consultée par les deux caches ci-dessus**. Le fix `checksum(contents)` est donc correct et nécessaire pour les deux, mais `File.render()` (`File.js:178-179`) a son propre garde-fou `areFilesEqual` qui empêchait déjà le pire cas ("aucun re-render du tout") — seul le contenu affiché en aval (lignes/couleurs) était affecté, pas l'absence totale de rendu. | ✅ Confirmé, fix correct | Phase 1 du plan bien orientée | `File.js:104-116,178-179`, `areFilesEqual.js`, `WorkerPoolManager.js:44-56` | Vérif. #1 + Vérif. #2 (convergent) |
| C6 | Remount dominant = démontage Solid complet via `<Show when={!editing()}>`, déclenché par `setEditing(false)` après save (commentaire source : *"viewer re-mounts"*), **pas** `options()`/`virtual()` changeant. Un rendu Pierre incrémental (Phase 4/6) ne couvre que le cas secondaire où le composant reste monté et seul le contenu change — pas le cas dominant du flux édition→Ctrl+S. | ✅ Confirmé | Le plan v1/v2 l'a déjà corrigé dans son addendum | `file-tabs.tsx:228-239`, `editor-panel.tsx:185-190` | Vérif. #1 + Vérif. #2 (convergent) |
| C7 | Resize sans mutation DOM détectable : DEUX causes indépendantes, pas une. (a) reflow CSS pur du wrap (`white-space: pre-wrap` sur `[data-overflow='wrap']`, forcé par `viewer-panel.tsx:88`). (b) `ResizeManager` interne de Pierre mute des propriétés CSS custom (`--diffs-column-content-width` etc.) sur `root.host`, débounce ~33ms — ce sont de vraies mutations DOM mais **invisibles** au `MutationObserver` de l'app qui n'observe que `{childList:true, subtree:true}`, jamais `attributes:true`. Le `ResizeObserver` sur `root.host` capte les deux, mais pour deux raisons différentes qu'il faut documenter séparément (sinon un futur refactor pourrait croire qu'une seule suffit). | ✅ Confirmé | Renforce la Phase 2/4 du plan | `node_modules/@pierre/diffs/dist/style.js`, `managers/ResizeManager.js:13-38,144-166` | Vérif. #1 (non re-vérifié par moi) |
| C8 | Troisième scan DOM complet, non compté dans la Phase 3 du plan v1 : `notifyShadowReady` fait `root.querySelectorAll("[data-line]")` à **chaque** callback de son propre `MutationObserver` tant que "prêt" n'est pas atteint (en plus de `watchViewerLineRows` et `watchViewerTokenStyles`). | ✅ Confirmé | À inclure explicitement dans la Phase "observers" | `pierre/file-runtime.ts:69-132`, `components/file.tsx:919-936` | Vérif. #1 + Vérif. #2 (convergent) |
| C9 | `checksum("")` retourne `undefined` par design (`!content` vrai pour `""`). `getOrCreateLineCache` traite `cacheKey == null` comme "jamais cacher" → le cache de lignes Pierre est **désactivé en permanence** pour tout contenu vide (pas un bug de correction, juste une non-optimisation permanente sur fichiers vides). | 🟡 Mineur | Non traité, à documenter | `util/encode.ts:22-30`, `File.js:104-107` | Vérif. #2 (celle-ci) |
| C10 | `checksum` = FNV-1a 32 bits. `getOrCreateLineCache`/`getFileResultCache` ne comparent QUE le `cacheKey`, jamais `contents`. Une collision de hash (improbable mais non nulle sur 32 bits) reproduirait exactement le bug que corrige la Phase 1 — juste avec une probabilité bien plus faible qu'avec `.length`. | 🟡 Mineur, à documenter comme limite résiduelle | Non bloquant | `util/encode.ts:22-30` | Vérif. #2 (celle-ci) |
| C11 | Edge case latent, adjacent au scope mais découvert en creusant les tests "sauvegardes rapides successives" déjà prévus par le plan : `handleCtrlS` ne traite en early-return QUE `conflict/missing/error` ; si `editorStore.save()` retourne `{type:"none"}` (cas où `entry.saving` était déjà `true`, save() no-op), le code continue quand même vers `onSave()` + `setEditing(false)` **comme si la sauvegarde avait réussi**, alors que le contenu tapé depuis n'a pas été persisté. Sortie en mode lecture avec des frappes non sauvegardées, sans avertissement. | 🟡 Moyen — bug latent distinct de la réactivité du viewer, mais le test "sauvegardes rapides successives" prévu par le plan va probablement le révéler | Non traité, hors scope initial mais à trancher | `editor-panel.tsx:165-194`, `context/editor/store.ts:173-176` (`if (!entry \|\| entry.saving) return {type:"none"}`) | Vérif. #2 (celle-ci) |
| C12 | "Validation actuelle" du plan v1/v2 ("typecheck app/ui, test syntax highlighting et test file-tab-scroll passés") est **trompeuse**. Les 3 tests cités ne couvrent rien de la réactivité du viewer (CodeMirror sans rapport, substring `.toContain()` statique sur du CSS, scroll de barre d'onglets). Zéro test existant ne référence `watchViewerLineRows`, `watchViewerTokenStyles`, `fixSubgridLineRowCollapse`, `getSynchronizedGridRows`, ni le `checksum` de `viewer-panel.tsx`. Un test e2e Playwright pertinent existe (`packages/app/e2e/session/session-review.spec.ts`, *"review keeps scroll position after a live diff update"*) mais est **désactivé** (`test.fixme`, ligne 351). | 🔴 À corriger avant toute review multi-IA | Non traité | Vérif. #1, section 6 (recherche exhaustive par grep) | Vérif. #1 (non re-vérifié par moi, mais méthode fiable) |

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

## 6. Plan de phases (ordre révisé)

L'ordre du plan v1/v2 (checksum → lignes → tokens → rendu Pierre → instrumentation) traitait en priorité les symptômes visibles côté Pierre. Cette consolidation déplace l'instrumentation et le fix du pipeline de sauvegarde **avant** les optimisations Pierre, parce que C1 est probablement la plus grosse part de la latence perçue et qu'il vaut mieux le confirmer par la mesure avant d'investir du temps ailleurs.

### Phase 0 — Instrumentation minimale AVANT tout fix (nouveau)

Objectif : mesurer avant d'optimiser, pour prioriser objectivement entre C1 et les phases Pierre.

Ajouter des timestamps instrumentés (derrière un flag debug désactivable, pas bruyant en prod) autour de :
```
save-start                    (handleCtrlS entrée)
write-complete                (editorStore.save() résolu)
store-mirror                  (FileStore.markClean terminé — devrait être ~immédiat après write-complete)
refresh-sdk-start              (refreshAfterEditor / file.load(force:true) démarre)   ← nouveau, absent du plan v1/v2
refresh-sdk-complete            (file.load résolu, setLoaded() appelé)                 ← nouveau
editing-false                  (setEditing(false) appelé)
viewer-mount-start              (ViewerPanel/TextViewer createEffect démarre)
worker-result                  (résultat de tokenisation reçu)
notify-shadow-ready-start/end   (notifyShadowReady détecte "prêt")
layout-fix-start/end            (fixSubgridLineRowCollapse)
viewer-ready                   (onRendered appelé)
```
Mesurer séparément `refresh-sdk-complete - refresh-sdk-start` (coût du round-trip C1) vs `viewer-ready - editing-false` (coût du remount Pierre) sur desktop ET Android. Ces deux nombres décident si C1 doit être corrigé avant ou après les phases Pierre.

### Phase 1 — Identité de contenu fiable (déjà partiellement faite — à compléter, pas à refaire)

- [x] `cacheKey: checksum(contents)` au lieu de `.length` — déjà fait dans `viewer-panel.tsx`.
- [ ] **Corriger C2** : mémoïser l'objet `file` avec `createMemo` dans `viewer-panel.tsx` au lieu de l'IIFE inline, pour que `checksum()` ne soit calculé qu'une fois par changement réel de `source()`, pas à chaque lecture de `props.file` (sélection de ligne incluse).
- [ ] Documenter C9/C10 comme limites connues (pas de fix requis, juste un commentaire + test qui les couvre explicitement).
- [ ] Test : deux contenus de même longueur → deux clés différentes, deux rendus corrects (déjà demandé par le plan v1, toujours à écrire réellement — voir C12).

### Phase 2 — Pipeline de sauvegarde : éliminer le round-trip SDK redondant (nouveau, remplace l'ancienne Phase 2 "lignes dynamiques" qui devient Phase 4)

**⚠️ Cette phase touche `packages/app/src/context/` (providers). Elle tombe sous la règle "Architectural change discipline" du AGENTS.md du projet : avant d'appliquer, exécuter `graphify path` sur les symboles touchés, lire au moins 3 call-sites de `file.load`/`refreshAfterEditor` en dehors du chemin de sauvegarde, écrire explicitement "Affects: [...]. Does not affect: [...]." dans le commit, et faire confirmer le scope par l'utilisateur avant d'appliquer si le diff touche ≥2 fichiers dans ce périmètre.**

Options à évaluer (ne pas trancher sans mesure Phase 0) :
1. Faire lire `ViewerPanel.contents` directement depuis `FileStore` (`context/file/store.ts`) au lieu du cache viewer de `context/file.tsx` — unifie les deux stores de lecture, supprime le besoin du round-trip SDK pour `onSave`/`onReload`/`onOverwrite`/`onRecreate`. Risque : `FileStore` et le cache viewer n'ont pas exactement la même forme (VCS diff/patch, flags loading/error) — vérifier tous les consommateurs de `file.get()` avant de changer sa source.
2. Exposer une méthode de "seed direct" sur le contexte `file` (ex: `file.seed(path, content, stamp)`) que `refreshAfterEditor` appelle avec `res.content`/`res.stamp` déjà connus, sans repasser par `sdk.client.file.read`/`readRaw`. Garder `file.load({force:true})` uniquement pour les cas qui en ont structurellement besoin (`onDiscard`, tab activation, watcher).
3. A minima (fix conservateur, faible risque) : ne pas `await` le round-trip avant `setEditing(false)` — flipper `editing` immédiatement avec le contenu déjà connu (`res.content`), laisser `file.load()` se terminer en arrière-plan pour rafraîchir VCS/diff/patch qui ne sont pas dans `res.content`.

Choisir l'option avec l'utilisateur après la mesure Phase 0 — ne pas décider unilatéralement, cette phase a le blast radius le plus large du plan.

- [ ] Corriger **C11** dans la même passe (ou séparément si le scope Phase 2 est jugé trop large) : `handleCtrlS`/`handleOverwrite` doivent traiter `eff.type === "none"` comme "rien à faire", ne pas enchaîner `onSave()` + `setEditing(false)`.

### Phase 3 — `notifyShadowReady` : fermer la fenêtre de tâche obsolète (nouveau, corrige C3)

- [ ] Ajouter une fonction (ex: `invalidateReadyWatcher(state)`) qui incrémente `state.token` en plus de déconnecter l'observer — à appeler dans le cleanup de `TextViewer`/`DiffViewer`, en plus de `clearReadyWatcher` déjà appelé par `useFileViewer`.
- [ ] Test : démonter le composant entre "prêt détecté" et fin de `settleFrames`, vérifier qu'aucun observer n'est recréé et qu'`onRendered` n'est pas appelé après démontage.

### Phase 4 — Lignes dynamiques desktop/Android (= ancienne Phase 2 du plan v1, déjà partiellement faite)

Contenu inchangé par rapport au plan v1/v2 (déjà validé par les deux vérifications indépendantes) :
- `watchViewerLineRows` (renommé depuis `watchSubgridLineRowCollapse`) déjà en place.
- `ResizeObserver` sur `root.host` : documenter explicitement qu'il couvre DEUX causes indépendantes (C7a reflow CSS pur, C7b `ResizeManager` interne de Pierre mutant des attributs `style` invisibles au `MutationObserver` `childList`-only) — pas une seule, pour éviter qu'un futur refactor en retire une moitié en pensant l'autre suffisante.
- Coalescer dans un seul `requestAnimationFrame`, lire toutes les hauteurs avant d'écrire les `gridTemplateRows` (déjà fait, à revalider par test).
- Tests : ligne simple, ligne vide, dernière ligne, fichier vide, lignes longues wrapées, resize étroit/large, changement desktop/mobile — inchangé.

### Phase 5 — Observers de tokens ET readiness coalescés (= ancienne Phase 3, scope étendu pour couvrir C8)

- [ ] Remplacer le scan complet `querySelectorAll` de `watchViewerTokenStyles` par une file de nœuds ajoutés, coalescée en `requestAnimationFrame`.
- [ ] **Étendre explicitement à `notifyShadowReady`** (C8, absent de la Phase 3 originale) : éviter de re-scanner tout le Shadow DOM à chaque callback du `MutationObserver` interne — s'arrêter dès la première condition "prêt" stable, ou utiliser le dernier `MutationRecord` pour vérifier localement au lieu d'un `querySelectorAll` complet.
- [ ] Garder un scan complet uniquement à l'initialisation ou si la mutation ne permet pas d'identifier les nœuds ajoutés.
- [ ] Vérifier que les styles inline Shiki restent présents après plusieurs rerenders.

### Phase 6 — Rendu Pierre incrémental / teardown propre (= ancienne Phase 4, scope corrigé)

**Correction de scope importante (C6)** : un rendu Pierre incrémental sur l'instance existante ne résout QUE le cas où `ViewerPanel` reste monté et seul le contenu change (mécanisme secondaire). Il ne résout PAS le cas dominant du flux édition→Ctrl+S, qui est un démontage Solid complet via `<Show when={!editing()}>`. Cette phase doit donc :

1. **Décider explicitement** si `ViewerPanel` doit rester monté pendant la transition édition↔lecture (masquer/afficher au lieu de démonter/remonter) — gain potentiellement plus important que le rendu incrémental Pierre lui-même, mais changement plus structurel (`file-tabs.tsx`, `<Show>` → `class="hidden"` ou équivalent). Évaluer l'impact sur le cycle de vie CodeMirror (ne doit pas rester monté en double).
2. Si le remount Solid reste la solution retenue (plus simple, moins risqué) : au minimum transférer proprement le contenu final à la nouvelle instance sans passer par un conteneur vidé visible (`innerHTML = ""` déjà fait, mais vérifier qu'aucune frame blanche n'est visible).
3. **Corriger C4** : appeler `workerManager.cleanUpPendingTasks(this)` dans le cleanup côté app (ou proposer un correctif à la lib si elle l'expose), à l'image de `DiffHunksRenderer.cleanUp()` — évite la contention sur le pool de workers partagé lors de sauvegardes/changements de fichier rapprochés.
4. Fusionner le rerender des annotations avec le rendu principal pour éviter la double passe `active.rerender()` puis `find.refresh()` (inchangé du plan v1).
5. Ne pas ajouter de garde-fou de version supplémentaire pour "rendu obsolète écrasant le plus récent" — C4-bis confirme que ce n'est pas reproductible aujourd'hui (4 garde-fous déjà présents).

### Phase 7 — Mesure et validation finale

- Compléter l'instrumentation Phase 0 avec les métriques encore manquantes (nombre de remounts, nombre de recalculs, nombre de scans DOM, durée totale des scans, nombre de tâches pending, nombre de callbacks annulés).
- Réactiver et faire passer `session-review.spec.ts` (retirer `test.fixme`).
- Validation réelle desktop + APK Android (voir section 10).

---

## 7. Matrice de cas de figure (edge cases exhaustifs)

| Catégorie | Cas | Couvert par quelle phase | Statut avant ce plan |
|---|---|---|---|
| Cache/contenu | Même longueur, contenu différent | Phase 1 | ✅ Fix en place (checksum) |
| Cache/contenu | Contenu identique sauvegardé deux fois | Phase 1 | ✅ `areFilesEqual` fait déjà un early-bail dans `File.render()` |
| Cache/contenu | Fichier vide (`checksum` → `undefined`) | Phase 1 | 🟡 Comportement safe mais cache Pierre désactivé en permanence (C9) — à documenter |
| Cache/contenu | Fichier très volumineux | Phase 1 + Phase 2 (perf checksum) | 🔴 checksum recalculé plusieurs fois par interaction (C2) |
| Cache/contenu | Collision de hash 32 bits | Phase 1 (doc) | 🟡 Résiduel, probabilité très faible, à documenter (C10) |
| Cycle de vie | Montage initial | Phase 6 | ✅ |
| Cycle de vie | Remount édition→lecture (dominant) | Phase 6 | 🔴 Non couvert par un rendu incrémental seul (C6) |
| Cycle de vie | Démontage pendant rendu (fenêtre settleFrames) | Phase 3 | 🔴 Non couvert (C3) |
| Cycle de vie | Cleanup appelé deux fois | Phase 3/6 | À tester — `clearReadyWatcher`/`cleanUp()` doivent être idempotents |
| Cycle de vie | Aucun callback après destruction | Phase 3 | 🔴 Non garanti aujourd'hui (C3) |
| Sauvegarde | Sauvegarde simple | Phase 2 | 🔴 Latence du double round-trip SDK (C1) |
| Sauvegarde | Sauvegardes rapides successives | Phase 2 | 🔴 Risque de perte silencieuse de frappes si `eff.type === "none"` (C11) |
| Sauvegarde | Sauvegarde avec latence simulée | Phase 0 (instrumentation) | À tester une fois Phase 0 en place |
| Sauvegarde | Erreur SDK write | déjà géré (`eff.type === "error"` → toast) | ✅ |
| Sauvegarde | Store miroir à jour avant SDK reload | Phase 2 | 🔴 Actuellement l'inverse (C1) |
| Resize | Resize avant/pendant/après rendu | Phase 4 | ✅ scheduler RAF déjà en place, à re-tester |
| Resize | Reflow CSS pur sans mutation DOM | Phase 4 | ✅ Couvert par `ResizeObserver` (C7a) |
| Resize | `ResizeManager` interne Pierre (mutation invisible au MutationObserver) | Phase 4 | ✅ Couvert par le même `ResizeObserver` mais pour une raison distincte à documenter (C7b) |
| Resize | Rotation mobile simulée | Phase 4 | À valider sur device réel (Phase 7) |
| `notifyShadowReady` | Rendu partiel puis complet | Phase 5 | À tester |
| `notifyShadowReady` | Scan interrompu après succès | Phase 5 | 🔴 Scan complet à chaque callback aujourd'hui (C8) |
| `notifyShadowReady` | Cleanup avant succès | Phase 3 | 🔴 Non garanti (C3) |
| Concurrence worker | Pool partagé, tâche obsolète après changement de fichier rapide | Phase 6 | 🔴 Pas de `cleanUpPendingTasks` (C4) — contention, pas corruption |
| Concurrence worker | Rendu obsolète écrasant le plus récent | — | ✅ Non reproductible, 4 garde-fous déjà présents (C4-bis) |
| Parité | Desktop Chrome vs Android WebView, mêmes hauteurs/numéros | Phase 4 + 7 | À valider sur device réel |
| Parité | Mode édition : scroll horizontal conservé, pas de wrap forcé | Hors scope (ne pas toucher) | ✅ à ne pas régresser |

---

## 8. Tests obligatoires (corrigés — la ligne "validation actuelle" du plan v1/v2 est fausse, voir C12)

**Ne pas répéter l'erreur de la v1/v2** : ne citer un test comme "validation" que s'il a été lu et confirmé pertinent. Actuellement AUCUN test existant ne couvre la réactivité du viewer read-only.

### A. Contenu et cache
- même longueur, contenu différent → deux `cacheKey` différents, deux rendus corrects ;
- contenu identique sauvegardé deux fois → pas de re-render Pierre (vérifier via un spy sur `render()`/le worker) ;
- fichier vide → `cacheKey` undefined géré sans crash, 1 ligne affichée ;
- modification d'une seule ligne → seule cette ligne change visuellement ;
- gros fichier → mesurer le nombre d'appels à `checksum()` par interaction (sélection incluse) — doit être ≤1 par changement réel de contenu après le fix Phase 1/C2.

### B. Cycle de vie
- montage, remount (édition→lecture), démontage pendant rendu, cleanup avant tâche, cleanup après tâche, cleanup appelé deux fois, **aucun callback après destruction** (test spécifique pour C3 : démonter pendant la fenêtre `settleFrames`, vérifier zéro nouvel Observer créé).

### C. Sauvegarde
- sauvegarde simple → mesurer `editing-false timestamp` et vérifier qu'il ne dépend pas d'un round-trip SDK évitable (test pour C1, potentiellement avec un mock de `sdk.client.file.read`/`readRaw` retardé, assertion sur le fait que le viewer devient visible avec le bon contenu sans attendre ce mock) ;
- sauvegardes rapides successives → **test spécifique pour C11** : déclencher `handleCtrlS` deux fois avant résolution du premier, vérifier qu'aucune frappe n'est perdue silencieusement et que le mode édition ne se ferme pas sur un save no-op ;
- erreur SDK write → reste en édition, toast affiché (déjà couvert, à revalider) ;
- mise à jour du store miroir → `FileStore` à jour de manière synchrone après `save()` ;
- viewer recevant le contenu final, absence d'ancien contenu visible après validation.

### D. Resize
- resize avant/pendant/après rendu, `ResizeObserver` + `MutationObserver` simultanés, rotation mobile simulée, changement de largeur répété, absence de boucle infinie.

### E. `notifyShadowReady`
- rendu partiel puis complet, mutation multiple dans une même frame, scan interrompu après succès, cleanup avant succès (lié à C3), gros fichier sans explosion du nombre de scans.

### F. Parité
- desktop, Android (si les outils de test le permettent), affichage read-only, mode édition séparément avec scroll horizontal conservé.

### G. Réactivation
- `packages/app/e2e/session/session-review.spec.ts` : retirer `test.fixme` (ligne 351), faire passer réellement, pas juste réactiver et ignorer un échec.

---

## 9. Critères de réussite

- le contenu affiché correspond toujours au dernier contenu sauvegardé ;
- deux contenus de même longueur ne partagent jamais incorrectement le même rendu ;
- **la latence entre save-complete et viewer-ready est mesurée, et le round-trip SDK redondant (C1) est soit supprimé soit justifié explicitement s'il reste nécessaire** ;
- la vue read-only est stable dès son apparition, hauteurs correctes sans correction visible ultérieure ;
- les numéros de ligne restent alignés, y compris sur lignes wrapées/multi-hauteur ;
- resize desktop et Android recalcule correctement, sans boucle ResizeObserver/MutationObserver ;
- aucune tâche (RAF, Observer, worker, callback) ne continue après destruction du viewer (C3 corrigé) ;
- sauvegardes rapides successives ne provoquent ni contenu obsolète ni perte silencieuse de frappes (C11 tranché) ;
- le mode édition conserve son scroll horizontal, ses couleurs, pas de régression CodeMirror ;
- aucune régression TypeScript/Biome/test ;
- les tests couvrent réellement la réactivité (section 8), pas seulement le rendu statique — et la liste de tests citée comme "passés" a été relue individuellement, pas supposée pertinente par son nom.

---

## 10. Validation

Dans `packages/app` : `bun typecheck` + `bun test`.
Dans `packages/ui` : `bun typecheck` + `bun test`.
Si la suite complète est trop longue, exécuter au minimum les tests ciblés listés section 8 et indiquer précisément ceux qui n'ont pas tourné.

Desktop :
- `TEMP`/`TMP` → `D:\App\OpenCode\.build-temp` ;
- builder depuis le worktree courant, pas depuis `opencode-cache-verification` ;
- vérifier timestamps/chemins des artefacts, vérifier que le raccourci barre des tâches pointe vers le build courant ;
- validation visuelle réelle uniquement après ouverture effective de l'app.

Android :
- identifier l'APK réellement généré, vérifier son timestamp ;
- installer, vérifier `lastUpdateTime` sur l'appareil ;
- tester : sauvegarde, passage affichage/édition, resize/rotation, gros fichier ;
- screenshot si nécessaire ;
- distinguer explicitement validations locales / desktop / device réel.

Ne jamais déclarer une validation desktop ou Android réussie sans preuve réelle (timestamp d'artefact, capture, log).

---

## 11. Risques et garde-fous

- `ResizeObserver` peut déclencher pendant un layout : ne jamais écrire directement dans son callback, uniquement planifier une frame.
- Les fichiers virtuellement rendus ne doivent pas être mesurés comme s'ils étaient entièrement montés ; limiter le correctif aux lignes présentes.
- Les changements de thème peuvent modifier la line-height ; déclencher une nouvelle mesure sans reconstruire le renderer.
- Un contenu vide ou un langage inconnu doit rester affichable sans worker.
- Toute optimisation doit préserver sélection, annotations, recherche, scroll restoration et hover utilities.
- **Nouveau** : la Phase 2 (pipeline de sauvegarde) a le blast radius le plus large de ce plan — ne pas l'appliquer sans suivre la procédure "Architectural change discipline" du AGENTS.md (graphify path, lecture de call-sites, confirmation de scope explicite avec l'utilisateur).
- **Nouveau** : ne pas supprimer `file.load({force:true})` globalement — `onDiscard` et d'autres appelants (tab activation, watcher) en ont structurellement besoin. Le fix de C1 doit être ciblé sur le chemin `onSave` spécifiquement, pas une suppression générale.
- **Nouveau** : ne pas fusionner C1 et C11 dans le même commit si leur risque respectif diverge trop — C11 est un fix local dans `editor-panel.tsx` (faible risque), C1 touche potentiellement `context/`.

---

## 12. Ordre de livraison recommandé

1. Phase 0 — instrumentation (mesure avant optimisation).
2. Petits fixes chirurgicaux, faible risque, indépendants : C2 (mémoïser l'objet `file`), C3 (bump token dans `clearReadyWatcher`), C11 (garde `eff.type === "none"`).
3. Décision sur la Phase 2 (pipeline de sauvegarde, C1) avec l'utilisateur, à la lumière des mesures Phase 0 — appliquer seulement après confirmation de scope.
4. Phase 4 (lignes dynamiques — déjà largement faite, revalider par tests).
5. Phase 5 (observers de tokens + `notifyShadowReady` coalescés, C8).
6. Phase 6 (rendu Pierre incrémental / `cleanUpPendingTasks`, C4, décision sur le maintien du montage pendant édition↔lecture).
7. Phase 7 — instrumentation complète + validation réelle desktop/Android + réactivation de `session-review.spec.ts`.
8. Review multi-IA avec ce plan et le diff final.

---

## 13. Brief à copier-coller pour les IA reviewers

> Revois ce plan et le diff associé comme un reviewer senior spécialisé UI réactive (SolidJS + Shadow DOM + Web Workers). Le plan a déjà été vérifié deux fois indépendamment par lecture directe du code source (app + lib tierce `@pierre/diffs` vendée) — les causes listées section 4 citent toutes un fichier:ligne vérifié, pas une inférence. Concentre ta review sur : (1) la justesse du fix proposé pour le pipeline de sauvegarde à 3 stores (section 3, cause C1) et son impact sur les autres appelants de `file.load()` ; (2) la mémoïsation de l'objet `file` (C2) et si elle peut casser la réactivité fine-grained Solid existante ; (3) la correction du `token` dans `notifyShadowReady`/`clearReadyWatcher` (C3) et si elle couvre bien tous les chemins de démontage ; (4) le fix `eff.type === "none"` dans `handleCtrlS` (C11) et s'il peut introduire une régression sur le flux normal ; (5) l'appel manquant à `cleanUpPendingTasks` (C4) et s'il existe une API publique de la lib pour ça sans la patcher ; (6) toute race entre le remount Solid (`<Show>`) et les phases Pierre/worker restantes. Vérifie aussi : fichiers vides, très gros fichiers, virtualisation, wrap après resize, thème clair/sombre, sélection/annotations/recherche/scroll restoration, parité desktop Chrome/Android WebView, et que la stratégie de tests (section 8) couvre réellement chaque cause listée section 4 — pas seulement des tests qui passent par coïncidence. Signale chaque problème avec sévérité, fichier/lignes, scénario reproductible et correctif recommandé. Ne valide aucune affirmation "test passé" sans avoir lu le test cité et confirmé qu'il exerce réellement le mécanisme concerné.

---

## 14. Décision attendue après review

Le correctif ne sera considéré terminé qu'après : tests automatisés réellement pertinents (section 8), validation desktop réelle, build APK, installation du dernier APK sur le téléphone, vérification visuelle du même fichier wrapé sur les deux plateformes, et mesure chiffrée de la latence save→viewer-ready avant/après (Phase 0/7).

---

## 15. Historique (addenda précédents, conservés pour traçabilité — contenu déjà intégré ci-dessus)

<details>
<summary>v1 — plan initial + addendum review Claude (2026-07-16, avant consolidation)</summary>

Voir git history de ce fichier pour le texte intégral du plan v1 et de son premier addendum ("Addendum review Claude — corrections intégrées"). Toutes les conclusions utiles ont été reprises dans les sections 3-4 ci-dessus.

</details>

<details>
<summary>v2 — vérification indépendante n°1 (2026-07-16)</summary>

Rapport complet avec citations fichier:ligne : `d:\tmp\review-plan-viewer-reactivity-verification.md`. Toutes les conclusions ont été reprises dans la table section 4 (colonne "Source: Vérif. #1").

</details>
