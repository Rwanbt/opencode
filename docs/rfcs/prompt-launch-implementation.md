# Prompt de lancement — session d'implémentation

> Copier-coller ce prompt tel quel dans une nouvelle session Claude Code
> ouverte dans `D:\App\OpenCode\opencode\`.

---

## Le prompt

```
Je travaille sur mon fork d'OpenCode (terminal agentique IA, Bun + Effect + SolidJS + Tauri).
Je veux implémenter une feature "Collective Intelligence" / "Blind Spot Hunter" — un mode
/debate qui fait dialoguer N modèles IA en parallèle, extrait les claims atomiques, identifie
les blind spots (insights qu'un seul modèle a vus), et produit un rapport structuré.

Cette feature a été spécifiée via 3 rounds de débat multi-IA (8 modèles, 20+ réponses).
La spec complète et le plan d'implémentation sont dans :

- docs/rfcs/implementation-plan-collective-intelligence.md — PLAN COMPLET (lire en premier)
- docs/rfcs/debate-final-synthesis.md — Synthèse des 3 rounds de débat
- docs/rfcs/credential-discovery-spec.md — Spec technique auth multi-provider

Commence par lire ces 3 fichiers. Ensuite :

1. Étudie les patterns Effect existants du codebase pour que le code s'intègre naturellement :
   - packages/opencode/src/agent/agent.ts — comment les agents sont déclarés (Agent.Info, Service)
   - packages/opencode/src/provider/provider.ts — comment les providers résolvent les modèles
   - packages/opencode/src/session/llm.ts — comment le streaming LLM fonctionne
   - packages/opencode/src/skill/index.ts — comment les skills sont enregistrées
   - packages/opencode/src/auth/index.ts — comment l'auth est gérée (Schema.TaggedErrorClass)
   - packages/opencode/src/storage/storage.ts — pattern de persistance
   - packages/opencode/src/bus/index.ts — pattern événements (BusEvent.define + PubSub)
   - packages/opencode/src/session/session.sql.ts — schéma drizzle existant

2. Implémente la Phase P0 (fondations) puis P1 (MVP) du plan. Concrètement :

   P0 — Fondations :
   - packages/opencode/src/collective/types.ts (types Zod: Claim, DebateReport, DebateConfig)
   - packages/opencode/src/collective/debate-store.sql.ts (schéma drizzle)
   - packages/opencode/src/collective/debate-store.ts (service Effect CRUD)
   - packages/opencode/src/collective/budget-tracker.ts (estimation + kill-switch)
   - Bus events (DebateStarted, DebateCompleted)

   P1 — MVP :
   - packages/opencode/src/collective/provider-discovery.ts (cascade auth)
   - packages/opencode/src/collective/claim-extractor.ts (extraction + vérif exhaustivité)
   - packages/opencode/src/collective/synthesis-judge.ts (Phase 4)
   - packages/opencode/src/collective/orchestrator.ts (Phases 1+2+4)
   - packages/opencode/src/collective/debate-agent.ts (Agent.Info)
   - packages/opencode/src/collective/index.ts (exports)
   - Enregistrement de l'agent dans agent/agent.ts
   - Skill: packages/opencode/skills/debate/SKILL.md

Patterns obligatoires (tirés du codebase existant) :
- Services: ServiceMap.Service<S, Interface>()("@opencode/Collective")
- Méthodes: Effect.fn("Collective.methodName")(function* () { ... })
- État: InstanceState.make() avec ScopedCache
- Erreurs: NamedError.create("CollectiveXxx", z.object({ ... }))
- Layers: Layer.effect(Service, Effect.gen(...)) + defaultLayer + makeRuntime
- Streaming: Stream.Stream<DebateEvent> pour la TUI
- Persistance: drizzle-orm sqliteTable avec Timestamps
- Events: BusEvent.define("collective.debate.xxx", z.object({ ... }))

Contraintes architecturales (issues du débat multi-IA) :
- Anti-contamination : les modèles ne voient JAMAIS les réponses attribuées des autres
- Anonymisation sélective : claims anonymes (hash) pendant le débat, attribués dans le rapport
- Union des différences : chaque insight unique a de la valeur, ne pas chercher le consensus
- Extracteur unique + vérificateur d'exhaustivité (pas double extracteur)
- Clause "hors rôle" : chaque modèle peut signaler un insight hors de son rôle assigné
- Graceful degradation : fonctionne dès 2 providers
- Budget kill-switch : arrêt en temps réel si budget dépassé
- Le juge final est un modèle qui N'A PAS participé à la Phase 1

Pour le MVP (P1), on se concentre sur :
- Pipeline simplifié: Phase 1 (diverge) + Phase 2 (extraction) + Phase 4 (synthèse)
- Pas de Phase 3 (convergence), pas de Red Team, pas de Canary, pas de mémoire
- Minimum 2 providers pour fonctionner
- Tier 1 (Quick) seulement
- Rapport JSON + Markdown affiché dans la TUI
```
