# P4-C400-A — Workspace runtime core

**Statut :** `INTEGRATED` (design documenté)
**Date :** 2026-08-01
**Parent :** P4-C400 (Workspace runtime)

## Objectif

Implémenter le **runtime de workspace** Unifia : la couche qui gère les fichiers au-dessus du filesystem brut.

## Architecture

```
┌─────────────────┐
│   Capability    │
│  (file.read,    │
│   file.write)   │
└────────┬────────┘
         │
┌────────▼────────┐
│ WorkspacePort   │  ← interface (@unifia/contracts)
│  (déjà livré)   │
└────────┬────────┘
         │
┌────────▼────────┐
│   Workspace     │
│   Runtime       │  ← P4-C400
│  (implémentation)│
└────────┬────────┘
         │
┌────────▼────────┐
│   Backends      │
│ - Filesystem    │
│ - Git           │
│ - Memory (test) │
└─────────────────┘
```

## Composants

### Workspace

Représente un workspace enregistré :
```typescript
class Workspace {
  id: string
  name: string
  path: string
  registeredAt: number
  metadata: WorkspaceMetadata
}
```

### WorkspaceHandle

Session active sur un workspace :
```typescript
class WorkspaceHandle {
  id: string
  workspaceId: string
  token: string
  expiresAt: number
}
```

### Watcher

Surveillance des changements de fichiers :
```typescript
class Watcher {
  subscribe(patterns: string[]): AsyncIterable<FileEvent>
  unsubscribe(id: string): Promise<void>
}
```

## Fonctionnalités

- **CRUD fichiers** : read, write, delete, rename
- **Atomic multi-write** : all-or-nothing
- **Symlinks** : détection et sécurité
- **Permissions** : POSIX + ACL
- **Streaming** : fichiers >1 GB
- **Watching** : inotify/FSEvents
- **Search** : ripgrep, regex, fuzzy

## Backends à implémenter

- FilesystemWorkspace (~500 LOC)
- GitWorkspace (~800 LOC)
- MemoryWorkspace (~200 LOC, déjà dans example 07)

## Tests

- Property-based : write→read idempotent
- Concurrence : multi-sessions concurrentes
- Gros fichiers : 1+ GB
- Permissions : access denied

## Estimation

- Total : ~2500 LOC

## Liens

- [P2-C200-B WorkspacePort](plans/P2-C200-B-workspace-port.md)
- [ADR-0002 WorkspacePort](docs/adr/0002-workspace-port.md)