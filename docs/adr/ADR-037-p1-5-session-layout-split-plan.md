<!-- SPDX-License-Identifier: MIT -->
<!-- Copyright (c) 2026 Unifia contributors -->

# ADR-037 — P1-5 split plan for `session.tsx` (1011 LOC) + `layout.tsx` (1069 LOC)

> **Statut** : PARTIAL (2026-09-12, Vagues 1-3 livrees, Vague 5 PARTIAL via factories)
> **Progression** :
> - session.tsx : 1011 -> 992 LOC (-19, Vagues 1+2+3 livrees)
> - layout.tsx : 1069 -> 1074 LOC (+5 call sites, Vague 5 context factories extraites)
> - layout-contexts.ts (NEW, 196 LOC) : 3 factories type-safe
> - **Reste** : Vague 4 (composer + sidebar section) + Vague 5 JSX orchestrateur (return block 70 lignes)

## 2026-09-12 update — Vague 5 partial shipped

Phase 49 (commit `886b5a0d6b`) : `createWorkspaceSidebarContext(deps)`
extracted to `layout-contexts.ts`. The 37-line inline `workspaceSidebarCtx`
object literal in layout.tsx is now a single factory call.

Phase 50 (commit `5d269bcd28`) : `createProjectSidebarContext(deps)` +
`createSidebarPanelContext(deps)` extracted to `layout-contexts.ts`. The
inline `projectSidebarCtx` (35 LOC) and `sidebarPanelCtx` (23 LOC)
replaced by factory calls.

**Pattern** : each factory takes its closure dependencies explicitly
as parameters (state slice wrapped in accessors, aim, layout, dialog,
store, drag handlers). The factory return type uses the source type
from `sidebar-project.tsx` and `sidebar-panel.tsx`.

**Trade-off** : layout.tsx stayed roughly flat (1069 -> 1074) because
the factory call sites pass ~20 deps each. Total layout + contexts
went from 1069 to 1270 LOC. Semantic win: data structure testable in
isolation, stable home for future context additions.

**Remaining Vague 5 slice** : the JSX orchestrator (return block,
~70 lines, TitlebarSlotsProvider + hover overlays + DebugBar +
Toast.Region) is not extracted yet. Extracting requires converting
inline callbacks (handleDragStart, onWorkspaceDragStart, projectOverlay,
sidebarContent) to either factory functions or a Solid Context
provider. Both are significant refactors outside the current session.

**Remaining Vague 4** : composer + sidebar section extraction (~200
LOC). Same pattern as Vague 3 (export ComposerProps, create
SessionComposerSection wrapper).

