---
id: 0018
title: Memory System
status: PROPOSED
date: 2026-07-31
---

# ADR-0018: Memory System (long-term + working)

**Statut :** `PROPOSED`
**Date :** 2026-07-31
**Décideurs :** Erwan, Hermes Agent (MiniMax M3)
**Source :** Plan V3 §13 (« Memory Layer »)

## Contexte

Unifia doit gérer une **mémoire** pour les agents :
- **Working memory** : état de la session courante (éphémère, perdu à la fin)
- **Long-term memory** : connaissances persistantes, traversant les sessions

L'agent doit pouvoir :
- Mémoriser des informations (préférences, faits, conventions)
- Récupérer des informations pertinentes (search/relevance)
- Oublier des informations (rétention, RGPD)
- Synchroniser entre agents (multi-tenant)

## Décision

Adopter le pattern **MemorySystem** avec 2 niveaux :

```typescript
interface MemorySystem {
  // Working memory (session)
  session(sessionId: string): SessionMemory
  
  // Long-term memory (cross-session)
  longTerm(): LongTermMemory
}

interface SessionMemory {
  set(key: string, value: unknown, ttl?: number): Promise<void>
  get(key: string): Promise<unknown | null>
  list(): Promise<MemoryEntry[]>
  clear(): Promise<void>
}

interface LongTermMemory {
  store(input: MemoryStoreInput): Promise<MemoryEntry>
  search(query: MemoryQuery): Promise<MemoryEntry[]>
  forget(entryId: string): Promise<void>
  export(): Promise<Blob>
  import(data: Blob): Promise<void>
}
```

**Types principaux** :
- `MemoryEntry` : id, key, value, scope (session/workspace/user), tags, createdAt, expiresAt
- `MemoryQuery` : text query, tags, scope, time range, relevance threshold
- `MemoryStoreInput` : key, value, scope, tags, ttl

**Backends** :
1. **Working memory** : in-memory (Map par session) + DB (SQLite) pour persistance
2. **Long-term memory** : SQLite (défaut) + Vector DB (Phase 13+, pour semantic search)

**RGPD** :
- `forget()` : suppression complète (cookie + cache + backups)
- `export()` : export user de ses données
- `ttl` : expiration automatique
- Anonymisation automatique des PII détectés

## Conséquences

### Positives
- ✅ **Continuité** : l'agent se "souvient" entre sessions
- ✅ **Personnalisation** : préférences utilisateur persistantes
- ✅ **RGPD-friendly** : forget/export/ttl intégrés
- ✅ **Multi-tenant** : scopé par user/workspace

### Négatives
- ❌ **Vie privée** : les données utilisateur sont stockées
- ❌ **Coût** : vector DB (large, coûteux)
- ❌ **Sécurité** : mémoire = fuite potentielle (mitigation : chiffrement + taint)
- ❌ **Qualité** : relevance search peut retourner du bruit

### Neutres
- Le pattern est agnostique du backend (SQLite / Postgres / Vector DB)

## Alternatives considérées

### A. Pas de long-term memory (que working)
- **Rejeté** : pas de continuité, Plan V3 §13

### B. Memory = simple JSON file
- **Rejeté** : pas de search, pas de RGPD

### C. Memory System à 2 niveaux (cette décision)
- **Adopté** : équilibre simplicité/puissance

## Plan d'implémentation

- **Phase 2** : interfaces TypeScript
- **Phase 4** : SessionMemory (in-memory + SQLite)
- **Phase 13** : LongTermMemory + Vector DB (semantic search)
- **Phase 13** : RGPD features (forget/export)

## Liens

- Plan V3 §13 (Memory Layer)
- ADR-0001 (RuntimeAdapter) — sessions
- ADR-0002 (WorkspacePort) — scopage par workspace
- ADR-0008 (SecretStore) — mémoire tainée
- ADR-0010 (TaintTracker) — marquage des secrets mémorisés
- ADR-0016 (Gates) — Gate C inclut Memory
