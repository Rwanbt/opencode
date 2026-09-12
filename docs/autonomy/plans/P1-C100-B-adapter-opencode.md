# P1-C100-B — Adapter OpenCode

**Statut :** `INTEGRATED` (design documenté)
**Date :** 2026-08-01
**Parent :** P1-C100 (Harness multi-runtime)

## Objectif

Implémenter `OpenCodeHarnessAdapter` qui wrappe le runtime OpenCode existant et l'expose comme un `RuntimeHarness` Unifia-compatible.

## Mapping OpenCode → Unifia

| OpenCode | Unifia |
|---|---|
| `packages/unifia/src/cli/cmd/run.ts` | `RuntimeAdapter.sendPrompt` |
| `packages/unifia/src/session/index.ts` | `RuntimeAdapter.createSession` |
| `packages/unifia/src/server/server.ts` | `RuntimeHarness.start` |
| `packages/unifia/src/provider/loaders.ts` | `CapabilityDescriptor` |

## Stratégie

**Pas de rewrite** : le code OpenCode est gros (48k LOC). On crée un **adapter fin** qui :
1. Démarre le process OpenCode (subprocess ou in-process)
2. Expose les commandes minimales
3. Traduit les events OpenCode vers RuntimeEvent Unifia

## Code squelette

```typescript
// packages/harness/src/adapters/opencode.ts
import { spawn } from "bun"
import type { RuntimeHarness, HarnessConfig, HarnessHandle, RuntimeEvent, Session } from "../harness.js"

export class OpenCodeHarnessAdapter implements RuntimeHarness {
  id = "opencode" as const
  version = "0.x.x"

  private proc: Bun.Subprocess | null = null
  private sessions = new Map<string, Session>()

  async start(config: HarnessConfig): Promise<HarnessHandle> {
    this.proc = spawn({
      cmd: ["bun", "run", "packages/unifia/src/index.ts"],
      env: { ...process.env, UNIFIA_API_KEY: config.apiKey },
    })
    return { id: this.id, process: this.proc }
  }

  async stop(handle: HarnessHandle): Promise<void> {
    this.proc?.kill()
    this.proc = null
  }

  async health(handle: HarnessHandle): Promise<HealthReport> {
    return { id: this.id, healthy: this.proc?.exitCode === null, latencyMs: 0 }
  }

  async createSession(input: any): Promise<Session> {
    // Delegate to OpenCode CLI
    return { id: `s_${Date.now()}`, workspaceId: input.workspaceId, runtimeId: this.id, createdAt: Date.now() }
  }

  async sendPrompt(input: any): Promise<any> {
    // Forward to OpenCode
    return { receiptId: `r_${Date.now()}`, sessionId: input.sessionId, accepted: true }
  }

  async *subscribeEvents(input: any): AsyncIterable<RuntimeEvent> {
    // Forward OpenCode events
    yield { sessionId: input.sessionId, type: "text", data: "", timestamp: Date.now() }
  }
}
```

## Tests à implémenter

- Test que start spawn le bon process
- Test que stop kill proprement
- Test que createSession génère un ID unique
- Test que subscribeEvents streame

## Estimation

- Adapter : ~200 LOC
- Tests : ~100 LOC
- **Total : ~300 LOC**

## Liens

- [ADR-0001 RuntimeAdapter](docs/adr/0001-runtime-adapter.md)
- [P1-C100-A](P1-C100-A-harness-contract.md)