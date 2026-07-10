# Plan — Poignées de sélection tactile Android dans le terminal mobile

**Date** : 2026-07-10  
**Statut** : Draft prêt pour implémentation  
**Périmètre** : `packages/app` + tests unitaires + validation Android device  
**Dépendance** : conserver intacte la sélection tactile/copie déjà fonctionnelle et le correctif de désélection.

## 1. Objectif UX

Reproduire le comportement Android attendu :

- appui long : mot sélectionné et surlignage Ghostty inchangé ;
- deux poignées visibles aux extrémités, forme goutte Android, couleur accent ;
- zone tactile minimale 48×48 CSS px, visuel plus petit centré ;
- glisser une poignée étend/réduit la sélection en temps réel ;
- croiser les poignées inverse le sens sans perdre la sélection ;
- les poignées suivent le texte pendant scroll, overscroll, resize clavier et rotation ;
- Copier conserve la sélection et les poignées ;
- tap simple, scroll normal et long-press existants ne régressent pas.

Non-objectifs : sélectionner du texte DOM, modifier `ghostty-web`, reproduire un menu d’action Android complet, ou implémenter une seconde logique de segmentation de mots.

## 2. Contraintes établies

`ghostty-web` rend le terminal sur canvas. `SelectionManager` ne comprend que les événements souris et expose `getSelectionPosition()`, pas une API publique de sélection pixel-à-pixel. La sélection et son surlignage restent donc la responsabilité exclusive du canvas Ghostty.

La dernière tentative a échoué parce qu’elle ajoutait un overlay Solid autonome avec son propre cycle d’état et des coordonnées approximatives. La nouvelle implémentation doit avoir une seule source de vérité : la géométrie doit être calculée par le contrôleur qui connaît le canvas, son `getBoundingClientRect()`, l’overscroll et les événements `onSelectionChange`.

## 3. Architecture proposée

Extraire les responsabilités de `terminal.tsx` (déjà ~1 500 lignes) :

```text
Terminal.tsx
  ├─ TerminalTouchController       état pending/swipe/selecting/handle-drag
  │    ├─ canvas MouseEvent bridge  seul endroit qui parle à SelectionManager
  │    └─ SelectionGeometry         positions canvas + overscroll + resize
  └─ TerminalSelectionOverlay       rendu des poignées, sans logique de sélection
```

Fichiers :

1. `packages/app/src/components/terminal-touch-controller.ts`
   - état tactile existant déplacé sans changer son comportement ;
   - long-press, swipe, blocage IME, désélection et drag des poignées ;
   - `startHandleDrag`, `moveHandleDrag`, `endHandleDrag` ;
   - aucun état global, dépendances injectées (`container`, `term`, `canvas`, callbacks).
2. `packages/app/src/components/terminal-selection-geometry.ts`
   - fonctions pures testables ;
   - conversion cellule → coordonnées client/overlay ;
   - calcul des points d’ancrage début/fin ;
   - prise en compte de `canvas.getBoundingClientRect()` et de l’offset d’overscroll fourni par le contrôleur.
3. `packages/app/src/components/terminal-selection-overlay.tsx`
   - rendu uniquement ;
   - racine `pointer-events:none` ; poignées seules en `pointer-events:auto` ;
   - visuel SVG goutte Android et hit target 48×48 ;
   - reçoit `positions`, `visible`, `onHandlePointerDown`.
4. `packages/app/src/components/terminal.tsx`
   - wiring minimal du contrôleur et de l’overlay ;
   - aucun calcul de coordonnées ni nouvelle machine tactile inline.
5. Tests associés dans `packages/app/src/components/terminal-selection-geometry.test.ts` et `terminal-touch-controller.test.ts`.

## 4. Modèle de données

```ts
type SelectionHandleSide = "start" | "end"
type SelectionHandlePoint = {
  clientX: number
  clientY: number
  overlayLeft: number
  overlayTop: number
}
type SelectionGeometry = {
  start: SelectionHandlePoint
  end: SelectionHandlePoint
  visible: boolean
  revision: number
}
type HandleDrag = {
  side: SelectionHandleSide
  pointerId: number
  anchor: { x: number; y: number }
}
```

