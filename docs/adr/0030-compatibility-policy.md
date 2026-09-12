---
id: 0030
title: Compatibility policy
status: PROPOSED
date: 2026-08-01
---

# ADR-0030: Politique de compatibilité et de rupture

**Statut :** `PROPOSED`
**Date :** 2026-08-01

## Contexte

Comment gérer les breaking changes dans Unifia ?

## Décision

**Semver strict** :
- MAJOR : breaking change (visible 6 mois avant)
- MINOR : new features, deprecation warnings
- PATCH : bug fixes

**Politique de dépréciation** :
1. Annoncer dans le CHANGELOG (1 minor avant)
2. Afficher un warning dans l\'UI
3. Logger les usages dans AuditRuntime
4. Supprimer après 2 minors (6 mois min)

**Compatibilité N-1** :
- v1.0 et v1.5 tournent côte à côte
- Data migration automatisée
- API additive seulement

## Conséquences

### Positives
- Predictable upgrades
- Pas de surprises pour les users

### Négatives
- Maintenance de N-1
- Délai avant removal de features

## Liens

- Semver officiel
- Plan V3 §17
- RELEASE-GUIDE.md
