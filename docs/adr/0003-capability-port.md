---
id: 0003
title: CapabilityPort
status: PROPOSED
date: 2026-07-31
---

# ADR-0003: CapabilityPort design

**Statut :** `PROPOSED`
**Date :** 2026-07-31
**Décideurs :** Erwan, Hermes Agent (MiniMax M3)
**Source :** Plan V3 §7.3

## Contexte

Unifia doit gérer des **capabilities** (skills, plugins, MCP servers, connecteurs). Le modèle doit supporter :
- **Découverte** : lister les capabilities disponibles
- **Autorisation** : vérifier qu'un agent peut utiliser une capability
- **Exécution** : lancer une capability avec un contexte donné
- **Annulation** : interrompre une exécution en cours

## Décision

Adopter le pattern **CapabilityPort** avec 4 méthodes :

```typescript
interface CapabilityPort {
  search(query: CapabilityQuery): Promise<CapabilityDescriptor[]>
  authorize(request: CapabilityRequest): Promise<AuthorizationDecision>
  execute(request: CapabilityExecutionRequest): Promise<CapabilityExecution>
  cancel(executionId: string): Promise<void>
}
```

**Types principaux** :
- `CapabilityDescriptor` : id, name, description, version, author, license, schema (JSON Schema)
- `CapabilityQuery` : name pattern, tags, capabilities
- `AuthorizationDecision` : allow / deny / require-approval / allow-once
- `CapabilityExecutionRequest` : capability id, inputs (JSON), context (workspace, user)
- `CapabilityExecution` : executionId, status, output

**Implémentations** :
1. `RegistryCapabilityPort` (défaut — registry Unifia)
2. `McpCapabilityPort` (MCP servers distants)
3. `MockCapabilityPort` (pour tests)

**Intégration** :
- `CapabilityRegistry` (Plan V3 §5) = l'autorité canonique
- `CapabilityEngine` (Plan V3 §5) = le moteur d'autorisation (délègue à `PolicyEngine` pour les checks sensibles)

## Conséquences

### Positives
- ✅ **Modularité** : une capability = un module autonome
- ✅ **Sandbox** : exécution isolée par capability
- ✅ **Audit** : `execute()` est tracé, `cancel()` permet d'interrompre
- ✅ **Discovery** : `search()` permet à l'UI de proposer des capabilities à l'utilisateur

### Négatives
- ❌ **Schema validation** : chaque capability doit déclarer son JSON Schema
- ❌ **Sandbox isolation** : nécessite un sandbox (Plan V3 §8) pour les capabilities non-trusted
- ❌ **Versioning** : compatibilité ascendante entre versions de capabilities

### Neutres
- Le port est agnostique du mécanisme d'implémentation (registry, MCP, IPC, etc.)

## Alternatives considérées

### A. Capabilities en code natif (pas de port)
- **Rejeté** : trop rigide, pas de mise à jour dynamique

### B. Capabilities = scripts Bash avec un wrapper
- **Rejeté** : pas de typage, pas d'audit, sécurité faible

### C. Capabilities = WebAssembly modules
- **Rejeté** pour v1.0 : trop complexe, valeur ajoutée incertaine
- **À reconsidérer** en Phase 15+ (Skill Hub & Marketplace)

## Plan d'implémentation

- **Phase 2** : interfaces TypeScript + CapabilityDescriptor schema
- **Phase 4** : RegistryCapabilityPort (local registry)
- **Phase 4** : CapabilityEngine (intégration PolicyEngine)
- **Phase 6** : McpCapabilityPort (intégration Open Cowork skills)
- **Phase 15** : Skill Hub & Marketplace (Phase 15 du Plan V3)

## Liens

- Plan V3 §7.3 (CapabilityPort)
- Plan V3 §15 (Capabilities minimales — 14 capabilities)
- Plan V3 §15 (Combinaisons critiques — 6 à bloquer par défaut)
- ADR-0001 (RuntimeAdapter)
- ADR-0006 (PolicyEngine) — sibling contract
- ADR-0007 (ApprovalBroker) — sibling contract