# Plan définitif — Éditeur & gestion fichiers OpenCode (IDE fonctionnel, zéro dette)

> 📋 **Mirror vault** : [[OpenCode/Plan-Editeur-IDE-Definitif-2026-06-25]]
> 📋 **Règle vault** : [[_global/rules/rule-plans-vault|règle plans-vault]]
>
> Rédigé le 2026-06-25. Remplace `PLAN-CORRECTION-EDITEUR-FICHIERS.md` (patches B1–B4 = rustines).

## Suivi d'implémentation

| Phase | Statut | Commit | Notes |
|-------|--------|--------|-------|
| Phase 0 (R3 build) | ⏸ à faire | — | Bloquant. copy-sidecar.ts déjà amélioré par GLM mais pas les 3 autres sous-étapes. |
| **Phase 1 (R2 canonical)** | **✅ FAIT 2026-06-25** | `f46824090a` + `b1d2ac3131` | canonical.ts (frontend) + toCanonicalRelative (backend). 19 tests frontend + 3 tests backend. 129/129 packages/opencode/test/file/ verts. Reste : tools (write/edit/apply_patch) migrés en Phase 2. |
| Phase 2.1 (FileDoc contrat) | **✅ FAIT 2026-06-25** | `a93d6c6199` | Stamp gardé dans editor/store.ts. Stale absorbé dans `conflict`. Content = string + vcs séparé. 14 tests. 488/488 packages/app + 129/129 backend verts. |
| Phase 2.2 (trim backend retiré) | **✅ FAIT 2026-06-25** | `76efa186a7` | `.trim()` retiré à `file/index.ts:633`. Pas de `readText()` créé (audit : aucun consumer ne veut le trim). 3 tests backend patchés (ils asservaient le bug R1). 129/129 backend + 488/488 packages/app verts. |
| Phase 2.3 (unifier read/readRaw) | **✅ FAIT 2026-06-25** | `d8f8c1e998` | `read()` appelle `readRaw()` interne (via `Effect.promise` + `Effect.catch`). VCS mémo paresseux sera dans `FileDoc.vcs` côté frontend (2.4). 488/488 packages/app + 129/129 backend verts. |
| Phase 2.4a (context wrapper) | **✅ FAIT 2026-06-25** | `21de28e84e` | `createFileStore()` exposé via `createSimpleContext` → `useFileStore()` + `<FileStoreProvider>`. Aucun consommateur branché (fondation pure, 17 LOC). 488/488 packages/app verts. |
| Phase 2.4b-g + 2.5 + 2.6 | ⏸ partiel (2.5 fait) | — | 2.5 fait. Reste 2.4b-g (migration FileStore consumers) + 2.6 (close on tab) dans prochaine session dédiée. |
| Phase 2.5 (découper file-tabs.tsx) | **✅ FAIT 2026-06-25** | `ee487b732f` + `63cd4cd763` + `35c0fb606f` + `1564ca5b4c` + `20d8d38279` + `59bd5709ff` + `91625f1b17` | 972 → 427 LOC. 8 nouveaux fichiers : lsp-handlers.ts, rename-dialog.tsx, code-actions-panel.tsx, references-panel.tsx, editor-panel.tsx, viewer-panel.tsx, comments-overlay.tsx (factory pattern), file-keybindings.ts. + auto-edit.ts pour le module-level set. file-tabs.tsx sous alerte 500 (strict <300 cible non atteinte — glue LSP/rename/code-action reste inline ~120 LOC). |
| Phase 2.6 (editorStore.close tab close) | ⏸ à faire | — | `layout.tsx close(tab)` → `editorStore.close(path)`. Sans garde dirty pour l'instant (Phase 3). |
| Phase 3 (R5, R6 save/dirty) | ⏸ à faire | — | |
| Phase 4 (UI/conv) | ⏸ à faire | — | |
| Phase 5 (IDE features) | ⏸ à faire | — | |
| Phase 6 (tests CI) | ⏸ partiel | — | canonical.test.ts ✅, manque : non-régression open→save→close→reopen, watcher echo, dirty-close, invariants runtime. |

