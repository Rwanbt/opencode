# PLAN 8 AGENTS — portage v110 production-ready (pas un MVP)

## WAVE 0 — AUDIT + FOUNDATION (en cours, gate obligatoire)

A1 (ui-v110/a1-foundation):
1. Auditer packages/app (496 fichiers src, session/layout/app, contexts, workbench, e2e).
2. Analyser maquette (manifest 97 modules, tokens, breakpoints, e2eContract cartesien).
3. Mapping maquette vers composants existants (COMPONENT-MAP.md fait foi, GAP-01/02/03 ouverts).
4. Contrats UI + risques de perte fonctionnelle.
5. Implementer primitives necessaires (tokens, typographie, spacing, radius, surfaces, breakpoints, panel contracts, resizers, a11y, animations).
6. Tests (bun typecheck + tests concernes + smoke E2E).
Gate: tokens/responsive-contracts/panel-contracts documentes, aucune feature metier cassee, CI verte sur la branche A1.

## WAVE 0.5 — SHELL (gate obligatoire avant parallelisation)

A2 (ui-v110/a2-shell-responsive) sur base A1 rebasee:
- topbar, rail 4 modes (+settings/user), context, workspace, inspector shell, Chat/Split/Main (+Graph Memory sous-vue), resizers, overlays, breakpoints, safe-areas, mobile nav.
- App fonctionne avec surfaces metier encore anciennes si necessaire, mais navigation/rail/topbar/panneaux/workspace/responsive deja v110.
- A8 commence le Port Gate a ce stade.
Gate: shell responsive vert sur 5 viewports + invariants side-state + zero overflow + a11y clavier/focus.

## WAVE 1 — PORTAGE PARALLELE (seulement si Foundation+Shell stables et integres dans feat/ui-v110-port)

Rebase/creation depuis le nouvel etat, puis en parallele:
- A3 Chat/Inspector (thread, composer, prompts, permissions, observabilite, trajectory->Execution).
- A4 Code/Browser (editor/tabs/terminal/diff/Git/LSP + browser tabs/address/device/activity; GAP-01 a lever d abord).
- A5 Work/Team (kanban/tasks/agents/runs/approvals + roles/governance).
- A6 Design (canvas/layers/transform/SVG/Bezier/tokens/commentaires; D01-D08 en PR <=400 LOC).
- A7 Automate/Memory (nodes/ports/run/debug + vault/notes/graph/links; preserver WorkflowIR + memory-system).
- A8 teste en continu leurs PR, ownership strict, aucune modif shell sans A1/A2.

## GIT

work-design -> feat/ui-v110-port -> branches agents -> PR courtes vers feat/ui-v110-port.
Jamais direct vers work-design/dev/main. Decoupage type Design: D01 surface/routing, D02 layers, D03 transforms, D04 SVG selection, D05 vector drawing, D06 Bezier, D07 responsive, D08 tests.

## ORDRE PREMIERES PR (propose)

1. docs(ui-ref): reference v110 + contrats (cette etape).
2. A1-01: tokens + primitives + docs contrats.
3. A1-02: panel/resizer/a11y/animation primitives + tests.
4. A8-01: Port Gate squelette (staticAudit + responsive-v98 + 5 viewports smoke).
5. A2-01: shell grid + topbar + rail (4 modes).
6. A2-02: context + inspector shell + layout switch.
7. A2-03: responsive/overlays/mobile nav + gates verts.
8. Puis Wave 1 par mode, chaque PR testable/reversible/reviewable.

## COMMANDES DE TEST (rappel AGENTS.md)

- Jamais tsc direct, jamais tests depuis root.
- packages/app: bun typecheck; bun test:e2e (ou -- app/home.spec.ts / -g); bun test:e2e:ui pour debug.
- Backend local: depuis packages/opencode: bun run --conditions=browser ./src/index.ts serve --port 4096.
- App locale: depuis packages/app: bun dev -- --port 4444, ouvrir http://localhost:4444.
- SolidJS: preferer createStore. Pas de any, pas de mocks inutiles, pas de waitForTimeout en e2e.
