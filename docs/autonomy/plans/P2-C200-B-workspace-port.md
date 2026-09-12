# P2-C200-B — WorkspacePort (déjà livré)

**Statut :** `INTEGRATED` (interface TypeScript créée + tests)
**Date :** 2026-08-01
**Parent :** P2-C200 (Contrats Unifia)

## État

**Interface TypeScript** déjà livrée :
- `packages/contracts/src/workspace.ts` (47 LOC)
- `packages/contracts/test/contracts.test.ts` (15 tests PASS)
- `packages/contracts/examples/02-workspace-files.ts` (exemple)

## Composition

```typescript
export interface WorkspacePort {
  register(input: { name: string; path: string }): Promise<Workspace>
  open(input: { id: string }): Promise<WorkspaceHandle>
  read(input: { session: string; paths: string[] }): Promise<FileReadResult[]>
  write(input: { session: string; writes: FileWrite[] }): Promise<FileWriteResult[]>
  watch(input: { session: string }): AsyncIterable<FileEvent>
  close(input: { session: string }): Promise<void>
}
```

## Implémentations cibles

- `FilesystemWorkspace` : fichiers locaux (200 LOC)
- `GitWorkspace` : Git bare repo (300 LOC)
- `MemoryWorkspace` : pour tests (50 LOC, déjà dans example 07)

## Tests à implémenter

- Test CRUD basique
- Test atomicité (multi-write doit être atomique)
- Test symlinks (sécurité)
- Test gros fichiers (>1 GB)
- Test permissions

## Liens

- [ADR-0002 WorkspacePort](docs/adr/0002-workspace-port.md)
- [P2-C200-A](P2-C200-A-runtime-adapter.md)