# OWNERSHIP — portage v110 (read everywhere, write only in owned surfaces)

Integration: feat/ui-v110-port (depuis work-design @ d212bc80).
Interdiction: ne jamais merger directement vers work-design/dev/main. PR courtes vers feat/ui-v110-port, ~400 LOC logiques.

## A1 — FOUNDATION / ARCHITECTURE UI (branche ui-v110/a1-foundation)

- WRITE: packages/app/src/styles/*, packages/app/src/tokens/* (si cree), docs/ui-reference/v110/*, primitives UI partagees explicitement listees en Wave 0.
- READ: tout.
- INTERDIT: pages/session.tsx, pages/layout.tsx, mode.tsx, global-sync, workbench-shell/modes, e2e existants (sauf ajout gate avec A8).
- API: expose tokens, breakpoints, panel contracts, resizers, a11y/animation primitives.
- Ne porte pas les metiers complets des modes.

## A2 — SHELL / RESPONSIVE / NAVIGATION (ui-v110/a2-shell-responsive)

- WRITE exclusif: topbar, rail, context panel, workspace root/body, inspector shell (frame seule), layout switch, mobile nav/sheets, resizers shell, responsive shell CSS.
- READ: tout.
- INTERDIT d etre modifie par A3-A7 sans demande interface implementee par A2 + rebase.
- Fichiers a risque: layout.tsx, session.tsx (co-ownership temporaire A2 seul en Wave 0.5), global responsive CSS, navigation root, design tokens (read-only, demande a A1).

## A3 — CHAT / INSPECTOR / CONTEXT / OBSERVABILITE (ui-v110/a3-chat-inspector)

- WRITE: thread/composer/messages, trajectory/observability troisieme onglet, inspector content (pas frame), context panel content specifique chat.
- READ: shell frame (pas de modif structurelle), runtime session reel.
- INTERDIT: layout.tsx, shell grid, tokens, navigation root.
- Doit preserver runtime session reel.

## A4 — CODE + BROWSER (ui-v110/a4-code-browser)

- WRITE: surfaces code (editor/tabs/terminal/diff/diagnostics/tests/git/lsp dans surface code uniquement) + surfaces browser (tabs/address/device/activity) + contenu inspector code/browser.
- READ: runtime browser/code existants (ne pas reimplementer).
- INTERDIT: shell structurel A1/A2, explorer global (reste dans Inspector), duplication Explorer.

## A5 — WORK + TEAM (ui-v110/a5-work-team)

- WRITE: surfaces work/team + panneaux specifiques + inspector work/team.
- READ: orchestration taches/sessions reelle (preserver).
- INTERDIT: shell structurel, stores globaux concurrents.

## A6 — DESIGN (ui-v110/a6-design)

- WRITE exclusif surface Design: canvas, layers, selection/transform, SVG/Bezier, tokens style, commentaires, artefacts, inspector design.
- READ: runtime Design existant (opendesign-integration, workbench design-*).
- INTERDIT: shell structurel; ne pas creer un faux editeur.

## A7 — AUTOMATE + MEMORY (ui-v110/a7-automate-memory)

- WRITE: flow/nodes/library/debug + vault/notes/graph/links + inspectors associes.
- READ: runtimes reels (workflow-runtime, memory-system).
- INTERDIT: shell structurel, second inspector, second source responsive.

## A8 — PORT QA / ADVERSARIAL (ui-v110/a8-port-qa)

- WRITE: packages/app/e2e/* (nouveau Port Gate), tests unit/integration/visual/a11y, rapports audit (docs/ui-reference/v110/QA/*).
- READ: tout. N ecrit aucun ecran metier.
- Pouvoir: NO-GO tant que P0/P1 > 0. Detecte features disparues + mocks deguises.

## Transverse

- Modification transverse: 1) demande interface claire, 2) implementee par A1/A2, 3) rebase, 4) poursuivre.
- Conflits simultanes interdits sur: layout.tsx, session.tsx, global responsive CSS, navigation root, global state, design tokens.
