# État des bugs terminal mobile OpenCode — handoff humain

## Bug #2 ✅ RÉSOLU — Touches avancées (Vim/Esc/Ctrl/flèches)

**Fix appliqué** : Réécriture de `TerminalMobileToolbar` pour envoyer des octets bruts via un handle `onSend` exposé par le composant `<Terminal>`.

**Fichiers modifiés** :
- `packages/app/src/components/terminal.tsx` — prop `onSend` (lignes 30, 262, 816-820)
- `packages/app/src/pages/session/terminal-panel.tsx` — toolbar rewrite (lignes 27-164) + consumer (lignes 426-430, 451)

**Résultat confirmé par l'utilisateur** : toolbar avec Esc, Tab, flèches, Home, End, PgUp, PgDn, Del, F1-F12, `:`, `|`, `/`, `~`, Ctrl/Alt toggles fonctionne.

---

## Bug #3 ✅ FIX EN PLACE — `vi` "bad system call"

**Root cause identifiée** : `libbusybox_exec.so` est un binaire **statique** (confirmé par `file`). Lancé, il fait des syscalls directs ; certains (probablement `rseq`, `statx`, `clone3` — non identifié avec précision) sont bloqués par le seccomp-bpf filter du zygote Android. Résultat : SIGSYS → "bad system call".

**LD_PRELOAD ne fonctionne pas** sur un binaire statique → impossible d'instrumenter busybox via shim.

**Fix appliqué** : router `vi`, `vim`, `less`, `more`, `top`, `sed` vers `/system/bin/toybox` (dynamic-bionic, compatible seccomp zygote Android). Les applets toybox Android 0.8.6+ incluent `vi`.

**Fichier modifié** :
- `packages/mobile/src-tauri/src/runtime.rs` (lignes 318-357, 363-368)

**Validation effectuée** :
- `file libbusybox_exec.so` → "ELF executable, static"
- `toybox vi --help` fonctionne (applet présent sur ce device Xiaomi)
- Test manuel : symlink `/data/data/.../tmp/vi → /system/bin/toybox` exécuté via pty_server → vi ouvre sans SIGSYS, accepte `:wq`

**À tester par l'humain** : ouvrir terminal dans l'app → `vi /tmp/test.txt` → doit ouvrir vi natif Android (toybox). Si SELinux bloque l'exec de `/system/bin/*` depuis le sandbox app (commentaire ligne 270-271 du runtime.rs mentionne ce risque), le fix pourra échouer et il faudra shipper un vim NDK bionic dans `assets/runtime/bin/` via `prepare-android-runtime.sh`.

---

## Bug #1 ❌ NON RÉSOLU — Prompt invisible en portrait (flash puis disparaît)

**Hypothèses testées et RÉFUTÉES par les observations device** :
1. Timing de render ghostty-web → Ctrl-L kick via `requestAnimationFrame` après 1er byte : aucun effet
2. Android WebView viewport metadata → `interactive-widget=resizes-content` : aucun effet
3. Line-height 150% hérité de `base.css` sur `.xterm-*` → `line-height: normal !important` : aucun effet
4. Padding excessif `px-6 py-3` sur container → custom property `--terminal-px/py` réduit sur mobile : aucun effet

**Toutes ces tentatives ont été revert** pour laisser le code dans un état propre.

**Observations factuelles depuis le device (capture via `chrome://inspect`)** :
```
t.open OK container=393x196 inDOM=true t.cols=80 t.rows=24 vp=392x851 vvh=851
SIZE[t.onResize] ?x?→36x12
TIMER[50ms] container=393x196 t=36x12 vvh=851
TIMER[200ms] container=393x196 t=36x12 vvh=851
WS first msg: text(36ch)
firstByte bytes=36 userTyped=false t=36x12 vvh=851
TIMER[500ms] container=393x196 t=36x12 vvh=851
vvp.resize vvh=851→803  ← chute spontanée de 48px
vvp.resize vvh=803→548  ← clavier virtuel monte (spontanément, user n'a rien tapé)
```

