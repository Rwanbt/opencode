---
id: 0011
title: Migration non-breaking
status: PROPOSED
date: 2026-07-31
---

# ADR-0011: Migration non-breaking opencode → unifia

**Statut :** `PROPOSED`
**Date :** 2026-07-31
**Décideurs :** Erwan, Hermes Agent (MiniMax M3)
**Source :** `docs/autonomy/MIGRATION-PLAN.md`

## Contexte

Le rebrand Unifia doit être **non-breaking** pour les installations existantes du fork Rwanbt/unifia. Les utilisateurs ont :
- Des DB SQLite (`~/.config/opencode/opencode.db`) avec données accumulées
- Des configs JSONC (`opencode.jsonc`) avec providers, modèles, etc.
- Des themes, localStorage keys, et autres identifiants persistants

Un rebrand brutal casserait ces installations.

## Décision

Adopter la stratégie **dual-support v1.0 → cleanup v2.0** :

```bash
# Au premier lancement de v1.0
bash scripts/unifia-migrate.sh --apply
# Renomme automatiquement :
#   ~/.config/opencode/opencode.db       → ~/.config/unifia/unifia.db
#   ~/.config/opencode/opencode.jsonc    → ~/.config/unifia/unifia.jsonc
#   ~/.config/opencode/ (dossier)        → ~/.config/unifia/
```

**Identifiants préservés en v1.0** (dual-tag) :
- `opencode.global.dat:language` (localStorage) → migré à `unifia.global.dat:language` au premier accès
- `opencode-theme-id` (localStorage) → migré
- `User-Agent: opencode` (HTTP) → `User-Agent: unifia/1.0 (compatible; opencode/...)`
- `opencode.trace` (Langfuse) → `unifia.trace` + alias `opencode.trace` conservé
- `opencode-cli` (sidecar) → `unifia-cli` + alias pour les releases existantes

**Phases de release** :
- **v1.0** (release actuelle) : dual-support, auto-migration au premier lancement
- **v1.5** (LTS) : idem, plus de retours utilisateurs
- **v2.0** : suppression du support `opencode.*`, setup-only `unifia.*`

## Conséquences

### Positives
- ✅ **Pas de breaking change** : utilisateurs existants gardent leurs données
- ✅ **Migration automatique** : `unifia-migrate.sh` au premier lancement
- ✅ **Idempotent** : peut être exécuté plusieurs fois
- ✅ **Rollback possible** : restaurer manuellement (renommer les dossiers)

### Négatives
- ❌ **Code dual** : `UnifiaRuntimeAdapter` doit gérer les deux identifiants
- ❌ **Tests matrice** : dual-support = 2× cas de test
- ❌ **Cleanup v2.0** : devra supprimer le code legacy (breaking)

### Neutres
- Migration par défaut = `auto` (pas d'option `manual`)

## Alternatives considérées

### A. Migration manuelle uniquement
- **Rejeté** : friction UX, support requests

### B. Pas de migration (clean install uniquement)
- **Rejeté** : perte de données utilisateurs

### C. Migration par script Python (cross-platform)
- **À reconsidérer** : bash est OK pour v1.0, Python serait plus portable

## Plan d'implémentation

- **v1.0 (cette release)** : `scripts/unifia-migrate.sh` (déjà livré), test fresh
- **v1.0** : UnifiaRuntimeAdapter dual-support (Phase 2+)
- **v1.5** : retour utilisateurs, fixes migration
- **v2.0** : cleanup du code legacy `opencode.*`

## Liens

- `docs/autonomy/MIGRATION-PLAN.md` — plan complet
- `scripts/unifia-migrate.sh` — script de migration (déjà livré)
- `docs/autonomy/RELEASE-NOTES.md` — release notes v1.0
- ADR-0001 (RuntimeAdapter) — dual-support v1.0
- ADR-0008 (SecretStore) — migration des secrets