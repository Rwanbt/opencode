# P2-C200-H — Mock implementations (déjà livré)

**Statut :** `INTEGRATED` (example 07)
**Date :** 2026-08-01
**Parent :** P2-C200 (Contrats Unifia)

## État

**Mocks** livrés dans [examples/07-fake-impl.ts](../../packages/contracts/examples/07-fake-impl.ts) :
- `FakeRuntimeAdapter`
- `FakeWorkspacePort`
- `FakeCapabilityPort` (partial)
- `FakeArtifactPort` (partial)
- `FakeSandboxPort` (partial)

## Limitations

- `FakeCapability` ne fait que echo (pas de policy)
- `FakeArtifact` ne render pas vraiment (retourne bytes vides)
- `FakeSandbox` retourne toujours exitCode 0

## Mocks manquants à implémenter

```typescript
// packages/contracts/src/mocks/capability.ts
export class StrictMockCapability implements CapabilityPort {
  private allowed = new Set<string>()

  allow(capId: string) {
    this.allowed.add(capId)
    return this
  }

  async search(input: SearchInput): Promise<CapabilityDescriptor[]> {
    return Array.from(this.allowed).map(id => ({ id, name: id, version: "1.0", inputs: [] }))
  }

  async authorize(input: AuthorizeInput): Promise<AuthorizationResult> {
    return this.allowed.has(input.capabilityId)
      ? { type: "allow" }
      : { type: "deny", reason: "not in allowed list" }
  }

  async execute(input: ExecuteInput): Promise<ExecutionResult> {
    if (!this.allowed.has(input.capabilityId)) {
      throw new Error("not authorized")
    }
    return {
      executionId: `e_${Date.now()}`,
      status: "completed",
      output: `mock ${input.capabilityId}`,
      startedAt: Date.now(),
    }
  }

  async cancel(): Promise<void> {}
}
```

## Estimation

- 6 mocks complets : ~500 LOC
- **Total : ~500 LOC**

## Liens

- [P2-C200-G property tests](P2-C200-G-property-tests.md)
- [examples/07-fake-impl.ts](../../packages/contracts/examples/07-fake-impl.ts)