# ADR-0001 : Factory with Deps Pattern for SolidJS Page Components

**Date** : 2026-05-27 | **Statut** : Accepté

## Contexte

Les composants-page SolidJS (`session.tsx`, `layout.tsx`) dépassaient 1400 LOC en orchestrant état, hooks, effects et JSX. Le pattern classique d'extraction en composants enfants nécessite des props-drilling massifs (~25 props) qui dégradent la maintenabilité.

## Décision

Utiliser le pattern **Factory with Deps** : les blocs logiques sont extraits dans des fonctions `createXxx(deps: XxxDeps)` qui :
- Déclarent leurs dépendances via une interface `XxxDeps` typée
- Installent leurs propres effects + cleanup via `createEffect` / `onCleanup`
- Retournent les seuls accesseurs/actions nécessaires en dehors

## Alternatives rejetées

- **Composants enfants** : nécessitent ~25 props, dégradent la lisibilité des call sites
- **Context injection** : complexifie le test et le découpage
- **Inline** : fichiers > 1500 LOC, bloque le gate CI

## Conséquences

- ✅ Fichiers extraits ≤ 300 LOC
- ✅ Call sites lisibles (1 ligne par factory)
- ✅ Chaque factory testable indépendamment
- ⚠️ Les coordinateurs (session.tsx, layout.tsx) restent ≥ 1000 LOC (plancher architectural — voir ADR-0002)
