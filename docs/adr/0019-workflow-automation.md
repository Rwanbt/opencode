---
id: 0019
title: Workflow Automation
status: PROPOSED
date: 2026-07-31
---

# ADR-0019: Workflow Automation

**Statut :** `PROPOSED`
**Date :** 2026-07-31
**Décideurs :** Erwan, Hermes Agent (MiniMax M3)
**Source :** Plan V3 §14 (« Workflow Automation »)

## Contexte

Unifia doit permettre l'**automatisation de workflows** : l'utilisateur décrit un workflow (séquence d'étapes), et l'agent l'exécute de manière répétée. Le mode **Automate** du Shell Unifia (§7) est dédié à ça.

Use cases :
- "Compile le projet, lance les tests, builde les artefacts, publie sur npm"
- "Scrape les news, extrait les titres, envoie-moi un résumé par email"
- "Compile, test, commit, push, deploy"

## Décision

Adopter le pattern **WorkflowEngine** avec 4 méthodes :

```typescript
interface WorkflowEngine {
  define(workflow: WorkflowDefinition): Promise<WorkflowId>
  execute(workflowId: WorkflowId, input: WorkflowInput): Promise<WorkflowRun>
  status(runId: RunId): Promise<RunStatus>
  cancel(runId: RunId): Promise<void>
}
```

**Types principaux** :
- `WorkflowDefinition` : id, name, steps (array), triggers (schedule/webhook/manual), retry policy
- `Step` : name, command, capability required, timeout, retry on failure
- `WorkflowRun` : runId, status (running/completed/failed), output, logs
- `Triggers` : schedule (cron), webhook (URL), manual

**Implémentations** :
1. `YamlWorkflowEngine` (défaut — workflow en YAML)
2. `SchedulableWorkflowEngine` (cron trigger)
3. `WebhookWorkflowEngine` (HTTP trigger)

**Chaque step** :
- Exécute une capability (ex: `unifia.command.bash`)
- A un timeout configurable
- Retry sur failure (backoff exponentiel)
- Output passé au step suivant (chaînage)

## Conséquences

### Positives
- ✅ **Automatisation** : workflows répétables
- ✅ **Composabilité** : steps réutilisables
- ✅ **Triggers** : schedule, webhook, manual
- ✅ **Observabilité** : logs, status, retry count
- ✅ **Sécurité** : chaque step passe par PolicyEngine

### Négatives
- ❌ **Complexité** : workflows buggés sont difficiles à debugger
- ❌ **Idempotence** : un step non-idempotent peut causer des dégâts
- ❌ **Coût** : workflows longs consomment des resources
- ❌ **Sécurité** : un trigger webhook peut être exploité

### Neutres
- Le pattern est agnostique du langage de workflow (YAML, JSON, etc.)

## Alternatives considérées

### A. GitHub Actions comme backend
- **Rejeté** : couplage à GitHub, pas offline

### B. n8n / Temporal comme backend
- **À reconsidérer** : mature, mais dépendance externe

### C. Workflow engine natif (cette décision)
- **Adopté** : autonomie, alignement Plan V3

## Plan d'implémentation

- **Phase 2** : interfaces TypeScript
- **Phase 14** : YamlWorkflowEngine
- **Phase 14** : SchedulableWorkflowEngine (cron)
- **Phase 14** : WebhookWorkflowEngine
- **Phase 14** : UI Shell Unifia mode Automate

## Liens

- Plan V3 §14 (Workflow Automation)
- ADR-0001 (RuntimeAdapter) — exécution des steps
- ADR-0003 (CapabilityPort) — chaque step est une capability
- ADR-0006 (PolicyEngine) — chaque step autorisé
- ADR-0009 (AuditRuntime) — chaque run tracé
- ADR-0016 (Gates) — Gate C inclut Workflow
