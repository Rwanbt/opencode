---
name: testing
description: "Test Unifia - run integration tests, vitest, lint, typecheck. Use when user wants to test, validate, run tests, check code quality. Triggers: test, tests, check, validate, lint, typecheck, ci, verify, integration."
---

# Testing Workflow SKILL

Skill pour tester Unifia Workbench.

## Quand m'utiliser

L'utilisateur demande de :
- Lancer les tests
- Valider le code
- Vérifier avant commit
- Lancer la CI localement
- Debug un test

## Procédure

### 1. Test rapide (3 min)

```bash
# 4 scripts unifia
bash scripts/unifia-verify.sh
bash scripts/unifia-migrate.sh --dry-run
bash scripts/unifia-install.sh --help
bash scripts/unifia-doctor.sh

# Lint
bun x biome@latest check .
```

### 2. Test intégration (5 min)

```bash
# 6 suites d'integration
bash tests/integration/run-all.sh
```

### 3. Test unitaire (10 min)

```bash
# @unifia/contracts (15 tests)
cd packages/contracts
bun install
bun test
```

### 4. Test complet (15 min)

```bash
# Lint + integration + unit
bash tools/dev-runner.sh
```

### 5. Test ciblé

```bash
# Un seul test
cd packages/contracts
bun test -t "test name"

# Un seul fichier
bun test --reporter=verbose test/contracts.test.ts
```

### 6. Validation TypeScript

```bash
cd packages/contracts
bunx tsc --noEmit
```

## Diagnostic

### Test qui échoue

1. Lire le message d'erreur
2. Identifier le fichier et la ligne
3. Reproduire localement
4. Ajouter un test unitaire pour le bug
5. Corriger
6. Vérifier que le test passe

### Test flaky

1. Identifier le test
2. Lancer plusieurs fois : `for i in 1..10; do bun test; done`
3. Si toujours flaky, c'est un bug
4. Fix le bug ou skip le test

## Tests disponibles

| Suite | Type | Count | Runtime |
|---|---|---:|---|
| bun test (contracts) | vitest | 15 | 200ms |
| test-migrate.sh | bash | 9 | <1s |
| test-verify.sh | bash | 6 | <1s |
| test-doctor.sh | bash | 6 | <1s |
| test-install.sh | bash | 5 | <1s |
| test-migrate-cmd.sh | bash | 10 | <1s |
| test-tools.sh | bash | 24 | <30s |
| **Total** | - | **75** | <1min |

## Liens

- [tests/integration/](/tests/integration/)
- [packages/contracts/test/](/packages/contracts/test/)
- [tools/dev-runner.sh](/tools/dev-runner.sh)