**Incident de session 2026-06-25 14h08** : `mavis-trash` a supprimé `D:\App\OpenCode\opencode` par erreur (path contenant `$null`). Récupération immédiate depuis Corbeille Windows via `robocopy` + `bun install`. Voir [[OpenCode/_review/2026-06-25 - Incident mavis-trash dossier opencode]].
> Ici on attaque les **causes racines architecturales**, pas les symptômes.
> Objectif : l'app devient un IDE où l'on code à la main (comme VS Code), pas seulement via l'IA.
> **Pas de MVP, pas de dette technique** : une source de vérité, des invariants vérifiés.

---

## 0. Le bug signalé (reproduit logiquement)

> « si je sauvegarde une modif, que je ferme le fichier, puis que je le réouvre,
> la modification n'est pas visible mais réapparaît lorsque je rebascule en édition. »

Symptôme décodé : **le mode lecture affiche du contenu STALE (pré-sauvegarde),
le mode édition affiche du contenu FRAIS (post-sauvegarde).** Donc :
- `editorStore.entries[p].baseline.content` (édition) = **NOUVEAU** ✓ (mis à jour par `save`)
- `store.file[p].content` (lecture, dans `file.tsx`) = **ANCIEN** ✗

C'est la preuve qu'**il existe DEUX caches de contenu indépendants** qui divergent.

---

## 1. DIAGNOSTIC COMPLÈTE (causes racines, prouvées par le code)

### R1 — CRITIQUE / ARCHITECTURAL : double cache de contenu divergent

Deux stores détiennent le contenu d'un même fichier, sans lien réactif :

| Store | Fichier | API backend | Utilisé par | Trim ? |
|---|---|---|---|---|
| **cache lecture** | `context/file.tsx` → `store.file[p].content` | `sdk.client.file.read` (`/file/read`) | viewer read-mode (`renderFile`) | **OUI** (`file/index.ts:633`) |
| **baseline édition** | `context/editor/store.ts` → `entries[p].baseline.content` | `api.file.readRaw` (`/file/readRaw`) | CodeMirror (`initialContent`) | **NON** (`file/index.ts:948`) |

La cohérence entre les deux n'est garantie que par **des appels manuels `file.load(p,{force:true})`** parsemés :
- `file-tabs.tsx:504` (handleCtrlS) — présent ✅
- `file-tabs.tsx:540` (handleDiscard) — présent ✅
- `handleRecreate` (`file-tabs.tsx:543`) — **ABSENT** ❌
- `handleOverwrite` (`file-tabs.tsx:521`) — **ABSENT** ❌
- `handleReload` (`file-tabs.tsx:511`) — **ABSENT** ❌
- rename / move (`operations.ts`) — refresh du **tree** seulement, **pas du cache contenu** ❌
- édition agent (tool write via le bus) — refresh via watcher **uniquement** ❌

**Conséquence** : tout chemin d'écriture qui oublie le `file.load` force laisse le viewer en lecture
STALE jusqu'à la prochaine fermeture/rouverture forcée. C'est inévitable : la synchro est
« souviens-toi de le faire à chaque endroit ». Une dette structurelle.

**Preuve de la divergence de rendu** : `file/index.ts:632-635`
```ts
const content = yield* appFs.readFileString(full).pipe(
  Effect.map((s) => s.trim()),   // ← TRIM appliqué au contenu lu
  Effect.catch(() => Effect.succeed("")),
)
```
alors que `readRaw` (`index.ts:948`) retourne le **contenu brut**. Donc read et edit
affichent **des bytes différents** pour le même fichier. Une modif en bord de fichier
(retour à la ligne final, indentation de tête, normalisation EOF — extrêmement courants)
est **silencieusement supprimée** en mode lecture puis **réapparaît** en édition.
→ Ce seul bug produit EXACTement le symptôme rapporté pour toute modif de bord.

### R2 — CRITIQUE / WINDOWS : normalisation de chemin incohérente (clés divergentes)

`context/file/path.ts:104-131` `normalize()` :
- préserve les **séparateurs natifs** du chemin d'entrée (`path.slice(root.length)`, l.119-120).

