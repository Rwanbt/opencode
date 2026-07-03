# Plan de correction — OpenCode IDE (éditeur + gestion fichiers)

> Re-vérifié intégralement le 2026-06-24 par opencode (sans confiance aveugle dans le diagnostic précédent).
> Chaque cause est prouvée par lecture du code source + preuve empirique (serveur live / binaires).

## État du déploiement (vérifié maintenant)
- `target/release/opencode-cli.exe` = `0.0.0-ide-202606241612` (sidecar FRAIS, copié manuellement par la session précédente — TOUJOURS en place).
- Serveur opencode était ready sur 62521 (log), sidecar ne crashe plus (le stale du 7 mai crashait à 7s).
- ⚠️ L'app desktop OpenCode.exe n'est pas lancée à l'instant, mais le sidecar (PID 30508) tourne encore orphelin.
- Test isolé précédent : write/readRaw/delete-dossier/conflict-409 — tous passent sur le sidecar frais.

---

## RÉSOLU — R0 : Serveur opencode mort (cause racine immédiate)
Le desktop spawn le sidecar **voisin du binaire** (`cli.rs:117-124` `get_sidecar_path` → `current_binary().parent().join("opencode-cli")`). Donc `target/release/OpenCode.exe` lançait `target/release/opencode-cli.exe` qui était le binaire du **7 mai** (antérieur au file-write API du 19 juin) ET crashait 7s après démarrage (log : `Sidecar terminated code=Some(1)`). Serveur mort → toute écriture/suppression → 404 → "deleted on disk" / "failed to delete".
**Fix runtime appliqué** (toujours en place) : copie sidecar frais → `target/release/opencode-cli.exe`.
**Reste à corriger durablement** : voir B4 (sinon chaque rebuild réintroduit le stale).

---

## BUGS CODE RÉELS (manifestes maintenant que le serveur vit)

