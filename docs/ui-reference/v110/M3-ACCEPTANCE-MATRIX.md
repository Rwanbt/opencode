# MiniMax M3 — Acceptance Matrix (Phase 1, partial)

> **Statut** : Phase 1 PARTIAL — surface × viewport × state × interaction matrixe pour surfaces principales
> **Base** : M3-CAMPAIGN-BASELINE.md, BASE_SHA `9aabd75cd10ec4e9886424ee4420a4022199d871`
> **Mandat** : reproduction fonctionnelle, responsive et visuellement certifiee de la maquette v110
> **Source** : `Unifia-UI-UX-v110-PORT-READY-R1.html` (2.4 MB, 97 modules, frozen 2026-09-10)

---

## Conventions de la matrice

Pour chaque surface :
- **Surfaces canoniques** : panneaux, boutons, tabs, toggle, resize, drawer, modal, hover, focus, scroll, DnD, animation, etats vide/chargement/erreur
- **Viewports** : desktop-large (≥1360), desktop-compact (1024-1360), tablet-landscape, tablet-portrait (768-1024), mobile-landscape, mobile-portrait (≤599)
- **Etats** : default, hover, focus, active, disabled, loading, error, empty
- **Interactions** : click, double-click, keyboard (Tab/Enter/Escape), drag-and-drop, resize, scroll, focus-trap

---

## Surface : Shell global (TOUS modes)

| Surface | Viewport | Interaction | Source maquette | Runtime actuel | Status |
|---|---|---|---|---|---|
| Topbar (title + workspace + actions) | desktop-large | click buttons | `data-v110-topbar` | existe (extracted) | ✅ partiel |
| Topbar | mobile-portrait | show topbar | maquette mobile mockup | layout.tsx topbar mobile | ✅ partiel |
| Rail (mode nav 4 buttons) | desktop-large | click → switch mode | `data-v110-rail` mode nav | context/mode (4 modes) | ✅ partiel |
| Rail | desktop-compact | collapse mode label | maquette | mode.modes accessor | ✅ partiel |
| Rail | tablet-portrait | collapse | maquette | ? | ⚠️ à tester |
| Rail | mobile-portrait | hide, mobile-nav only | `data-v110-mobile-nav` | shell/v110-mobile-nav.tsx | ✅ partiel |
| Sidebar (WorkspaceSidebarContext) | desktop-large | open/close + hover-peek | inline JSX + 3 factories (Phase 49-50) | OK factories shipped | ✅ partial |
| Sidebar | desktop-compact | close on smaller | maquette | `state.peeked` | ✅ partiel |
| Sidebar | tablet-portrait | collapse, peek on hover | maquette | aim.move | ✅ partiel |
| Sidebar | mobile-portrait | hidden, drawer | maquette | mobile | ? | ⚠️ à tester |
| Inspector (3 tabs Explorer/Inspector/Execution) | desktop-large | click tab | `data-v110-inspector-frame` | v110-inspector-frame.tsx (TABS=["explorer","inspector","execution"]) | ✅ partiel |
| Inspector | desktop-compact | persist open/close | maquette | layout.inspector | ✅ partiel |
| Inspector | tablet/mobile | collapse by default | maquette | ? | ⚠️ à tester |
| Workspace (main content area) | all | scroll, focus, resize | inline JSX | session.tsx + workspace | ✅ partiel |
| Composer (bottom chat input) | desktop-large | type + send | `data-v110-composer` | SessionComposerRegion (extracted) | ✅ partiel |
| Composer | mobile-portrait | adapt to mobile | maquette mobile | composer mobile | ✅ partiel |
| Terminal (bottom panel) | desktop | show/hide, resize | `data-v110-terminal-panel` | terminal.tsx (v110 marker) | ✅ partiel |
| Toast region | all | show/hide | `[data-component="toast-region"]` | inline JSX in layout.tsx | ⚠️ à extraire (Phase 5) |
| Dialog (settings, etc.) | desktop | show + focus trap | `[role="dialog"]` | inline @unifia/ui/dialog | ✅ partiel |
| Hover-peek overlay (sidebar peek) | desktop-compact | mouse over rail | inline JSX | aim/disarm | ✅ partiel |

**Authority responsive** : `tokens/viewport.ts:classify()` → `shell/v110-store.ts:useViewport()` doit être la source unique. **Pas de breakpoint local** ailleurs.

---

## Surface : Chat + conversationnel modes

