# ADR-1031 : Sortie du chemin legacy `experimental_telemetry`

**Date** : 2026-07-10 | **Statut** : Accepté

## Décision

`experimental_telemetry` de l’AI SDK reste supporté uniquement comme compatibilité transitoire et est désactivé par défaut pour le cœur d’observabilité native. Il ne constitue ni la source de vérité ni un stockage. Tant qu’un appel legacy subsiste, `recordInputs: false` et `recordOutputs: false` sont forcés; aucune donnée libre ne doit être envoyée à un exporter. Sa suppression complète sera traitée après migration des call sites `session/llm.ts` et `agent/agent.ts`, avec un test de non-régression.

## Conséquences

La collecte native ne dépend pas d’OTel/AI SDK. Une configuration legacy existante ne peut pas réactiver l’enregistrement de contenu par défaut.
