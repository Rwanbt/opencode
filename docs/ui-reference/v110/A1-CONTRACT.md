<!-- SPDX-License-Identifier: MIT -->

# A1-CONTRACT — ce que Foundation expose a A2-A7 (Wave 0)

Build maquette: v110-port-ready-r1 (97 modules, 0 recovery layer).
Autorites: LayoutControllerV98 (layout), ResponsiveV98 (audit responsive),
NativeInspectorV44 (inspector), CanonicalV110 (stabilite), PortReadyV110 (gate).

## 1. Imports demandables

```ts
import { classify, side, layouts, cohabit, exclusive, CASES } from "@/tokens/viewport"
import { TOPBAR, RAIL, CONTEXT, INSPECTOR, CHAT, width, visible, clamp, narrow } from "@/tokens/panels"
import { STEP, FAST, delta, drag, orientation, clampSize } from "@/tokens/resizer"
import { Separator } from "@/primitives/separator"
```

CSS: `@/styles/v110.css` (deja importe par `src/index.css`).
Vars: `--v110-topbar/rail/rail-compact/context/inspector/chat/chat-min/chat-max`,
`--v110-radius-sm/md/lg/xl` (10/12/15/18), `--v110-target/target-touch` (31/44px),
`--v110-focus`, `--v110-fast/layout/split/ease`, `.v110-shell`,
`[data-component="separator"][data-axis]`, `:where(...):focus-visible`,
`html[data-ui-animations="off"]`, `prefers-reduced-motion`.

## 2. Regles d usage

- Couleurs: ne pas redefinir, utiliser le theme `@unifia/ui` + `unifia-brand.css`.
- Light mode: `html[data-color-scheme="light"]` (pas `data-theme`, qui porte l id du theme).
- Graph Memory = sous-vue (`MemoryView = "note" | "graph"`), jamais un layout global.
- Registry: 4 shell modes (`code/work/design/automate`); browser/memory/settings/user
  sont des destinations, pas des shell modes (pas d ADR = pas de nouveau mode).
- Automate: gate unique `isAutomateAccessible(grants)` sur `workflow.run`
  (`context/automate-flag.ts`); ne jamais exposer le rail si refuse.
- Resizers: `Separator` (role separator, fleches 16px, Shift 24px, Home/End).
  `session.tsx`/`layout.tsx` gardent leurs handles jusqu a migration A2.

## 3. Migration A2 (Wave 0.5, pas A1)

- `hooks/use-mobile-layout.ts` (seuils 768/1024, createSignal) doit deriver de
  `classify` (seuils 600/900/1200 + regle paysage) — une seule source responsive.
- `pages/workbench/design-responsive.ts` (1024/768) documente le meme ecart;
  trou 840-899 tranche par `classify` (portrait = tablet, paysage = compact).
- `@unifia/ui/resize-handle` (souris seule) -> `Separator` pour les shell panels.

## 4. Risques P0/P1 (detail fichier/composant/impact/correctif en rapport A1)

- P0-1 GAP-01 Browser sans runtime: `design-browser-tab/model.ts` = store local
  maquette-like; ne jamais brancher la vraie nav dessus sans runtime A4.
- P0-2 Registry 4-vs-10: `modes.ts` fait foi; `design-browser-tab`,
  `work-surface`, memory sans runtime partage corrompraient le rail.
- P0-3 Automate grants: `automate-surface.tsx` appelle `client.startWorkflow`
  direct; tout rail automate non gate casse ADR-1041.
- P1-1 Stores responsive concurrents: `use-mobile-layout` + `design-responsive`
  + `classify` = 3 sources; A2 unifie ou les gates A8 flappent.
- P1-2 Deux inspecteurs: `session-side-panel.tsx` + `NativeInspectorV44` v110;
  un seul inspector natif (COMPONENT-MAP §1).
- P1-3 Explorateur duplique: `file-tree.tsx` = instance unique, reste Inspector.
- P1-4 `ResizeHandle` sans clavier (session.tsx:1057, layout.tsx:18) jusqu a A2.
- P1-5 `session.tsx` (1096 lignes) / `layout.tsx` (1163 lignes) au-dela du budget;
  toute PR A2 > 400 LOC logiques doit etre splittee.
- P1-6 `use-mobile-layout` seuils 768/1024 vs v110 600/900/1200: layouts
  tablet/phone faux entre 600-767 et 900-1023 jusqu au rebase A2.

## 5. Verdicts composants (audit Wave 0)

- REUTILISER (@unifia/ui): button, icon-button, dialog, tooltip, popover, tabs,
  switch, select, checkbox, radio-group, list, tag, avatar, spinner, keybind,
  progress, text-field, inline-input, hover-card, context-menu, dropdown-menu,
  toast, logo, icon (+ file/provider/app-icons), markdown, code-mirror.
- REUTILISER (app): layout store (`context/layout.tsx`), global-sync,
  file-tree, session-side-panel, terminal-panel, prompt-input/composer,
  design-toolbar/split/switcher, automate-decode/surface, workbench-thread.
- REFACTOR (A2-A7, pas A1): topbar/rail/context/workspace/inspector,
  thread/composer/prompts, editor/tabs/terminal/diff/diagnostics/Git/LSP,
  kanban/tasks/agents/runs/approvals, canvas/layers/transform/SVG/Bezier,
  nodes/ports/run/debug, vault/notes/graph/links, settings/user.
- NOUVEAU (A1, ce contrat): tokens/viewport, tokens/panels, tokens/resizer,
  primitives/separator, styles/v110.css + tests.
- GAP: GAP-01 browser runtime, GAP-02 registry 4-vs-10, GAP-03 automate grants.
