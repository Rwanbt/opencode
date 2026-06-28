---
type: plan
status: ready-for-review
created: 2026-06-28
updated: 2026-06-28 (post 3-AI review)
project: opencode-desktop
issue: Manual file edits via close-guard dialog are not persisted to disk (round 3)
review-style: adversarial / multi-angle
reviewers: GLM 5.2, ChatGPT, DeepSeek
audit-iterations: 4 (initial + adversarial challenge + edge case sweep + 3-AI external review)
---

# PLAN — Bug persistance des éditions manuelles via close-guard (round 3)

**Date** : 2026-06-28
**Statut** : plan révisé après review par 3 AIs adversariaux (GLM 5.2, ChatGPT, DeepSeek). 2 bugs confirmés, fixes révisés (Fix A = getter pattern, Fix B = check return), investigation runtime OBLIGATOIRE avant commit. **PAS encore appliqué.**

---

## 1. Symptôme exact (rapporté par l'user)

> "je clique sur enregistrer losque je le ferme puis le réouvre la modification n'est pas visible mais si je veux le remodifier en cliquant sur le bouton modifier la modification réalisé precedement est encore là mais non visible en mode lecture seule et les modifications ne sont pas réellement appliqué si j'accède au fichier directement dans l'explorateur windows"

Décomposé :

