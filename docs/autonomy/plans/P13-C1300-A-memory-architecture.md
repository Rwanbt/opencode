# P13-C1300-A — Memory architecture

**Statut :** `INTEGRATED` (design documenté)
**Date :** 2026-08-01
**Parent :** P13-C1300 (Memory)

## Objectif

Implémenter le **Memory System** : mémoire persistante pour les sessions Unifia.

## Couches de mémoire

```
┌─────────────────────────────────┐
│ Working Memory                  │  ← session actuelle
│ (in-process, ephemeral)         │
└────────────┬────────────────────┘
             ↓ save
┌─────────────────────────────────┐
│ Episodic Memory                 │  ← sessions précédentes
│ (par workspace, indexed)        │
└────────────┬────────────────────┘
             ↓ consolidate
┌─────────────────────────────────┐
│ Semantic Memory                 │  ← long terme
│ (per user, encrypted)           │
└─────────────────────────────────┘
```

## Interface

```typescript
interface MemorySystem {
  // Working
  set(input: { key: string; value: any; ttlMs?: number }): Promise<void>
  get(input: { key: string }): Promise<any | null>
  list(input?: { prefix?: string }): Promise<MemoryEntry[]>

  // Episodic
  recordEvent(input: { event: SessionEvent }): Promise<void>
  searchEvents(input: { query: string; limit?: number }): Promise<SessionEvent[]>

  // Semantic
  remember(input: { fact: string; context?: any }): Promise<void>
  recall(input: { cue: string }): Promise<Memory[]>
}

interface MemoryEntry {
  key: string
  value: any
  createdAt: number
  expiresAt?: number
  tags?: string[]
}
```

## Stockage

- **Working** : in-memory Map
- **Episodic** : SQLite (FTS5 pour full-text search)
- **Semantic** : Vector store (ChromaDB, Pinecone, ou local)

## Sécurité

- **Encryption at rest** : AES-256-GCM
- **Taint tracking** : memory entries marquées sensibles
- **Auto-expiry** : TTL configurable
- **Audit** : chaque accès loggé

## Estimation

- Memory core : ~500 LOC
- Working memory : ~200 LOC
- Episodic (SQLite) : ~500 LOC
- Semantic (vector) : ~500 LOC
- Tests : ~500 LOC
- **Total : ~2200 LOC**

## Liens

- [ADR-0018 Memory System](docs/adr/0018-memory-system.md)