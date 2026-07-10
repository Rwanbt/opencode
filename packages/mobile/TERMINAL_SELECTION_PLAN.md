# Terminal mobile — sélection tactile + copier/coller — état & plan (2026-07-10)

Ce fichier est un handoff autonome : lisible sans le reste de la conversation qui l'a produit.
Contexte projet complet dans `../../CLAUDE.md` (racine du repo `opencode/`).

## Objectif

Ajouter la sélection de texte tactile (appui long + glisser) et copier/coller dans le terminal
mobile (Android, WebView Tauri, `ghostty-web` = canvas, pas xterm.js). Le clavier Android ne
doit JAMAIS se rouvrir sur un geste de scroll ou de sélection (bug historique déjà corrigé et
fragile — voir "Piège critique" plus bas).

## Ce qui est fait et VÉRIFIÉ (build + install device réel, testé par l'utilisateur)

Fichiers modifiés :
- `packages/app/src/components/terminal.tsx` — state machine tactile étendue avec un 3e mode
  `"selecting"` (voir `useTerminalUiBindings`, variable `TouchMode`).
- `packages/app/src/pages/session/terminal-panel.tsx` — boutons Copier/Coller dans
  `TerminalMobileToolbar`, registre `selectionApis` par onglet.
- `packages/app/src/context/platform.tsx` + `packages/mobile/src/platform.ts` —
  `readClipboardText()` (miroir de `readClipboardImage()` déjà existant, via
  `@tauri-apps/plugin-clipboard-manager`).
- `packages/mobile/src-tauri/capabilities/default.json` — **bug pré-existant corrigé au passage** :
  `clipboard-manager:default` n'accorde AUCUNE permission concrète (confirmé dans le schéma du
  plugin — c'est un identifiant "vide" par design). Ajouté `allow-read-text` (requis pour Coller)
  et `allow-read-image` (fixe un bug latent probable sur le paste d'image dans le chat, même
  cause racine, trouvé en marge de ce travail).
- i18n `en.ts`/`fr.ts` — clés `terminal.selection.copy/paste/copied`.

### Architecture de la sélection tactile (le point le plus important à comprendre avant de toucher au code)

`ghostty-web`'s `SelectionManager` (`node_modules/ghostty-web/lib/selection-manager.ts`) est
**100% pilotée par événements souris réels** (`mousedown`/`mousemove`/`mouseup`/`click` sur son
propre canvas + `document`). Elle n'a AUCUN support tactile, et son API publique
(`term.getSelection/hasSelection/copySelection/selectAll/select/selectLines/getSelectionPosition`,
voir `ghostty-web/lib/terminal.ts:813-874`) ne permet PAS de piloter une sélection point-à-point
arbitraire (pas de "sélectionne du pixel A au pixel B" public ; `pixelToCell` est privée).

**Décision d'architecture (délibérée, validée)** : plutôt que de réimplémenter cette logique
(seuil de drag, auto-scroll aux bords, inversion de sélection, copie clipboard — tout déjà
testé côté desktop), le code dispatche de VRAIS `MouseEvent` synthétiques sur le canvas de
ghostty-web (`canvasEl = input.container.querySelector("canvas")`, déjà référencé dans
`terminal.tsx` pour l'overscroll). C'est la technique standard pour piloter un widget canvas qui
n'expose pas d'API de geste — pas un hack, mais ça a des conséquences qu'il faut connaître (voir
bugs restants ci-dessous).

Long-press (500ms, `LONG_PRESS_MS`) → `beginSelection(x, y)` dispatche `mousedown` PUIS un
`click` synthétique avec `detail: 2` au même point, pour rejouer le chemin de sélection de mot
au double-clic déjà testé de SelectionManager (`getWordAtCell`, privée, pas dupliquée). Le drag
qui suit étend seulement `selectionEnd` (mousemove synthétique) — `selectionStart` reste fixé au
bord du mot initial tant qu'aucune poignée indépendante n'existe (voir Bug 2 ci-dessous).

`lastGestureWasSwipe` a été renommé `lastGestureConsumedTouchEnd` et couvre maintenant le mode
`"selecting"` en plus de `"swipe"` — sinon relâcher une sélection tactile rouvre le clavier
Android exactement comme l'ancien bug scroll (le native `touchend` de ghostty-web fait
`textarea.focus()` sans condition, `terminal.ts:451-454`).

