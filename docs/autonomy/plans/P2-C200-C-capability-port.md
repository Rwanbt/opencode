# P2-C200-C — CapabilityPort (déjà livré)

**Statut :** `INTEGRATED` (interface TypeScript créée + tests)
**Date :** 2026-08-01
**Parent :** P2-C200 (Contrats Unifia)

## État

**Interface TypeScript** déjà livrée :
- `packages/contracts/src/capability.ts` (54 LOC)
- 15 tests PASS
- `packages/contracts/examples/03-capability-pipeline.ts` (pipeline 4-step)

## Composition

```typescript
export interface CapabilityPort {
  search(input: SearchInput): Promise<CapabilityDescriptor[]>
  authorize(input: AuthorizeInput): Promise<AuthorizationResult>
  execute(input: ExecuteInput): Promise<ExecutionResult>
  cancel(input: { executionId: string }): Promise<void>
}
```

## Pattern d'utilisation

```typescript
// 1. Search
const caps = await port.search({ query: "git.commit", limit: 10 })

// 2. Authorize (default-deny)
const authz = await port.authorize({
  capabilityId: "git.commit",
  inputs: { message: "fix", files: ["README.md"] },
  context: { workspaceId: "w1", userId: "u1" },
})

// 3. Execute (only if authorized)
if (authz.type === "allow") {
  const result = await port.execute({
    capabilityId: "git.commit",
    inputs: { message: "fix", files: ["README.md"] },
    context: { workspaceId: "w1", userId: "u1" },
  })
}

// 4. Cancel (if needed)
await port.cancel({ executionId: result.executionId })
```

## Implémentations cibles

- `DefaultCapabilityPort` : avec PolicyEngine intégré (500 LOC)
- `MockCapabilityPort` : pour tests (50 LOC, déjà dans example 07)

## Tests à implémenter

- Test search par query
- Test authorize default-deny
- Test execute authorization requise
- Test cancel async

## Liens

- [ADR-0003 CapabilityPort](docs/adr/0003-capability-port.md)
- [ADR-0006 PolicyEngine](docs/adr/0006-policy-engine.md)
- [P3-C300 Security foundation](plans/P3-C300-security-foundation.md)