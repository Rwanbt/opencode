# P8-C800 — SandboxBroker

**Statut :** `INTEGRATED` (design documenté)
**Date :** 2026-08-01
**Parent :** P8-C800 (SandboxBroker)

## Objectif

Implémenter le **SandboxBroker** qui route les exécutions vers le bon backend (native, docker, wsl2, firecracker).

## Architecture

```
[Capability demandée]
     ↓
[SandboxPort.execute]
     ↓
[SandboxBroker.route]  ← policy-based routing
     ↓
┌─────────┬─────────┬─────────┬─────────┐
│ native  │ docker  │  wsl2   │firecrack│
└─────────┴─────────┴─────────┴─────────┘
```

## Routing policy

```typescript
interface RoutingPolicy {
  capability: string
  preferredBackend: SandboxBackend
  fallbackBackends: SandboxBackend[]
  constraints?: {
    networkAccess?: boolean
    linuxOnly?: boolean
    macOSOnly?: boolean
    windowsOnly?: boolean
  }
}
```

## Backends

| Backend | Plateforme | Use case |
|---|---|---|
| `native` | All | Quick, local |
| `docker` | Linux/macOS/Windows | Standard |
| `wsl2` | Windows | WSL2 users |
| `lima` | macOS (alt Docker) | Advanced macOS |
| `firecracker` | Linux | Production microVM |

## Fallback chain

```typescript
const fallback = ["docker", "native", "wsl2"]
// Try docker, if fail try native, etc.
```

## Estimation

- Broker core : ~300 LOC
- Routing policy : ~200 LOC
- Backends : ~1500 LOC (5 backends × 300 LOC)
- Tests : ~300 LOC
- **Total : ~2300 LOC**

## Liens

- [P2-C200-E SandboxPort](plans/P2-C200-E-sandbox-port.md)
- [ADR-0005 SandboxPort](docs/adr/0005-sandbox-port.md)