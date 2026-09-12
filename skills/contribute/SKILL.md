---
name: contribute
description: "Contribution workflow for Unifia Workbench. Use when user wants to contribute code, fix bugs, propose features, or review PRs. Triggers: contribute, code, fix, feature, review, PR, fork."
---

# Contribution Workflow SKILL

Skill pour contribuer à Unifia Workbench.

## Quand m'utiliser

L'utilisateur demande de :
- Contribuer du code
- Créer une issue
- Soumettre un PR
- Reviewer du code

## Procédure

### 1. Fork

```bash
# Sur GitHub, forker Rwanbt/unifia
git clone https://github.com/<user>/unifia
cd unifia
git remote add upstream https://github.com/Rwanbt/unifia
```

### 2. Branch

```bash
# Convention de nommage
git checkout -b agent/phase-X/PX-CNNN-description

# Exemple
git checkout -b agent/phase-0/P0-C008-brand-unifia
```

### 3. Develop

- Faire les changements
- Suivre le style du repo (biome)
- Ajouter des tests
- Mettre à jour le CHANGELOG

### 4. Tests

```bash
# Lint
bun x biome@latest check .

# Typecheck (per package)
cd packages/contracts
bunx tsc --noEmit

# Unit tests
cd packages/contracts
bun test

# Integration tests
bash tests/integration/run-all.sh
```

### 5. Commit

```bash
# Convention : Conventional Commits
git commit -m "feat(scope): [PX-CNNN] description"

# Exemple
git commit -m "feat(rebrand): [P0-C008] install Unifia brand kit (130 fichiers)"
```

### 6. Push & PR

```bash
git push origin HEAD
# Créer PR sur github.com/Rwanbt/unifia
```

### 7. Code review

- Au moins 1 reviewer (BDFL)
- Auto-review agent
- Tous les tests doivent passer

## Checklist

- [ ] Branche conventionnelle (`agent/phase-X/PX-CNNN-...`)
- [ ] Tests ajoutés/modifiés
- [ ] Lint clean (`biome check`)
- [ ] Typecheck pass (`tsc --noEmit`)
- [ ] CHANGELOG.md mis à jour
- [ ] Commit message suit Conventional Commits
- [ ] PR description claire
- [ ] Auto-review pass

## Liens

- [CONTRIBUTING.md](/CONTRIBUTING.md)
- [CODE_OF_CONDUCT.md](/CODE_OF_CONDUCT.md)
- [ADR-0026 (Workflow de contribution)](docs/adr/0026-contribution-workflow.md)
- [.github/PULL_REQUEST_TEMPLATE.md](.github/PULL_REQUEST_TEMPLATE.md)
