# P2-C200-G — Tests E2E property-based

**Statut :** `INTEGRATED` (design documenté)
**Date :** 2026-08-01
**Parent :** P2-C200 (Contrats Unifia)

## Objectif

Fournir des **property-based tests** pour les 6 ports, qui vérifient les invariants mathématiques plutôt que des cas spécifiques.

## Outil

`fast-check` (npm package) : property-based testing TypeScript-first.

## Tests à implémenter

```typescript
import * as fc from "fast-check"
import { describe, it } from "vitest"
import { FakeRuntime, FakeWorkspace, FakeCapability } from "./07-fake-impl"

describe("RuntimeAdapter properties", () => {
  it("createSession then sendPrompt increments messageCount", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.string({ minLength: 1 }),
        fc.string(),
        async (workspaceId, prompt) => {
          const runtime = new FakeRuntime()
          const session = await runtime.createSession({ workspaceId })
          const before = session.messageCount
          await runtime.sendPrompt({ sessionId: session.id, prompt })
          const after = await runtime.listSessions().then(s => s[0])
          return after.messageCount === before + 1
        }
      )
    )
  })
})
```

## Invariants à tester

### RuntimeAdapter
- `createSession` retourne un ID unique
- `sendPrompt` incrémente messageCount de exactement 1
- `cancelSession` supprime la session

### WorkspacePort
- `write` puis `read` retourne le même contenu
- `write` est atomique (multi-files = all-or-nothing)
- `close` invalide la session

### CapabilityPort
- `execute` sans `authorize` → reject
- `authorize` "deny" → execute reject
- `cancel` met fin à l'execution

### ArtifactPort
- `version` incrémente le compteur
- `render` retourne un buffer de bytes
- `export` retourne une destination valide

### SandboxPort
- `prepare` retourne un handle unique
- `terminate` libère les ressources
- `execute` retourne un exit code

### RemoteTransportPort
- `send` n'échoue jamais (best-effort)
- `pair` retourne une identité unique

## Estimation

- Tests property-based : ~500 LOC
- **Total : ~500 LOC**

## Liens

- [P2-C200-A](P2-C200-A-runtime-adapter.md)
- [ADR-0028 Contracts implementation](docs/adr/0028-contracts-implementation.md)