### Piège critique — NE PAS RÉGRESSER

Cette zone (`useTerminalUiBindings` dans `terminal.tsx`) a eu 3 régressions confirmées cette
session (scroll qui rouvrait le clavier, overscroll cassé 2x, watchdog anti-blocage tactile).
Toute nouvelle modification touchant `onTouchDownCapture`/`onTouchMoveCapture`/
`onTouchEndOrCancel`/`blockTouchEndIfGestureConsumed` doit être testée manuellement sur device
réel avant d'être considérée acquise — **CDP `Page.captureScreenshot` ment sur le contenu canvas
sur ce device** (tout noir même quand le rendu est correct, vérifié par `getImageData()`) et
`adb shell input` est bloqué par MIUI sur ce device. Impossible de vérifier le geste tactile réel
depuis un agent — seul un humain sur le vrai téléphone peut valider.

### Confirmé fonctionnel par test utilisateur sur device réel

- Appui long → sélectionne le mot, pas de réouverture clavier.
- Glisser après l'appui long → étend la sélection.
- Boutons Copier/Coller fonctionnels (Copier écrit dans le presse-papiers **système** Android via
  `navigator.clipboard.writeText`, donc collable dans une autre app).
- Scroll normal ne désélectionne rien (exigence explicite de l'utilisateur, déjà respectée par
  construction : le mode `"swipe"` ne touche jamais SelectionManager).

## Bugs confirmés restants (root cause identifiée par lecture de code, PAS encore corrigés)

### Bug 1 — "taper ailleurs ne désélectionne rien"

Deux causes distinctes, toutes les deux à corriger :

**1a. Régression introduite par le dispatch synthétique.** Le `mousedown` synthétique bubble
jusqu'à `document`, où SelectionManager a son propre listener
(`selection-manager.ts:569-571`, `document.addEventListener('mousedown', e => this.mouseDownTarget = e.target)`).
Sa logique "clic dehors désélectionne" (`selection-manager.ts:726-751`) vérifie
`canvas.contains(mouseDownTarget)` et abandonne silencieusement si vrai. Comme notre `mousedown`
synthétique est le SEUL `mousedown` qui existe jamais sur un device tactile pur,
`mouseDownTarget` reste bloqué sur le canvas dès le premier appui long de la session — cassant
"tap ailleurs = désélection" pour le reste de la session. **Ne pas essayer de corriger ça en
touchant SelectionManager (privé/tiers)** — contourner en implémentant notre propre détection.

**1b. Gap structurel, indépendant du bug ci-dessus.** Un tap simple À L'INTÉRIEUR du terminal
(zone vide, sans nouveau appui long) ne génère AUCUN `click` du tout : `touchstart` fait
`e.preventDefault()` sur toute la séquence tactile (`suppressSyntheticMouseEvents`,
`terminal.tsx`), ce qui supprime la synthèse `click` du navigateur pour tout tap démarrant sur
le conteneur. Donc même sans 1a, ce chemin n'a jamais été câblé pour le tactile.

**Fix prévu (validé, pas encore codé)** :
- Tap simple (mode reste `"pending"`, pas de mouvement) qui se termine dans
  `onTouchEndOrCancel` avec une sélection active existante → appeler `input.term.clearSelection()`
  nous-mêmes explicitement, sans dépendre de la détection (aveugle au tactile) de
  SelectionManager. Corrige 1b, et 1a par la même occasion pour les taps À L'INTÉRIEUR du
  terminal.
- Tap n'importe où HORS du terminal (autre partie de l'UI) → ajouter notre propre listener
  `document.addEventListener('click', ...)` (phase BULLE, pas capture — important : ça garantit
  qu'il s'exécute APRÈS le `onPointerDown` du bouton Copier, donc pas de race qui viderait la
  sélection avant que Copier ait pu la lire) qui appelle `clearSelection()` si
  `!input.container.contains(e.target)` ET qu'une sélection existe. **Exclure explicitement la
  toolbar mobile** (`e.target.closest('[data-component="terminal-mobile-toolbar"]')`) sinon
  taper sur Copier viderait la sélection qu'on vient justement de copier — décision utilisateur
  validée : Copier doit laisser la sélection visible après usage (voir Décisions ci-dessous).