`SelectionGeometry` est dérivée de `term.getSelectionPosition()` à chaque changement de sélection et non stockée comme une seconde sélection. `HandleDrag.anchor` est toujours l’extrémité opposée relue au moment du pointerdown.

## 5. Flux de rendu et synchronisation

1. `term.onSelectionChange` programme une mise à jour via `requestAnimationFrame`.
2. Le contrôleur lit `getSelectionPosition()` et `getSelection()` ; si l’un est vide, il masque les poignées sans appeler `clearSelection()`.
3. Il lit le `canvas.getBoundingClientRect()` après le layout réel. Aucune approximation `container.width / cols` comme source primaire.
4. Il convertit `start/end` en CSS pixels. Pour le début, l’ancre est au bord gauche de la cellule ; pour la fin, au bord droit.
5. Le même offset d’overscroll que celui appliqué au canvas est fourni à la géométrie ; le canvas et l’overlay bougent donc ensemble.
6. Recalcul obligatoire sur : `onSelectionChange`, `ResizeObserver` du container/canvas, `visualViewport.resize`, scroll capturé, changement d’overscroll, fin de `fit()` et reprise après clavier.
7. Une seule frame pending est autorisée ; cleanup annule le RAF, les observers et les listeners.

## 6. Drag d’une poignée

### Pointerdown

- Le hit-test reconnaît `[data-terminal-selection-handle]` dans `onPointerDownCapture` avant la machine `pending/swipe`.
- Le contrôleur ne déclenche ni `clearSelection`, ni focus textarea, ni scroll.
- `preventDefault()` + `stopPropagation()` ; `setPointerCapture(pointerId)` sur la poignée.
- Relire `getSelectionPosition()`.
- Pour la poignée `end`, l’ancre est `selection.start`. Pour `start`, l’ancre est `selection.end`.
- Dispatcher un `mousedown` synthétique sur le canvas à la cellule d’ancrage. Ne dispatcher aucun `click`.
- Conserver les poignées visibles pendant la phase intermédiaire où `SelectionManager` n’a pas encore produit la nouvelle sélection.

### Pointermove

- Vérifier `pointerId` et l’état `HandleDrag`.
- `preventDefault()` + `stopPropagation()` ; dispatcher un `mousemove` synthétique avec les coordonnées client réelles du doigt.
- Laisser `SelectionManager` calculer la cellule, l’auto-scroll et l’inversion ; son événement `onSelectionChange` met à jour le surlignage et les poignées.
- Si le doigt sort du viewport, le pointer capture maintient le drag ; le contrôleur conserve le clamp/auto-scroll déjà fourni par Ghostty.

### Pointerup/cancel

- Dispatcher exactement un `mouseup` si le drag est actif.
- Libérer le pointer capture, annuler le RAF pending et relire la géométrie.
- Ne jamais appeler `clearSelection()` dans ce chemin.
- `pointercancel` doit terminer proprement sans laisser `isSelecting` Ghostty actif.

## 7. Visuel Android

- SVG dédié, forme goutte : tête arrondie + pointe/stem vers la ligne sélectionnée ; pas un cercle et pas un simple carré CSS.
- Couleur issue du token d’accent de l’UI, avec contraste garanti sur le canvas.
- Visuel environ 24×32 CSS px, hit target 48×48 CSS px ; zone transparente autour du SVG.
- `touch-action:none`, `user-select:none`, `aria-label` distinct pour début/fin.
- Overlay `pointer-events:none` pour ne jamais masquer le canvas ; seules les deux poignées capturent les événements.
- Vérifier aux bords gauche/droit/bas : la poignée reste visible autant que possible sans modifier le canvas ni le clipping du terminal.

## 8. Prévention des régressions

Avant d’activer le rendu des poignées, livrer une étape intermédiaire qui ne change que l’extraction du contrôleur et prouve que le surlignage reste identique.

Garde-fous obligatoires :

- le chemin long-press continue à dispatcher `mousedown + click(detail=2)` exactement comme avant ;
- le chemin swipe ne touche jamais `SelectionManager` ;
- un pointerdown sur poignée sort avant `pending/swipe/selecting` ;
- aucun `clearSelection()` dans les chemins de poignée ;
- les listeners document existants ne voient pas les poignées comme un clic extérieur ;
- l’overlay ne devient jamais parent du canvas et ne remplace pas le DOM créé par `term.open()` ;
- un test visuel manuel doit valider le surlignage avant d’autoriser le drag.

