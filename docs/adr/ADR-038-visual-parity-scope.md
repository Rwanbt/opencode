<!-- SPDX-License-Identifier: MIT -->
<!-- Copyright (c) 2026 Unifia contributors -->

# ADR-038 — Visual parity scope with the v110 mockup

> **Statut** : DECIDED (2026-09-12)
> **Source** : user mandate "l'interface portée doit être identique à la maquette"
>   pointing at `Unifia-UI-UX-v110-PORT-READY-R1.html` (97 modules, 2.4 MB,
>   frozen 2026-09-10).
> **Portée** : `packages/app/src/styles/v110.css` Phase 35 block,
>   component-level data-v110 markers, scope of what is / is not
>   visual-parity work.

## Contexte

La maquette HTML v110-PORT-READY-R1 contient 97 modules pour 2.4 MB
de JSX inline. Le port runtime réutilise massivement les composants
Tailwind existants ; atteindre la parité visuelle pixel-perfect demande
soit (a) un re-styling complet de chaque composant, soit (b) un
ensemble de règles CSS v110 partagées qui harmonisent l'ensemble.

## Décision

Stratégie (b) : une feuille `v110.css` centralisée qui pose les
**chrome tokens** (background, border, focus, motion) pour chaque
surface v110, ancrée sur des attributs `data-v110=` ou `data-component=`
stables. Les host components restent maîtres de leur geometry et de
leur Tailwind ; le CSS ne fait qu'harmoniser le rythme.

### Surfaces couvertes par Phase 35

- `shell-frame` (root)
- `v110-topbar` (header)
- `mobile-nav` (bottom bar ≤599px portrait)
- `sidebar-nav-desktop` (hover-peek authority)
- `workspace-tabs-bar` (between topbar and workspace)
- `composer` + `session-composer-region` (chat input bottom)
- `inspector-frame` (right panel, 3 tabs)
- `editor-pane` (center)
- `code-gutter` + `diagnostic-marker`
- `terminal-panel` (bottom session)
- `file-tree` (explorer inspector tab)
- `work-surface` (work mode)
- `memory-vault` + `memory-note-pane` + `memory-links`
- `toast-region`
- `[role="dialog"]` (settings, model, provider, etc.)
- `[data-settings-pane]`
- `[data-auth-pane]`
- `[data-workspace-create]`

### Principes de la parité

1. **Pas de pixel-perfect** : on suit le rythme (radius, borders, focus
   rings), pas chaque couleur exacte. Le design system Tailwind du
   runtime reste la source de vérité pour les couleurs sémantiques.
2. **Pas de remplacement de classes Tailwind** : on ajoute, on ne
   supprime pas. Si une classe Tailwind écrase le CSS v110 sur un host,
   la classe Tailwind gagne (cascade specificity).
3. **Ancré sur data-v110= / data-component=** : selectors stricts pour
   ne pas affecter les composants hors v110 (workbench-tabs-bar
   legacy, etc.).
4. **Réduit motion respecté** : tous les `transition` + `animation`
   sont désactivés sous `@media (prefers-reduced-motion: reduce)`.

### Honesty scope

Les éléments suivants restent **hors scope de Phase 35** :

- **Maquette HTML 2.4 MB** : relecture pixel-perfect non faite. Les
  surfaces manquantes peuvent exister (97 modules, certains
  probablement hors de ce qu'on a taggé `data-v110`).
- **Wires internes** : certains composants runtime ont déjà des
  classes Tailwind qui s'écrasent avec le CSS v110 ajouté. Refactor
  complet requis pour atteindre pixel-perfect.
- **Couleurs sémantiques** : `text-danger`, `text-warning`,
  `text-success`, `accent-base`, `shadow-overlay` — utilisés dans la
  nouvelle CSS mais pas définis dans `tokens/viewport.ts`. Si le
  design system les expose ailleurs, ils prennent ; sinon, ils
  tombent en fallback `--text-weak` (acceptable mais à raffiner).

**Phase 38 update (commit `db703d0183`)** : les tokens sémantiques
sont maintenant définis dans `tokens/semantic.ts` (testé 5/5 PASS)
et enregistrés dans le bloc `:root { ... }` de `v110.css`. Le
fallback `--text-weak` n'est plus nécessaire pour les surfaces
couvertes par Phase 35. La dette "semantic tokens absents" est
**fermée**. Restent à raffiner (post-Phase 38) :
- `tokens/semantic.ts` n'est pas encore consommé par
  `tokens/viewport.ts` — un futur ADR-039 pourrait unifier.
- Les couleurs sémantiques actuelles sont des RGB triplets fixes ;
  le design system theme (`@unifia/ui/theme`) n'est pas encore
  consulté. Une fois le thème exposé, on basculera les valeurs sur
  `var(--text-danger)` côté theme plutôt que RGB direct.

### Tests de vérification

Pas de test Playwright snapshot ajouté (infra `@solidjs/testing-library`
bloquée — voir ADR-037 + commit `923533c739`). Vérification manuelle
sur le navigateur à chaque modification de `v110.css`.

## Consequences

- ~150 LOC de CSS v110 ajoutées sur `packages/app/src/styles/v110.css`
- Aucune modification des host components (sauf A4 terminal +
  mobile-diff déjà taggés, A6 MVP déjà taggés)
- Typecheck vert, strict gate 5/5 PASS attendu
- Aucune promotion vers `work-design` recommandée (cf. ADR-037)

## Alternatives rejetees

- **Re-styling complet de chaque composant** : 10-20 h, risque
  élevé, hors scope session
- **CSS-in-JS runtime (Tailwind plugins)** : dépendance runtime
  accrue, hors ADR
- **Shadow DOM encapsulation** : trop invasif pour un port v110

## References

- `packages/app/src/styles/v110.css` (Phase 35 block, this commit)
- `docs/ui-reference/v110/INTERACTIONS.md` — surface tokens
- `docs/ui-reference/v110/VISUAL-GATES.md` — visual regression cases
- `Unifia-UI-UX-v110-PORT-READY-R1.html` (maquette, frozen 2026-09-10)
