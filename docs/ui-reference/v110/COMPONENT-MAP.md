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
