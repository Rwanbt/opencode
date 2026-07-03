---
type: plan
status: ready-for-review
created: 2026-06-29
project: opencode-desktop
feature: Auto-exit edit mode after successful save (UX)
related: PLAN-EDITEUR-IDE-FIX-SAVE-2026-06-28.md (persistence fix round 3)
---

# PLAN — Auto-exit edit mode after successful save

**Date** : 2026-06-29
**Statut** : plan d'implémentation prêt. ~30 lignes de code touchées, 1 fichier principal (`editor-panel.tsx`), risque très faible. Pas de review adversariale multi-AI prévue (trop petit).

---

## 1. Symptôme exact (rapporté par l'user)

> "j'aimerais que lorsque je clique sur le bouton enregistrer quand je suis en train de modifier un fichier, qu'il rebascule automatiquement en mode lecture"

Décomposé :

| # | Observation | Couverture du plan |
|---|---|---|
| 1 | User clique **Save** (bouton ou Ctrl+S) en mode édition | ✅ Fix A |
| 2 | User s'attend à voir le viewer (lecture seule), pas CM | ✅ Fix A — `<Show when={!editing()}>` côté `file-tabs.tsx:255` |
| 3 | Comportement actuel : save OK mais reste en mode édition | ❌ Bug UX — confirmé par recherche |

Hors scope de cette demande :
- Autosave → ne doit PAS déclencher l'exit (silencieux, transparent)
- Close-guard Save → ferme déjà le tab (exit effectif)
- Conflict → ne PAS exit (banner doit rester visible)
- Missing → ne PAS exit (banner recreate/discard doit rester)

---

## 2. Architecture actuelle (état avant fix)

### 2.1 Trois flows de save + un cas particulier