## 9. Tests automatisés

### Géométrie pure

- début et fin sur la même ligne ;
- sélection multi-lignes ;
- début/fin inversés ;
- canvas transformé par overscroll ;
- resize clavier et changement de `cols/rows` ;
- canvas partiellement hors viewport ;
- sélection absente → géométrie invisible.

### Contrôleur

- pointerdown poignée début ancre sur fin ;
- pointerdown poignée fin ancre sur début ;
- pointermove dispatcher dans l’ordre ;
- pointerup dispatcher une seule fois ;
- cancel libère l’état ;
- aucun `clearSelection` pendant un drag ;
- pointerdown poignée ne passe pas en mode swipe ;
- second pointer ignoré sans casser le premier.

### Device Android — matrice de sortie

1. appui long : mot surligné, clavier non rouvert ;
2. poignée fin : extension/réduction vers la droite et vers la gauche ;
3. poignée début : même vérification ;
4. croisement : inversion sans disparition du surlignage ;
5. scroll pendant sélection : poignées et surlignage restent alignés ;
6. clavier ouverture/fermeture et rotation : positions recalculées ;
7. Copier : texte copié, sélection et poignées conservées ;
8. tap simple/scroll normal : comportement v1 inchangé ;
9. changement d’onglet : aucune poignée d’un ancien terminal visible.

## 10. Séquencement d’implémentation

- [ ] Étape 0 — conserver l’APK connu bon et caractériser visuellement la sélection actuelle sur device.
- [x] Étape 1 — extraire `terminal-selection-geometry.ts` + tests purs. (4 tests passants)
- [ ] Étape 2 — extraire le contrôleur tactile sans modifier les comportements ; typecheck + tests.
- [ ] Étape 3 — ajouter un overlay inerte (poignées non interactives) ; vérifier surlignage et synchronisation scroll.
- [ ] Étape 4 — activer pointer capture et drag de la poignée `end` seulement ; build/install/device.
- [ ] Étape 5 — ajouter poignée `start`, inversion et cancel ; build/install/device.
- [ ] Étape 6 — ajuster SVG, hit target, bords, clavier et rotation ; build/install/device.
- [ ] Étape 7 — mettre à jour handoff, tests, plan et mémoire ; proposer `/audio-validate` non pertinent ici, `/health` non pertinent car pas de projet Rust modifié.

Chaque étape doit rester buildable et être validée avant la suivante. Aucun build ne doit combiner extraction, visuel et drag complet.

## 11. Commandes de validation

```powershell
cd D:\App\OpenCode\opencode\packages\app
bun typecheck
bunx biome check src/components/terminal.tsx src/components/terminal-touch-controller.ts src/components/terminal-selection-geometry.ts src/components/terminal-selection-overlay.tsx

cd D:\App\OpenCode\opencode\packages\mobile
$env:TEMP='D:\App\OpenCode\.build-temp'
$env:TMP='D:\App\OpenCode\.build-temp'
$env:ORT_LIB_LOCATION='D:/tmp/ort-android'
bun tauri android build --target aarch64
```

Signer l’APK unsigned avec `zipalign` puis `apksigner` et vérifier avant `adb install -r`. Toujours comparer l’heure de l’unsigned et du signed ; le précédent incident venait d’un APK signed antérieur au bundle frontend.

## 12. Critères de sortie

Le chantier est terminé seulement si :

- aucun changement de surlignage par rapport à l’APK connu bon hors drag ;
- les deux poignées ont le visuel goutte et une zone tactile utilisable ;
- chaque poignée se déplace réellement et suit le texte ;
- scroll, overscroll, clavier et rotation ne désalignent pas l’overlay ;
- crossing/inversion, Copier, désélection et multi-onglets passent ;
- tests automatisés, typecheck et Biome passent ;
- test humain device consigné dans le handoff ;
- diff final ≤400 LOC par étape ou découpé en commits indépendants.