**Comportement reporté par l'utilisateur** : "le prompt apparaît en flash puis disparaît". En **paysage** il est visible, en **portrait** il n'est visible que brièvement.

**Pistes pour l'humain** :

1. **Le clavier virtuel monte spontanément sans interaction** — pourquoi ? (focus automatique sur le textarea caché de ghostty-web ?) La séquence `vvp.resize 851→803→548` se produit ~1100ms après l'ouverture, sans frappe utilisateur. Identifier ce qui déclenche le focus.

2. **Le container reste à `393x196`px** même quand `visualViewport.height` passe à 548. Le `#terminal-panel` ne se contracte pas avec le clavier. À investiguer : pourquoi le layout ne suit pas visualViewport ?

3. **Position du `#terminal-panel` dans le layout mobile** : à inspecter via `chrome://inspect` pendant le flash. Hypothèse : le panel est positionné en bas de l'écran (document-relative) ; quand le clavier monte, il passe sous le clavier.

4. **Test alternatif suggéré** : utiliser `position: fixed; bottom: 0` sur `#terminal-panel` avec une hauteur calculée dynamiquement depuis `visualViewport.height - composerHeight - tabsHeight`. Via JS, écouter `visualViewport.resize` et mettre à jour la hauteur.

5. **ghostty-web est canvas-based** — la "disparition" pourrait être un canvas clear/reflow interne déclenché par un resize ou un event. Instrumenter via `chrome://inspect` pendant le flash.

**Outils à disposition** :
- `chrome://inspect/#devices` fonctionne (WebView debuggable)
- Les logs `[terminal-debug]` basiques existent toujours dans `terminal.tsx` (addDebug)
- Sur device : `/data/data/ai.opencode.mobile/tmp/` est writable pour logs custom si besoin

---

## État du code (changements actifs dans le repo)

### Bug #2 (gardé, fonctionne) :
- `packages/app/src/components/terminal.tsx` — prop `onSend`
- `packages/app/src/pages/session/terminal-panel.tsx` — toolbar rewrite

### Bug #3 (gardé, devrait fonctionner) :
- `packages/mobile/src-tauri/src/runtime.rs` — symlinks vi/vim → /system/bin/toybox

### Diagnostic dormant (peut être retiré si non utile) :
- `packages/mobile/src-tauri/gen/android/app/src/main/jni/sigsys_trace.c` (nouveau, LD_PRELOAD shim)
- `packages/mobile/src-tauri/gen/android/app/src/main/jni/CMakeLists.txt` — entrée sigsys_trace ajoutée

### Reverted (aucun effet, supprimés) :
- `packages/ui/src/styles/base.css` — reset line-height (retiré)
- `packages/mobile/src/mobile.css` — --terminal-px/py override (retiré)
- `packages/mobile/index.html` — interactive-widget viewport meta (retiré)
- `packages/app/src/components/terminal.tsx` — Ctrl-L kick, diagnostic logs verbeux (retirés)

---

## Build + install

```bash
cd packages/mobile && \
  ORT_LIB_LOCATION="$PWD/src-tauri/gen/android/app/src/main/jniLibs/arm64-v8a" \
  bunx tauri android build --debug --target aarch64

adb uninstall ai.opencode.mobile
adb install src-tauri/gen/android/app/build/outputs/apk/universal/debug/app-universal-debug.apk
```

**Dernière APK installée** : état 2026-04-20 ~18:55, bug #2 OK, bug #3 fix en place, bug #1 non résolu.

## Vérifications rapides

```bash
# Bug #3 : après avoir ouvert le terminal dans l'app une fois
adb shell "run-as ai.opencode.mobile readlink /data/user/0/ai.opencode.mobile/runtime/bin/vi"
# Attendu : /system/bin/toybox
```
