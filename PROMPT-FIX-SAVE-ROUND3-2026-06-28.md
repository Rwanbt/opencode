# PROMPT PRODUCTION — Fix bug persistance des éditions manuelles via close-guard (round 3)

## 0. Contexte

Tu travailles sur le projet `D:\App\OpenCode\opencode\` (fork opencode).

**Bug user (rapporté pour la 3ème fois)** :
> "je clique sur enregistrer losque je le ferme puis le réouvre la modification n'est pas visible mais si je veux le remodifier en cliquant sur le bouton modifier la modification réalisé precedement est encore là mais non visible en mode lecture seule et les modifications ne sont pas réellement appliqué si j'accède au fichier directement dans l'explorateur windows"

**Cause racine identifiée après analyse adversariale** : `close-guard.tsx:107` envoie `fileStore.get(p)?.content` (= baseline, contenu original du disque) au backend au lieu du contenu live de CodeMirror. Le backend écrit la même chose → "Saved" OK → disk inchangé. Bug silencieux.

**Bug secondaire (EC1)** : `close-guard.onSave` ignore le retour de `editor.save`. Si 409/404/500, le tab ferme quand même → perte de données.

**Plan complet (à lire AVANT de coder)** :
- **Vault Obsidian** : `OpenCode/Plan-Fix-Close-Guard-Save-Round3-2026-06-28.md`
- **Vault path** : `D:\Documents\Obsidian\IA_Dev_Brain\OpenCode\Plan-Fix-Close-Guard-Save-Round3-2026-06-28.md`
- **Format** : markdown, 562 lignes, 13 sections. Lis-le ENTIÈREMENT avant de coder.
- **Review** : déjà révisé par 3 AIs adversariaux (GLM 5.2, ChatGPT, DeepSeek). Le plan intègre leurs retours.

**Travaux précédents dans cette session** :
- Fix GlobalSDK tree (commit/Phase précédente) — déjà appliqué et rebuild OK. NE PAS Y TOUCHER.
- Fichiers actuels : `app.tsx` (AppProviders refactor), `entry.tsx`, `desktop/src/index.tsx`, etc.

---

## 1. Contraintes d'environnement (CRITIQUES)

### Processus à NE JAMAIS toucher

```powershell
# PID 18756 — extension VS Code MiniMax Code (OpenCode dans VS Code)
# PID 23620 — opencode.exe qui héberge cette session (D:\IA\Opencode_officiel\bin\opencode.exe)
# Si tu dois killer des processus, filtre TOUJOURS :
Get-Process -Name "opencode*" | Where-Object { $_.Id -ne 18756 -and $_.Id -ne 23620 } | Stop-Process -Force
```

### Disk space

- C: peut être PLEIN → TOUJOURS set `TEMP` sur D: avant build :
```powershell
$env:TEMP = "D:\App\OpenCode\.build-temp"
$env:TMP = $env:TEMP
$env:TAURI_ENV_TARGET_TRIPLE = "x86_64-pc-windows-msvc"
New-Item -ItemType Directory -Force "D:\App\OpenCode\.build-temp" | Out-Null
```

### Plan complet déjà dans ton contexte local

- `D:\App\OpenCode\opencode\PLAN-EDITEUR-IDE-FIX-SAVE-2026-06-28.md` (copie locale du plan dans le repo fork)

---

## 2. Phase A — Lecture obligatoire AVANT de coder

Lis **dans cet ordre** :

1. `D:\Documents\Obsidian\IA_Dev_Brain\OpenCode\Plan-Fix-Close-Guard-Save-Round3-2026-06-28.md` (le plan complet, 562 lignes)
2. `D:\App\OpenCode\opencode\packages\app\src\context\editor\store.ts` (state machine, lignes 1-366)
3. `D:\App\OpenCode\opencode\packages\app\src\context\file\store.ts` (FileStore, lines 1-172)
4. `D:\App\OpenCode\opencode\packages\app\src\context\editor\close-guard.tsx` (close-guard, lines 1-140)
5. `D:\App\OpenCode\opencode\packages\app\src\pages\session\editor-panel.tsx` (EditorPanel, lines 1-343)

Lis aussi le rapport de review des 3 AIs (intégré dans le plan, sections 7, 9, 10) — surtout :
- § 7 Fix A révisé (getter pattern au lieu de mirror)
- § 9 Risque #3 "Observation 3 user inexpliquée"
- § 10 Investigation runtime OBLIGATOIRE avant commit

---

## 3. Phase B — Implémentation (4 modifications principales)

### B.1 — `file/store.ts` : ajouter getter pattern

Ajoute au store FileStore :

```ts
// Map des getters pour accéder au contenu live CM sans copier
const draftGetters = new Map<string, () => string | undefined>()