## Décisions verrouillées

- conserver `ghostty-web` et son `SelectionManager` comme unique moteur de sélection ;
- ne pas modifier le code tiers de `ghostty-web` ;
- poignées style goutte Android, pas cercles ;
- Copier ne désélectionne pas ;
- ne pas recommencer une implémentation overlay complète sans étape visuelle inerte et validation device ;
- pas de commit/push automatique inclus dans ce plan.
## 13. Amendements issus de la review croisée des IA — v2

### Verdict consolidé

Les reviews convergent sur une note d’environ 8/10 : l’architecture séparation contrôleur/géométrie/overlay et le séquencement incrémental sont validés. Aucun avis ne recommande de réutiliser l’overlay autonome qui a régressé le produit. Les réserves portent toutes sur le pont d’événements, la géométrie exacte et le lifecycle mobile ; elles deviennent des gates obligatoires avant implémentation.

### Faits vérifiés dans ghostty-web

Lecture de `packages/app/node_modules/ghostty-web/lib/selection-manager.ts` :

- les handlers `mousedown`/`mousemove`/`click` sont attachés au canvas ;
- les handlers canvas convertissent `e.offsetX/e.offsetY` en cellule ;
- le handler `document.mousemove` utilise `clientX/clientY` puis `canvas.getBoundingClientRect()` ;
- le handler `document.mouseup` termine `isSelecting`, copie et émet `onSelectionChange` ;
- `normalizeSelection()` normalise l’ordre et convertit les lignes absolues en lignes viewport clamped ;
- `getSelectionPosition()` retourne donc des coordonnées de cellules viewport, pas des pixels physiques : aucun facteur DPR ne doit être appliqué à ces valeurs.

Conséquence : avant l’étape d’extraction, il faut vérifier sur le WebView réel que les `MouseEvent` synthétiques reçus sur le canvas exposent bien les `offsetX/offsetY` attendus. Si ce n’est pas le cas, le pont synthétique est bloqué et doit être adapté avant toute UI.

### Gate 0 — PoC du pont synthétique, avant tout refactor`r`n`r`n**Résultat 2026-07-10** : validé sur WebView réel via CDP/ADB. `offsetX/offsetY` correspondent aux coordonnées client attendues et un double-clic synthétique déclenche la copie Ghostty (`ClipboardItem:1`).

Ajouter temporairement une instrumentation dev-only, sans modification de comportement :

1. sélectionner un mot avec le chemin actuel ;
2. dispatcher un `mousedown` synthétique à une cellule connue ;
3. observer sur le canvas `clientX/clientY`, `offsetX/offsetY`, `getBoundingClientRect()` et la cellule calculée ;
4. dispatcher `mousemove` puis `mouseup` ;
5. vérifier que le surlignage se déplace et que `onSelectionChange` est émis.

Le PoC doit vérifier les champs complets :

```ts
{
  bubbles: true,
  cancelable: true,
  view: window,
  button: 0,
  buttons: 1, // mousedown/mousemove
  detail: 1,
  clientX,
  clientY,
  screenX,
  screenY,
}
```

Pour `mouseup`, `buttons: 0`. Conserver `lastClientX/lastClientY` afin que `pointercancel`, `lostpointercapture` et dispose puissent fermer le drag avec des coordonnées cohérentes. Le PoC est un stop-the-line : aucune extraction ni poignée interactive si la cellule synthétique ne correspond pas à la cellule attendue.

### Snapshot géométrique atomique

La géométrie ne doit jamais mélanger une sélection N avec un layout N-1. Chaque frame lit dans cet ordre :

```text
getSelection() + getSelectionPosition()
        ↓
canvas.getBoundingClientRect() final
        ↓
revision layout/overscroll
        ↓
SelectionGeometry unique
```

`getSelectionPosition()` est en cellules viewport ; le canvas rect est en CSS px. Le DPR n’intervient pas dans la conversion. Utiliser le rect final transformé par CSS ou un rect non transformé + offset, jamais les deux : l’overscroll ne doit être compté qu’une fois.

### HandleDrag renforcé

