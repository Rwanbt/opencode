# P2-C200-E — SandboxPort (déjà livré)

**Statut :** `INTEGRATED` (interface TypeScript créée + tests)
**Date :** 2026-08-01
**Parent :** P2-C200 (Contrats Unifia)

## État

**Interface TypeScript** déjà livrée :
- `packages/contracts/src/sandbox.ts` (44 LOC)
- 15 tests PASS
- `packages/contracts/examples/04-sandbox-port.ts` (multi-backend)

## Composition

```typescript
export interface SandboxPort {
  inspect(): Promise<SandboxBackendInfo[]>
  prepare(policy: SandboxPolicy): Promise<SandboxHandle>
  execute(handle: SandboxHandle, request: ExecutionRequest): Promise<Execution>
  terminate(handle: SandboxHandle): Promise<void>
}
```

## Backends cibles

| Backend | Plateforme | Status |
|---|---|---|
| `native` | Local process | À implémenter |
| `docker` | Linux/macOS/Windows | À implémenter |
| `wsl2` | Windows | À implémenter |
| `lima` | macOS (alternative Docker) | Future |
| `firecracker` | Linux (microVM) | Future |

## Policy par défaut

```typescript
const defaultPolicy: SandboxPolicy = {
  backend: "docker",
  network: "none",  // default-deny
  filesystem: { readOnly: true },
  resources: {
    cpu: 1,
    memoryMb: 512,
    timeoutMs: 30_000,
  },
}
```

## Liens

- [ADR-0005 SandboxPort](docs/adr/0005-sandbox-port.md)
- [P8-C800 SandboxBroker](plans/P8-C800-sandbox-broker.md)