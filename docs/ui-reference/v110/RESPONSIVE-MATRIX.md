# RESPONSIVE-MATRIX — contrats v110 (ne pas reinventer)

## Breakpoints canoniques (manifest)

- desktop-wide: width >= 1200 — side panels grid-reserved, layouts chat/split/main.
- desktop-compact: 900-1199 — single-side-utility, context et inspector mutuellement exclusifs.
- tablet-portrait: 600-839 portrait — overlays, layouts chat/main.
- phone-portrait: width <= 599 portrait — overlays, single pane + bottom nav.
- compact-landscape: height <= 560 et width <= 980 landscape — overlays, chat/split/main.

## Viewports de certification (e2eContract)

- 1920x1080, 1440x900, 1280x800, 1024x768 (desktop).
- 768x1024 (tablet portrait), 1024x768 (tablet landscape).
- 390x844, 360x800 (mobile portrait), 844x390 (mobile landscape).
- Tester aussi les seuils immediatement autour des breakpoints.

## Invariants par viewport

- desktop-wide: context peut coexister avec inspector; workspace non-overlapped.
- desktop-compact: ouvrir context ferme inspector et inversement.
- tablet-portrait: context et inspector en overlay.
- phone-portrait: overlay exclut l interaction workspace tant qu ouvert.
- compact-landscape: overlay commence apres le rail compact; split reste disponible.

## Regles globales

- Aucun overflow global involontaire (audit v98: root-overflow > 6px = fail).
- Aucun panneau recouvrant le workspace sans comportement overlay prevu.
- Aucun controle coupe, aucun z-index incorrect, aucun element inaccessible.
- Touch targets: carres 31px desktop, 38-44px touch (contrat square, pas de rectangles 31x44).
- Scroll correct, safe-area correcte, layout switching correct.
- Conteneurs reels: workspace-body et surfaces sont des containers (container queries); les composants reagissent a l espace recu, pas au nom du device.
- Deduplication: une seule source de verite responsive (pas de second store local concurrent).

## Layouts par mode (matrice minimale)

Pour chaque mode pertinent (code/work/design/automate + memory note/graph + settings/user):

- Chat / Split / Main (Graph seulement Memory, independant du layout global).
- panneau gauche ouvert/ferme, inspector ouvert/ferme (avec invariant desktop-compact).
- Explorer, Trajectory/Observability (onglet Execution de l inspector natif).
- desktop + tablet + mobile portrait + mobile landscape.

## Handset specifics (valide v99-v110)

- Code: terminal cache par defaut a la premiere entree compacte; codebar 38px homogene.
- Work: header 40px, tabs 38px, toolbar nowrap, More fixe en haut (pas dans les tabs).
- Design: bottom-bar unifiee (zoom + changebar + layers), layers = bottom-sheet resizable 190-620px.
- Automate: runbar une ligne scrollable, run/stop 30-34px icones, tools bottom-centre, nodes = bottom-sheet.
- Memory: toolbar 42px une ligne, persistence masquee en compact, editor = hauteur restante exacte.