```ts
type HandleDrag = {
  activeSide: "start" | "end"
  pointerId: number
  anchorCell: { x: number; y: number }
  lastClient: { x: number; y: number }
  selectionRevision: number
  mouseDownDispatched: boolean
  mouseUpDispatched: boolean
}
```

`activeSide` reste attaché à la poignée physique saisie, même lorsque Ghostty inverse `start/end` après crossing. Le contrôleur ne bascule jamais l’identité du pointer vers l’autre poignée.

### Lifecycle obligatoire

La fin de drag est idempotente et centralisée dans `finishHandleDrag(reason)` :

- `pointerup` ;
- `pointercancel` ;
- `lostpointercapture` ;
- dispose du terminal ;
- changement d’onglet ou perte de visibilité.

Si `mouseDownDispatched && !mouseUpDispatched`, `finishHandleDrag` émet exactement un `mouseup`, puis libère la capture, annule le RAF et masque l’état actif. Les observers/listeners sont retirés systématiquement.

### Scroll, auto-scroll et MIUI

- `onSelectionChange` est une source primaire : elle couvre l’auto-scroll Ghostty même sans nouveau `pointermove` ;
- un RAF dirty unique coalesce toutes les sources et évite le layout thrashing ;
- `ResizeObserver`, fin de `fit()`, focus/blur textarea, `visualViewport.resize` et scroll sont des invalidations, pas des sources de vérité ;
- `visualViewport.resize` est un signal opportuniste sur MIUI, jamais l’unique signal ;
- le root overlay reste `pointer-events:none` ; seul le bouton poignée a `pointer-events:auto`, `touch-action:none` et `user-select:none` ; le container terminal conserve son scroll normal ;
- si un endpoint sort réellement du viewport après reflow clavier, la poignée est masquée ou clamped selon la géométrie Android définie, sans déplacer arbitrairement le canvas.

### Crossing et spike technique

Le crossing est validé avant la finition visuelle : après le PoC, un spike `end` déplace la poignée derrière `start`, puis vérifie que le surlignage reste présent, que `getSelectionPosition()` retourne le nouvel ordre normalisé et que le pointer physique actif continue son drag. Si le pont ne permet pas ce comportement, stopper et réviser le mécanisme d’ancrage plutôt que d’ajouter un état `isInverted` spéculatif.

### Séquence v2 obligatoire

- [ ] Gate 0 — instrumentation read-only `offsetX/offsetY`, listeners et rect.
- [x] Étape 1 — géométrie pure + tests de cellules viewport et rect transformé. (4 tests passants)
- [ ] Étape 2 — extraction mécanique du contrôleur sans changement de comportement ; compter le déplacement comme refactor mécanique, pas comme 400 LOC comportementales.
- [ ] Étape 2.5 — spike synthétique end + crossing + cancel/lostcapture, sans UI finale.
- [ ] Étape 3 — overlay inerte, rect final et scroll/resize/overscroll ; validation du surlignage inchangé.
- [ ] Étape 4 — poignée end interactive, pointer capture et auto-scroll ; build/device isolé.
- [ ] Étape 5 — poignée start, crossing et changement de rôle physique ; build/device isolé.
- [ ] Étape 6 — SVG goutte, hit target 48×48 CSS px équivalent WebView 48 dp, clipping et contraste.
- [ ] Étape 7 — matrice complète clavier, rotation, tabs, copie, désélection, cancel et dispose.

### Tests supplémentaires imposés

- `offsetX/offsetY` synthétiques correspondant à la cellule cible ;
- champs `button/buttons/detail/bubbles/cancelable/view` exacts ;
- double overscroll impossible avec canvas transformé ;
- `pointercancel` et `lostpointercapture` n’abandonnent jamais `isSelecting` ;
- dispose pendant drag n’émet qu’un seul `mouseup` ;
- RAF, ResizeObserver, visualViewport et scroll listeners nettoyés ;
- overlay supprimé sur changement d’onglet et aucun ancien handle visible ;
- crossing maintient le pointer physique sur la poignée initialement saisie ;
- focus/blur et fit recalculent même si `visualViewport` ne notifie pas MIUI.

Ces amendements remplacent les hypothèses implicites du plan initial. Le plan est prêt pour Gate 0, mais pas pour écrire le composant de poignées directement.