Or le chemin arrive avec des séparateurs différents selon la porte d'entrée :
- via **onglet** (`file://a/b.ts` décodé) → `/`
- via **watcher** (`Bus.publish(..., { file: full })` où `full = path.join(...)` natif) → `\` sur Windows

Donc sur Windows, `store.file` peut contenir **deux entrées** pour le même fichier :
`store.file["a/b.ts"]` (clé viewer) ET `store.file["a\\b.ts"]` (clé watcher). Le refresh
watcher (`watcher.ts:32` `ops.hasFile(path)`) écrit dans la clé `\`, que le viewer (clé `/`)
**ne lit jamais** → le refresh contenu est **silencieusement droppé**.

Le patch B2 (`operations.ts` parentDir/basename gère `\`) traite le symptôme de l'arbre,
**pas la cause** : la normalisation produit toujours des clés hétérogènes.

### R3 — CRITIQUE / BUILD : pipeline sidecar/frontend cassé → l'app qui tourne peut être stale

(cf. `HANDOFF-finir-rebuild.md`). Le source contient les patchs B1–B4, MAIS :
- `tauri.conf.json` `beforeBuildCommand = bun run build` (frontend seul) — le sidecar n'est
  **jamais recopié** vers `target/release/opencode-cli.exe` après un build.
- `copy-sidecar.ts` pointe vers une source **stale via junction** (disque C: plein).
- Résultat : `target/release/opencode-cli.exe` peut être le binaire du **7 mai** (sans write API)
  → `write` → 404 → mappé en « deleted on disk ». L'app runtime n'a **aucune** des corrections.

Tant que ce pipeline n'est pas déterministe, **tout fix frontend est non vérifiable**.
C'est le prérequis numéro un : un build reproductible.

### R4 — MAJEUR : pas de source unique → sync en bordel

`editorStore.close(p)` n'est **jamais appelé à la fermeture d'onglet** (`layout.tsx:963` `close`
ne touche pas à l'editor store). Seul `handleDiscard` le fait. Conséquence : les entrées
`entries[p]` **fuitent** (le baseline persiste ; un onglet rouvert retourne le baseline caché
au lieu de relire — `store.ts:94` `if (existing && !existing.missing) return baseline`).

### R5 — MAJEUR : sémantique de setting fausse

`file-tabs.tsx:493` : `const format = settings.general.autoSave()`. Le flag **« autoSave »**
est utilisé comme **flag « format on save »**. Or ce sont deux concepts distincts :
- autoSave = sauvegarde automatique temporisée (qui **n'existe pas** du tout aujourd'hui !)
- formatOnSave = reformater le fichier à la sauvegarde

Aucun des deux n'est correctement implémenté : `autoSave` pilote le formatage, et l'autosave
temporisé est absent. Réglage trompeur + feature IDE de base manquante.

### R6 — MAJEUR : pas de garde anti-perte à la fermeture d'onglet sale

`layout.tsx:963` `close(tab)` : **aucun** contrôle de `dirty`. Fermer un onglet avec des
modifications non sauvegardées les **détruit silencieusement**. Perte de données garantie
pour un IDE de codage manuel. VS Code demande confirmation ; ici : rien.

---

## 2. CE QUI EST MAL FAIT / MAL IMPLÉMENTÉ (audit)

### Code & conventions
- **Texte UI en dur en français** dans `file-tabs.tsx` : « Renommé en » (l.331),
  « Fichier courant mis à jour » (l.332), « Actions » (l.960), « Références » (l.1027),
  « Renommer en : » (l.991), « nouveau nom » (l.1002). **viole** AGENTS.md « English everywhere »
  et contourne le système i18n (`language.t(...)`). Bug d'internationalisation + dette.
- **`fetch` directs** vers `/lsp/completion`, `/lsp/rename`, `/lsp/code-action`,
  `/lsp/execute-command` (`file-tabs.tsx:237,314,357,398`) au lieu du SDK généré.
  Contourne l'auth/transport/typage du SDK → obligations de maintenance manuelle.
  → régénérer le SDK (`packages/sdk/js/script/build.ts`) avec ces endpoints.
- **Deux clients SDK** : global `throwOnError:true` (`sdk.tsx`) + dédié `throwOnError:false`
  (`editor.tsx:22`). Source de confusion (R1 a été causé par ça). Le non-throwing devrait
  être le défaut pour les opérations fichier.
- **Composants définis dans le corps de rendu** : `renderFile` (l.810) recréé à chaque
  passage. Le commentaire l.856 dit utiliser `Dynamic` pour l'éviter, mais `renderFile`
  reste une fermeture récréée. Fragile (remonter en module).
- **`file-tabs.tsx` = 1072 LOC** → dépasse le seuil « alerte >500 / refactor >800 »
  d'AGENTS.md. Mélange : scroll-sync, commentaires, LSP, rename, code-actions, références,
  éditeur, banners. **5+ responsabilités** → à découper.

### Architecture
- **Cache LRU global mutable** (`content-cache.ts`) avec des compteurs module-level (`let total`).
  État global → non testable isolément, fuites potentielles, ordre d'éviction implicite.
  Devrait vivre dans le `FileStore`.
- **`file.load` silent-skip** (`file.tsx:167` `if (!force && loaded) return`) : un fichier déjà
  chargé n'est JAMAIS rafraîchi à la réouverture d'onglet. Combiné à R1/R2 = stale garanti.
- **Watcher echo mal géré** : `onExternalChange` ignore via `entry.saving`, mais l'écho peut
  arriver APRÈS que `saving` soit repassé à `false` (race). La défense est temporelle, pas structurelle.

### Backend
- **`trim()` dans `read`** (R1) — transforme silencieusement le contenu à la frontière données.
- **Deux lecteurs** (`read` l.590+ et `readRaw` l.943) avec des sémantiques différentes
  (trim, type-detection base64, diff/patch git). Duplication de connaissance (anti-DRY).
- **`notifyWrite` synchrone dans le lock** (`index.ts:937`) publie un event watcher qui revient
  frapper le client → boucle de cohérence fragile (le client doit deviner « c'est mon echo »).

### Build/ops
- Pipeline sidecar non déterministe (R3).
- Aucun test E2E de la boucle edit→save→close→reopen. Les tests unitaires du store
  (`store.test.ts`) couvrent la machine à états mais **pas** la synchro read↔edit ni le watcher.

---

## 3. CE QUI MANQUE POUR UN IDE FONCTIONNEL (vs VS Code)

Classé par criticité pour « coder à la main » :

### Sauvegarde & intégrité (bloquant)
1. **Autosave temporisé** (après N ms d'inactivité) ET/OU on focus-loss — jamais aujourd'hui.
2. **Confirmation de fermeture d'onglet sale** (R6).
3. **Indicateur dirty sur l'onglet** (point/astérisque) — le tab UI ne reflète pas `editorStore.dirty`.
4. **« Revert File »** explicite (bouton/diff) au-delà de discard.

### Expérience d'édition
5. **Persistance des onglets ouverts** entre sessions (VS Code rouvre vos fichiers).
6. **Onglets épinglés / preview tabs** (open in preview, promote on edit).
7. **Recherche dans le fichier** fonctionnelle en mode lecture aussi (Ctrl+F intercepté seulement hors édition l.729).
8. **Recherche globale dans le projet** (Ctrl+Shift+F) — absent.
9. **Multi-curseurs / colonnes** : vérifier la couverture CM (présent côté CM, mais mappings clavier ?).
10. **Minimap**, **règle de pliage persistant**, **bracket pair colorization** (réglages CM).

### Navigation & projet
11. **Palette de commandes** (Ctrl+Shift+P) couvrant les actions fichier/éditeur.
12. **Quick Open** (Ctrl+P) par nom de fichier — la search existe côté backend, pas de UI dédiée.
13. **Go-to-symbol** dans le fichier (Ctrl+Shift+O) via LSP (déjà câblé pour definition).
14. **Terminal intégré** correct (existe partiellement — auditer).

### Cohérence & feedback
15. **Statut LSP visible** (diagnostics en continu, pas seulement on-demand).
16. **Sauvegarde en arrière-plan non bloquante** avec indicateur.
17. **Historique local/undo across reload** (VS Code retient l'undo après reopen via backups).

---

## 4. PLAN D'EXÉCUTION COMPLET (zéro dette, ordre strict)

> Principe directeur : **SOURCE UNIQUE DE VÉRITÉ**. Un seul `FileStore` détient le contenu
> brut (hash+stamp) par chemin canonique. Le buffer CodeMirror est un brouillon « au-dessus ».
> Read-mode et edit-mode lisent le MÊME store → divergence **structurellement impossible**.

### Phase 0 — Prérequis build (bloquant, R3)
Sans ça, aucun fix n'est vérifiable.
1. **Réparer le pipeline sidecar** : `copy-sidecar.ts` doit résoudre la source fraîche
   (pas via junction). Vérifier le junction (`Get-Item ... | Select LinkType,Target`) ;
   si présent, pointer la source vers le résolu réel
   `packages/opencode/dist/opencode-windows-x64/bin/opencode.exe`.
2. **`beforeBuildCommand`** = `bun run build && bun run precopy:sidecar` (frontend + sidecar).
3. **`cli.rs get_sidecar_path`** : fallback défense-en-profondeur vers `sidecars/` si le sibling
   est absent/stale (vérif : chaîne `File changed on disk since it was last read` présente).
4. **Build reproductible vérifié** : un seul `bun tauri build` produit un exe qui contient
   le frontend corrigé ET le sidecar frais (findstr sur les deux chaînes marqueurs).

### Phase 1 — Normalisation canonique des chemins (R2, à la racine)
Single source of truth pour la clé.
1. **Créer `context/file/canonical.ts`** : `canonical(raw): string` → toujours
   **forward-slash, relatif au scope, décodé, sans query/hash, sans `file://`**.
   Cette fonction est l'UNIQUE producteur de clé. Tout `path.normalize` actuel délègue vers elle.
