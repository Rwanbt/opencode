---
id: 0014
title: Provider unifia native
status: PROPOSED
date: 2026-07-31
---

# ADR-0014: Provider unifia natif dans le runtime (BD-6)

**Statut :** `PROPOSED`
**Date :** 2026-07-31
**Décideurs :** Erwan, Hermes Agent (MiniMax M3)
**Source :** Plan V3 §5, BLOCKED-DECISIONS.md §BD-6

## Contexte

Unifia doit supporter **plusieurs providers de modèles** (Anthropic, OpenAI, etc.). Pour le provider **`unifia`** (qui n'existe pas encore mais qui sera créé), il y a deux options :

1. **Provider externe** : `unifia` est un provider comme les autres (clé API, base URL, etc.)
2. **Provider natif** : `unifia` est codé en dur dans le runtime Unifia (équivalent à "le runtime lui-même")

## Décision

**Provider natif** (par défaut, BD-6 recommandation).

```typescript
// packages/unifia/src/provider/native/unifia.ts
export const UnifiaProvider: Provider = {
  id: "unifia",
  name: "Unifia",
  type: "native",
  // Pas d'API key : le runtime Unifia EST le provider
  // Les requêtes sont routées vers le runtime Unifia local (ou distant via @unifia/sdk)
  models: async () => unifiaModels,
  chat: async (request) => runtimeAdapter.sendPrompt(request),
}
```

**Avantages** :
- ✅ **Pas de config** : pas d'API key à fournir
- ✅ **Runtime intégré** : `unifia` est le provider par défaut
- ✅ **Découverte** : les modèles disponibles sont ceux du runtime Unifia
- ✅ **Test** : FakeRuntime fournit des modèles de test

**Configuration runtime** :
```json
{
  "provider": "unifia",
  "unifia": {
    "endpoint": "local",  // ou l'URL d'un runtime distant que vous hébergez
    "apiKey": null  // pas requis pour local
  }
}
```

**Migration depuis OpenAI/Anthropic** : explicite, l'utilisateur choisit son provider

## Conséquences

### Positives
- ✅ **UX** : pas de config, fonctionne out-of-the-box
- ✅ **Runtime canonique** : `unifia` est l'autorité (Plan V3 §5)
- ✅ **Extensibilité** : un provider externe `unifia-cloud` peut être ajouté plus tard

### Négatives
- ❌ **Confusion** : `unifia` (provider) vs `Unifia` (produit) vs `unifia` (runtime) — nomenclature
- ❌ **Migration** : les utilisateurs doivent choisir explicitement entre providers

### Neutres
- Le provider `unifia` est **toujours présent** dans la liste des providers (même désactivé)

## Alternatives considérées

### A. Pas de provider natif (que des providers externes)
- **Rejeté** : viole Plan V3 §5 "Providers et modèles = Unifia Core"

### B. Provider natif ET un provider par modèle
- **Rejeté** : trop de duplication, chaque modèle deviendrait un provider

### C. Provider unifia = agrégateur (route vers le meilleur provider)
- **À reconsidérer** : concept de "smart routing" (Plan V3 ModelRouter)

## Plan d'implémentation

- **Phase 1** : interface Provider dans `packages/unifia/src/provider/`
- **Phase 1** : UnifiaProvider scaffold (route vers RuntimeAdapter)
- **Phase 2** : intégration RuntimeAdapter (cf. ADR-0001)
- **Phase 2** : tests avec FakeRuntime

## Liens

- `docs/autonomy/BLOCKED-DECISIONS.md` §BD-6 — décision par défaut
- Plan V3 §5 (Providers = Unifia Core)
- Plan V3 §7.1 (RuntimeAdapter)
- ADR-0001 (RuntimeAdapter) — dépendance
- ADR-0003 (CapabilityPort) — capabilities vs providers