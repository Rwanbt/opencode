---
id: 0026
title: Contribution workflow
status: PROPOSED
date: 2026-08-01
---

# ADR-0026: Workflow de contribution

**Statut :** `PROPOSED`
**Date :** 2026-08-01

## Contexte

Unifia est un fork open-source. Il faut un workflow clair pour les contributeurs.

## Décision

**Workflow BDFL-asynchronous** :

1. **Fork** : Erwan (BDFL)
2. **Contributeurs** : PRs sur `Rwanbt/unifia`
3. **Reviews** : 1 reviewer (BDFL) + auto-review agent
4. **Tests** : `bash tests/integration/run-all.sh` doit passer
5. **Lint** : `bun x biome@latest check .` doit passer
6. **Typecheck** : `tsc --noEmit` sur les fichiers TS
7. **Security** : 0 secret, 0 /ee/, SBOM updated
8. **Merge** : squash merge sur `agent/integration`

**Catégories de PR** :
- **fix** : 1 commit = 1 fix
- **feat** : 1+ commits pour 1 feature
- **docs** : documentation only
- **refactor** : code refactoring
- **chore** : maintenance

**Cadence** :
- Daily : triage des issues
- Weekly : review PRs, merge OK
- Monthly : release (v0.1.0, v0.2.0, etc.)

## Conséquences

### Positives
- Process clair
- Sécurité par défaut (auto-review)
- Tests obligatoires

### Négatives
- Single point of failure (BDFL)
- Rythme de release dépend de l'engagement d'Erwan

## Liens

- ADR-0022 (Org Model)
- CODE_OF_CONDUCT.md
- CONTRIBUTING.md
- .github/PULL_REQUEST_TEMPLATE.md
