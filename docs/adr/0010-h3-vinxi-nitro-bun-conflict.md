# ADR-0010 : h3 / vinxi / nitro conflit structurel bun — accepté, non fixable en config

**Date** : 2026-06-26 | **Statut** : Accepté (documenté, pas fixé)

## Contexte

Le `overrides` global dans `package.json` force `h3: 2.0.1-rc.22` (sécurité nitro). Mais :
- `vinxi@0.5.x` hard-pin `h3@1.15.3` (exact, no caret) sur **toute la ligne** (0.5.0 → 0.5.11, pas de 0.6.x dans registry).
- `nitro@3.0.1-alpha.1` hard-pin `h3@2.0.1-rc.5` (utilise `toRequest` qui est 2.x-only API).

Avec bun **hoisted install** : un seul `h3` installé. Si on force 2.x (global override) → vinxi casse (`send` n'existe plus en 2.x). Si on laisse 1.x (vinxi wins) → nitro casse (`toRequest` n'existe pas en 1.x).

## Décision

**Garder le status quo** : `h3: 2.0.1-rc.22` global override. Vinxi et nitro ne sont PAS chargés simultanément dans le runtime actuel — l'écosystème est en transition vers 2.0.0-alpha où vinxi 0.6.x supportera h3@2.x (pas encore publié).

## Alternatives rejetées (toutes testées, toutes échouent)

- **Path 1 — Override `h3: ^1.10.0`** : nitro casse (forcé 1.x partout, pas de `toRequest`)
- **Path 2 — Retrait total override h3** : bun résout `nitro/h3@2.0.1-rc.5` au top-level → vinxi casse
- **Path 3 — Nested override bun** : `bun: "Bun currently only supports top-level overrides. Nested overrides are not supported."` (docs officielles https://bun.com/docs/pm/overrides). Brief 9.6.1 invalide.
- **Path 4 — `bun install --linker=isolated`** : testée, l'override global force quand même la version dans les nested. Pas de fix.
- **Path 5 — Patch vinxi + nitro** : 1-2h, dette de maintenance permanente (à refaire à chaque bump), détails API h3@2.x non documentés publiquement.
- **Path 6 — Attendre vinxi 0.6.x** : pas de date, bloque projet.

## Conséquences

- ✅ Comportement actuel stable (avec 2.0.0-alpha.3 de @solidjs/start, les imports passent)
- ⚠️ Tout ajout futur d'un package qui hard-pin h3@1.x en dépendance directe cassera le build
- ⚠️ Tout ajout futur d'un package qui hard-pin h3@2.x en dépendance directe cassera le build (overridden par le global)
- ℹ️ Quand vinxi 0.6.x supportera h3@2.x, retrait du global override + bump vinxi = 1 ligne de config
- ℹ️ Surveillance cargo audit / bun audit : h3@1.15.3 a des CVEs publiquement connues, on garde nitro-sécurité 2.0.1-rc.22

Refs : Phase 9.5 Update 1+2+3, sub-agent scan registry vinxi (109 versions)
      `OpenCode/_review/Phase-9-5-Update-2-Option-A-Result-2026-06-26.md`
      `OpenCode/_review/Phase-9-5-Update-3-Final-Report-2026-06-26.md`
