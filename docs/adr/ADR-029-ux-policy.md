<!-- SPDX-License-Identifier: MIT -->
<!-- Copyright (c) 2026 Unifia contributors -->

# ADR-029 — UX Policy (C-AR-04)

> **Statut** : DECIDED
> **Date** : 2026-09-02
> **Source** : C-AR-04 (ouvert depuis M1, résolu post-M3-R3),
>   plan V2.3.1 §230 (UX track) + §155-160 (EXECUTION_PROFILE
>   REQUIREMENTS, design surface),
>   `@unifia/contracts/src/ux.ts` (UX-01 livré),
>   `@unifia/contracts/test/ux.test.ts` (8/8 PASS),
>   ADR-013 (browser isolation, déjà DECIDED),
>   ADR-024 (extension isolation, déjà DECIDED).
> **Cible** : `Automate Core × local-single-node × Windows` (puis
>   tous les profiles impliquant l'UI : Browser, AI, Enterprise,
>   Desktop).

## Status

DECIDED. ADR de **politique d'ingénierie** (cadre UI/UX), ni runtime
ni schéma — définit le contrat que toute surface UI doit respecter.
**N'est PAS** bloqué par ADR-000.

## Contexte

L'UX-01 contract (`@unifia/contracts/src/ux.ts`) est livré et testé
(8/8 PASS). Mais plusieurs décisions UI/UX de fond n'ont pas encore
d'ADR pour les porter :

1. **Quel framework UI** ? Solid (déjà en place, voir
   `package.json#workspaces.catalog.solid-js: 1.9.10`),
   React, Vue, Svelte ? La question se pose pour les nouveaux
   modules (post-M3).
2. **Quel design system** ? Tailwind seul, Kobalte (déjà
   pinné `0.13.11` dans le catalog), un design system custom,
   lumen-ui (cf. projet Erwan, `D:\App\lumen-ui`) ?
3. **Tokens de design** ? Où vivent les `colors`, `spacing`,
   `typography` ? Variables CSS, JSON, JS ?
4. **A11y standard** ? WCAG 2.1 AA (déjà audité, R-002/R-003),
   WCAG 2.2 AAA ? Section 508 ?