const setDraftGetter = (path: string, getter: (() => string | undefined) | undefined) => {
  if (getter === undefined) draftGetters.delete(path)
  else draftGetters.set(path, getter)
}

const getDraftContent = (path: string): string | undefined => {
  const g = draftGetters.get(path)
  return g ? g() : undefined
}
```

Et expose-les dans le `return { ... }` final.

Dans `remove(path)` AJOUTE `draftGetters.delete(path)` (cleanup obligatoire).

### B.2 — `editor-panel.tsx` : register le getter au mount CM

Localise la fonction `handleEditorChange` et AJOUTE un createEffect + onCleanup pour enregistrer le getter. Typiquement après les définitions de handlers :

```ts
import { createEffect, onCleanup } from "solid-js"  // vérifie imports

// Dans EditorPanel :
createEffect(() => {
  const p = props.path()
  if (!p) return
  const editorHandle = props.editorHandle
  fileStore.setDraftGetter(p, () => editorHandle?.getContent() ?? "")
})
onCleanup(() => {
  const p = props.path()
  if (p) fileStore.setDraftGetter(p, undefined)
})
```

### B.3 — `close-guard.tsx` : Fix A (utiliser le getter) + Fix B (check retour)

Remplace la fonction `onSave` (lignes 99-113) :

```tsx
onSave={async () => {
  setSaving(true)
  // FIX A (round 3): prefer FileStore.draftContent (live CM via getter)
  // over FileStore.content (baseline). Fallback to content if getter
  // unavailable (e.g., editor not yet mounted or already unmounted).
  const live = fileStore.getDraftContent(p.path) ?? fileStore.get(p.path)?.content ?? ""
  const eff = await editor.save(p.path, live)
  setSaving(false)
  // FIX B (EC1): check return, don't close tab if save failed
  if (eff.type === "conflict" || eff.type === "not-found" || eff.type === "error") {
    if (eff.type === "error") {
      showToast({ variant: "error", title: language.t("toast.file.saveFailed") })
    }
    // IMPORTANT: setPending AVANT dialog.close (évite double-resolve)
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

**IMPORTANT — Ajoute l'import `showToast`** si pas déjà présent en haut du fichier :
```tsx
import { showToast } from "@opencode-ai/ui/toast"
```

---

## 4. Phase C — Tests

### C.1 — `file/store.test.ts` : nouveau test getter pattern

Ajoute dans le `describe` approprié :

```ts
test("setDraftGetter + getDraftContent roundtrip", () => {
  const store = createFileStore()
  store.setDraftGetter("a.ts", () => "live content")
  expect(store.getDraftContent("a.ts")).toBe("live content")
})

test("getDraftContent returns undefined if no getter registered", () => {
  const store = createFileStore()
  expect(store.getDraftContent("a.ts")).toBeUndefined()
})

test("setDraftGetter(undefined) unregisters", () => {
  const store = createFileStore()
  store.setDraftGetter("a.ts", () => "live")
  store.setDraftGetter("a.ts", undefined)
  expect(store.getDraftContent("a.ts")).toBeUndefined()
})

test("remove() also clears the draft getter", () => {
  const store = createFileStore()
  store.upsert("a.ts", { content: "", stamp: { hash: "" }, status: "clean" })
  store.setDraftGetter("a.ts", () => "live")
  store.remove("a.ts")
  expect(store.getDraftContent("a.ts")).toBeUndefined()
})
```

### C.2 — Tests régression

Vérifie que les tests existants passent toujours : `bun test src/context/editor/ src/context/file/ src/test/providers/`.

Si des tests échouent à cause des nouvelles méthodes dans FileStore (ex: `setDraftGetter` non exposé), c'est probablement que ton implémentation B.1 est incomplète.

---

## 5. Phase D — Build + Runtime + Investigation Observation 3 (CRITIQUE)

### D.1 — Build

```powershell
cd D:\App\OpenCode\opencode\packages\app
bun run typecheck -F packages/app   # 0 erreurs

cd D:\App\OpenCode\opencode\packages\desktop
bun run build                       # ~20s, build le frontend
bun run tauri build --no-bundle    # ~3 min, build OpenCode.exe
```

Vérifie que `OpenCode.exe` est rebuild avec timestamp frais.

### D.2 — Investigation runtime Observation 3 (AVANT de tester manuellement)

**Observation 3 de l'user** : "Click Edit après close-guard save → modif encore là". Les 3 AIs reviewers ont dit de NE PAS dismiss cette observation. AVANT de tester manuellement, fais cette investigation :

#### A. Instrumentation frontend

Dans `packages/app/src/context/editor/close-guard.tsx`, AJOUTE temporairement :

```tsx
console.log('[guard] save', p.path, 'live.length=', live.length, 'live.first50=', live.slice(0, 50))
```

Dans `packages/app/src/context/editor/store.ts`, dans `save()`, AJOUTE :

```ts
console.log('[editor] save', path, 'content.length=', content.length, 'first50=', content.slice(0, 50), 'eff.type=', eff.type)
```

Dans `packages/app/src/context/editor/close-guard.tsx`, dans `EditorCloseGuardProvider`, AJOUTE :

```tsx
onCleanup(() => {
  console.log('[guard] cleanup', p.path, 'entry before cleanup:', JSON.stringify({...}).slice(0, 200))
})
```

#### B. Instrumentation backend

Dans `packages/app/src/context/editor.tsx`, dans `write()` AJOUTE :

```ts
console.log('[editor] backend-write-send', filePath, 'len=', content.length, 'first50=', content.slice(0, 50), 'expectedHash=', effectiveHash)
```

Dans `packages/opencode/src/file/index.ts`, dans `atomicWrite()` AJOUTE :

```ts
console.log('[backend] atomicWrite', full, 'len=', input.content.length, 'first50=', input.content.slice(0, 50))
```

#### C. Reproduction + analyse

1. Ajoute `"devtools": true` à `packages/desktop/src-tauri/tauri.conf.json` (pour ouvrir F12)
2. Rebuild : `bun run tauri build --no-bundle`
3. Lance `OpenCode.exe`, ouvre DevTools (F12), onglet Console
4. Reproduit le flow user : ouvre fichier → modifie (ex: ajoute "TESTCOUCOU") → X sur onglet → Save dans dialog → rouvre
5. Copie les logs console

**Détermine le cas** :
- **Cas A** : `[guard] save` montre `live.first50` = "TESTCOUCOU..." → Fix A marche → retire l'instrumentation et continue vers D.3
- **Cas B** : `[guard] save` montre le live MAIS `[backend] atomicWrite` montre un contenu différent → atomicWrite bug, fix séparé nécessaire
- **Cas C** : `[guard] save` et `[backend] atomicWrite` montrent le live correctement MAIS le viewer montre l'ancien contenu → bug cycle de vie CM/viewer, fix séparé

### D.3 — Test runtime manuel

Si Cas A confirmé (ou si D.2 skip) :

1. Ouvre un fichier dans l'app
2. Modifie (ajoute une ligne identifiable, ex: "COUCOU_TEST_ROUND_3")
3. Clique X sur l'onglet (dialog apparaît)
4. Clique Save dans la dialog
5. Ouvre l'Explorateur Windows sur le fichier → **DOIT contenir "COUCOU_TEST_ROUND_3"**
6. Réouvre le fichier dans l'app → viewer DOIT montrer les edits
7. Test Ctrl+S (Flow A) pour confirmer non-régression
8. Test conflit : modifie le fichier dans un autre outil (Notepad), puis Save dans dialog → banner conflict DOIT apparaître, tab DOIT rester ouvert

### D.4 — Retire l'instrumentation

Après les tests, retire TOUS les `console.log` ajoutés.

---

## 6. Phase E — Commit

**SEULEMENT si DoD rempli (voir §7)**.

```powershell
cd D:\App\OpenCode\opencode
git add packages/app/src/context/editor/close-guard.tsx packages/app/src/context/editor/store.ts packages/app/src/context/file/store.ts packages/app/src/pages/session/editor-panel.tsx packages/app/src/context/file/store.test.ts
git commit -m "fix(editor): expose CM live content via FileStore draft getter + check save return in close-guard

- file/store.ts: add setDraftGetter/getDraftContent (live CM ref, no per-keystroke copy)
- editor-panel.tsx: register the getter on mount, unregister on cleanup
- close-guard.tsx: read getDraftContent (live CM) instead of content (baseline); don't close tab if save fails

Fixes round 3 (3rd user report). Reviewed by GLM 5.2, ChatGPT, DeepSeek."
```

---

## 7. Definition of Done (CHECKLIST avant commit)

- [ ] **Phase B appliquée** : B.1 (file/store.ts), B.2 (editor-panel.tsx), B.3 (close-guard.tsx)
- [ ] **Phase C appliquée** : tests getter pattern dans file/store.test.ts
- [ ] `bun run typecheck -F packages/app` : 0 erreurs
- [ ] Tests existants : `bun test src/context/editor/ src/context/file/ src/test/providers/` — tous pass
- [ ] **Phase D.2 instrumentation faite** ET **Cas A/B/C déterminé** :
  - [ ] Cas A → continue
  - [ ] Cas B → fix atomicWrite séparé nécessaire AVANT commit
  - [ ] Cas C → fix cycle de vie séparé nécessaire AVANT commit
- [ ] Phase D.3 : test runtime manuel — disk contient les edits après Flow B (close-guard Save)
- [ ] Phase D.3 : test Ctrl+S non régressé
- [ ] Phase D.3 : test conflit → banner + tab ouvert
- [ ] Phase D.4 : instrumentation retirée
- [ ] Commit créé avec message explicite
- [ ] **PAS de commit avant 100% DoD rempli**

---

## 8. Anti-patterns (ce qu'il ne faut PAS faire)

- ❌ **Commit avant investigation runtime** (§10 du plan) — l'Observation 3 peut cacher un bug séparé
- ❌ **Mirror `FileStore.draft` à chaque keystroke** (revue GLM : perf killer sur 1MB+)
- ❌ **Plumb CM handle via Context** (over-engineering pour ce fix ; reporter en Phase 4)
- ❌ **Skipper le test conflict** (le scénario 409 est un data-loss silencieux)
- ❌ **Tuer PID 18756 ou 23620** (extensions/hôte de session)
- ❌ **Builder sans set TEMP=D:\** (C: plein, build échoue)
- ❌ **Dismiss Observation 3 comme "illusion user"** (les 3 AIs reviewers convergent : ne pas faire)
- ❌ **Modifier `AppProviders` tree** (le fix GlobalSDK précédent est appliqué et OK)

---

## 9. Si le fix échoue (rollback)

Si après Phase D.3 le bug persiste :

```powershell
cd D:\App\OpenCode\opencode
git revert HEAD
```

Puis investiguer selon Cas A/B/C (§10 du plan).

---

## 10. Références

- **Plan complet dans Obsidian** : `OpenCode/Plan-Fix-Close-Guard-Save-Round3-2026-06-28.md` (`D:\Documents\Obsidian\IA_Dev_Brain\OpenCode\`)
- **Plan complet local** : `D:\App\OpenCode\opencode\PLAN-EDITEUR-IDE-FIX-SAVE-2026-06-28.md`
- **Handoff round précédent (GlobalSDK)** : `D:\App\OpenCode\opencode\HANDOFF-finir-rebuild.md`
- **Prompt production round précédent** : `D:\App\OpenCode\opencode\PROMPT-PRODUCTION.md`
- **Vault Obsidian** : `D:\Documents\Obsidian\IA_Dev_Brain\OpenCode\`

---

**Rappel final** : Le plan a été révisé par 3 AIs adversariaux (GLM 5.2, ChatGPT, DeepSeek). Leurs retours sont intégrés. Si tu découvres un nouveau cas non couvert, **arrête-toi et demande** plutôt que d'improviser. L'observation runtime §10 (D.2) est NON-NÉGOCIABLE avant commit.

Bonne chance.
