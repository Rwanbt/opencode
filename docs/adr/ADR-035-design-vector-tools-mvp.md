<!-- SPDX-License-Identifier: MIT -->
<!-- Copyright (c) 2026 Unifia contributors -->

# ADR-035 — Design vector tools MVP (D03-D06 contract surface)

> **Statut** : DECIDED (2026-09-12)
> **Source** : COMPONENT-MAP §5 D03-D06 + INTERACTIONS §Design
>   (toolbar v55 unique, vector-toolbar v54, SVG selection, Bezier),
>   QA/PORT-GATE-CERTIFICATION-2026-09-12.md §7 phases 3-5,
>   commit `83648a0d3f feat(design): ship v110 MVP for D02 layers and D03-D06 vector tools`.
> **Portée** : `pages/workbench/design-vector-tools.tsx`.

## Contexte

INTERACTIONS §Design impose une toolbar unique non-empilee (v55)
avec tools vector (v54) : select, rectangle, line, ellipse, Bezier.
Plus : selection handles 8 points (NW/N/NE/E/SE/S/SW/W) pour la
selection active, et un renderer Bezier path. Le canvas runtime
(`design-sketch-tab.tsx`, `artifact-preview` iframe) heberge le
contenu reel mais doit pouvoir monter ces outils sans dupliquer
la logique.

## Décision

Livraison MVP d'un module unique `design-vector-tools.tsx` exposant
4 composants exportes :
- `DesignVectorToolbar(props.tool, props.onTool)` — 5 tools dans
  une seule row (pas d'empilement), `data-v110="design-vector-toolbar"`
  pour autorite shell
- `DesignSelectionHandles(props.selection)` — 8 handle squares +
  dashed selection frame, positionne en SVG coordinates
- `DesignBezierPath(props.points)` — renderer cubic path minimal,
  utilise le midpoint de chaque segment comme control point
- `DesignVectorCanvas(props)` — convenience combinant toolbar +
  SVG canvas + status line, gere son propre tool state via
  `createSignal<DesignVectorTool>`

`DesignVectorTool = "select" | "rect" | "line" | "ellipse" | "bezier"`
type exporte pour les consumers.

## Consequences

- A1-CONTRACT: surface v110 respectee (5 tools accessibles,
  selection handles, Bezier path)
- Rotate transform : pas livre (8 handles sont translates, pas
  rotation). Le contrat INTERACTIONS §Design mentionne "drag/resize/
  rotate" — rotate releve d'une extension future
- Multi-segment Bezier : pas livre (le renderer gere 2+ anchors
  via midpoint control points, pas de courbe de Bézier vraie avec
  handles editables). Le runtime canvas peut reimplementer un
  renderer plus sophistique
- Wiring canvas runtime : les composants sont mountable mais pas
  montes par defaut. `design-sketch-tab.tsx` peut les importer sans
  dependance circulaire (le module n'importe rien du runtime)

## Alternatives rejettees

- Implementer rotate : necessite 4 corner handles supplementaires
  avec cursors `cursor: nesw-resize` etc. — 2-3 h
- Implementer multi-segment Bezier editable : necessite drag handles
  sur les control points — 3-4 h
- Reporter a une session future : risque que D03-D06 restent non
  livres indefiniment

## Sortie du scope MVP

Pour passer en "full delivery" :
1. Ajouter rotate handles dans `DesignSelectionHandles`
2. Implementer multi-segment Bezier editable avec handles de control
3. Monter `DesignVectorCanvas` dans `design-sketch-tab.tsx` au lieu
   du placeholder actuel

## References

- `pages/workbench/design-vector-tools.tsx:1-150`
- `docs/ui-reference/v110/COMPONENT-MAP.md#8`
- `docs/ui-reference/v110/INTERACTIONS.md#design`
