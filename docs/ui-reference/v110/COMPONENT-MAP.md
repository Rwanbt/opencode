# COMPONENT-MAP — maquette v110 vers application reelle

Legende: KEEP = reutiliser tel quel, REFACTOR = garder contrat + changer representation, NEW = creer (aucun equivalent), GAP = ecart documente (runtime reel gagne).

## 0. Decouverte critique (bloque tout mapping naif)

- SHELL_MODES reel = 4 entrees: code, work, design, automate (packages/workbench-shell/src/modes.ts).
- Maquette = ~10 vues: home, code, work, design, automate, browser, memory, settings, user/account, chat global + trajectory.
- REGLE: ne pas dupliquer de modes parce que la maquette et le runtime utilisent des noms differents. Browser/Memory/Team/Chat/Plan/Debate ne deviennent pas des shell modes.

## 1. Shell (A2, proprietaire)

| Maquette | Reel work-design | Verdict |
|---|---|---|
| topbar (brand, crumbs, search, actions, theme, user) | pages/layout.tsx, titlebar-slots, global-sdk | REFACTOR: garder routing/session/projets, changer representation |
| rail de modes | context/mode.tsx + SHELL_MODES | REFACTOR: 4 modes + settings/user comme destinations, pas 10 boutons |
| context panel (projets/sessions) | context/file, sidebar-project/workspace, global-sync | REFACTOR |
| workspace root + workspace-body | pages/layout.tsx, directory-layout.tsx | REFACTOR |
| inspector (Explorer + Details + Execution) | session-side-panel, references-panel, review-tab | REFACTOR: un seul inspector natif, pas de doublon par mode |
| layout switch Chat/Split/Main + Graph Memory | session-layout.ts, use-view-mode.ts | REFACTOR: Graph = sous-vue Memory, pas un layout global |
| mobile nav + sheets + safe-area | use-mobile-layout.ts, mobile/*, nav-drawer | REFACTOR |

## 2. Chat / Inspector / Observabilite (A3)

| Maquette | Reel | Verdict |
|---|---|---|
| chat global partage + thread + composer + prompts | workbench-thread-shared, workbench-thread, composer/*, prompt-input/* | REFACTOR: brancher sur runtime session reel |
| messages, artefacts, tool calls, approvals, Coffee trajectory | artifact-*, session-*, permission.tsx | REFACTOR |
| prompt graduation ticks, copy context, context-meter | message-timeline, session-context-* | NEW UI sur contrat existant |
| observabilite configurable (Settings>Observability) | observabilite existante + docs | REFACTOR, aucune donnee mockee |

## 3. Code + Browser (A4)

| Maquette | Reel | Verdict |
|---|---|---|
| editor tabs, terminal integre, diff, diagnostics, tests, Git, LSP, autocomplete | editor-panel, file-tabs, terminal-panel, lsp-*, session-vcs, review-tab | KEEP contrat + REFACTOR representation |
| explorer (doit rester dans Inspector uniquement) | file-tree, explorer existant | KEEP, interdiction de dupliquer |
| browser tabs, Brave/home, GitHub demo, Computer use, AI Activity | `design-browser-tab` + WebView Tauri (`open_design_browser`, navigation native) | KEEP contrat reel : navigateur accessible comme onglet Design, jamais comme faux shell mode ni navigation simulee |

## 4. Work + Team (A5)

| Maquette | Reel | Verdict |
|---|---|---|
| work hero, kanban, tasks, agents, runs, approvals | work-surface, team-panel, workbench/* | REFACTOR sur orchestration reelle |
| team roles, coordination | context/team.tsx, team/* | KEEP |

## 5. Design (A6)

| Maquette | Reel | Verdict |
|---|---|---|
| canvas, layers, selection, drag/resize/rotate, zoom/pan, SVG, Bezier, tokens, commentaires, artefacts | design-surface, design-workspace, design-tabs/toolbar, artifact-preview, opendesign-integration (ADR-0017) | REFACTOR: brancher UI sur runtime Design existant, ne pas creer un faux editeur |
| source/preview switch, viewport bar, AI policy | design-spec-editor, design-snapshot | REFACTOR |

## 6. Automate + Memory (A7)

| Maquette | Reel | Verdict |
|---|---|---|
| nodes library, drag, ports, run/stop/test/validate/debug, logs, publish | automate-surface, automate-decode, workflow-runtime, workbench-server | REFACTOR sur WorkflowIR/runtime reel |
| vault, notes, editor/preview, graph, links/backlinks, hover, search | memory-system (ADR-0018), knowledge docs | REFACTOR |

## 7. Settings + User (transverse, rattache a A1/A2)

| Maquette | Reel | Verdict |
|---|---|---|
| settings integre (general/audio/shortcuts/memory/providers/models/configuration/benchmark/observability/mcp/skills/hooks/compute) | dialog-settings, settings-*, providers/models | REFACTOR: ne pas perdre une destination |
| account center, organisations, security | dialog-team, team, auth | REFACTOR |

## Gaps documentes (runtime gagne)

1. GAP-01 Browser: resolu — `DesignBrowserTab` pilote une WebView Tauri reelle. Il reste une destination Design, pas un shell mode.
2. GAP-02 Registry: 4 vs ~10; mapping ci-dessus fait foi, pas de nouveau shell mode sans ADR.
3. GAP-03 Automate grant-gated (workflow.run): respecter automate-flag.ts, ne pas exposer le rail si refuse.

## 8. Etat livraison reelle sur new-ui (2026-09-12)

Reference : commit `c2680f6a84 docs(qa): update report with Phase 10-12
outcome`. Chaque ligne ci-dessous dit ce qui a effectivement ete
shipping sur `new-ui`, pas le scope maximal du contrat.

### A1 Foundation — complet
- `tokens/{viewport,panels,resizer}.ts` avec tests unitaires
- `primitives/separator.tsx` (axe x/y, role=separator, arrows 16px,
  Shift 24px) + `styles/v110.css` + tests
- GAP-01/02/03 resolus

### A2 Shell — complet + certifie
- `shell/v110-{inspector-frame,mobile-nav,viewport,store,shell.css}.{ts,tsx}`
- Shell frame / topbar / rail / context / inspector / mobile-nav
- **A8-02 strict Port Gate : 5/5 PASS en 1 min 06 s** post-toutes-phases
- P1-A fix : `v110.css` height:100% sur `[data-component="separator"][data-axis="x"]`

### A3 Chat / Inspector — KEEP+REFACTOR
- `components/prompt-input/*` + `pages/session/composer/*` branches sur
  runtime reel (aucun mock)
- Composer context-meter (usage ring + tooltip) — PR #72
- Trajectory + Observability exposes via onglet Execution InspectorFrame

### A4 Code + Browser — markers only, refonte visuelle differee
- `data-v110="terminal"` (terminal.tsx:1027), `data-v110="mobile-diff"`
  (diff/mobile-diff.tsx:52), `data-v110="code-chrome"` via shell
- GAP-01 Browser resolu via `design-browser-tab.tsx` + WebView Tauri
- **REFONTE VISUELLE EDITEUR/TERMINAL/DIFF non livree** (au-dela des
  markers) — documente comme dette dans QA report

### A5 Work + Team — complet (6 vagues)
- `pages/workbench/work-{surface,team,board,board-panel,runs-panel,
  start-run,start-run-form,timeline-panel,view,view-switcher,
  activity-panel,plan-panel,progress-panel,next-action-panel,hero}.tsx`
- 36 marqueurs `data-v110=` (concentre sur cet agent)
- Source : orchestration reelle, pas de mock

### A6 Design — D01 + MVP D02-D06 livrees
- D01 surface/routing : complet (`design-surface.tsx`,
  `design-workspace.tsx`, `design-tabs.tsx`, `design-toolbar.tsx`)
- D02 layers panel MVP (`design-layers-panel.tsx`,
  `design-layers-model.ts` + 7 tests) — rename, visibility, lock,
  reorder (boutons up/down, **DnD non livre**)
- D03 transforms MVP (`design-vector-tools.tsx` — 8 selection
  handles, translate only, **rotate non livre**)
- D04 SVG selection : non livre (selection par defaut uniquement)
- D05 vector tools : MVP (`design-vector-tools.tsx` — toolbar unique
  avec select/rect/line/ellipse/bezier)
- D06 Bezier : MVP quadratic path (single segment, **multi-segment
  non livre**)
- Wiring canvas runtime (design-sketch-tab.tsx, artifact-preview) :
  **non livre** — les composants sont des stubs qui tiennent la
  surface v110 mais ne sont pas montes dans le canvas

### A7 Automate + Memory — complet
- Automate : `automate-{surface,workflow-model,decode}.ts` +
  `context/automate-flag.ts` (grant gate ADR-1041)
- Memory : `memory-panel.tsx` (vault + note preview/source/split +
  graph SVG + backlinks + search input + **hover preview via title=
  attribute** Phase 10)

### A8 Port Gate — strict GO, cartesian infra
- **Strict (A8-02) : 5/5 PASS** stable post-toutes-phases
- Cartesian (A8-01) : split 4 sous-tests de 4 viewports, skip
  screenshots sur 12 edge cases, `reducedMotion: reduce`,
  `waitForTimeout(80)` entre viewports. Browser hang persiste sur
  Windows local (connu, documente). CI linux plus stable grace aux
  fixes Phase 14.
