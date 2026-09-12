---
id: 0006
title: PolicyEngine
status: PROPOSED
date: 2026-07-31
---

# ADR-0006: PolicyEngine — moteur de policies Default-Deny

**Statut :** `PROPOSED`
**Date :** 2026-07-31
**Décideurs :** Erwan, Hermes Agent (MiniMax M3)
**Source :** Plan V3 §8.7, §15

## Contexte

Unifia doit implémenter un **moteur de policies** qui :
- Évalue chaque action sensible contre un ensemble de règles
- Default-deny : tout est interdit sauf ce qui est explicitement autorisé
- Combine les policies utilisateur + workspace + capability
- Supporte les **6 combinaisons critiques** du Plan V3 §15 :
  - `secret.read + network.request`
  - `desktop.control + secret.read`
  - `remote.receive + terminal.run`
  - `package.install + desktop.control`
  - `workspace.read[global] + network.request[*]`
  - `browser.cookies + network.request[*]`

## Décision

Adopter le pattern **PolicyEngine** comme composant de gouvernance (Plan V3 §5) avec :

```typescript
interface PolicyEngine {
  evaluate(request: PolicyRequest): Promise<PolicyDecision>
  grant(grant: PolicyGrant): Promise<void>
  revoke(grantId: string): Promise<void>
  listGrants(filter?: GrantFilter): Promise<PolicyGrant[]>
}
```

**Architecture** :
- **DSL de policies** : Rego-like (simple JSON) ou CEL (Google)
- **Hiérarchie** : system policy > workspace policy > user policy > runtime grant
- **Évaluation** : chaque `CapabilityRequest` ou action sensible passe par `evaluate()`
- **Décision** : `allow` / `deny` / `allow-once` / `require-approval` / `quota-exceeded`

**Combinaisons critiques** (Plan V3 §15) :
- Encodées comme règles **deny-by-default** dans la system policy
- Override possible par grants utilisateur explicites (avec audit)

**Implémentations** :
1. `JsonPolicyEngine` (par défaut, simple JSON rules)
2. `RegoPolicyEngine` (optionnel, Open Policy Agent)

## Conséquences

### Positives
- ✅ **Default-deny** : posture de sécurité par défaut
- ✅ **Audit** : chaque évaluation est tracée dans AuditRuntime
- ✅ **Combinaisons critiques** : bloquées par défaut, override explicite requis
- ✅ **Hiérarchie** : override clair (system > workspace > user)

### Négatives
- ❌ **UX** : trop de denys → frustration utilisateur → contournement
- ❌ **DSL** : balance entre expressivité et simplicité
- ❌ **Testing** : combinaisons à tester = explosion combinatoire
- ❌ **Performance** : évaluation synchrone sur le hot path

### Neutres
- PolicyEngine est un composant de gouvernance, pas une lib de sécurité

## Alternatives considérées

### A. Pas de PolicyEngine (chaque module gère ses permissions)
- **Rejeté** : viole Plan V3 §5 "aucune autorité parallèle"

### B. PolicyEngine basé sur OPA (Open Policy Agent)
- **À reconsidérer** : mature, mais dépendance externe lourde

### C. PolicyEngine basé sur Casbin
- **À reconsidérer** : mature, plus simple qu'OPA

## Plan d'implémentation

- **Phase 2** : interfaces TypeScript + PolicyRequest schema
- **Phase 3** : JsonPolicyEngine + 6 combinaisons critiques
- **Phase 3** : tests de non-régression (chaque combinaison)
- **Phase 17** : policy as code (Rego)

## Liens

- Plan V3 §5 (Trust and Governance)
- Plan V3 §8.7 (Default deny — liste des surfaces désactivées)
- Plan V3 §15 (Combinaisons critiques)
- ADR-0003 (CapabilityPort) — chaque capability passe par PolicyEngine
- ADR-0007 (ApprovalBroker) — sibling contract
- ADR-0008 (SecretStore) — protected par PolicyEngine