2. **Backend watcher** : publier le chemin **relatif canonique** (`/`), pas l'absolu natif.
   Dans `notifyWrite`/`notifyDelete`, calculer `path.relative(Instance.directory, full)` puis
   `.split(path.sep).join("/")`. → le client reçoit déjà la bonne clé, plus de mismatch.
3. **Supprimer la logique « préserver séparateurs natifs »** de `path.ts:119-120`.
4. Tests : `canonical.test.ts` couvre win/posix, absolu/relatif, file://, git-quoted, query/hash.

### Phase 2 — Unifier le contenu : `FileStore` unique (R1, R4)
C'est le cœur du plan. On fusionne cache lecture + baseline édition.
1. **Nouveau `context/file/store.ts`** (remplace progressivement `file.tsx` content + `editor/store.ts`) :
   ```ts
   interface FileDoc {
     content: string        // BRUT (jamais trim), vérité disque connue
     stamp: Stamp           // hash + mtime + size
     status: "clean" | "dirty" | "saving" | "conflict" | "missing"
     draft?: string         // buffer live CodeMirror (undefined = propre = content)
   }
   ```
   - `draft` undefined ⇒ le rendu = `content`. `draft` défini ⇒ rendu édition = `draft`,
     rendu lecture = `content` (le disque). **Plus jamais deux caches indépendants.**