| Surface | Viewport | Interaction | Source maquette | Runtime | Status |
|---|---|---|---|---|---|
| Chat composer (textarea + send) | desktop-large | type + Enter send | `data-v110-composer` | SessionComposerRegion | ✅ partial |
| Chat composer | mobile-portrait | show keyboard, full-width | maquette | mobile adapter | ⚠️ à tester |
| Chat message timeline | desktop-large | scroll, jump-to-anchor | session timeline | SessionTimelineSection (Vague 3) | ✅ partial |
| Chat message timeline | mobile-portrait | compress, sticky composer | maquette | mobile mode | ⚠️ à tester |
| Chat followup dock | desktop | queue / send / edit | inline object in session.tsx | followupDock signal | ⚠️ à extraire (Vague 4) |
| Chat revert dock | desktop | items / restore | inline object in session.tsx | rolled()/reverting() | ⚠️ à extraire |
| Chat permission dock | desktop | grant / deny | SessionComposerRegion | permission logic | ✅ partial |
| Chat plan tab | desktop-large | show plan | conversation plan mode | ? | ⚠️ à tester |
| Chat debate tab | desktop | show debate | debate mode | ? | ⚠️ à tester |
| Chat build tab | desktop | show build | build mode | ? | ⚠️ à tester |
| Chat team tab | desktop | show team | team mode | TeamPanel | ✅ partial |
| Chat auto tab | desktop | show auto | auto mode | ? | ⚠️ à tester |
| Chat prompt context meter (token ring) | desktop-large | hover → tooltip | composer context meter | usage ring + tooltip | ✅ partial |
| Chat prompt index (right rail) | desktop | hover → reveal | PromptIndex in session.tsx | PromptIndex component | ✅ partial (PromptIndex simplification noted in ADR-037) |

---

## Surface : Code mode (A4 v110 chrome)

| Surface | Viewport | Interaction | Source maquette | Runtime | Status |
|---|---|---|---|---|---|
| Editor (center pane) | desktop-large | type, scroll, format | `data-component="editor-pane"` | terminal.tsx + editor.tsx | ⚠️ partial — only chrome |
| Editor tabs | desktop | click tab, close tab | `data-component="workspace-tabs-bar"` | WorkspaceTabsBar | ✅ partial |
| Explorer (file tree, left) | desktop-large | click file, expand folder | `data-component="file-tree"` | sidebar-panel file-tree | ⚠️ partial |
| Inspector (3 tabs) | desktop-large | click tab | covered in Shell section | v110-inspector-frame | ✅ partial |
| Inspector file tree | desktop | show files | inline in sidebar-panel | file-tree | ⚠️ partial |
| Inspector git panel | desktop | show git status | sidebar-project sidebar-source-control | source-control.tsx | ⚠️ partial |
| Terminal (bottom) | desktop | show/hide, resize | `data-v110-terminal-panel` | terminal.tsx | ✅ partial |
| Diagnostic markers | desktop | hover → message | inline editor pane | inline | ⚠️ partial |
| Code lens | desktop | hover → action | editor pane | inline | ⚠️ partial |
| Inline AI suggestions | desktop | accept/reject | editor pane | inline | ⚠️ partial |
| Code split (editor + inspector) | desktop-large | resize | inline editor pane | `data-v110="resize-chat"` Separator | ✅ partial |
| Git blame annotations | desktop | hover → blame | inline | inline | ⚠️ à tester |
| Search/Replace | desktop | type + Enter | editor pane | inline | ⚠️ à tester |
| LSP diagnostics | desktop | hover → docs | editor pane | inline | ⚠️ à tester |

---

## Surface : Work mode (A5 v110, plus avancé)

| Surface | Viewport | Interaction | Source maquette | Runtime | Status |
|---|---|---|---|---|---|
| Work surface (tabs) | desktop-large | switch tab | `data-v110-work-surface` | work-surface.tsx | ✅ partial |
| Work board (Kanban) | desktop-large | drag task, click card | maquette | work-team-panels + workboard | ⚠️ partial (no DnD on task status yet) |
| Work list | desktop-large | scroll, filter | maquette | work-team-panels | ⚠️ partial |
| Work run details | desktop | view logs | maquette | work-team-panels | ⚠️ partial |
| Work team panels | desktop | click team member | maquette | work-team-panels + team components | ✅ partial |
| Work agent policy | desktop | configure | maquette | settings page | ⚠️ à tester |

**Note** : Work est relativement avancé. PRD-037 Vague 5 documente qu'on peut éviter de le réécrire (passe de parité précise uniquement).

---

## Surface : Design mode (A6 v110 — gros écart fonctionnel)