5. **Internationalisation** ? Quelle stratégie i18n (R-008
   connexes, 21 langues déjà en place d'après `0015-i18n-21-
   languages.md`) ?
6. **Mode offline-first** ? Toutes les surfaces UI doivent-elles
   fonctionner sans réseau ? Le profile `local-single-node`
   l'exige.
7. **Visual regression baseline** ? Comment géré-t-on les
   baselines screenshot (R-007 Linux baseline manquant) ?
8. **Theming** ? Light/dark obligatoire, custom themes par
   workspace ?

C-AR-04 ratifie une politique par défaut pour ces 8 axes, à
actualiser en ADR-030+ si la doctrine évolue.

## Decision

### 1. Framework UI (par surface)

- **SolidJS obligatoire pour le workbench** (déjà en place). Pas
  de React, pas de Vue, pas de Svelte pour cette surface.
  Rationale : cohérence avec l'existant, perf (signals > virtual
  DOM), bundle size.
- **Tauri host UI (DK-01) : framework libre, recommandation
  SolidJS** pour rester dans la même école. Pas bloquant.
- **Web surfaces externes (docs, marketing, account portal) :
  framework libre** au choix de l'équipe, sauf contrainte
  de cohérence (sections publiques seulement).
- **Pas d'introduction de React** dans le workbench, même pour
  une dépendance transitive. Si une lib React est nécessaire
  (ex. éditeur tiers), elle est wrappée dans un web component
  (Lit ou vanilla custom element).

### 2. Design system

- **lumen-ui pour le workbench** (projet Erwan, `D:\App\lumen-ui`,
  design system egui-flavored, Rust). Cible post-M3. Pas
  immédiatement (SolidJS natif d'abord), mais la cible de
  convergence est lumen-ui.
- **Kobalte (`@kobalte/core`, pinné `0.13.11`) pour les primitives
  a11y** (combobox, dialog, popover, listbox). SolidJS-native,
  WCAG 2.1 AA ready.
- **Tailwind 4.x pour le styling utility-first** (déjà pinné
  `4.1.11` dans le catalog). Pas de CSS-in-JS, pas de
  styled-components, pas de CSS Modules (sauf cas exceptionnel
  justifié).
- **Pas de Material UI, pas de Chakra, pas de Mantine** pour le
  workbench. Trop opinionated, conflits avec lumen-ui cible.

### 3. Tokens de design

- **Source unique** : `apps/web/app/styles/tokens.css` (racine
  monorepo, à créer si manquant). Format CSS custom properties
  (`--color-bg`, `--spacing-2`, etc.).
- **Trois niveaux** :
  - **Primitive** : valeur brute (`--blue-500: #3b82f6`).
  - **Semantic** : usage (`--color-action-primary: var(--blue-500)`).
  - **Component** : scoped (`--button-bg: var(--color-action-
    primary)`).
- **Light + dark obligatoires** : chaque primitive a une variante
  dark via `:root[data-theme="dark"]`. Pas de thème custom par
  workspace en V2.3.1.
- **Pas de tokens en JS/TS** : tout reste en CSS pour éviter la
  duplication et profiter du cascade. Les composants Solid
  accèdent aux tokens via `var(--token-name)` dans le template.

### 4. Accessibilité (a11y)

- **Standard** : WCAG 2.1 AA, niveau minimum sur toutes les
  surfaces du workbench. Cible : WCAG 2.1 AAA sur les surfaces
  critiques (editor de workflow, surface d'approbation).
- **Axe obligatoire** : `axe-core/playwright` déjà en place
  (cf. `certification/gates.yaml §4 a11y_axe`). Audité en CI
  sur 6 états (light/dark × 3 viewports).
- **Color contrast** : R-002 (text-text-weak) déjà documenté,
  fix tracké. Pas de nouveau raccourci de contraste.
- **Keyboard-first** : tout interactif est utilisable au clavier.
  Pas d'exceptions (mouse-only ou touch-only interdit).
- **Focus visible** : `:focus-visible` doit être stylé. Pas de
  `outline: none` sans alternative visible.
- **Section 508** : non exigé en V2.3.1 (cible première privée
  US-only, marché enterprise). Si besoin enterprise se présente
  (EN-02 audit log), réouverture ADR.

### 5. Internationalisation (i18n)

- **Strategy** : `@formatjs/intl` (recommandé SolidJS) ou
  `i18next` (déjà en usage probable côté workbench). Pas de
  consensus figé en V2.3.1 — choix au cas par surface.
- **Catalogue** : 21 langues déjà en place d'après
  `0015-i18n-21-languages.md` (EN, FR, DE, ES, IT, PT, NL, PL,
  RU, UK, CS, SK, HU, RO, BG, EL, TR, ZH, JA, KO, AR). Cible
  première FR + EN obligatoires.
- **Pas de hard-coded strings** dans les composants. Tout texte
  visible transite par `t('key')` ou équivalent.
- **RTL** : supporté via `dir="rtl"` au niveau racine, mais pas
  testé systématiquement en V2.3.1. Cible post-M3 pour les
  langues RTL (AR, HE futur).

### 6. Mode offline-first

- **Cible première `local-single-node` exige offline-first** :
  toute interaction UI doit fonctionner sans réseau.
- **Pas de fetch CDN** au runtime. Toutes les dépendances UI
  sont bundlées. Tailwind compilé, fonts locales, icônes
  locales (Lucide ou équivalent via `node_modules/`, pas
  via `<link rel="stylesheet" href="https://...">`).
- **Pas d'analytics distant** en V2.3.1 (première cible privée).
  Télémétrie locale via observability package (M1-12).
- **Détection de mode** : `navigator.onLine` n'est pas la
  source de vérité. Un workspace est "offline-first" par
  configuration (`WorkspaceConfig.network.policy = "offline"`
  par défaut pour `local-single-node`).

### 7. Visual regression baseline

- **8 baselines actuelles** (3 viewports × light/dark, capturé
  SESSION-2 §3.2) pour la surface Design.
- **Targeted baselines** : à chaque livraison d'une nouvelle
  carte UI, ajouter 2 captures (light + dark sur le viewport
  principal). Pas de saut massif.
- **Linux baseline manquant** (R-007) : à fournir post-M3-R3.
  La cible première est Windows-only, donc non bloquant.
- **Déterminisme** : `bunx playwright test ... -g 'determinism'`
  tourne partout (cf. gate `visual_determinism`).

### 8. Theming

- **Light + dark obligatoires** sur toutes les surfaces
  utilisateur. Toggle user-controlled, persisté dans
  `localStorage` (clé `unifia.theme`).
- **Pas de thèmes custom par workspace** en V2.3.1. Luminosité,
  contraste, taille de fonte : oui (préférences OS/accessibilité).
  Palette custom : non.
- **High-contrast mode** : à supporter post-M3 si besoin
  enterprise (EN-02).

## Consequences

- **lumen-ui** devient la cible de convergence long-terme pour
  le workbench. Pas de migration forcée en V2.3.1, mais toute
  nouvelle primitive UI doit être conçue en pensant à la
  portabilité vers lumen-ui.
- **SolidJS + Kobalte + Tailwind 4** sont la stack de référence
  pour V2.3.1. Tout écart nécessite un ADR-030+ distinct.
- **Tokens en CSS** : l'outillage Tailwind doit être configuré
  pour consommer les CSS custom properties (`tailwind.config.ts`
  avec `theme.extend.colors` qui pointe vers `var(--color-*)`).
  Pas de duplication des valeurs.
- **certification/gates.yaml §4 a11y_axe** : reste GREEN_WITH_DEBT
  (R-002 color-contrast, R-003 nested-interactive). Réouvertures
  futures gérées hors cette ADR.

## Liens

- `packages/contracts/src/ux.ts` (UX-01 livré, 8/8 tests PASS)
- `packages/contracts/test/ux.test.ts` (8/8 PASS)
- `apps/web/app/styles/` (à créer si manquant — tokens.css)
- `tailwind.config.ts` (à configurer pour tokens CSS)
- `package.json#workspaces.catalog` (solid-js, @kobalte/core,
  tailwindcss, @tailwindcss/vite déjà pinnés)
- `lumen-ui` (projet Erwan, `D:\App\lumen-ui`, design system
  cible long-terme)
- `docs/adr/ADR-013-browser-isolation-egress.md` (DECIDED)
- `docs/adr/ADR-024-extension-runtime-trust-isolation.md` (DECIDED)
- `docs/adr/ADR-027-supply-chain-policy.md` (DECIDED, scope global)
- `docs/adr/ADR-028-llm-supply-chain-policy.md` (DECIDED)
- `certification/gates.yaml §1 lint + §4 a11y_axe`
- `docs/adr/0008-tauri-exact-version-pin.md` (Tauri, séparé)
- `docs/adr/0010-shell-modes-...` (shells modes, séparé)
- `docs/adr/0013-desktop-electron-deprecation.md` (Electron
  déprécié)
- Plan V2.3.1 §155-160, §230

## Décisions de fond (rappel)

1. **SolidJS** pour le workbench (pas React/Vue/Svelte).
2. **lumen-ui** cible long-terme, Kobalte pour les primitives
   a11y en attendant.
3. **Tokens en CSS** (3 niveaux : primitive / semantic /
   component), light + dark obligatoires.
4. **WCAG 2.1 AA** minimum, AAA sur surfaces critiques, Axe en CI.
5. **i18n** : 21 langues cataloguées, FR + EN obligatoires en
   V2.3.1.
6. **Offline-first** sur `local-single-node` (pas de fetch CDN,
   pas d'analytics distant).
7. **Visual regression** : 8 baselines Windows, Linux à fournir
   post-M3-R3.
8. **Light + dark** obligatoires, pas de thèmes custom par
   workspace en V2.3.1.