2. **`read(path)`** : appelle **`readRaw`** (brut) côté backend. Le diff/patch git devient
   un calcul dérivé **paresseux** (memo séparé), pas une mutation du contenu. → élimine R1-trim.
3. **Watcher** : un seul handler met à jour `FileDoc.content`+`stamp` (si `status==="clean"`),
   ou marque `stale`/`conflict` (si dirty). Plus de double-listener (editor.tsx + file.tsx).
4. **`save(path)`** : write → met à jour `content`+`stamp`+`status="clean"` dans LE store.
     Read-mode et edit-mode étant réactifs au même store, **les deux se rafraîchissent ensemble,
     sans aucun `file.load(force)` manuel**. On supprime tous les appels manuels (R1).
5. **Fermeture d'onglet** appelle `store.close(path)` (R4) — avec garde dirty (Phase 4).
6. **Backend `read`** : supprimer le `.trim()` (index.ts:633). Si du nettoyage d'affichage est
   voulu, le faire **dans le composant de rendu**, jamais dans la couche données.

### Phase 3 — Sauvegarde & intégrité (R5, R6, manquants #1–3)
1. **Split settings** : `autoSave` (bool temporisé) + `formatOnSave` (bool). Migration du store
   settings (clé existante `autoSave` → `formatOnSave`, nouveau `autoSave:false` par défaut).