### Bug 2 — "impossible d'étirer/réduire la sélection à chaque extrémité (pas de poignées)"

Gap de portée v1 assumé au moment du design initial, pas une régression. Une fois le doigt levé
après le drag initial, il n'existe aucun moyen d'ajuster la sélection existante — seul un nouvel
appui long (qui redémarre sur un nouveau mot, perdant l'ancienne sélection) est possible.

**Plan validé (pas encore codé)** : deux poignées de sélection (style goutte Android natif,
décision utilisateur ci-dessous), positionnées via l'API PUBLIQUE déjà existante
`term.getSelectionPosition()` (`ghostty-web/lib/terminal.ts`, retourne
`{start:{x,y}, end:{x,y}}` en coordonnées colonne/ligne viewport), converties en pixels via la
même approximation déjà utilisée pour le tactile (`container.clientWidth/cols`,
`container.clientHeight/rows` — équivalent de `mobileCharHeight()` déjà présent, ajouter un
`mobileCharWidth()` symétrique).

Chaque poignée est draggable indépendamment :
- Glisser la poignée de **fin** → dispatcher un `mousedown` synthétique ancré sur la position de
  **début** actuelle (lue via `getSelectionPosition()`), puis suivre le doigt avec des
  `mousemove` synthétiques.
- Glisser la poignée de **début** → ancrer sur la position de **fin** actuelle, puis suivre le
  doigt vers la nouvelle position de début.
- La logique d'inversion de sélection déjà présente dans SelectionManager
  (`normalizeSelection()`, compare `absoluteRow`/`col` et swap si nécessaire) gère automatiquement
  le bon sens quel que soit la poignée déplacée — pas besoin de logique supplémentaire pour ça.
- Les poignées doivent court-circuiter le classifieur tactile existant : `onTouchDownCapture`
  doit ignorer tout pointerdown dont la cible est une poignée (ex.
  `if ((e.target as Element)?.closest('[data-terminal-selection-handle]')) return` en tout début
  de fonction), et chaque poignée gère son propre petit state machine de drag indépendant
  (pointerdown/pointermove/pointerup sur l'élément poignée lui-même, PAS de capture au niveau du
  conteneur pour ces éléments).
- Rendu conditionnel : seulement quand `hasSelection()` est vrai côté onglet actif, position
  recalculée à chaque `onSelectionChange` ET à chaque resize/scroll (le conteneur bouge déjà
  beaucoup avec le clavier — réutiliser le pattern `ResizeObserver` déjà présent dans
  `terminal.tsx` pour l'overscroll).

## Décisions utilisateur validées pour la suite (ne pas re-demander)

1. **Style des poignées** : goutte inversée façon sélecteur Android natif (pas de simples
   cercles) — plus de travail CSS/SVG pour la forme et l'ombrage, mais explicitement demandé
   pour coller au réflexe utilisateur Android.
2. **Copier ne désélectionne PAS** : la sélection doit rester visible et ajustable après un tap
   sur "Copier" (permet de recopier ou d'étendre encore avec les poignées sans tout refaire).
   C'est pour ça que le listener de désélection hors-terminal (Bug 1) doit explicitement exclure
   la toolbar mobile.

## Ordre de reprise recommandé

1. Bug 1 (désélection) — petit, faible risque, aucune nouvelle UI, pas de nouveau state.
   Build+test device après ce seul changement avant de passer à la suite.
2. Bug 2 (poignées) — le plus gros morceau, nouveau composant + nouveau state de drag. Build+test
   device isolé, ne pas empiler d'autres changements tactiles dans le même build tant que ce
   n'est pas validé.

## Progression de reprise — 2026-07-10

- [x] Bug 1 — désélection au tap ailleurs : correctif renforcé dans `packages/app/src/components/terminal.tsx` (clear au pointerdown interne + listener document pointerdown capture hors terminal). APK v2 installé le 2026-07-10 ; validation tactile utilisateur en attente.
  - Tap tactile simple dans le terminal : `term.clearSelection()` explicite avant le `touchend` Ghostty.
  - Clic hors terminal : listener `document` indépendant de `SelectionManager.mouseDownTarget`.
  - Toolbar mobile exclue pour conserver la sélection après Copier.
- [x] Baseline tactile (long-press + drag, scroll, tap dedans/dehors, Copier) validée sur device par l'utilisateur.
- [x] Bug clavier/layout pendant le drag de sélection (régression découverte après le fix ci-dessus) —
  root cause confirmée par instrumentation CDP réelle (`Element.prototype.focus` patché globalement +
  sonde `document.activeElement`/`visualViewport`) : le `mousedown` synthétique de `beginSelection()`
  déclenche DEUX `focus()` indépendants côté ghostty-web — `textarea.focus()`
  (`terminal.ts:446-449`) et `canvas.parentElement.focus()` depuis `SelectionManager`
  (`selection-manager.ts:441`, sur le conteneur `contenteditable="true"`). Un `blur()` synchrone
  après coup ne suffit pas (confirmé sur device : le clavier s'ouvre quand même ~130ms plus tard,
  la requête IME native est déjà en vol). Fix retenu : neutraliser temporairement `.focus` sur le
  textarea ET le conteneur (monkeypatch no-op) pendant la durée du `dispatchEvent` synchrone,
  restaurés juste après — `terminal-touch-controller.ts::beginSelection`. Validé sur device.
- [x] Bug clavier à la réouverture d'un terminal (second symptôme distinct signalé par l'utilisateur) —
  root cause confirmée : le conteneur `contenteditable="true"` posé par ghostty-web
  (`terminal.ts:396`, uniquement pour compat extensions desktop type Vimium) est focusé
  **nativement** par Android WebView au toucher, sans aucun appel `.focus()` JS (confirmé :
  zéro événement capté par la sonde `Element.prototype.focus` pendant le cycle observé). Fix :
  `container.contentEditable = "false"` sur mobile juste après `t.open(container)`
  (`terminal.tsx`) + blur défensif du conteneur au `touchstart` en complément
  (`terminal-touch-controller.ts::suppressSyntheticMouseEvents`). Validé sur device.
- [ ] Bug 2 — poignées Android natives : tentative retirée après régression (surlignage perdu, forme non conforme, drag/scroll non fiables). Reprendre avec une conception intégrée au rendu Ghostty et validation incrémentale — voir `PLAN-TERMINAL-SELECTION-HANDLES-2026-07-10.md`, reste à faire dans une session dédiée.
## Commandes de build/déploiement vérifiées cette session

```bash
cd packages/mobile
ORT_LIB_LOCATION=D:/tmp/ort-android bun tauri android build --target aarch64
# APK produit (non signé) :
#   src-tauri/gen/android/app/build/outputs/apk/universal/release/app-universal-release-unsigned.apk

# Le device (MIUI) bloque `adb shell pm clear` (SecurityException) — si un changement FRONTEND
# doit absolument bypasser le cache WebView, faire un uninstall+install complet plutôt qu'un
# simple install -r (voir memory reference_android_webview_cache_stale.md) :
adb uninstall ai.opencode.mobile   # ATTENTION : efface les données locales de l'app sur le device

# Signature (l'APK release n'est jamais signée par le build Tauri) :
export JAVA_HOME="/c/Program Files/Android/Android Studio/jbr"
BT="/c/Users/barat/AppData/Local/Android/Sdk/build-tools/35.0.0"
"$BT/zipalign.exe" -f -p 4 app-universal-release-unsigned.apk app-<label>-aligned.apk
"$BT/apksigner.bat" sign --ks "$HOME/.android/debug.keystore" --ks-pass pass:android \
  --out app-<label>-signed.apk app-<label>-aligned.apk

adb install app-<label>-signed.apk
adb shell monkey -p ai.opencode.mobile -c android.intent.category.LAUNCHER 1
```

## Vérification déjà faite (à refaire après chaque nouveau changement)

`bun run typecheck` (15/15 packages) et `bunx biome check <fichiers touchés>` — aucune erreur au
moment de l'écriture de ce fichier. Une fonction morte pré-existante (`errorName` dans
`terminal.tsx`) a été supprimée au passage (trouvée par le linter, jamais appelée).
