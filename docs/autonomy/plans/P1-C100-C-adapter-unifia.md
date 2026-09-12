# P1-C100-C — Adapter Unifia (futur)

**Statut :** `INTEGRATED` (design documenté)
**Date :** 2026-08-01
**Parent :** P1-C100 (Harness multi-runtime)

## Objectif

Documenter l'architecture cible du **UnifiaRuntime natif** qui remplacera OpenCode à terme. C'est le futur long terme (P3+).

## Vision

```typescript
// packages/harness/src/adapters/unifia.ts
import type { RuntimeHarness } from "../harness.js"

/**
 * UnifiaRuntime : implémentation native Unifia (pas fork d'OpenCode)
 * - Écrit from scratch en TypeScript strict
 * - Utilise les 6 contrats Unifia
 * - Compatible avec P3 (security foundation)
 *
 * Différences avec OpenCode :
 * - Default-deny par défaut (vs OpenCode: default-allow)
 * - Capabilities déclarées vs implicites
 * - Audit runtime systématique vs opt-in
 * - Sandbox par défaut vs opt-in
 */
export class UnifiaRuntimeAdapter implements RuntimeHarness {
  id = "unifia-runtime" as const
  version = "0.1.0"

  // Toutes les capabilities Unifia
  capabilities = [
    "workspace.*",
    "command.run",
    "file.read",
    "file.write",
    "file.diff",
    "git.diff",
    "git.commit",
    "git.push",
    "browser.automate",
    "image.render",
    "audio.transcribe",
  ]

  async start(config: HarnessConfig): Promise<HarnessHandle> {
    // Initialise UnifiaRuntime
    return { id: this.id }
  }

  async createSession(input: CreateSessionInput): Promise<Session> {
    // Default-deny: check policy avant create
    const allowed = await this.checkPolicy(input)
    if (!allowed) throw new Error("Policy denied")
    return { id: `s_${Date.now()}`, workspaceId: input.workspaceId, runtimeId: this.id, createdAt: Date.now() }
  }

  private async checkPolicy(input: any): Promise<boolean> {
    // Intégration avec PolicyEngine (P3-C300)
    return true
  }

  async sendPrompt(input: SendPromptInput): Promise<PromptReceipt> {
    // Audit runtime systématique
    return { receiptId: `r_${Date.now()}`, sessionId: input.sessionId, accepted: true }
  }

  async *subscribeEvents(input: SubscribeInput): AsyncIterable<RuntimeEvent> {
    // TaintTracker automatique sur tous les outputs
    yield* []
  }
}
```

## Différences clés avec OpenCode

| Aspect | OpenCode | UnifiaRuntime |
|---|---|---|
| Default policy | Allow | **Deny** |
| Capabilities | Implicites | **Déclarées** |
| Audit | Opt-in | **Systématique** |
| Sandbox | Opt-in | **Par défaut** |
| Taint tracking | None | **Automatique** |
| Approval flow | Aucun | **Workflow BDDL** |

## Plan

- v0.1 (2026 Q3) : PoC minimal, pas de policy
- v0.5 (2026 Q4) : Policy engine + audit basique
- v1.0 (2027 Q1) : Runtime Unifia complet, migration OpenCode

## Liens

- [ADR-0001 RuntimeAdapter](docs/adr/0001-runtime-adapter.md)
- [ADR-0006 PolicyEngine](docs/adr/0006-policy-engine.md)
- [ADR-0009 AuditRuntime](docs/adr/0009-audit-runtime.md)
- [P1-C100-A](P1-C100-A-harness-contract.md)
- [P3-C300 Security foundation](P3-C300-security-foundation.md)