2. **Autosave temporisé** : debounce 1s après dernière frappe (si `autoSave`), stoppé pendant
   save en cours, jamais si `conflict`/`missing`.
3. **Indicateur dirty sur l'onglet** : `SortableTab` lit `FileDoc.status==="dirty"` et affiche un point.
4. **Garde fermeture onglet sale** : `layout.tsx close(tab)` → si dirty, dialog « Save / Don't save / Cancel ».
5. **« Revert File »** : action commande remettant `draft=undefined` + reload.

### Phase 4 — Cohérence UI & conventions (R-code&conv)
1. **Extraire `file-tabs.tsx`** (1072 LOC) en modules : `editor-panel.tsx`, `rename-dialog.tsx`,
   `code-actions-panel.tsx`, `references-panel.tsx`, `lsp-handlers.ts`. Cible <300 LOC/fichier.
2. **Internationaliser** tout le texte FR en dur → `language.t(...)` + entrées `en.ts`/`fr.ts`.
3. **Régénérer le SDK** avec `/lsp/{completion,rename,code-action,execute-command}` ;
   remplacer les `fetch` directs par `sdk.client.lsp.*`. Typage + transport unifiés.
4. **Client SDK fichier non-throwant par défaut** pour les ops fichier (supprime la dualité).

### Phase 5 — Features IDE (manquants #5–17, par valeur)
- **Persistance onglets** : stocker la liste d'onglets par projet (localStorage / SQLite).
- **Quick Open (Ctrl+P)** : UI dédiée sur `sdk.client.find.files`.
- **Recherche globale (Ctrl+Shift+F)** : backend ripgrep existant → nouvelle UI.
- **Go-to-symbol (Ctrl+Shift+O)** : LSP `documentSymbol` (déjà câblable).
- **Statut LSP continu** : diagnostics poussés via le bus, badge dans la barre d'état.

### Phase 6 — Tests & invariants (obligatoire, pas optionnel)
1. **Test de non-régression du bug** : boucle `open → edit → save → close → reopen` asserte
   que read-mode === edit-mode === disque (intégration, deps mockées type `store.test.ts`).
2. **Test canonique** : `canonical()` déterministe跨 plateformes (win `\` vs posix `/`).
3. **Test watcher echo** : un write déclenche un event ; assert pas de boucle/stale.
4. **Invariant runtime** : `assert(FileDoc.content === readRaw(path))` après tout save/reload
   (debug_assert côté store). Un invariant non vérifié n'est qu'une promesse (AGENTS.md).
5. **Test dirty-close** : fermeture d'onglet sale déclenche le dialog.
6. Couverture : `bun test` dans `packages/app` après chaque phase.

---

## 5. ORDRE D'EXÉCUTION & VÉRIFICATION

```
Phase 0 (build)  ──► exe frais vérifiable (findstr des 2 marqueurs)
Phase 1 (paths)  ──► canonical.test.ts vert ; plus de clé `\` vs `/`
Phase 2 (store)  ──► test non-régression open→save→close→reopen vert
Phase 3 (save)   ──► autosave + dirty-close-guard ; settings migrés
Phase 4 (UI)     ──► file-tabs <300 LOC/fichier ; 0 texte FR en dur ; SDK lsp regen
Phase 5 (IDE)    ──► quick-open, search, symbols
Phase 6 (tests)  ──► invariants + non-régression en CI
```

Chaque phase est **indépendamment buildable et testable** (PR ≤400 LOC, AGENTS.md).
Aucune phase ne laisse de TODO/dette : on ne passe à la suivante qu'après tests verts.

## Critères d'acceptation finaux (le bug est MORT)
- [ ] Sauvegarder → fermer → rouvrir : la modif est visible **immédiatement** en lecture.
- [ ] Read-mode et edit-mode affichent **byte-à-byte** le même contenu (plus de trim-divergence).
- [ ] Fermer un onglet sale → dialog de confirmation.
- [ ] Onglet sale → point dirty visible.
- [ ] Autosave activable ; formatOnSave séparé.
- [ ] Build desktop déterministe (un seul `bun tauri build` → frontend + sidecar frais).
- [ ] Aucun texte UI en dur ; 0 `fetch` direct hors SDK ; `file-tabs` éclaté.
- [ ] Tests de non-régression verts en CI.
