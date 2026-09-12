# P13-C1300 — Plan détaillé : Memory System

**Carte parente :** P13-C1300 (Phase 13, DEFERRED → DETAILED)
**Statut :** `PROPOSED` — bloqué code TS
**Date :** 2026-07-31
**Source :** Plan V3 §13 (Memory Layer)

## Contexte

Phase 13 implémente le **Memory System** : longue terme (cross-session) + court terme (working). L'agent se "souvient" des préférences utilisateur, conventions, et faits importants.

## Découpage en sous-cartes (8)

### P13-C1300a — SessionMemory (in-memory)
- **Statut :** `PROPOSED`
- **Scope :** `packages/memory/src/session.ts` (~200 lignes)
- **Livrable :** Map<string, unknown> par session
- **Acceptance :** O(1) lookup, TTL configurable

### P13-C1300b — SessionMemory (SQLite)
- **Statut :** `PROPOSED`
- **Scope :** `packages/memory/src/session-db.ts` (~250 lignes)
- **Livrable :** Persistence des sessions
- **Acceptance :** crash recovery, transactions

### P13-C1300c — LongTermMemory (SQLite)
- **Statut :** `PROPOSED`
- **Scope :** `packages/memory/src/longterm.ts` (~300 lignes)
- **Livrable :** Storage long terme
- **Acceptance :** CRUD + tagging + scope

### P13-C1300d — VectorSearch (semantic)
- **Statut :** `PROPOSED`
- **Scope :** `packages/memory/src/vector.ts` (~300 lignes)
- **Livrable :** Search par embeddings
- **Acceptance :** cosine similarity, top-K

### P13-C1300e — RGPDFeatures
- **Statut :** `PROPOSED`
- **Scope :** `packages/memory/src/rgpd.ts` (~200 lignes)
- **Livrable :** forget, export, anonymisation
- **Acceptance :** RGPD-compliant

### P13-C1300f — MemoryTaint
- **Statut :** `PROPOSED`
- **Scope :** `packages/memory/src/taint.ts` (~150 lignes)
- **Livrable :** Taint tracking sur la mémoire
- **Acceptance :** sources taintées propagées

### P13-C1300g — MemoryUI
- **Statut :** `PROPOSED`
- **Scope :** `packages/app/src/pages/memory.tsx` (~300 lignes)
- **Livrable :** Vue user de sa mémoire
- **Acceptance :** search, edit, delete, export

### P13-C1300h — MemoryTests
- **Statut :** `PROPOSED`
- **Scope :** `packages/memory/test/` (~400 lignes)
- **Livrable :** Tests + property-based
- **Acceptance :** 100+ cas

## Critères de sortie Plan V3 §13

- [ ] Session memory O(1)
- [ ] Session persistence
- [ ] Long-term CRUD
- [ ] Semantic search
- [ ] RGPD features
- [ ] Taint tracking
- [ ] UI utilisateur
- [ ] Tests 100%

## Dépendances

- **P2-C200** (Contrats) — interface MemorySystem
- ADR-0018 (Memory) — design

## Estimation

**Total : 4-6 semaines solo**, 2-3 semaines équipe 2-3
