---
id: 0027
title: Release strategy
status: PROPOSED
date: 2026-08-01
---

# ADR-0027: Stratégie de release

**Statut :** `PROPOSED`
**Date :** 2026-08-01

## Contexte

Quelle cadence de release pour Unifia ?

## Décision

**Cadence hybride** :
- **Patch** (v0.X.Y) : as needed, bug fixes
- **Minor** (v0.X.0) : tous les 30-60 jours, features
- **Major** (vX.0.0) : tous les 6-12 mois, breaking changes

**Channels** :
- `latest` : stable, recommandé
- `next` : pre-release, beta
- `lts` : support étendu (3 ans)

**Communication** :
- Discord : annonce
- GitHub Releases : notes détaillées
- Site web : changelog public
- Email : aux contributeurs

## Conséquences

### Positives
- Cadence prévisible
- Channels multiples
- Support LTS

### Négatives
- Maintenance de 3 channels
- Communication complexe

## Liens

- Plan V3 §17 (Release hardening)
- RELEASE-GUIDE.md
- .github/workflows/release.yml
