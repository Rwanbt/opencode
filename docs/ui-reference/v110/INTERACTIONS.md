# INTERACTIONS — grammaire v110 a porter (comportement, pas code demo)

## Principes

- Chat/Inspector/Context = frames persistantes; seul le contenu qui change anime (v41/v44/v47/v83/v84).
- Layout = geometrie partagee (shared-edge v87-v90), jamais de cross-fade ni clip-path reveal.
- Resizers clavier-accessibles (role=separator, fleches, Shift=24px).
- Les 97 scripts demo ne sont pas une implementation: reimplementer sur signaux/stores reels.

## Chat

- Dock global permanent, jamais re-parente entre modes (post-v41).
- Layouts: chat-only centre (colonne 620-980px desktop), split (--chat 280-620px, main min 360-460px), main-only.
- Prompt ticks MiniMax-like: packet compact centre, visible au survol scrollbar, tooltip, navigation smooth.
- Copy-context dans header (mobile) / flottant (desktop).
- Message actions au survol/focus/tap: copy, branch, pin chapitre, speak, timing, rewind (user).
- Composer: textarea + footer 7 icones mobile, popovers +/mode/model/permission, privacy/offline, mic, send accent, context-meter ring avec tooltip metriques.
- Scope Global/Projet au-dessus de Projets/Sessions; animations on/off (data-ui-animations).

## Shell / panneaux

- Context: user-controlled, jamais auto-hide par mode; collapse/reopen; hover-peek premium 190/360ms (v84).
- Inspector: frame/tabs jamais animes en bloc; seul le pane modifie transitionne; 3 onglets (Explorer/Inspector/Execution).
- Rail: hover du bouton explicite uniquement (pas de edge invisible); bottom-twin 31px; landscape = vrai rail.
- Terminal: redimensionne editeur/terminal (flex-basis), min 96px, max 72-94%, handle tactile 28px.
- Overlays: command palette, compute popover, work-capture, quick-account menu, modals avec focus-trap et retour focus.

## Design

- Toolbar unique v55 (select/node/pen/pencil/line/rect/ellipse + snap), vector-toolbar v54 en remplacement (pas empilement).
- Selection: handles 13-16px, rotate handle, guides smart/grid snap 8px, marquee, Alt-click parent, dblclick texte inline.
- Layers: renommage inline, visibilite, lock (snapshot-avant-mutation), drag-reorder, hierarchy carets, recherche.
- Source backed: Apply source securise (sanitize), meta DesignDocument transactionnel, undo/redo, changebar, versions, audit, compare, export, present isole.
- Tokens: bindings semantiques, variables CSS, rename migre bindings, delete detache en conservant valeur resolue.

## Automate

- Studio a60: header (env, undo/redo, versions, import/export, publish), library (recherche), canvas 1300x820, runbar, minimap, inspector tabs, debug (runs/data/logs/tests/problems).
- Ports 14-18px, hit-zone >=24px invariant zoom (R4), drag sortie vers entree, temp-edge, validation cycle, branches true/false.
- Undo/redo historique 40 entrees, autosave local draft vs published.

## Code

- Editeur reel: highlight derriere textarea transparent, gutter breakpoints F9, find/replace 2 lignes, tabs closables/draggables, split/preview, LSP hover/completion, ghost Next Edit, inline AI permission-gated (ask=lecture seule).
- Bottom panel: terminal sessions multi-owner, problems/tests/debug/ports derives des buffers (une seule verite).
- Review/Git partagent le working tree; revert session preserve les changements humains anterieurs.

## Memory

- Triptyque: Vault | Note | Links-context; overlays medium/compact avec scrim; triptyque mobile une seule pane visible.
- Editeur: edit/preview/split, commit explicite, autosave 700ms, versions, tags, wikilinks avec casse/ambiguite, drag-drop dossiers/notes, bulk bar, context-menu, inbox propositions AI.
- Graph: pan/zoom/fit, depth/tags/orphans/stale, hover relations sans layout shift, tags browser.

## Browser (sous reserve GAP-01)

- Tabs Brave-like (seule active surfacee), address centre, device switch, control AI/user, AI Activity collapsible + bottom-sheet mobile, take-over observable, page = scroll container mobile.

## Motion

- Durees: micro 120-180ms, layout 540-760ms cubic-bezier(.16,.84,.2,1), chat-split symetrique 680ms.
- reduced-motion et data-ui-animations=off = aucun mouvement (contrat final v110).