### B1 — CRITICAL : mappage d'erreurs SDK cassé (editor.tsx)
**Fichier** : `packages/app/src/context/editor.tsx` l.18-43 (`readRaw` + `write`).
**Preuve** :
- `sdk.tsx:20` configure le client avec `throwOnError: true`.
- `client.gen.ts:222-224` : sur HTTP non-2xx, `throw finalError` (le body JSON `{message}` ou texte brut — **jamais** un objet avec `.response`/`.status`).
- Donc `editor.tsx:31-32` (`res.response.status === 409/404`) est **code mort** : `res` n'est assigné qu'en cas de succès (200). Toute erreur saute au `catch` (l.40-42, l.23-25) → `{type:"not-found"}`.
**Conséquences vérifiées** :
- Un vrai conflit 409 (fichier modifié sur disque pendant l'édition) → bannière "deleted on disk" au lieu de "conflict".
- Une erreur réseau/transitoire → "deleted on disk".
- `recreate()` (`store.ts:236`, write sans expectedHash) sur un fichier qui existe encore → 409 → not-found → reste bloqué "missing".
**Fix** : créer un client non-throwant dédié pour les opérations fichier, et inspecter le statut HTTP réel.
```ts
// editor.tsx — remplacer sdk.client par un client non-throwant
const file = sdk.createClient({ throwOnError: false })

async readRaw(filePath) {
  const res = await file.file.readRaw({ path: filePath })
  if (!res.data) return { type: "not-found" }      // 200 sans data ou erreur réseau
  return { type: "ok", content: res.data.content, stamp: res.data.stamp }
},

async write({ path: filePath, content, expectedHash, format }) {
  const res = await file.file.write({ path: filePath, content, expectedHash, format })
  // res.response est l'objet Response réel en cas d'erreur HTTP (client.gen.ts:227-232)
  if (res.response && res.response.status === 409) return { type: "conflict" }
  if (res.response && res.response.status === 404) return { type: "not-found" }
  if (!res.data) return { type: "not-found" }
  return { type: "ok", content: res.data.content, stamp: res.data.stamp, formatted: res.data.formatted }
}
```
**Note SDK** : en cas d'erreur HTTP non-throwing, le retour est `{error, request, response}` où `response` = vraie Response (client.gen.ts:124,227). En cas d'erreur réseau (fetch throw), `response` est `undefined` → `not-found` (acceptable). Ne pas toucher au `throwOnError:true` global (d'autres consommateurs en dépendent).

---

### B2 — MAJEUR : séparateurs Windows ignorés (operations.ts)
**Fichier** : `packages/app/src/context/file/operations.ts` l.12-20 (`parentDir`/`basename`), impact aussi `tree-store.ts:91`.
**Preuve** :
- Backend `list()` (`packages/opencode/src/file/index.ts:696`) : `file = path.relative(Instance.directory, absolute)`. Sur win32, `path.relative` produit des **backslashes** (comportement Node.js déterministe, `import path from "node:path"` = platform-default).
- Donc `FileNode.path` = `packages\app\foo.ts` sur Windows.
- `parentDir` (`lastIndexOf("/")`) retourne `""` pour tout chemin imbriqué. `basename` retourne le chemin complet.
**Conséquences** :
- `deleteNode` (l.74-83) : `refreshDir("")` (racine) au lieu du vrai parent → **arbre UI périmé** (nœud supprimé reste affiché). Le delete lui-même marche (backend gère `\`).
- `renameNode` (l.63-72) : `to: join("", newName)` = racine → **renommage vers la racine** (gravissime, perte de placement).
- `moveNode` (l.85-96) : `basename` retourne le chemin complet → destination malformée.
- `tree-store.ts:91` : `key.startsWith(removed + "/")` → nettoyage enfants cassé (orphelins de cache, cosmétique).
**Fix** :
```ts
// operations.ts l.12-20
function parentDir(filePath: string): string {
  const idx = Math.max(filePath.lastIndexOf("/"), filePath.lastIndexOf("\\"))
  return idx === -1 ? "" : filePath.slice(0, idx)
}
function basename(filePath: string): string {
  const idx = Math.max(filePath.lastIndexOf("/"), filePath.lastIndexOf("\\"))
  return idx === -1 ? filePath : filePath.slice(idx + 1)
}
```
Et `tree-store.ts:91` : remplacer `removed + "/"` par un test `startsWith(removed + "/") || startsWith(removed + "\\")`.
**Alternative propre (recommandée à terme)** : normaliser les `FileNode.path` en `/` côté backend (server routes/file.ts, avant `c.json`), single source of truth — mais plus invasif. Le fix operations.ts est le correctif minimal et immédiat.

---

### B3 — MINEUR : toast succès affiché même sur échec (file-tabs.tsx)
**Fichier** : `packages/app/src/pages/session/file-tabs.tsx` l.477-491 (`handleCtrlS`).
**Preuve** : `editorStore.save()` (`store.ts:124-151`) ne lève jamais (catch interne l.147-150, retourne un `DocEffect`). Donc le toast succès (l.487) s'affiche même si save retourne `{type:"missing"}` ou `{type:"conflict"}`.
**Fix** :
```ts
const handleCtrlS = async () => {
  const p = path()
  if (!p) return
  const content = editorHandle?.getContent() ?? ""
  const format = settings.general.autoSave()
  try {
    const eff = await editorStore.save(p, content, format)
    applyDocEffect(eff)
    if (eff.type === "conflict" || eff.type === "missing") return   // bannière dédiée déjà affichée
    showToast({ variant: "success", title: language.t("toast.file.saved") })
  } catch {
    showToast({ variant: "error", title: language.t("toast.file.saveFailed") })
  }
}
```

---

### B4 — DETTE DE BUILD : sidecar frais jamais copié vers target/release
**Fichiers** : `packages/desktop/scripts/` + `tauri.conf.json`.
**Preuve** :
- `tauri.conf.json` `beforeBuildCommand` = `bun run build` (vite frontend SEULEMENT).
- `predev.ts` (build+copie sidecar → `sidecars/`) ne tourne qu'avant `tauri dev`.
- `prepare.ts` (`gh run download`) = CI uniquement.
- `cli.rs:117` `get_sidecar_path` résout le sibling `target/release/opencode-cli.exe`. Rien ne garantit qu'il est frais après un `tauri build` local. Résultat : chaque rebuild réintroduit le stale → serveur mort → R0 + B1/B2 se réactivent.
**Fix A (pipeline, primaire)** — ajouter un script de copie qui s'exécute avant `tauri build` :
```jsonc
// packages/desktop/package.json scripts
"precopy:sidecar": "bun ./scripts/copy-sidecar.ts"
```
```ts
// packages/desktop/scripts/copy-sidecar.ts (nouveau)
import { $ } from "bun"
import { getCurrentSidecar, windowsify } from "./utils"
const target = Bun.env.TAURI_ENV_TARGET_TRIPLE ?? "x86_64-pc-windows-msvc"
const cfg = getCurrentSidecar(target)
const src = windowsify(`src-tauri/sidecars/opencode-cli-${target}`)
for (const profile of ["debug", "release"]) {
  const dest = windowsify(`src-tauri/target/${profile}/opencode-cli`)
  await $`cp ${src} ${dest}`.quiet()
  console.log(`copied sidecar -> target/${profile}`)
}
```
Puis `beforeBuildCommand`: `bun run build && bun run precopy:sidecar`.
Prérequis : le sidecar frais doit exister dans `sidecars/` (construit par `predev.ts` en dev, ou `bun run build --single` dans packages/opencode).
**Fix B (robustesse runtime, défense en profondeur)** — `cli.rs get_sidecar_path` : si le sibling est absent/stale, fallback vers `src-tauri/sidecars/opencode-cli-<triple>`. Nécessite recompile Rust. Optionnel si Fix A est fiable.

---

## Vérification post-correctifs
1. Rebuild : `cd packages/app && bun run build` (frontend) ; vérifier `packages/app/dist/index.html` rafraîchi.
2. Copier frontend vers desktop dist si nécessaire + recompiler Tauri.
3. Lancer l'app, ouvrir un fichier imbriqué (ex. `packages\app\src\context\file.tsx`), éditer, Ctrl+S → toast succès + PAS de bannière "deleted on disk".
4. Test conflit : modifier le même fichier sur disque pendant l'édition (dirty), sauver → bannière "conflict" (PAS "deleted on disk").
5. Supprimer un dossier imbriqué → toast succès + nœud disparaît de l'arbre immédiatement (refresh du bon parent).
6. Renommer un fichier imbriqué → reste dans son dossier d'origine (PAS déplacé à la racine).
7. Probe serveur : `GET https://127.0.0.1:<port>/global/health` → `healthy:true`.

## Ordre d'exécution recommandé
B1 → B3 → B2 → B4 → rebuild → tests 3-7.
B1 et B3 sont des éditions frontend pures (rebuild vite + recharger). B2 aussi frontend. B4 build/Rust.
Tests existants : `packages/app/src/context/editor/store.test.ts` (couvre le store ; ajouter un test readRaw/write conflict/not-found via deps mockées si couverture manquante).