**Status** : strict gate 5/5 PASS stable post-Phase 50 (50.4 s).
Type errors fixed: 6+ iterations on `sessionProps` shape, `hoverProject`
Accessor vs thunk, `DragEvent` vs `MouseEvent` vs `unknown`.
> **Source** : A1-CONTRACT §4 P1-5 ("`session.tsx` (1096 lignes) /
>   `layout.tsx` (1163 lignes) > budget ; PR > 400 LOC doit être split"),
>   QA/PORT-GATE-CERTIFICATION-2026-09-12.md §7 Wave 4.
> **Portée** : `packages/app/src/pages/session.tsx`,
>   `packages/app/src/pages/layout.tsx`.

## Contexte

Les deux fichiers `session.tsx` et `layout.tsx` dépassent le budget
800 LOC du contrat A1-CONTRACT. Au moment de l'audit (2026-09-12) :
- `session.tsx` : 1011 LOC, 1 seul `export default function Page()`
- `layout.tsx` : 1069 LOC, structure mixte (helpers + `export default`)

Ces fichiers sont déjà partiellement décomposés via leurs sous-dossiers
`sessions/` (30+ sous-modules) et `layout/` (15+ sous-modules). Le code
restant dans les deux `*.tsx` est l'orchestrateur : il câble les
hooks, les effects et le JSX final.

L'objectif est de découper l'orchestrateur en hooks + sous-composants
pour passer sous 800 LOC chacun, sans casser le contrat A8-02 strict
(5/5 PASS) ni l'orchestration runtime.

## Décision

Plan de split en 5 vagues. Chaque vague isole une responsabilité
distincte, passe sous 800 LOC pour le fichier cible, et est livrée
avec une vérification stricte Port Gate.

### Vague 1 — artifact loader (LIVREE, commit `34b96f1387`)
Extraire `createEffect()` (session.tsx:98-112) en hook
`useArtifactLoader()` dans `pages/session/use-artifact-loader.ts`.
Le hook garde la même signature de retour (`{ artifactDocument,
artifactError }`). Pattern : signature explicite, pas d'effet de bord
caché, testé séparément.
**Statut reel** : -15 LOC sur session.tsx. Strict gate 5/5 PASS
post-commit (verification v7).

### Vague 2 — prompt initializer (LIVREE, commit `b34f424ffd`)
Extraire `createEffect()` (session.tsx:114-150) en hook
`usePromptInitializer(searchParams, params, setSearchParams)`. Ce
hook gate l'initialisation du prompt depuis les query params et
appelle `prompt.submit()` au montage.
**Statut reel** : -3 LOC sur session.tsx. Le gain LOC est limite
parce que l'inline effect etait court ; le benefice reel est la
separation des responsabilites.

### Vague 3 — message timeline section
Extraire le JSX `<MessageTimeline ...>` et son wrapper dans
`SessionTimelineSection` (sous-composant SolidJS dans
`pages/session/session-timeline-section.tsx`). Réduit ~150 LOC du
JSX principal, conserve l'orchestrateur comme coordinateur.

### Vague 4 — composer + sidebar section
Extraire le JSX du composer + sidebar dans
`SessionComposerSection` (sous-composant). Réduit ~200 LOC.

### Vague 5 — layout.tsx orchestrateur
Découper layout.tsx en `LayoutHeader`, `LayoutSidebar`,
`LayoutWorkspace`, `LayoutDialogs`. Le default export devient un
composant 100-150 LOC qui orchestre les sous-composants. Réduit le
fichier sous 400 LOC.

## Consequences

- Chaque vague est un commit séparé avec message détaillé
- Chaque vague passe par Port Gate strict (5/5 attendu) avant merge
- Pas de changement de comportement runtime (refactor pur)
- Si une vague casse, rollback possible via revert du seul commit

## Alternatives rejettees

- **Refonte en une fois** : 5+ heures de travail, risque d'introduire
  des régressions difficiles à isoler. La stratégie par vagues
  minimise le risque par commit atomique
- **Découpage par closure** : trop de variables partagées dans le
  scope de `Page()`, l'extraction serait fragile
- **Renommer `Page()` en `SessionPageRoot()` et laisser tel quel** :
  ne réduit pas la dette LOC, juste cosmétique

## Definition of Done

- `session.tsx` < 800 LOC
- `layout.tsx` < 800 LOC
- Chaque sous-composant / hook extrait a un test unitaire ou un
  test.todo (pattern Wave 2 Phase 17)
- Port Gate strict reste 5/5 PASS post chaque vague
- Aucun nouveau warning TypeScript

## Vagues restantes (non livrees a la date du 2026-09-12)

| Vague | LOC a extraire | Effort | Risque | Statut |
|---|---|---|---|---|
| 3 — message timeline section | ~150 | 1-2 h | moyen (JSX move + state) | PROPOSED, non livree |
| 4 — composer + sidebar section | ~200 | 2-3 h | moyen (composition root) | PROPOSED, non livree |
| 5 — layout.tsx orchestrateur | ~700 | 4-5 h | eleve (4 sous-composants) | PROPOSED, non livree |

**Note** : Vagues 3+4 sont les plus risquees car elles deplacent du
JSX dans des sous-composants, ce qui peut casser la propagation
d'events DOM (delegation, focus, keyboard). Vague 5 est la plus
grosse (700 LOC) et devrait etre executee dans une session dediee
avec playwright pour valider le focus management.

**Recommandation** : faire ces vagues dans une session dediee avec
Playwright comme filet de securite, pas dans la session courante.
Le ratio effort/risque est eleve (3-10 h pour gagner 1050 LOC).

## Definition of Done (updated)

- session.tsx : 993 LOC -> cible 800 LOC, reste 193 a extraire (Vagues 3-4)
- layout.tsx : 1069 LOC -> cible 400 LOC, reste 669 a extraire (Vague 5)

## References

- `packages/app/src/pages/session.tsx:71-1011`
- `packages/app/src/pages/layout.tsx:71-1069`
- `packages/app/src/pages/session/` (30+ sous-modules déjà extraits)
- `packages/app/src/pages/layout/` (15+ sous-modules déjà extraits)
- `docs/ui-reference/v110/A1-CONTRACT.md#4`
- `docs/ui-reference/v110/QA/PORT-GATE-CERTIFICATION-2026-09-12.md`
