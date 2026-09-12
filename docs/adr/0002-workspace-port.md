---
id: 0002
title: WorkspacePort
status: PROPOSED
date: 2026-07-31
---

# ADR-0002: WorkspacePort design

**Statut :** `PROPOSED`
**Date :** 2026-07-31
**Décideurs :** Erwan, Hermes Agent (MiniMax M3)
**Source :** Plan V3 §7.2

## Contexte

Unifia doit gérer des **workspaces** multiples avec des sessions, fichiers, et identités distinctes. Le modèle d'API doit être :
- **Runtime-agnostique** (cf. ADR-0001)
- **Storage-agnostique** (SQLite, PostgreSQL, in-memory)
- **Async-first** (Node.js / Bun)

## Décision

Adopter le pattern **WorkspacePort** avec 6 méthodes :

```typescript
interface WorkspacePort {
  register(input: RegisterWorkspaceInput): Promise<Workspace>
  open(id: WorkspaceId): Promise<WorkspaceHandle>
  read(session: FileSessionId, paths: string[]): Promise<FileReadResult[]>
  write(session: FileSessionId, writes: FileWrite[]): Promise<FileWriteResult[]>
  watch(session: FileSessionId): AsyncIterable<FileEvent>
  close(session: FileSessionId): Promise<void>
}
```

**Modèles de données** :
- `WorkspaceId` (UUID)
- `ProjectId`, `SessionId`, `FileSessionId` (sous-IDs)
- `Workspace` (objet value)
- `WorkspaceHandle` (référence opaque)
- `FileWrite` (path + content + metadata)

**Implémentations** :
1. `SqliteWorkspacePort` (défaut, basé sur `better-sqlite3`)
2. `MemoryWorkspacePort` (pour tests)
3. `PostgresWorkspacePort` (futur, optionnel)

## Conséquences

### Positives
- ✅ **Identité claire** : un workspace = un conteneur logique (projet, sessions, fichiers)
- ✅ **Sécurité** : `read/write` scopés par `FileSessionId` (pas d'accès global)
- ✅ **Watch** : `AsyncIterable` pour les changements temps réel
- ✅ **Testabilité** : MemoryWorkspacePort pour les tests sans I/O

### Négatives
- ❌ **Granularité** : `FileSessionId` ajoute un niveau d'indirection (vs accès direct filesystem)
- ❌ **Migration** : les installations existantes ont des fichiers hors `WorkspacePort` (legacy)

### Neutres
- Le port est runtime-agnostique mais le storage peut être spécifique (SQLite par défaut)

## Alternatives considérées

### A. Accès direct filesystem (pas de port)
- **Rejeté** : impossible d'auditer, pas de transactions, pas de révocation

### B. FUSE filesystem
- **Rejeté** : trop complexe pour la valeur ajoutée, problèmes de portabilité

### C. Event sourcing (chaque modification est un event)
- **Rejeté** : complexe, sur-engineering pour le cas d'usage

## Plan d'implémentation

- **Phase 2** : interfaces TypeScript + tests contractuels
- **Phase 4** : SqliteWorkspacePort (Plan V3 §16)
- **Phase 4** : MemoryWorkspacePort (pour tests)

## Liens

- Plan V3 §7.2 (WorkspacePort)
- Plan V3 §16 (WorkspaceRuntime)
- ADR-0001 (RuntimeAdapter) — sibling contract
- ADR-0014 (Storage choice) — à créer