| Surface | Viewport | Interaction | Source maquette | Runtime | Status |
|---|---|---|---|---|---|
| Design layers panel | desktop-large | drag-reorder, toggle vis | maquette | design-layers-panel.tsx (Phase 3 MVP) | ✅ partial |
| Design vector tools (select/rect/line/ellipse/bezier) | desktop-large | click tool, drag | maquette | design-vector-tools.tsx (Phase 3 MVP) | ✅ partial (canvas wiring pending) |
| Design canvas (real Sketch integration) | desktop-large | draw, select, edit | maquette | Excalidraw iframe | ❌ **FAKE** — voir Phase 7 refonte |
| Design layers DnD (real reorder) | desktop-large | drag up/down | maquette | up/down buttons (Phase 3) | ⚠️ partial (no real drag-reorder) |
| Design selection handles (8 points) | desktop-large | drag handle | maquette | DesignSelectionHandles (Phase 3) | ✅ partial |
| Design Bézier path | desktop-large | drag control points | maquette | DesignBezierPath (Phase 3 cubic) | ✅ partial |
| Design rotate transform | desktop-large | drag | maquette | ? (not implemented) | ❌ Phase 7 |
| Design resize transform | desktop-large | drag | maquette | via handle drag | ✅ partial |
| Design snap/grid | desktop-large | drag with snap | maquette | ? | ❌ Phase 7 |
| Design undo/redo | desktop | Ctrl+Z/Y | maquette | rolled()/restoring() (inline) | ⚠️ partial |
| Design export | desktop | click | maquette | export hooks | ✅ partial |
| Design comments | desktop | add comment | maquette | comment-panel | ⚠️ partial |

**Phase 7 critique** : Design canvas doit être réellement câblé au runtime, pas un iframe Excalidraw cosmétique.

---

## Surface : Automate mode (A7 — P1 ABSOLU)

| Surface | Viewport | Interaction | Source maquette | Runtime | Status |
|---|---|---|---|---|---|
| Automate library (left) | desktop-large | drag node to canvas | maquette | automate-surface.tsx | ❌ **MANQUE** |
| Automate canvas (center, node graph) | desktop-large | drag node, connect port | maquette | ? (no canvas) | ❌ **MANQUE** |
| Automate Inspector (right) | desktop-large | open on node click | maquette | shared Inspector (3 tabs) | ⚠️ partial |
| Automate node library | desktop-large | browse, filter | maquette | ? | ❌ **MANQUE** |
| Automate run bar (bottom) | desktop-large | start/stop/test/validate | maquette | inline | ⚠️ partial |
| Automate ports (input/output) | desktop | drag connect | maquette | ? | ❌ **MANQUE** |
| Automate zoom/pan | desktop-large | Ctrl+wheel / drag | maquette | ? | ❌ **MANQUE** |
| Automate minimap | desktop-large | navigate | maquette | ? | ❌ **MANQUE** |
| Automate debug (Runs/Data/Logs/Tests/Problems) | desktop | switch tabs | maquette | automate surface | ⚠️ partial |
| Automate environment | desktop-large | configure | maquette | ? | ❌ **MANQUE** |
| Automate publish/import/export | desktop | click | maquette | workflow-runner hooks | ⚠️ partial |
| Automate branches | desktop | switch | maquette | ? | ❌ **MANQUE** |

**Phase 8 critique** : Automate doit devenir le vrai studio node-based. C'est le plus gros écart fonctionnel. **P1 absolu**.

---

## Surface : Memory mode (A7)

