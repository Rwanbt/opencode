---
id: 0010
title: TaintTracker
status: PROPOSED
date: 2026-07-31
---

# ADR-0010: TaintTracker — marquage des données sensibles

**Statut :** `PROPOSED`
**Date :** 2026-07-31
**Décideurs :** Erwan, Hermes Agent (MiniMax M3)
**Source :** Plan V3 §15, §8.3

## Contexte

Unifia doit **marquer** les données qui ont touché des sources sensibles (secrets, network privé, fichiers protégés) et **propager** ces marquages pour :
- **Prévenir les fuites** : un secret lu ne doit pas fuiter via `network.request`
- **Prouver l'origine** : un output contient-il des données sensibles ?
- **Audit** : tracer la chaîne de custody d'une donnée

## Décision

Adopter le pattern **TaintTracker v0** comme composant de gouvernance (Plan V3 §5) avec :

```typescript
interface TaintTracker {
  mark(data: TaintedData, source: TaintSource): Promise<TaintedData>
  check(data: unknown): Promise<TaintInfo>
  propagate(input: TaintedData, transform: (data: unknown) => unknown): Promise<TaintedData>
  sanitize(data: TaintedData, level: TaintLevel): Promise<unknown>
}
```

**Types principaux** :
- `TaintSource` : origin (id), type (secret/network/file), level (low/medium/high/critical)
- `TaintInfo` : isTainted, level, sources (array)
- `TaintedData<T>` : data + taint metadata

**Sources de taint** :
- `secret.read` (SecretStore) → taint = critical
- `network.request[*]` → taint = high
- `desktop.control` (screenshots) → taint = medium
- `workspace.read[global]` → taint = low
- (propagation : un output d'une capability tainte hérite du taint le plus haut de ses inputs)

**Combinaisons interdites** (Plan V3 §15) :
- Si `data` est tainted `critical` ET destination = `network.request[*]` → DENY
- Si `data` est tainted `high` ET destination = `remote.receive` → DENY
- (etc., voir PolicyEngine pour la liste complète)

**Implémentations** :
1. `InMemoryTaintTracker` (v0, simple Set<id>)
2. `PersistentTaintTracker` (futur, dans SqliteAuditRuntime)

## Conséquences

### Positives
- ✅ **Prévention des fuites** : secrets ne peuvent pas sortir via network sans approbation
- ✅ **Transparence** : l'utilisateur sait quelles données sont sensibles
- ✅ **Audit** : chaîne de custody tracée
- ✅ **Composition** : taint se propage naturellement (output tainted = max(inputs))

### Négatives
- ❌ **Faux positifs** : trop de taint → friction UX
- ❌ **Performance** : tracking sur le hot path
- ❌ **Complexité** : v0 in-memory, v1+ persistant = migrations

### Neutres
- TaintTracker est passif (n'empêche pas, signale)

## Alternatives considérées

### A. Pas de taint tracking (chaque capability gère)
- **Rejeté** : viole Plan V3 §5 "autorité unique"

### B. Taint tracking dans chaque capability (runtime OpenCode style)
- **Rejeté** : pas centralisé, faux positifs

### C. Information Flow Control (IFC) formel
- **À reconsidérer** : trop complexe pour v1.0, valeur ajoutée incertaine

## Plan d'implémentation

- **Phase 2** : interfaces TypeScript + TaintSource/TaintInfo
- **Phase 3** : InMemoryTaintTracker v0
- **Phase 3** : integration avec SecretStore (mark on read)
- **Phase 3** : integration avec PolicyEngine (deny on taint + sensitive destination)
- **Phase 7** : UI visualisation du taint (badges, tooltips)

## Liens

- Plan V3 §15 (Combinaisons critiques — taint comme mécanisme)
- Plan V3 §8.3 (Sécurité avant computer use — taint des screenshots)
- ADR-0006 (PolicyEngine) — utilise TaintTracker
- ADR-0008 (SecretStore) — source de taint
- ADR-0009 (AuditRuntime) — trace les mouvements de taint