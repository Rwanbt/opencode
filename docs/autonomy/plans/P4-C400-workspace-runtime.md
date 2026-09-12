# P4-C400 — Plan détaillé : WorkspaceRuntime + stockage versionné

**Carte parente :** P4-C400 (Phase 4, DEFERRED → DETAILED)
**Statut :** `PROPOSED`
**Date :** 2026-07-31
**Source :** Plan V3 §16 « WorkspaceRuntime, stockage et migrations »

## Contexte

WorkspaceRuntime est l'**application service** qui gère les workspaces, les transactions, et le cycle de vie des données. Il s'appuie sur `WorkspacePort` (P2-C200c) pour le storage.

## Découpage en sous-cartes (8)

- **P4-C400a** : `WorkspaceRuntime` impl (open/close/list) — 200 lignes
- **P4-C400b** : `WorkspaceRuntime.create` + `delete` + `rename` — 150 lignes
- **P4-C400c** : Storage versionné (schema migrations) — 300 lignes
- **P4-C400d** : Transactions (begin/commit/rollback) — 250 lignes
- **P4-C400e** : Crash recovery (WAL) — 300 lignes
- **P4-C400f** : File sessions (open/read/write/close) — 400 lignes
- **P4-C400g** : Watchers (events temps réel) — 200 lignes
- **P4-C400h** : Inbox/outbox (commands async) — 250 lignes

## Critères de sortie Plan V3 §16

- [ ] Storage versionné
- [ ] Transactions
- [ ] Migrations
- [ ] Crash recovery
- [ ] File sessions
- [ ] Watchers
- [ ] Inbox/outbox
- [ ] Export/reset

## Dépendances

- **P2-C200c** (WorkspacePort)
- **P3-C300i** (AuditRuntime — chaque transaction est auditée)
- **P3-C300d** (Transactions sont soumises à PolicyEngine)

## Estimation

**Total : 3-4 semaines solo**, 1.5-2 semaines équipe 2-3
