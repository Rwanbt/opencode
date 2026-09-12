# VISUAL-GATES — Port Gate v110 (A8)

Infra existante: packages/app/e2e (Playwright), fixtures/actions/selectors, guides e2e/AGENTS.md.
Ne pas remplacer; ajouter un veritable UI v110 Port Gate cartesien (pas echantillonne).

## Cases minimales

Etendre viewport x mode x layout, puis appliquer side-state invariant + critical-action set.
Modes: code, work, design, automate, browser, memory, user (+ settings).
Memory sub-views: note, graph.

### Global checks (chaque case)

- port-gate-ok (staticAudit: buildId, revision, 97 modules, no-recovery-style, unique-ids, manifest divergences, cartesian contract).
- responsive-v98-ok (audit UnifiaResponsiveV98).
- zero-global-x-overflow.
- active-view-present.
- requested-layout-effective-when-supported.
- context-toggle-square-when-visible.
- no-unrecovered-runtime-exception.

### Panel checks

- desktop-wide: context peut coexister avec inspector; workspace non-overlapped.
- desktop-compact: ouvrir context ferme inspector; ouvrir inspector masque context.
- tablet-portrait: overlays geometrie.
- phone-portrait: overlay exclut workspace.
- compact-landscape: overlay apres rail compact.

### Critical actions

- code: chat/split/main, terminal open/close, editor tabs, F9 breakpoint, explorer/inspector/execution.
- work: chat/split/main, task controls, kanban/list, AI policy/actions, inspector.
- design: chat/split/main, layers collapse/reopen, canvas zoom, selection/resize/vector, comments, inspector.
- automate: chat/split/main, nodes collapse/reopen, node select/configure, port connect hit-targets, zoom, inspector.
- browser: chat/split/main, tabs, navigation/address, device switch, AI activity collapse/clear, takeover/control.
- memory: chat/split/main/graph, vault open/close, note selection/move, links/context, graph interactions, inspector.
- user: chat/split/main, account/workspace navigation, security/session controls, inspector coexistence.

## Gates de fin

- Functional parity: fonctions existantes importantes encore accessibles.
- Visual parity: suit v110 avec tolerances documentees.
- Responsive parity: tous viewports passent.
- Interaction parity: transitions, panneaux, menus, resizers, layout switches.
- Accessibility: keyboard, focus, aria, reduced motion, contrast, inert/aria-hidden synchronises.
- Runtime integrity: aucun mock maquette n a remplace le fonctionnement reel.

## Verdict

- P0 critique / P1 bloque portage/production: scenario + reproduction + fichier/composant + impact + correctif.
- Tant qu il reste un P0/P1: VERDICT = NO-GO.
- Boucle audit-correction-retest-audit jusqu a 0 P0, 0 P1, TypeScript vert, E2E vert, visual gates verts ou ecarts acceptes.
