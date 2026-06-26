# ADR-0009 : @solidjs/start Path B (2.0.0-alpha.3) au lieu de 1.2.0 stable

**Date** : 2026-06-26 | **Statut** : Accepté (avec dette documentée)

## Contexte

Le catalogue workspace pinnait `https://pkg.pr.new/@solidjs/start@dfb2020` — bun encodait `:` et `/` en `+` dans le path, Rollup ne pouvait pas résoudre (B-002 Phase 8 audit). Tentative de revert à `1.2.0` (Path A vault original) :
- `1.2.0` n'exporte PAS `solidStart` (ajouté en 2.0.0-alpha), `vite.config.ts` casse au build.
- B-003 fix (Windows backslash JSON.stringify) présent seulement dans 2.x source.
- 1.3.2 (autre stable) : même problème, pas de `solidStart` export.

Phase 9 session précédente a choisi `2.0.0-alpha.3` (vers laquelle pkg.pr.new visait) + documenté dette : ~30 fichiers `console/app` utilisent `APIEvent` / `RequestEvent.locals` (removed in alpha). Refactor suivi Phase 10.

Phase 9.5 session a réalisé ce refactor console/app :
- `global.d.ts` : suppression de l'override `APIEvent = { request: Request }` (real type extends FetchEvent)
- 3 imports : `@solidjs/start` → `@solidjs/start/server` (où APIEvent est exporté)
- 3 casts explicites `getRequestEvent() as APIEvent` pour accès `event.locals` (augmentation RequestEvent→FetchEvent non propagée sans import APIEvent en scope)

## Décision

Rester sur `2.0.0-alpha.3` + refactor console/app complété. Accepter le statut alpha en production.

## Alternatives rejetées

- **Path A (1.2.0 + refactor `solidStart` → `defineConfig`)** : techniquement possible mais ne résout pas le B-003 Windows backslash (alpha-only fix). Demande refactor + re-introduction bug B-003.
- **Path C (downgrade h3 pour fixer vinxi)** : pas applicable (voir ADR-0010).
- **Attendre 2.0.0 stable** : aucune date announced, bloque le projet indéfiniment.

## Conséquences

- ✅ enterprise + console/app build PASS
- ✅ B-002 push débloqué, B-003 fixé
- ⚠️ Version alpha en production — breaking changes possibles à chaque bump 2.0.0-alpha.X
- ⚠️ Phase 8 audit MEDIUM items peuvent réapparaître si SolidStart 2.0.0 change d'API entre alphas
- ℹ️ Migration vers 2.0.0 stable = changement de type minimal (la nouvelle API est déjà utilisée)

Refs : B-002 commits `afbae5e3f2` + `1ad7e80fec` (Phase 9 + 9.5)
      `OpenCode/_review/Phase-9-5-Update-3-Final-Report-2026-06-26.md`
