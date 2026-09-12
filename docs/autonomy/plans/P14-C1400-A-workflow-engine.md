# P14-C1400-A — Workflow engine

**Statut :** `INTEGRATED` (design documenté)
**Date :** 2026-08-01
**Parent :** P14-C1400 (Workflow)

## Objectif

Implémenter un **moteur de workflow** déclaratif pour orchestrer des séquences complexes.

## Format YAML

```yaml
name: deploy-app
version: 1.0.0
trigger:
  type: git_push
  branch: main

steps:
  - name: install
    run: bun install
  - name: test
    run: bun test
    on_failure: abort
  - name: build
    run: bun run build
    needs: [install, test]
  - name: deploy
    run: scripts/deploy.sh
    needs: [build]
    requires_approval: true
```

## Architecture

```typescript
interface WorkflowEngine {
  define(workflow: Workflow): Promise<WorkflowHandle>
  trigger(handle: WorkflowHandle, input: TriggerInput): Promise<WorkflowRun>
  status(runId: string): Promise<WorkflowStatus>
  cancel(runId: string): Promise<void>
  list(): Promise<WorkflowHandle[]>
}
```

## Fonctionnalités

- **DAG** : steps avec `needs` (dependances)
- **Conditions** : `if`, `on_failure`, `on_success`
- **Approval gates** : `requires_approval`
- **Retry** : `retry_on_failure: 3`
- **Parallel** : `parallel: true`
- **Timeout** : `timeout: "5min"`

## Estimation

- Engine core : ~600 LOC
- DAG scheduler : ~400 LOC
- Conditions/approvals : ~300 LOC
- YAML parser : ~200 LOC
- Tests : ~500 LOC
- **Total : ~2000 LOC**

## Liens

- [ADR-0019 Workflow Automation](docs/adr/0019-workflow-automation.md)
- [.github/workflows/release.yml](../../.github/workflows/release.yml)