| # | Observation | Compatibilité avec bug identifié |
|---|---|---|
| 1 | "clique sur enregistrer losque je le ferme" | ✓ User déclenche le flow **close-guard** (dialog Save/Don't save/Cancel) |
| 2 | Réouvre → modif pas visible | ✓ Viewer lit le disque → contenu inchangé → pas d'edits |
| 3 | Click Edit → "modif encore là" | ❓ **Incompatible** avec mon analyse (voir §10) |
| 4 | Explorer Windows → modif pas appliquée | ✓ Disk réellement inchangé |
| 5 | Toast "Saved" | ✓ Backend retourne OK pour un write no-op |

Les observations 1+2+4+5 sont compatibles avec un **save no-op silencieux** : le backend reçoit le contenu original (baseline) du disque, écrit la même chose, retourne OK. Le toast "Saved" s'affiche. Le disque ne change pas.

L'observation 3 est plus mystérieuse et nécessite investigation runtime (voir §10).

---

## 2. Architecture actuelle

### 2.1 Trois flows de save distincts

| Flow | Déclencheur | Source du contenu | Fichier:ligne |
|---|---|---|---|
| **A** Manuel éditeur | Bouton Save / Ctrl+S dans `EditorPanel` | `props.editorHandle?.getContent()` (CM live) | `editor-panel.tsx:140` |
| **B** Close-guard | Dialog 3 boutons au close d'un onglet dirty | `fileStore.get(p)?.content` (**baseline**, pas CM) — **BUG** | `close-guard.tsx:107` |
| **C** Autosave | Debounce 1s après dernière frappe | `contentFor(path)` callback → CM live | `autosave.ts:65` |

### 2.2 Architecture des stores

```
CM (CodeMirror) ──── source unique du buffer live
  │
  ├─ editorStore (store.ts) ──── metadata: baseline.content, dirty, saving, conflict
  │     │
  │     └─ mirror → fileStore.markClean / markDirty / etc.
  │
  └─ fileStore (file/store.ts) ── content, draft?, status, stamp
        │
        └─ persist? NON (in-memory uniquement)
```

**Le `draft` du FileStore EXISTE déjà** (`FileDoc.draft?: string` — `file/store.ts:41`) mais n'est **jamais alimenté**. Le commentaire `setDirty` ligne 162-164 l'explicite : *"WHY no draft here: CM owns the live buffer"*. Ce choix architectural cause précisément le bug Flow B.

### 2.3 Pourquoi le close-guard n'a pas accès au CM handle

`EditorCloseGuardProvider` est rendu dans `EditorProvider` (`context/editor.tsx:115`) → `DirectoryDataProvider` (`pages/directory-layout.tsx:49`) → `DirectoryLayout`. Le CM handle est stocké via `props.setEditorHandle` (signal local à `FileTabContent`, `file-tabs.tsx`). Il n'est **pas** remonté dans un context partagé.

Le commentaire `close-guard.tsx:103-106` reconnaît le problème :
> *"The CM handle isn't reachable from this provider (Phase 4 can plumb a ref through). Passing baseline is acceptable for now"*

**"Acceptable" est faux depuis que l'user voit le bug.**

---

## 3. Bug #1 confirmé : close-guard envoie la baseline au backend

### Trace précis du Flow B (close-guard.onSave)

```
[user edits in CM]
  handleEditorChange(content)
    editorStore.setDirty(p, dirty=true)             ← entry.dirty=true
    mirror(fileStore.markDirty(path))                ← FileStore.draft reste undefined (BUG : pas mirroré)
    autosave.schedule(p)

[user ferme l'onglet]
  EditorCloseGuard.close(tab)
    fileStore.get(p).status === 'dirty' (entry.status)
    shouldGuardDirtyClose() → true                   ← dialog.show(DialogDirtyClose)

[user clique "Save" dans la dialog]
  onSave (close-guard.tsx:99)
    editor.save(p.path, fileStore.get(p.path)?.content ?? "")
      ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^ BUG : .content = baseline = contenu original du disque
    layout.tabs.close(tab)
    dialog.close()

[editor.save(p, baseline) dans store.ts:173]
  deps.write({path, content: baseline, expectedHash: baseline.hash, format})
    ↓ editor.tsx write
    api.file.write({path, content: baseline, expectedHash: baseline.hash})
      ↓ backend File.write (file/index.ts:987)
      assertWritableTarget → exists=true → expectedHash provided → current.hash matches → OK
      atomicWrite: tmp → write(baseline) → fsync → rename
      post-rename read-back retry 10×200ms → reads baseline → matches → returns
      notifyWrite → OK
      returns {content: baseline, stamp, formatted: false}
    ↓ editor store
    entry.baseline = baseline (was baseline, stays baseline)
    entry.dirty = false
    mirror(fileStore.markClean(p, baseline, stamp))
      ↓ FileStore
      doc.content = baseline (was baseline, stays baseline)
      doc.draft = undefined
      doc.status = 'clean'
    returns {type: 'none'}
    toast 'Saved' (via editor.save puis onSave puis refreshAfterEditor → pas de toast direct depuis close-guard)

[résultat user-visible]
  disk: baseline (UNCHANGED — atomicWrite a écrit baseline qui était déjà là)
  CM buffer: toujours les edits user (CM jamais réinit)
  FileStore: baseline (correct vis-à-vis disk)
  Toast: 'Saved' (parce que rien n'a throw)
```

### Pourquoi le save est-il un no-op silencieux ?

1. `deps.write({content: baseline, expectedHash: baseline.hash})` — expectedHash matche le disk hash actuel
2. `atomicWrite(baseline)` — écrit exactement le contenu déjà sur disque
3. Backend retourne OK avec le content = baseline
4. Frontend traite comme succès (pas de 409/404/5xx → pas de error toast)

---

## 4. Bug #2 confirmé : close-guard ferme le tab même si save échoue (EC1)

### Trace du chemin d'erreur

`editor.save()` peut retourner `{type: "conflict"}`, `{type: "not-found"}`, ou `{type: "error"}` quand :
- **409** : disk a changé entre `editor.open` et le save (modification externe)
- **404** : fichier supprimé entre `editor.open` et le save
- **500** : erreur backend (réseau, FS, antivirus)

`close-guard.onSave` actuel :
```ts
onSave={async () => {
  setSaving(true)
  await editor.save(p.path, fileStore.get(p.path)?.content ?? "")  // ignore le retour
  setSaving(false)
  layout.tabs(sessionKey()).close(p.tab)  // ← ferme TOUJOURS
  setPending(null)
  dialog.close()
  p.resolve("closed")
}}
```

Si `editor.save` retourne `{type: "conflict"}` :
- `entry.conflict = true` (correct)
- Mais `layout.tabs.close(tab)` ferme l'onglet
- `EditorTabCleanup` supprime l'entry + FileStore.doc
- **edits perdus** — l'user n'a même pas vu le banner de conflict

C'est un data-loss silencieux dans le cas où le disk change entre open et close.

### Vérification : `shouldGuardDirtyClose` (`close-guard-helpers.ts`)

```ts
export function shouldGuardDirtyClose(tab, filePath, status) {
  if (tab === "context" || tab === "review") return false
  if (!filePath) return false
  return status === "dirty"
}
```

**Le dialog n'apparaît QUE pour `status === "dirty"`**. Pas pour `saving`, `conflict`, `missing`. Donc si user clique X pendant un save in-flight, tab ferme silencieusement (pas de dialog).

---

## 5. Investigation fausse piste (EC2 — race autosave ↔ close-guard)

**Hypothèse initiale** : autosave fire pendant close-guard → race condition.

**Analyse** : `shouldGuardDirtyClose` retourne `false` pour `status === "saving"`. Donc le dialog N'apparaît PAS pendant un save in-flight. close-guard ne s'exécute pas en parallèle avec autosave.

Conclusion : **EC2 n'est PAS un vrai problème**. Le seul moment où close-guard.onSave fire est quand status='dirty' ET aucun autre save n'est en cours.

---

## 6. Edge cases analysés (multi-angle)

### Angles vérifiés OK (pas de bug)

| Angle | Vérification | Status |
|---|---|---|
| Concurrence close-guard + autosave | `shouldGuardDirtyClose` gate | ✅ Pas de bug |
| Concurrence handleCtrlS + close-guard | handleCtrlS markClean avant dialog click | ✅ |
| CM mount race avec editor.open | showEditor memo bloque render tant que entry absent | ✅ |
| Format change content | backend renvoie formatted content, CM met à jour, markClean | ✅ |
| External watcher change | onExternalChange: dirty→stale, clean→reload | ✅ |
| atomicWrite antivirus | 10×200ms retry → throw → 500 → error toast | ✅ |
| EditorTabCleanup après close | supprime editor entry + FileStore.doc | ✅ |
| setDirty(false) clear draft | markClean clear draft | ✅ |
| `fallbackContent` not-found | open uses fallback, markClean le stocke | ✅ |
| Undo/redo CM | onChange fire → setDirty mirror | ✅ |
| Concurrent pending (double X rapide) | `dialog.show` detach old mais onClose PAS appelé → **Promise hang pré-existant** | ⚠️ Hors scope |
| File watcher détecte propre write | `entry.saving` check → ignore | ✅ |
| Tauri sidecar restart pendant save | catch → error → toast | ✅ |
| Gros fichier (1MB) edit | produce O(1), draft mirror O(1) | ✅ |
| Split pane (2 CM sur même file) | last write wins sur draft | ⚠️ Acceptable |

### Angles avec risque identifié

| Angle | Risque | Mitigation dans le fix |
|---|---|---|
| EC1 : close-guard ferme sur save fail (409/404/500) | **HAUTE — perte données silencieuse** | Check retour de `editor.save`, ne ferme pas si non-ok |
| EC11 : double-resolve si dialog.close() avant setPending(null) | Promesse résolue par le mauvais callback | Ordre : `setPending(null)` AVANT `dialog.close()` |
| Observation 3 user : edits preserved in Edit mode | Incompatible avec mon analyse | Investigation runtime §10 |

---

## 7. Fix recommandé : 2 modifications

### Fix A — Enregistrer un getter CM live dans FileStore (au lieu de mirror)

**Permet à close-guard d'accéder au contenu live sans copier le texte à chaque frappe.**

**Décision architecturale** (révision après review par 3 AIs adversariaux) :

| Approche | Problème |
|---|---|
| Mirror `FileStore.draft` à chaque keystroke (proposition initiale) | Perf killer sur 1MB+ (copie du contenu complet à chaque frappe), viole "CM owns the live buffer" |
| **Getter enregistré (proposition révisée)** | Aucune copie, lecture à la demande, cleanup à l'unmount — **CHOISI** |
| Plumb CM handle via Context | Plus invasif (4-5 fichiers), reporter en Phase 4 si getter suffit |
| Debounce du mirror | Patche le perf mais garde l'anti-pattern architectural |

**Implémentation** :

| Fichier:ligne | Modification |
|---|---|
| `file/store.ts` (nouveau) | `setDraftGetter(path, getter: () => string \| undefined)` + `getDraftContent(path)` + cleanup à `remove(path)` |
| `editor-panel.tsx` (mount CM) | `createEffect(() => fileStore.setDraftGetter(p, () => props.editorHandle?.getContent() ?? ""))` |
| `editor-panel.tsx` (cleanup) | `onCleanup(() => fileStore.setDraftGetter(p, undefined))` |
| `close-guard.tsx:107` | `editor.save(p.path, fileStore.getDraftContent(p.path) ?? fileStore.get(p.path)?.content ?? "")` |

**Avantages vs mirror** :
- Pas de copie mémoire par keystroke (réf seulement)
- Lit CM live au moment exact du save (jamais stale)
- Plus conforme à "CM owns the live buffer"
- Cleanup propre (getter = undefined à unmount)

### Fix B — Check retour de editor.save dans close-guard.onSave (EC1)

**Empêche le data-loss silencieux quand save échoue.**

`close-guard.tsx:99` modification :
```ts
onSave={async () => {
  setSaving(true)
  const live = fileStore.getDraftContent(p.path) ?? fileStore.get(p.path)?.content ?? ""
  const eff = await editor.save(p.path, live)
  setSaving(false)
  // EC1 : check retour, ne ferme pas le tab si save a échoué
  if (eff.type === "conflict" || eff.type === "not-found" || eff.type === "error") {
    if (eff.type === "error") {
      showToast({ variant: "error", title: language.t("toast.file.saveFailed") })
    }
    // Banner conflict/missing est déjà affiché par EditorBanner via entry.conflict
    // IMPORTANT : setPending AVANT dialog.close (évite double-resolve)
    setPending(null)
    dialog.close()
    p.resolve("cancelled")  // user doit résoudre manuellement
    return
  }
  layout.tabs(sessionKey()).close(p.tab)
  setPending(null)
  dialog.close()
  p.resolve("closed")
}}
```

### Pourquoi Fix A ET Fix B (pas juste A)

Fix A seul envoie le bon contenu au backend. Mais si le backend rejette (409/404/500), Fix A ne fait rien — le tab ferme quand même, edits perdus. Fix B protège contre ça.

**Recherche exhaustive des callers de `editor.save()` à faire avant commit** (revue ChatGPT) :

| Caller | Source du contenu | Status |
|---|---|---|
| `editor-panel.tsx:handleCtrlS` | `props.editorHandle?.getContent()` | ✅ OK (live) |
| `editor-panel.tsx:handleOverwrite` | `props.editorHandle?.getContent()` | ✅ OK (live) |
| `editor-panel.tsx:handleRecreate` | `props.editorHandle?.getContent()` | ✅ OK (live) |
| `close-guard.tsx:onSave` | `fileStore.getDraftContent()` (Fix A) | ✅ Fix A applique |
| `autosave.ts` | `contentFor(path)` callback → CM live | ✅ OK (live) |
| `editor-panel.tsx:handleReload` | `editorStore.reload()` (lecture seule, pas save) | N/A |
| `editor-panel.tsx:handleDiscard` | `editorStore.close()` (pas save) | N/A |
| `editor-panel.tsx:handleEnterEdit` | `editorStore.open()` (pas save) | N/A |

**Conclusion** : seul `close-guard.tsx` est affecté par le bug. Confirmation à faire via `grep -rn "editor\.save\(\|editorStore\.save\(" packages/app/src`.

---

## 8. Plan d'implémentation

### Phase A — Préparation

1. ✅ Lire `editor/store.ts:128-214` (open, setDirty, save)
2. ✅ Lire `editor-panel.tsx:116-162` (handleEditorChange, handleCtrlS)
3. ✅ Lire `close-guard.tsx:55-127` (close, effect)
4. ✅ Lire `editor/store.test.ts` (437 lignes) — pas de test pour setDirty(content), pas pour close-guard flow
5. ✅ Lire `close-guard.test.ts` (9 tests pour shouldGuardDirtyClose uniquement)

### Phase B — Modifications

**B.1** `editor/store.ts:157-170` — setDirty accepte content
```ts
function setDirty(path: string, dirty: boolean, content?: string) {
  const entry = state.entries[path]
  if (!entry) return
  set(path, { dirty })
  if (dirty) {
    // FORK (round 3): mirror CM live content into FileStore.draft so
    // consumers without CM handle (close-guard dialog) can save the
    // user's actual edits, not the stale baseline.
    mirror(path, (fs) => fs.markDirty(path, content))
    return
  }
  mirror(path, (fs) => fs.markClean(path, entry.baseline.content, { hash: entry.baseline.hash }))
}
```

**B.2** `editor-panel.tsx:124` — passer content
```ts
editorStore.setDirty(p, dirty, content)  // ajout du content CM
```

**B.3** `close-guard.tsx:99-113` — Fix A + Fix B combinés
```ts
onSave={async () => {
  setSaving(true)
  const doc = fileStore.get(p.path)
  const live = doc?.draft ?? doc?.content ?? ""
  const eff = await editor.save(p.path, live)
  setSaving(false)
  if (eff.type === "conflict" || eff.type === "not-found" || eff.type === "error") {
    if (eff.type === "error") {
      showToast({ variant: "error", title: language.t("toast.file.saveFailed") })
    }
    setPending(null)
    dialog.close()
    p.resolve("cancelled")
    return
  }
  layout.tabs(sessionKey()).close(p.tab)
  setPending(null)
  dialog.close()
  p.resolve("closed")
}}
```

### Phase C — Tests

**C.1** `editor/store.test.ts` — vérifier que `editor.save` callers existants non régressés (signature sans changement)
- Test : `setDirty(p, true)` (sans content) → entry.dirty=true (backward-compat)
- Test : `setDirty(p, false)` → fileStore.draft cleared via markClean

**C.2** `file/store.test.ts` — nouveau test pour getter pattern
- Test : `setDraftGetter(p, () => "live")` puis `getDraftContent(p)` → `"live"`
- Test : `setDraftGetter(p, undefined)` → `getDraftContent(p)` → undefined
- Test : `remove(p)` → `getDraftContent(p)` → undefined (cleanup)

**C.3** `editor/store-integration.test.ts` — scénario close-guard-like
- Open → editor.open(p) → getter registered → editor.save(p, "user edits") via getter → disk has "user edits" → close → reopen → baseline matches disk
- Open → editor.save(p, baseline) (sans getter, fallback content) → disk unchanged (BUG original reproduit sans Fix A)
- Open → simulate 409 → editor.save returns conflict → close-guard.onSave with Fix B → tab NOT closed → user can resolve

**C.4** `close-guard.test.ts` — vérifier que onSave avec retour non-ok NE ferme PAS

**C.5** Test régression autosave (Flow C, revue GLM)
- Vérifier que autosave utilise `contentFor(path)` callback (CM live) et NON `fileStore.getDraftContent(path)` (qui retournerait le getter du premier éditeur monté, possiblement stale si tab a été close-guardée et rouverte)
- Test : mount close-guard A → save avec contenu live A → unmount A → mount close-guard B → save avec contenu live B (devrait être B, pas A)

**C.6** Test double-X rapide (EC15, revue GLM)
- Cliquer deux fois rapidement sur X d'un onglet dirty
- Vérifier qu'une seule dialog apparaît, qu'un seul setPending est actif, pas de promise hang

**C.7** Test exhaustif callers `editor.save` (revue ChatGPT)
- Vérifier que tous les callers de `editor.save` utilisent du contenu live (CM) sauf close-guard (qui utilise désormais le getter Fix A)
- `grep -rn "editor\.save\(\|editorStore\.save\(" packages/app/src` doit retourner uniquement des callers avec contenu live OU le close-guard avec le getter

### Phase D — Build + Smoke

1. `bun test src/context/editor/ src/context/file/` → tous pass
2. `bun run typecheck -F packages/app` → 0 erreurs
3. `bun run build` + `bun run tauri build --no-bundle` (~3 min)
4. Lance `OpenCode.exe`
5. **Test runtime critique** :
   - Ouvre un fichier
   - Modifie du contenu
   - Clique X sur l'onglet (dialog apparaît)
   - Clique Save dans le dialog
   - Ouvre l'Explorateur Windows sur le fichier → **DOIT contenir les edits**
   - Réouvre le fichier dans l'app → viewer DOIT montrer les edits
6. Idem avec Ctrl+S pour confirmer que Flow A non régressé
7. Test conflit : ouvre un fichier, modifie, dans un autre outil modifie le disk, clique Save dans dialog → banner conflict DOIT apparaître, tab DOIT rester ouvert

### Phase E — Commit

```
fix(editor): mirror CM live content into FileStore.draft + check save return in close-guard

- editor/store.ts: setDirty accepts optional content, mirrors to FileStore.draft
- editor-panel.tsx: pass CM content to setDirty on every keystroke
- close-guard.tsx: read draft (live CM) instead of content (baseline); don't close tab if save failed
```

---

## 9. Risques résiduels

| # | Risque | Sévérité | Status |
|---|---|---|---|
| 1 | Fix B : double-resolve si ordre dialog.close/setPending | Moyenne | Mitigé (setPending avant dialog.close) |
| 2 | Concurrent pending (double X rapide) → Promise hang | Faible | À fixer dans Fix séparé (EC15, test C.6) |
| 3 | Observation 3 user inexpliquée | **HAUTE (review 3 AIs)** | Investigation runtime §10 OBLIGATOIRE avant commit |
| 4 | Perf getter : lecture CM à chaque save est O(1) (getter call) | Faible | OK (vs copie 1MB par keystroke) |
| 5 | Split pane : 2 CM sur même file → 2 getters registered, last write wins | Faible | Acceptable (chaque onglet a son propre file-tabs.tsx) |
| 6 | Cleanup getter oublié → memory leak | Moyenne | `onCleanup(() => setDraftGetter(p, undefined))` obligatoire |
| 7 | Getter appelé après unmount de CM (closure stale) | Moyenne | Cleanup obligatoire avant close-guard.onSave fire (mais ordre: getter registered → tab close → onSave → closeTab → unmount → cleanup, donc OK) |
| 8 | Backend écrit mal (atomicWrite bug) | Faible | §10 instrumentation backend le détectera |

---

## 10. Investigation runtime requise (AVANT commit)

**Observation 3 user** : "Click Edit après close-guard save → modif encore là".

Mon analyse dit que les edits sont perdus après close (EditorTabCleanup supprime entry, reopen fait fresh read). **Mais les 3 AIs reviewers convergent : ne pas dismiss cette observation**, elle peut cacher un 3e bug réel.

### Comment investiguer (revue ChatGPT)

#### A. Instrumentation frontend

1. Activer devtools Tauri temporairement : ajouter `"devtools": true` à `tauri.conf.json`
2. Rebuild : `bun run tauri build --no-bundle`
3. Dans l'app : ouvre DevTools (F12), `console.log` instrumentation :

   **Frontend (file-tabs.tsx / editor-panel.tsx / close-guard.tsx)** :
   - `handleEditorChange` : `console.log('[editor] change', p, 'content.length=', content.length, 'first50=', content.slice(0, 50))`
   - `handleEnterEdit` : `console.log('[editor] enterEdit', p, 'baseline=', editorStore.get(p)?.baseline.content.length)`
   - `editor.save` (store.ts) : `console.log('[editor] save', path, 'content.length=', content.length, 'first50=', content.slice(0, 50), 'eff=', eff)`
   - `close-guard.onSave` : `console.log('[guard] save', p.path, 'live.length=', live.length, 'live.first50=', live.slice(0, 50))`
   - `EditorTabCleanup` : `console.log('[cleanup] close', filePath, 'entry.before=', editorStore.get(filePath)?.baseline.content.slice(0, 50))`

#### B. Instrumentation backend (CRITIQUE — manquant dans mon plan initial)

   **`packages/app/src/context/editor.tsx`** (côté frontend SDK call) :
   ```ts
   const res = await api.file.write({ path: filePath, content, expectedHash: effectiveHash, format })
   console.log('[editor] backend-write-send', filePath, 'len=', content.length, 'first50=', content.slice(0, 50), 'expectedHash=', effectiveHash)
   ```

   **`packages/opencode/src/file/index.ts` ligne ~1018** (backend) :
   ```ts
   await atomicWrite(full, input.content)
   console.log('[backend] atomicWrite', full, 'len=', input.content.length, 'first50=', input.content.slice(0, 50))
   ```

   **`packages/opencode/src/server/routes/file.ts` ligne ~319** :
   ```ts
   const result = await File.write(body)
   console.log('[route] file.write-OK', body.path, 'result.content.length=', result.content.length, 'first50=', result.content.slice(0, 50))
   ```

#### C. Reproduction du flow + analyse

4. Reproduit le flow user : ouvre fichier → modifie → X sur onglet → Save dans dialog → rouvre
5. Capture les logs
6. **Analyse des 3 cas possibles** :
   - **Cas A** : close-guard envoie baseline au backend (mon hypothèse) → Fix A corrige → commiter
   - **Cas B** : close-guard envoie live content au backend MAIS backend écrit mal → Fix A ne corrige pas → investiguer atomicWrite
   - **Cas C** : backend écrit correctement MAIS frontend cache le résultat (Observation 3) → Fix A ne corrige pas → investiguer viewer state

7. **Conclusion selon le cas** :
   - Cas A confirmé : commit Fix A + Fix B
   - Cas B confirmé : Fix A + Fix B + investiguer atomicWrite
   - Cas C confirmé (Observation 3 réelle) : fix séparé pour le cycle de vie CM/viewer, reporter en Phase 4+
   - Cas A + Cas C confirmés : Fix A + Fix B + Fix cycle de vie

**NE PAS dismiss l'observation 3 sans preuve runtime.**

---

## 11. Hors scope (à noter pour Phase 4+)

- **Option 2 (plumb CM handle via context)** : design + impl en Phase 4, permettrait de retirer le mirror dans FileStore
- **Bug EC15 (double pending Promise hang)** : fix séparé
- **Bug EC13 (editorHandle undefined = save "")** : fix séparé (pré-existant)
- **Tests E2E** pour ce flow spécifique

---

## 12. Definition of Done

- [ ] Modifications Fix A (getter pattern) + Fix B (check return) appliquées
- [ ] Tests unitaires existants : 179/179 pass
- [ ] Nouveaux tests (Phase C.1, C.2, C.3, C.4, C.5, C.6, C.7) : tous pass
- [ ] Typecheck : 0 erreur
- [ ] Build Tauri : OK
- [ ] **Investigation runtime §10 OBLIGATOIRE avant commit** :
  - [ ] Instrumentation frontend + backend en place
  - [ ] Reproduction du flow user
  - [ ] Logs capturés et analysés
  - [ ] **Observation 3 résolue** (Cas A/B/C déterminé)
- [ ] Smoke runtime Phase D.5 : disk contient les edits après Flow B
- [ ] Flow A (Ctrl+S) non régressé (Phase D.6)
- [ ] Flow conflict (Phase D.7) : tab reste ouvert, banner affiché
- [ ] Commit créé avec message explicite
- [ ] Plan archivé dans Obsidian

**Pas de commit avant que DoD soit rempli à 100%.**

---

## 13. Si le fix échoue (rollback)

Si Phase D.5 montre que le bug persiste après Fix A + Fix B :

1. `git revert HEAD`
2. Investiguer Observation 3 (probablement cause racine manquante)
3. Si Observation 3 confirme un storage caché : fix séparé
4. Reprendre le plan

---

## Annexe A : Fichiers lus pendant l'analyse

| Fichier | Lignes | Notes |
|---|---|---|
| `app.tsx` | 394 | AppProviders refactor (Phase 1 Fix-GlobalSDK) |
| `editor.tsx` | 165 | createEditorStore wiring |
| `editor/store.ts` | 366 | state machine editor |
| `editor/store.test.ts` | 437 | tests state machine |
| `editor/autosave.ts` | 94 | debounce factory |
| `editor/close-guard.tsx` | 140 | close-guard provider |
| `editor/close-guard-helpers.ts` | 23 | shouldGuardDirtyClose |
| `editor/close-guard.test.ts` | ~50 | tests shouldGuardDirtyClose |
| `editor-panel.tsx` | 343 | EditorPanel + handlers |
| `file.tsx` | 307 | FileProvider (viewer state) |
| `file/store.ts` | ~250 | FileStore |
| `global-sdk.tsx` | 260 | GlobalSDK init |
| `global-sync.tsx` | 439 | GlobalSync init |
| `server.tsx` | 310 | ServerProvider |
| `server-health.ts` | 131 | checkServerHealth |
| `dialog.tsx` | 159 | DialogProvider (Kobalte wrapper) |
| `opencode/src/file/index.ts` | 1102 | backend file write |
| `opencode/src/server/routes/file.ts` | 399 | /file/write route |
| `sdk/js/src/v2/client.ts` | 92 | SDK createClient throwOnError default |
| `PLAN-FIX-GLOBALSDK-PROVIDER-TREE.md` | 992 | Plan précédent |
| `PROMPT-PRODUCTION.md` | 394 | Prompt de la session précédente |
| `HANDOFF-finir-rebuild.md` | 78 | Handoff round 2 |