| Flow | Déclencheur | Sortie aujourd'hui | Fix ? |
|---|---|---|---|
| **A** Manuel (bouton + Mod-s) | `handleCtrlS` `editor-panel.tsx:170-195` | Reste en edit mode | ✅ **Fix A** — `setEditing(false)` après succès |
| **B** Close-guard dialog | `onSave` `close-guard.tsx:121` | Ferme le tab | ⏭ Pas touché (exit déjà effectif via tab close) |
| **C** Autosave | `autosave.ts:65` | Fire-and-forget, pas de toast | ⏭ Pas touché (transparent — user n'a pas demandé) |
| **D** Overwrite (conflict resolve) | `handleOverwrite` `editor-panel.tsx:208-224` | Reste en edit mode | ✅ **Fix B** — `setEditing(false)` après succès |

### 2.2 Le signal `editing`

```
FileTabContent (file-tabs.tsx:61)
  const [editing, setEditing] = createSignal(false)
        ↓ props.editing / props.setEditing
  ┌─────────────────────┬──────────────────────┐
  │ EditorPanel         │ ViewerPanel          │
  │ (CM + Save + Banner)│ (File component)     │
  │ rendu si editing()  │ <Show when=!editing> │
  └─────────────────────┴──────────────────────┘
```

- **Pas de champ `mode` dans l'editor-store entry** — c'est un signal local Solid.
- **Le pattern existant** pour "exit edit mode" est `props.setEditing(false)`. Cf. `handleDiscard` `editor-panel.tsx:230` et rollback de `handleEnterEdit` `editor-panel.tsx:144`.

### 2.3 Pourquoi l'exit ne se produit pas aujourd'hui

`handleCtrlS` se termine par `showToast({ variant: "success", title: ... })` (ligne 191) sans toucher au signal `editing`. Le user voit donc "Saved" puis reste en CM.

**Trace complet d'un Ctrl+S réussi (avant fix)** :
```
user: Ctrl+S
  CM keymap (code-mirror.tsx:185-191) → props.onSave → handleCtrlS
  editorStore.save(p, content, format) → {type: "none"} (eff)
  applyDocEffect(eff) — no-op si pas de format change
  props.onSave() → refreshAfterEditor → file.load(p, {force:true})
  showToast('toast.file.saved')
  ← editing() reste true → CM reste rendu → user perplexe
```

---

## 3. Fix proposé

### Fix A — `handleCtrlS` exit après succès (PRINCIPAL)

**Fichier** : `packages/app/src/pages/session/editor-panel.tsx`
**Ligne** : 170-195 (entre 184 et 195)
**Modification** : ajouter `props.setEditing(false)` après le toast succès, et JAMAIS dans le branch erreur/conflict/missing.

```ts
const handleCtrlS = async () => {
  const p = props.path()
  if (!p) return
  const content = props.editorHandle?.getContent() ?? ""
  const format = settings.general.formatOnSave()
  try {
    const eff = await editorStore.save(p, content, format)
    applyDocEffect(eff)
    if (eff.type === "conflict" || eff.type === "missing" || eff.type === "error") {
      if (eff.type === "error") {
        showToast({ variant: "error", title: language.t("toast.file.saveFailed") })
      }
      return                                        // ← PAS de setEditing(false) ici
    }
    await props.onSave()                           // refresh fileStore AVANT exit
    showToast({ variant: "success", title: language.t("toast.file.saved") })
    props.setEditing(false)                         // ← AJOUT (Fix A)
  } catch {
    showToast({ variant: "error", title: language.t("toast.file.saveFailed") })
  }
}
```

### Fix B — `handleOverwrite` exit après succès

**Fichier** : `packages/app/src/pages/session/editor-panel.tsx`
**Ligne** : 208-224
**Modification** : ajouter `props.setEditing(false)` après le success path.

```ts
const handleOverwrite = async () => {
  const p = props.path()
  if (!p) return
  const content = props.editorHandle?.getContent() ?? ""
  try {
    const eff = await editorStore.resolveConflict(p, content, "overwrite")
    applyDocEffect(eff)
    if (eff.type === "error") {
      showToast({ variant: "error", title: language.t("toast.file.saveFailed") })
      return                                        // ← PAS de setEditing(false) ici
    }
    await props.onOverwrite()                       // refresh fileStore AVANT exit
    props.setEditing(false)                         // ← AJOUT (Fix B)
  } catch {
    showToast({ variant: "error", title: language.t("toast.file.saveFailed") })
  }
}
```

### Pas de Fix C (autosave / close-guard) — justifications

| Caller | Pourquoi PAS d'exit |
|---|---|
| `autosave.ts:65` | Fire-and-forget. User n'a pas déclenché manuellement → il ne s'attend pas à sortir du mode édition par une save background. Autosave doit rester 100 % transparent. |
| `close-guard.tsx:121` | Ferme le tab → `EditorTabCleanup` unmount tout → exit effectif. Ajouter `setEditing(false)` ici n'aurait aucun effet (composant démonté). |

### Pas de Fix D (handleRecreate / handleDiscard / handleReload)

| Caller | Comportement actuel | Pourquoi garder |
|---|---|---|
| `handleRecreate` (ligne 234) | Reste en edit mode | User vient de "recréer" un fichier deleted — il veut continuer à éditer. Exit serait surprenant. |
| `handleDiscard` (ligne 226) | Exit déjà | OK, ne pas toucher. |
| `handleReload` (ligne 197) | Reste en edit mode | User a explicitement choisi de prendre la version disk → veut continuer à éditer. Exit serait surprenant. |

---

## 4. Séquence après fix

### Flow A — Ctrl+S sur fichier dirty (cas principal)

```
[user: Ctrl+S]
  CM keymap → props.onSave → handleCtrlS
  editorStore.save(p, live, format)
    → disk has user edits
    → {type: "none"}
  applyDocEffect(eff) (no-op si pas de format)
  if (eff conflict|missing|error) return    ← court-circuit, pas d'exit
  await props.onSave()
    → refreshAfterEditor
    → fileStore.load(p, {force: true})       ← viewer rechargera avec le bon contenu
  showToast('toast.file.saved')
  props.setEditing(false)                     ← AJOUT Fix A
    → reactive: ViewerPanel <Show> monte
    → EditorPanel <Show> démonte (CM unmount proprement)
    → EditorBanner démonte (n'est plus gated sur editing())
[user voit: viewer + toast 'Saved']
```

### Flow D — Overwrite (conflict resolve)

```
[user: clique "Overwrite disk" sur banner conflict]
  handleOverwrite
  editorStore.resolveConflict(p, content, "overwrite")
    → re-lit disk pour hash frais
    → save(p, content) avec nouveau expectedHash
    → {type: "none"}
  applyDocEffect(eff)
  if (eff.error) return
  await props.onOverwrite() → fileStore.refresh
  props.setEditing(false)                     ← AJOUT Fix B
[user voit: viewer + disk = version user]
```

### Flow conflict — banner reste

```
[user: Ctrl+S mais disk a changé entre-temps]
  editorStore.save → {type: "conflict"}
  applyDocEffect(eff) (no-op)
  return                                       ← setEditing(false) NOT appelé
[user voit: CM reste monté + EditorBanner conflict visible]
```

Idem pour `missing` et `error`.

---

## 5. Edge cases analysés

| Cas | Comportement avec fix | Verdict |
|---|---|---|
| Ctrl+S sur fichier clean (pas d'edits) | Save no-op `{type: "none"}` → exit edit mode | ✅ Acceptable — user a explicitement demandé save, exit est cohérent |
| Save + formatOnSave reformatte | applyDocEffect met à jour CM, save OK, exit | ✅ OK |
| Save mais disk a changé (conflict) | exit PAS déclenché, banner visible | ✅ Conforme spec user |
| Save mais fichier supprimé (missing) | exit PAS déclenché, banner recreate/discard | ✅ Conforme spec user |
| Save mais erreur backend (500) | exit PAS déclenché, error toast | ✅ Conforme spec user |
| Save OK mais format change le contenu (plus de lignes que CM) | applyDocEffect déjà géré, viewer rend correctement | ✅ OK |
| Mod-s spam pendant un save en cours | bouton `disabled={saving}`, keymap return true | ✅ Pas de double-save |
| User clique Save puis immédiatement ré-entre en edit mode (pencil) | `handleEnterEdit` → `editorStore.open` → state propre | ✅ OK (re-mount complet du CM, contenu frais) |
| Tab multi-files : save sur file A, pas sur file B dirty | `editing` est par-tab, isolé | ✅ Pas d'effet de bord |
| Split pane (2 CM sur même file hypothétique) | 2 onglets = 2 `editing` signals distincts | ✅ OK |
| Exit edit mode + autosave mid-flight | autosave fire dans un createEffect — quand `dirty=false` il se cancel (l. 276-282) | ✅ Pas de save orpheline |
| Exit edit mode + dirty reste à true (race) | Impossible — `editorStore.save` set `entry.dirty=false` synchrone avant le return | ✅ OK |

---

## 6. Plan d'implémentation

### Phase A — Préparation

1. ✅ Lire `editor-panel.tsx:170-195` (handleCtrlS)
2. ✅ Lire `editor-panel.tsx:208-224` (handleOverwrite)
3. ✅ Lire `editor-panel.tsx:226-232` (handleDiscard) — pattern de référence
4. ✅ Lire `file-tabs.tsx:201-267` (ViewerPanel / EditorPanel branching)
5. ✅ Lire `close-guard.tsx:121-146` — vérifier qu'on n'a rien à changer
6. ✅ Lire `autosave.ts:55-68` — vérifier qu'on n'a rien à changer
7. ⏭ Tests existants `editor-panel.test.tsx` (s'il existe) — vérifier scope des mocks

### Phase B — Modifications

**B.1** `editor-panel.tsx:190` — après le `showToast('Saved')`, ajouter `props.setEditing(false)`

**B.2** `editor-panel.tsx:220` — après le `await props.onOverwrite()`, ajouter `props.setEditing(false)`

### Phase C — Tests

**C.1** `editor-panel.test.tsx` (nouveau OU à créer) — handleCtrlS success path
- Mock `editorStore.save` → `{type: "none"}`
- Render EditorPanel avec `props.editing = true`, `props.setEditing = spy`
- Trigger Save (button click ou Mod-s)
- Assert `spy` called with `false`
- Assert toast.success fired
- Assert `props.onSave()` called (refresh)

**C.2** `editor-panel.test.tsx` — handleCtrlS conflict path (régression)
- Mock `editorStore.save` → `{type: "conflict"}`
- Trigger Save
- Assert `spy` NOT called (setEditing reste true)
- Assert EditorBanner rendu (conflict visible)
- Assert `props.onSave()` NOT called (pas de refresh inutile)

**C.3** `editor-panel.test.tsx` — handleCtrlS error path
- Mock `editorStore.save` → `{type: "error"}`
- Trigger Save
- Assert `spy` NOT called
- Assert toast.error fired avec 'saveFailed'

**C.4** `editor-panel.test.tsx` — handleOverwrite success
- Mock `editorStore.resolveConflict` → `{type: "none"}`
- Render avec entry.conflict = true (banner visible), click "Overwrite disk"
- Assert `spy` called with `false`

**C.5** `editor-panel.test.tsx` — handleOverwrite error
- Mock → `{type: "error"}`
- Assert `spy` NOT called

**C.6** Test intégration : double-click file → edit → Ctrl+S → viewer visible
- Setup : FileTabContent monté sur un path, double-click → edit mode
- Action : dispatch Mod-s
- Assert : ViewerPanel rendu (pas EditorPanel), fileStore.content = user edits

**C.7** Test non-régression autosave
- Setup : edit mode, autosave activé
- Action : typing (autosave fire 1s après)
- Assert : `editing` reste true (autosave ne doit PAS exit)

### Phase D — Build + Smoke runtime

1. `bun test packages/app/src/pages/session/` → tous pass
2. `bun test packages/app/src/context/editor/` → tous pass
3. `bun run typecheck -F packages/app` → 0 erreur
4. `bun run build` + `bun run tauri build --no-bundle`
5. Lance `OpenCode.exe`
6. **Tests runtime critiques** :
   - Ouvre un fichier (double-click) → edit mode
   - Modifie du contenu
   - **Ctrl+S** → viewer apparaît, toast "Saved", contenu visible dans viewer
   - **Bouton Save** dans toolbar → idem
   - Modifie à nouveau, conflict simulé (modifie disk via Explorer) → Ctrl+S → **reste en CM**, banner conflict visible
   - Sauve OK + fichier missing (delete via Explorer) → Ctrl+S → reste en CM, banner recreate visible
   - Sauve OK sur fichier clean (sans edits) → Ctrl+S → exit edit mode (acceptable)
   - Conflict → "Overwrite disk" → viewer apparaît
   - Modifie + autosave activé + attente 2s → reste en CM (autosave transparent)

### Phase E — Commit

```
feat(editor): auto-exit edit mode after successful save

When the user saves (Ctrl+S or Save button) and the backend returns
{type: "none"} (success), flip the local `editing` signal to false
so the viewer re-mounts and the editor (CodeMirror) unmounts.

Behavior matrix:
- save OK (none)              → exit edit mode  [NEW]
- overwrite OK (conflict)     → exit edit mode  [NEW]
- save conflict / missing / error → stay in edit mode (banner visible)
- autosave fire-and-forget    → stay in edit mode (transparent)
- close-guard Save            → unchanged (closes tab)
- handleReload / handleRecreate / handleDiscard → unchanged

Why two callers:
- handleCtrlS: standard Save button + Mod-s (same handler)
- handleOverwrite: conflict resolution "Overwrite disk" button

Files: editor-panel.tsx (2 lines added)
```

---

## 7. Risques résiduels

| # | Risque | Sévérité | Mitigation |
|---|---|---|---|
| 1 | Save OK sur fichier clean exit edit mode (user surprit ?) | Très faible | Acceptable — Ctrl+S = user dit "j'ai fini". Si user veut continuer : pencil. |
| 2 | `setEditing(false)` appelé pendant un save en cours (race) | Impossible | `editorStore.save` est await-ed ; `setEditing(false)` n'arrive qu'après succès. Bouton `disabled={saving}`. |
| 3 | Viewer mount race avec fileStore.refresh | Très faible | `await props.onSave()` AVANT `setEditing(false)` → fileStore.content est frais quand viewer monte. |
| 4 | CM unmount mid-typing (cancellation) | Très faible | `editing()` flip → `<Show>` unmount CM → CM cleanup normal (autosave.cancel déjà wired). |
| 5 | handleOverwrite appelé quand `entry.conflict=false` | Impossible | Le bouton "Overwrite disk" n'est rendu que dans le banner conflict (editor-banner.tsx:62-79). |
| 6 | Tests existants cassent (setEditing devient required dans mocks) | Faible | Vérifier Phase A.7 avant commit. |

---

## 8. Hors scope (à noter pour Phase 4+)

- **Setting `editor.autoExitEditOnSave`** : opt-out pour users qui veulent rester en edit après save. Pas demandé.
- **Exit edit + focus next dirty file** (VSCode-like) : pas demandé.
- **Save + close tab** combo : pas demandé.
- **Persist `editing` signal across sessions** : non — `editing` est runtime-only.
- **Animation de transition CM → viewer** (fade, slide) : non demandé, focus sur fonctionnalité.

---

## 9. Definition of Done

- [ ] B.1 + B.2 appliquées
- [ ] Tests C.1 à C.7 passent (ou C.7 skip si pas d'autosave test existant)
- [ ] `bun run typecheck` : 0 erreur
- [ ] `bun run build` : OK
- [ ] Smoke runtime Phase D.6 : tous les scénarios OK
- [ ] Commit créé
- [ ] Plan archivé dans Obsidian (cf. `~/Obsidian/.../PLAN-EDITEUR-IDE-AUTOEXIT-EDIT-ON-SAVE-2026-06-29.md`)

---

## 10. Si le fix pose problème (rollback)

Si Phase D.6 montre un comportement inattendu :

```bash
git revert HEAD
```

Le diff est ~2 lignes — rollback trivial.

---

## Annexe A — Fichiers touchés

| Fichier | Type | Lignes modifiées |
|---|---|---|
| `packages/app/src/pages/session/editor-panel.tsx` | edit | +2 lignes (l. 191 et l. 220) |
| `packages/app/src/pages/session/editor-panel.test.tsx` (ou nouveau) | create | ~150 lignes (C.1-C.5) |

**Total code production** : 2 lignes.
**Total tests** : ~150 lignes nouvelles.

---

## Annexe B — Convention de nommage (suit les plans précédents)

- Fichier plan : `PLAN-EDITEUR-IDE-AUTOEXIT-EDIT-ON-SAVE-2026-06-29.md` (parallèle à `PLAN-EDITEUR-IDE-FIX-SAVE-2026-06-28.md`)
- Frontmatter `type: plan`, `status: ready-for-review`, `project: opencode-desktop`
- Commit message : `feat(editor): ...` (conventional commits, scope = editor)
- Pas de bump VERSION — c'est une feature additive, pas un breaking change.

---

## Annexe C — Note pédagogique

Ce plan illustre un pattern important du codebase opencode :

**Le signal `editing` est local à `FileTabContent`** — c'est un choix architectural délibéré. Chaque tab a son propre mode (on peut être en train d'éditer file A en mode édition et lire file B en mode viewer dans le même workspace). Le mode n'est PAS centralisé dans un store global parce que ça n'a pas de sens cross-tab.

Pour cette feature, on respecte ce choix : `setEditing(false)` est appelé localement par EditorPanel via la prop `props.setEditing`. Pas besoin de toucher au store.