<!-- SPDX-License-Identifier: MIT -->
<!-- Copyright (c) 2026 Unifia contributors -->

# ADR-036 — Memory hover preview via native `title=` attribute

> **Statut** : DECIDED (2026-09-12)
> **Source** : INTERACTIONS §Memory ("Vault | Note | Links-context
>   triptyque with hover previews"), QA/PORT-GATE-CERTIFICATION-2026-09-12.md
>   §7 phase 10, commit `2b1eaf7977 feat(memory,gate): hover previews on Memory links + cartesian split`.
> **Portée** : `pages/session/memory-panel-model.ts`,
>   `pages/session/memory-panel.tsx`, `pages/session/memory-panel-model.test.ts`.

## Contexte

INTERACTIONS §Memory spec exige que les notes referencees (links +
backlinks) exposent un hover preview — actuellement, le panel montre
juste le titre. La surface Memory est deja a 95 % livree (vault, note
preview/source/split, graph, backlinks, search input) ; seul le hover
preview manquait. L'audit identifie ce point comme le seul vrai gap
Memory residuel.

## Décision

Implementation via l'attribut HTML `title=` natif :
1. Nouvelle fonction pure `memoryExcerpt(body, max)` dans
   `memory-panel-model.ts` qui strippe le markdown inline (images,
   links, code marks, headings), collapse les whitespace, tronque
   avec une ellipse sur boundary de mot
2. 2 tests unitaires (noise stripping + short-body passthrough)
3. Dans `memory-panel.tsx`, 2 memos `linkedExcerpt()` et
   `backlinksExcerpt()` calculent le map path->excerpt sur le
   body de la note selectionnee. Les buttons linked/backlinks
   exposent `title={`${item.title}\n${excerpt}`}`. Les vault items
   exposent `title={item.path}` (chemin complet en tooltip)

## Consequences

- Accessible par defaut : `title=` est announce par les screen
  readers et affiche par tous les navigateurs
- Pas de nouveau composant SolidJS : pas de risque de regression
  sur le rendu
- i18n : l'excerpt est en anglais (le panel Memory ne traduit pas
  les notes utilisateur) — acceptable pour MVP, un jour on
  pourrait ajouter un `i18n.t("memory.hoverPrefix")` pour le
  prefix du tooltip
- Performance : `memoryExcerpt` est O(N) sur le body (longueur
  typique 200-2000 chars), appel sur changement de selection
  uniquement. Pas de memoization au-dela de `createMemo` SolidJS

## Alternatives rejettees

- Composant tooltip custom (popover SolidJS) : 4-6 h, risque de
  regression a11y, pas justifie par l'usage (tooltips textuels
  simples)
- Hover via fetch + cache du body des notes ciblees : trop
  invasif, le body de la note courante suffit pour le preview
- Pas de hover preview (laisser tel quel) : INTERACTIONS §Memory
  non respecte, point d'audit explicitement identifie

## Sortie du scope MVP

Pour passer en "rich hover" :
1. Composant tooltip custom avec markdown rendering
2. Fetch du body des notes liees pour un vrai apercu
3. i18n des labels

## References

- `pages/session/memory-panel-model.ts:32-50` (memoryExcerpt)
- `pages/session/memory-panel-model.test.ts:30-45`
- `pages/session/memory-panel.tsx:95-105` (memos linkedExcerpt,
  backlinksExcerpt)
- `pages/session/memory-panel.tsx:130-145` (wiring `title=` attrs)
- `docs/ui-reference/v110/INTERACTIONS.md#memory`
- `docs/ui-reference/v110/QA/PORT-GATE-CERTIFICATION-2026-09-12.md`
