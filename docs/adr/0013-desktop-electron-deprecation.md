---
id: 0013
title: Desktop-electron deprecation
status: PROPOSED
date: 2026-07-31
---

# ADR-0013: Dépréciation desktop-electron (BD-3)

**Statut :** `PROPOSED`
**Date :** 2026-07-31
**Décideurs :** Erwan, Hermes Agent (MiniMax M3)
**Source :** Plan V3 §2.2, BLOCKED-DECISIONS.md §BD-3

## Contexte

Le fork `Rwanbt/unifia` contient **deux packages desktop** :
- `packages/desktop/` : Tauri 2 (recommandé par le Plan V3)
- `packages/desktop-electron/` : Electron (legacy, hérité d'upstream)

Garder les deux :
- **Double maintenance** : 2x les bugs, 2x les features
- **Confusion UX** : quel package utiliser ?
- **Bundle size** : 2x la taille des artefacts

## Décision

**Déprécier `packages/desktop-electron/`** (BD-3 par défaut).

**Plan de dépréciation** :
- **v1.0 (cette release)** : `desktop-electron/` reste fonctionnel mais affiche un warning de dépréciation
- **v1.5** : `desktop-electron/` n'est plus publié dans les releases
- **v2.0** : `desktop-electron/` supprimé du repo

**Actions concrètes** :
- Ajouter un fichier `packages/desktop-electron/DEPRECATED.md` expliquant la migration
- Mettre à jour `package.json` de `desktop-electron/` : `description` mentionne DEPRECATED
- README pointe vers `desktop/` (Tauri)
- Workflow CI : `desktop-electron` ne build plus automatiquement

## Conséquences

### Positives
- ✅ **Focus** : 1 seul desktop = moins de bugs
- ✅ **Migration naturelle** : Tauri est plus moderne (Rust, sécurisé, plus rapide)
- ✅ **Bundle size** : ~50% de réduction

### Négatives
- ❌ **Breaking change** pour les utilisateurs Electron (mais v1.5+ = 6 mois de transition)
- ❌ **Perte de features** : si Electron avait des features que Tauri n'a pas

### Neutres
- Le code Electron reste dans le repo (juste deprecated, pas supprimé)

## Alternatives considérées

### A. Garder les deux indéfiniment
- **Rejeté** : double maintenance, confusion

### B. Supprimer desktop-electron immédiatement
- **Rejeté** : trop brutal, pas de période de transition

### C. Migrer desktop-electron vers Tauri (réécrire)
- **À reconsidérer** : trop de travail, v1.x ne suffit pas

## Plan d'implémentation

- **v1.0** (cette release) :
  - Créer `packages/desktop-electron/DEPRECATED.md`
  - Mettre à jour `package.json` (description DEPRECATED)
  - Workflow CI : `desktop-electron` ne build plus
  - README pointe vers `desktop/`
- **v1.5** : supprimer du CI matrix, plus de releases Electron
- **v2.0** : suppression du code

## Liens

- `docs/autonomy/BLOCKED-DECISIONS.md` §BD-3 — décision par défaut
- `docs/autonomy/UPSTREAM-STRATEGY.md` — exclusion strategy
- Plan V3 §2.2 (enfermement Electron)
- ADR-0001 (RuntimeAdapter) — applicable aux deux desktop
- ADR-0006 (PolicyEngine) — applicable aux deux desktop