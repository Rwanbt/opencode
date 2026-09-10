# Unifia v110 — Porting Contract (PORT-READY-R1)

Source: Unifia-UI-UX-v110-PORT-READY-R1.html (frozen 2026-09-10, build v110-port-ready-r1).
Local copy SHA256: 6C01E84C27ABF7665BB4DE65E0C3969B7AF0F020129AA971916376B1CA69818B (2 465 661 bytes).
Manifest: 97 runtime modules, 0 recovery layers, 2 intentional style divergences + 13 script divergences (audited corrections).

## Authority rule

- Maquette = autorite visuelle, responsive, UX.
- work-design @ d212bc8098af43ca64a8c4456263dfdb44a56190 = autorite fonctionnelle, metier, runtime, donnees.
- Contradiction: ne jamais supprimer une capacite existante, ne jamais remplacer une integration reelle par un mock, documenter l'ecart dans COMPONENT-MAP.md, adapter la nouvelle UI au runtime reel.

## What NOT to do

- Pas de conversion HTML vers JSX automatique + remplacement.
- Pas de deuxieme application parallele.
- Pas de copie du JS demonstratif comme implementation (les 97 modules unifia-v*-script sont une demo, pas un runtime).

## Port order (obligatoire)

1. Contrat existant (stores, contexts, hooks, services, APIs, runtimes).
2. Nouveaux composants UI (tokens, primitives, shell).
3. Branchement sur etat/services reels.
4. Tests non-regression (Playwright packages/app/e2e + unit).
5. Suppression de l'ancienne representation devenue inutile.

## Preserved runtime (verifie sur work-design)

- packages/app/src/context/* : mode, file, editor, terminal, permission, models, team, workbench, global-sync, layout.
- pages/session.tsx (992 lignes), pages/layout.tsx (1055 lignes), app.tsx (429 lignes).
- packages/workbench-shell/src/modes.ts : SHELL_MODES = code, work, design, automate (4 modes, pas 10).
- Session, terminal, filesystem, Git, LSP, providers, memory, automate, browser, observabilite, persistence.

## Responsive contract (from manifest e2eContract)

- desktop-wide 1440x900, desktop-compact 1024x768, tablet-portrait 768x1024, phone-portrait 390x844, compact-landscape 844x390.
- Layouts: desktop = chat/split/main (+graph Memory), tablet/phone portrait = chat/main, compact-landscape = chat/split/main.
- Side states: desktop-wide cohabitation possible, desktop-compact context/inspector mutuellement exclusifs, autres = overlays.
- Global checks: port-gate-ok, responsive-v98-ok, zero global x-overflow, active-view-present, requested-layout-effective, context-toggle-square, no-unrecovered-exception.

## Visual authorities to port

- Stylesheet canonique unique (pas de Recovery layer separe).
- Tokens: bg/surface/text/muted/line, topbar 48px, rail 62-78px selon breakpoint, context 248px, inspector 300px, chat 348px, radius 10-18px, themes dark/light, accent system v35/v36, focus-ring, reduced-motion.
- Shell: topbar / rail / context / workspace / inspector, Chat/Split/Main-Editor, resizers clavier-accessibles, overlays, safe-areas, bottom-nav mobile, quick-actions sheet.

## E2E strategy

Cartesien complet exige par le manifest: viewport x mode x layout x side-state + critical-actions par mode. Pas de certification par echantillonnage.