| Surface | Viewport | Interaction | Source maquette | Runtime | Status |
|---|---|---|---|---|---|
| Memory vault (left) | desktop-large | click note | `data-memory-vault` | memory-panel.tsx | ✅ partial |
| Memory note pane (center) | desktop-large | edit, scroll | `data-memory-note-pane` | memory-panel.tsx | ✅ partial |
| Memory links + graph (right) | desktop-large | hover link, pan graph | `data-memory-links` | memory-panel.tsx | ✅ partial |
| Memory hover preview | desktop | hover linked note | tooltip `title=` attr | memory-panel.tsx (Phase 10) | ✅ partial |
| Memory mobile single-pane | mobile-portrait | tap to navigate | maquette mobile | ? | ❌ **MANQUE** — voir Phase 9 |
| Memory folder tree | desktop | expand/collapse | maquette | ? | ⚠️ à tester |
| Memory DnD notes | desktop | drag to folder | maquette | ? | ❌ **MANQUE** |
| Memory context actions | desktop | right-click | maquette | ? | ⚠️ à tester |
| Memory autosave | desktop | debounced | maquette | ? | ⚠️ à tester |
| Memory wikilinks | desktop | type [[ | maquette | parseMemoryNote (model) | ✅ partial |
| Memory graph pan/zoom/fit | desktop-large | drag/wheel/dblclick | maquette | localMemoryGraph (model) | ✅ partial |
| Memory graph depth/tags/orphans | desktop | filter | maquette | ? | ⚠️ à tester |

**Phase 9 critique** : Memory doit avoir un vrai workflow (DnD, folders, mobile single-pane).

---

## Surface : Browser mode

| Surface | Viewport | Interaction | Source maquette | Runtime | Status |
|---|---|---|---|---|---|
| Browser tabs | desktop-large | click tab | maquette | browser-runtime | ⚠️ partial |
| Browser address bar | desktop-large | type URL, Enter | maquette | browser-runtime | ⚠️ partial |
| Browser back/forward/refresh | desktop-large | click button | maquette | browser-runtime | ⚠️ partial |
| Browser AI Activity | desktop | view | maquette | ? | ⚠️ à tester |
| Browser clear/takeover | desktop | click | maquette | ? | ⚠️ à tester |
| Browser device controls | desktop | toggle | maquette | ? | ⚠️ à tester |
| Browser home/Brave/GitHub | desktop | click | maquette | browser-runtime | ⚠️ partial |
| Browser mobile navigation | mobile-portrait | tap | maquette mobile | ? | ⚠️ à tester |

**Phase 10 critique** : Browser doit gérer le bug historique flash/changement de mode.

---

## Surface : User / Settings

| Surface | Viewport | Interaction | Source maquette | Runtime | Status |
|---|---|---|---|---|---|
| Settings dialog (Général) | desktop-large | click tab | maquette | settings-general | ⚠️ partial |
| Settings dialog (Audio) | desktop | click | maquette | settings-audio | ⚠️ partial |
| Settings dialog (Mémoire) | desktop | click | maquette | settings-memory | ⚠️ partial |
| Settings dialog (Compute) | desktop | click | maquette | settings-configuration | ⚠️ partial |
| Settings dialog (Observabilité) | desktop | click | maquette | settings-observability | ⚠️ partial |
| Settings dialog (Fournisseurs) | desktop | click | maquette | settings-providers | ⚠️ partial |
| Settings dialog (Benchmarks) | desktop | click | maquette | settings-benchmark | ⚠️ partial |
| Settings dialog (Android) | desktop | click | maquette | settings-android | ⚠️ partial |
| Settings dialog (Plugins) | desktop | click | maquette | settings-plugins | ⚠️ partial |
| Settings dialog (Remote Access) | desktop | click | maquette | settings-remote-access | ⚠️ partial |
| Settings dialog (Collaborative Auth) | desktop | click | maquette | settings-collaborative-auth | ⚠️ partial |
| User Account / Sign-in / Sign-up | desktop-large | submit | maquette auth | inline | ⚠️ partial |
| User Connect Provider | desktop | click | maquette | inline | ⚠️ partial |
| User Connect Local LLM | desktop | configure | maquette | inline | ⚠️ partial |

**Phase 11 critique** : tous les controls doivent modifier réellement le runtime/config.

---

## Viewport matrix (à appliquer à toutes les surfaces)

| Viewport | Width | Height | Comportement attendu |
|---|---|---|---|
| desktop-large | ≥1360 | variable | full shell, all sidebars visible |
| desktop-compact | 1024-1360 | variable | shell compact, peek behavior |
| tablet-landscape | 900-1360 | ≤900h | rail compact, sidebars collapse |
| tablet-portrait | 768-1024 | variable | mobile-nav + drawer sidebars |
| mobile-landscape | ≤1024 | ≤560 | bottom-nav + drawer |
| mobile-portrait | ≤599 | variable | bottom-nav + drawer, single-pane |

**Bug historique** : tablet-portrait et mobile-landscape produisent les superpositions les plus difficiles. **Phase 12** doit les tester systématiquement.

---

## Anti-régression checklist (à valider avant Phase 18)

- [ ] Aucun bouton mort trouvé dans aucun mode
- [ ] Aucun mock ajouté pour combler un écart maquette
- [ ] Aucun breakpoint local concurrent de l'autorité responsive
- [ ] Aucun panneau/Inspector dupliqué
- [ ] Aucune action masquée sur mobile sans workflow alternatif
- [ ] Aucune capacité réelle du runtime cassée par le port
- [ ] Phase 17 cleanup lancée SEULEMENT après parité (PAS avant)

---

## Prochaine étape

**Phase 2** : helpers Playwright déterministes (session launch, mode switch, sidebar toggle, viewport change, overflow/focus/screenshot assertions). Aucun test ne boucle sur plusieurs viewports dans une même session.

---

*Matrice partielle 2026-09-13 — Phase 1 PARTIAL. Compléter dans sessions suivantes au fur et à mesure que les surfaces sont portées.*
