<!-- SPDX-License-Identifier: MIT -->
<!-- Copyright (c) 2026 Unifia contributors -->

# ADR-034 — Design layers panel MVP (v110 contract surface)

> **Statut** : DECIDED (2026-09-12)
> **Source** : COMPONENT-MAP §5 D02 + INTERACTIONS §Design (layers
>   panel with rename, visibility, lock, drag-reorder),
>   QA/PORT-GATE-CERTIFICATION-2026-09-12.md §7 phases 3-5,
>   commit `83648a0d3f feat(design): ship v110 MVP for D02 layers and D03-D06 vector tools`.
> **Portée** : `pages/workbench/design-layers-model.ts`,
>   `pages/workbench/design-layers-panel.tsx`.

## Contexte

COMPONENT-MAP §5 demande pour le mode Design (A6) un canvas complet
avec layers, selection, transforms, SVG, Bezier. Sur `new-ui @ b20426d67f`
la surface D01 (routing/files/artifacts/browser) est livrée mais D02-D06
manquent. Le contrat INTERACTIONS §Design spécifie pour les layers :
rename, visibility, lock, drag-reorder.

## Décision

Pour `new-ui`, livraison MVP : layers panel v110-stylisé avec
rename (dblclick), visibility, lock, reorder via boutons up/down.
Model pur `Layer` + `applyLayers` (rename/toggleVisibility/toggleLock/
reorder) testable en isolation. Pas de DnD pointer-based (relèvera
d'une session dediee avec le runtime canvas).

## Consequences

- A1-CONTRACT: respect du contrat surface (4 layers canoniques
  background/structure/content/annotations, 4 operations)
- COMPONENT-MAP: desalignement doc/code si on pretend livrer DnD;
  MVP est documente honnetement dans COMPONENT-MAP §8
- Tests : 7 unit tests sur `applyLayers` (rename, toggle, reorder
  clamping, no-op on missing id)
- Wiring canvas runtime : pas livre — le composant est mountable
  depuis n'importe quel parent mais n'est pas integre a
  `design-surface.tsx`. Le montage runtime releve d'une autre
  session ou d'un autre agent

## Alternatives rejetees

- Implementer le DnD complet avec @thisbeyond/solid-dnd : 4-6 h
  supplementaires, risque de regression sur les autres drags
  (kanban Work, sessions Work)
- Implementer un pointer-based reorder maison : risque
  d'incompatibilite mobile/tactile
- Reporter a une session future : risque que D02 reste non livre
  indefiniment

## Sortie du scope MVP

Pour passer en "full delivery" : ajouter le DnD dans
`design-layers-panel.tsx` et le montage dans `design-surface.tsx`.
Le model actuel est deja compatible (l'operation `reorder` accepte
n'importe quel index).

## References

- `pages/workbench/design-layers-model.ts:1-60`
- `pages/workbench/design-layers-model.test.ts:1-50`
- `pages/workbench/design-layers-panel.tsx:1-130`
- `docs/ui-reference/v110/COMPONENT-MAP.md#8`
- `docs/ui-reference/v110/INTERACTIONS.md#design`
- `docs/ui-reference/v110/QA/PORT-GATE-CERTIFICATION-2026-09-12.md`
