# @unifia/contracts

Unifia Workbench contracts — 6 ports TypeScript du Plan V3 §7.

## Contenu

- **RuntimeAdapter** (ADR-0001) — abstraction sur le runtime agentique
- **WorkspacePort** (ADR-0002) — abstraction sur le storage workspace
- **CapabilityPort** (ADR-0003) — abstraction sur les capabilities
- **ArtifactPort** (ADR-0004) — abstraction sur les artefacts
- **SandboxPort** (ADR-0005) — abstraction sur les backends d'isolation
- **RemoteTransportPort** (Plan V3 §7.6) — abstraction sur les transports distants
- **Secret brands** (ADR-1042) — `DesktopKeychainToken`,
  `MobileEncryptionKey`, `WorkbenchIpcBearer` — three brand types
  that prevent a value being used in the wrong role at compile
  time, with `tryDecode*` runtime guards at the env-var /
  request-header boundary.

## Usage

```typescript
import type { RuntimeAdapter, WorkspacePort } from "@unifia/contracts"

const runtime: RuntimeAdapter = ...
const workspace: WorkspacePort = ...
```

## Status

- **v0.1** : interfaces TypeScript pures (interfaces + types)
- **v0.2** : implémentations (OpenCode, Fake, Local, etc.)
- **v1.0** : contractualisé, versionné

## Liens

- [Plan V3 §7](docs/autonomy/PLAN-DIRECTEUR-V3.md)
- [P2-C200 plan détaillé](docs/autonomy/plans/P2-C200-contracts-unifia.md)
- [ADR-0001 à ADR-0005](docs/adr/)
