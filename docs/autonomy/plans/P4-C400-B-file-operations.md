# P4-C400-B — File operations (atomic, streaming)

**Statut :** `INTEGRATED` (design documenté)
**Date :** 2026-08-01
**Parent :** P4-C400 (Workspace runtime)

## Objectif

Implémenter les **opérations fichiers atomiques et streaming**.

## Atomic multi-write

```typescript
interface AtomicWriteRequest {
  files: { path: string; content: string | Uint8Array; mode?: number }[]
  metadata?: { author: string; message: string }
}

// Tous les fichiers sont écrits ensemble ou aucun
// Si échec au milieu, rollback complet
async function atomicWrite(workspace: WorkspaceHandle, request: AtomicWriteRequest): Promise<void>
```

**Stratégie** : write each file to temp, fsync, rename atomically, repeat, fsync parent dir.

## Streaming pour gros fichiers

```typescript
interface StreamingReadRequest {
  path: string
  offsetBytes?: number  // default 0
  maxBytes?: number     // default = full file
}

// Stream des chunks via AsyncIterable
async function* streamRead(workspace: WorkspaceHandle, request: StreamingReadRequest): AsyncIterable<Uint8Array>
```

**Implémentation** :
- Filesystem : `createReadStream` + `for await`
- Git : `git show` + parse
- Memory : trivial

## Format detection

```typescript
function detectFormat(path: string, content: Uint8Array): {
  mimeType: string
  charset: string
  encoding: "binary" | "text"
  language?: string  // for syntax highlighting
}
```

## Sécurité

- **Symlinks** : refusés par défaut (config: `allowSymlinks: false`)
- **Path traversal** : `../` bloqué
- **Path length** : max 4096 chars (Linux limit)
- **Permissions** : chmod respecté
- **Umask** : 022 par défaut

## Estimation

- Atomic write : ~200 LOC
- Streaming : ~300 LOC
- Format detection : ~100 LOC
- Tests : ~200 LOC
- **Total : ~800 LOC**

## Liens

- [P4-C400-A Workspace runtime core](plans/P4-C400-A-workspace-runtime.md)
- [ADR-0002 WorkspacePort](docs/adr/0002-workspace-port.md)