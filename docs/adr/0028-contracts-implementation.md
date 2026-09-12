---
id: 0028
title: Contracts implementation
status: PROPOSED
date: 2026-08-01
---

# ADR-0028: Stratégie d\'implémentation des Contrats

**Statut :** `PROPOSED`
**Date :** 2026-08-01

## Contexte

Les 6 ports du Plan V3 §7 (RuntimeAdapter, WorkspacePort, etc.) doivent être implémentés.
Quelle stratégie d\'implémentation ?

## Décision

**Stratégie incrémentale** :
1. **Interfaces d\'abord** : TypeScript pur (déjà livré)
2. **Tests d\'abord** : property-based testing
3. **Fake impls** : pour les tests
4. **Adapters réels** : un par un
5. **Migration des runtimes existants** : OpenCode → OpenCodeRuntimeAdapter

**Ordre** :
1. FakeRuntimeAdapter (le plus simple)
2. OpenCodeRuntimeAdapter (compat ascendante)
3. UnifiaRuntimeAdapter (nouveau, future)
4. Composition

## Conséquences

### Positives
- Interfaces testables immédiatement
- Fakes permettent le dev en parallèle
- Pas de big-bang

### Négatives
- Risque de "faux positif" (les fakes passent mais le vrai fail)
- Effort de maintenance des fakes

## Liens

- P2-C200 plan détaillé
- @unifia/contracts
- ADR-0001 à ADR-0005 (les 6 ports)
- ADR-0020 (MCP UI Server)
