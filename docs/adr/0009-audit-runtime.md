---
id: 0009
title: AuditRuntime
status: PROPOSED
date: 2026-07-31
---

# ADR-0009: AuditRuntime — journal d'audit centralisé

**Statut :** `PROPOSED`
**Date :** 2026-07-31
**Décideurs :** Erwan, Hermes Agent (MiniMax M3)
**Source :** Plan V3 §5, §8.7

## Contexte

Unifia doit **auditer** toute action sensible pour :
- **Conformité** : prouver qu'une action a été autorisée
- **Debug** : comprendre ce que l'agent a fait
- **Sécurité** : détecter des patterns anormaux
- **Replay** : rejouer une session pour debug

## Décision

Adopter le pattern **AuditRuntime** comme composant de gouvernance (Plan V3 §5) avec :

```typescript
interface AuditRuntime {
  log(event: AuditEvent): Promise<void>
  query(filter: AuditFilter): Promise<AuditEvent[]>
  subscribe(filter?: AuditFilter): AsyncIterable<AuditEvent>
  export(filter: AuditFilter, format: 'json' | 'csv'): Promise<Blob>
}
```

**Types principaux** :
- `AuditEvent` : id, timestamp, action, actor (user/agent), context (workspace, session), risk level, decision (allowed/denied/pending), metadata
- `AuditFilter` : time range, actor, action type, risk level, workspace, session

**Architecture** :
- **Storage** : append-only SQLite table (WORM-like)
- **Compression** : gzip sur les vieux events (> 30 jours)
- **Retention** : configurable (défaut 1 an)
- **Real-time** : `subscribe()` permet à l'UI de voir les events en direct

**Sources d'events** (qui émettent) :
- `PolicyEngine.evaluate()` : chaque décision
- `ApprovalBroker.decide()` : chaque approbation
- `SecretStore.get()` : chaque accès secret
- `CapabilityPort.execute()` : chaque exécution capability
- `SandboxPort.execute()` : chaque commande sandbox
- `RemoteTransportPort.receive()` : chaque commande distante
- `RuntimeAdapter.*` : events runtime

**Implémentations** :
1. `SqliteAuditRuntime` (défaut, append-only, compression gzip)
2. `MemoryAuditRuntime` (pour tests)

## Conséquences

### Positives
- ✅ **Traçabilité complète** : chaque action sensible est tracée
- ✅ **Conformité** : RGPD-friendly (retention, export, anonymisation)
- ✅ **Debug** : replay possible d'une session
- ✅ **Détection** : patterns anormaux détectables (taux de refus, etc.)

### Négatives
- ❌ **Storage** : croît avec le temps (mitigation : compression + retention)
- ❌ **Performance** : insert synchrone sur le hot path (mitigation : batch insert)
- ❌ **Privacy** : contient des données sensibles (mitigation : chiffrement + anonymisation)

### Neutres
- AuditRuntime ne décide pas qui peut faire quoi (c'est PolicyEngine)

## Alternatives considérées

### A. Fichiers logs JSON (un par jour)
- **Rejeté** : difficile de query, pas de concurrence

### B. Cloud (Datadog, Sentry)
- **Rejeté** : dépendance externe, RGPD, offline

### C. Pas d'audit (logs minimaux)
- **Rejeté** : viole Plan V3 §5 et §8.7

## Plan d'implémentation

- **Phase 2** : interfaces TypeScript + AuditEvent schema
- **Phase 3** : SqliteAuditRuntime (append-only, compression)
- **Phase 3** : integration avec PolicyEngine, ApprovalBroker, SecretStore, etc.
- **Phase 7** : UI Shell Unifia — vue audit temps réel
- **Phase 17** : export + anonymisation

## Liens

- Plan V3 §5 (Trust and Governance — AuditRuntime)
- Plan V3 §8.7 (Toute action sensible est auditée)
- Plan V3 §15 (Combinaisons critiques = tracées)
- ADR-0006 (PolicyEngine) — émet events
- ADR-0007 (ApprovalBroker) — émet events
- ADR-0008 (SecretStore) — émet events
- ADR-0010 (TaintTracker) — émet events