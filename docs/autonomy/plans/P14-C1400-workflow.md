# P14-C1400 — Plan détaillé : Workflow Automation

**Carte parente :** P14-C1400 (Phase 14, DEFERRED → DETAILED)
**Statut :** `PROPOSED` — bloqué code TS
**Date :** 2026-07-31
**Source :** Plan V3 §14 (Workflow Automation)

## Contexte

Phase 14 implémente le **Workflow Engine** : l'utilisateur décrit un workflow (YAML), et l'agent l'exécute de manière répétée. Triggers : cron, webhook, manual.

## Découpage en sous-cartes (8)

### P14-C1400a — WorkflowParser
- **Statut :** `PROPOSED`
- **Scope :** `packages/workflow/src/parser.ts` (~250 lignes)
- **Livrable :** YAML → WorkflowDefinition
- **Acceptance :** validation, erreurs claires

### P14-C1400b — WorkflowExecutor
- **Statut :** `PROPOSED`
- **Scope :** `packages/workflow/src/executor.ts` (~400 lignes)
- **Livrable :** Exécution séquentielle/parallèle
- **Acceptance :** error handling, retry

### P14-C1400c — StepCapability
- **Statut :** `PROPOSED`
- **Scope :** `packages/workflow/src/steps/` (~300 lignes)
- **Livrable :** Steps built-in (bash, http, capability)
- **Acceptance :** 10+ steps

### P14-C1400d — CronTrigger
- **Statut :** `PROPOSED`
- **Scope :** `packages/workflow/src/triggers/cron.ts` (~200 lignes)
- **Livrable :** Trigger cron
- **Acceptance :** cron syntax, persistence

### P14-C1400e — WebhookTrigger
- **Statut :** `PROPOSED`
- **Scope :** `packages/workflow/src/triggers/webhook.ts` (~200 lignes)
- **Livrable :** Trigger HTTP
- **Acceptance :** auth, payload validation

### P14-C1400f — WorkflowUI
- **Statut :** `PROPOSED`
- **Scope :** `packages/app/src/pages/workflows.tsx` (~400 lignes)
- **Livrable :** UI mode Automate
- **Acceptance :** create, edit, run, logs

### P14-C1400g — WorkflowRuntime
- **Statut :** `PROPOSED`
- **Scope :** `packages/workflow/src/runtime.ts` (~300 lignes)
- **Livrable :** Scheduler + poller
- **Acceptance :** exécute planifié, recovery

### P14-C1400h — WorkflowTests
- **Statut :** `PROPOSED`
- **Scope :** `packages/workflow/test/` (~400 lignes)
- **Livrable :** Tests property-based
- **Acceptance :** 100+ cas

## Critères de sortie Plan V3 §14

- [ ] Workflow YAML valide
- [ ] Exécution correcte
- [ ] Steps built-in
- [ ] Cron + Webhook
- [ ] UI Automate
- [ ] Runtime schedulé
- [ ] Tests 100%

## Dépendances

- **P2-C200** (Contrats) — WorkflowEngine
- ADR-0019 (Workflow) — design

## Estimation

**Total : 4-6 semaines solo**, 2-3 semaines équipe 2-3
