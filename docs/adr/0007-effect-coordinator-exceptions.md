# ADR-0007 : Exceptions coordinateur pour les layers Effect monolithiques

**Date** : 2026-06-22 | **Statut** : Accepté

## Contexte

La passe de réduction des god-files (>1500 LOC) a décomposé avec succès 6
fichiers (provider, github, acp, lsp, config, session-TUI) en extrayant des
unités à responsabilité unique. Deux fichiers résistent à une extraction propre :

- `session/prompt.ts` (2085 LOC) — le `SessionPrompt.layer` est un unique
  `Layer.effect(Service, Effect.gen(...))` de ~1767 LOC qui injecte 22 services
  (`yield* X.Service`) puis définit une dizaine de closures `Effect.fn`
  (`createUserMessage`, `insertReminders`, `resolveTools`, `handleSubtask`,
  `command`…) mutuellement récursives qui **capturent** ces services.

C'est l'équivalent backend des coordinateurs SolidJS de [ADR-0002](0002-coordinator-loc-floor.md)
(`session.tsx`, `layout.tsx`).

## Décision

Reconnaître les **layers Effect coordinateurs** comme exception documentée au
gate de 1500 LOC, au même titre que les coordinateurs UI (ADR-0002).

Tentative d'extraction menée et **rejetée** sur `prompt.ts` : sortir les closures
vers un module `makePromptImpl(deps)` (pattern Factory-with-Deps, ADR-0001) casse
le typage Effect. Les closures, définies hors du contexte `Effect.gen`, perdent
la résolution du **canal de requirements (R)** : leurs appels de méthodes service
produisent `Effect<…, unknown, unknown>` au lieu de `Effect<…, never, never>`
attendu par l'`Interface` du Service. Le typage des deps via `ServiceShape<typeof
X.Service>` ne suffit pas à reconstituer l'identité de type exacte, et forcer le
typage du `state` (InstanceState) + 16 services injectés est fragile.

Le coût (refactor à haut risque du hot path LLM, typage Effect profond) est
disproportionné au regard du bénéfice (pure conformité au gate LOC, **zéro**
changement de comportement).

## Conséquences

- `prompt.ts` reste à 2085 LOC — coordinateur Effect, plancher architectural.
- Le gate LOC CI doit exempter `session/prompt.ts` (comme `session.tsx` /
  `layout.tsx`).
- Règle générale : un `Layer.effect` dont les closures capturent un grand nombre
  de services injectés et s'appellent mutuellement n'est PAS un candidat à
  l'extraction Factory-with-Deps. Préférer extraire les **helpers purs**
  (sans capture de service, comme fait sur `acp/agent.ts`) quand ils existent.

## Alternatives rejetées

- **Factory `makePromptImpl(deps)`** : casse le canal R d'Effect (testé).
- **Réécrire chaque closure en `deps.X`** : 100+ éditions sur le hot path, risque
  de régression élevé pour un gain nul.
- **Déplacer toutes les closures dans un seul module** : relocalise le BLOCKER
  sans le résoudre (le module ferait ~1700 LOC).
