<!-- SPDX-License-Identifier: MIT -->
<!-- Copyright (c) 2026 Unifia contributors -->

# ADR-037 — P1-5 split plan for `session.tsx` (1011 LOC) + `layout.tsx` (1069 LOC)

> **Statut** : PROPOSED (2026-09-12)
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

### Vague 1 — artifact loader (livré dans ce commit)
Extraire `createEffect()` (session.tsx:98-112) en hook
`useArtifactLoader()` dans `pages/session/use-artifact-loader.ts`.
Le hook garde la même signature de retour (`{ artifactDocument,
artifactError }`). Pattern : signature explicite, pas d'effet de bord
caché, testé séparément.

### Vague 2 — prompt initializer
Extraire `createEffect()` (session.tsx:114-150) en hook
`usePromptInitializer(searchParams, params, setSearchParams)`. Ce
hook gate l'initialisation du prompt depuis les query params et
appelle `prompt.submit()` au montage.

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

## References

- `packages/app/src/pages/session.tsx:71-1011`
- `packages/app/src/pages/layout.tsx:71-1069`
- `packages/app/src/pages/session/` (30+ sous-modules déjà extraits)
- `packages/app/src/pages/layout/` (15+ sous-modules déjà extraits)
- `docs/ui-reference/v110/A1-CONTRACT.md#4`
- `docs/ui-reference/v110/QA/PORT-GATE-CERTIFICATION-2026-09-12.md`
