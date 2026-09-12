# P2-C200-I — Documentation examples

**Statut :** `INTEGRATED` (8 examples créés)
**Date :** 2026-08-01
**Parent :** P2-C200 (Contrats Unifia)

## État

**8 examples** livrés dans [packages/contracts/examples/](../../packages/contracts/examples/) :

| Fichier | Description | LOC |
|---|---|---:|
| 01-runtime-basic.ts | RuntimeAdapter basique | 80 |
| 02-workspace-files.ts | WorkspacePort file ops | 132 |
| 03-capability-pipeline.ts | 4-step pipeline | 117 |
| 04-sandbox-port.ts | Multi-backend sandbox | 119 |
| 05-remote-port.ts | Slack/Feishu remote | 102 |
| 06-artifact-port.ts | Document generation | 121 |
| 07-fake-impl.ts | Fake implementations | 99 |
| 08-integration-test.ts | E2E scenario | 235 |
| **Total** | | **~1100** |

## Vérification

Tous les examples compilent clean :
```bash
tsc --noEmit examples/*.ts src/*.ts
# exit 0
```

## Exemples supplémentaires à ajouter

### 09-error-handling.ts
Démontre comment chaque port gère les erreurs (timeout, abort, rate limit).

### 10-concurrency.ts
Démontre la concurrence (multi-sessions, multi-files).

### 11-large-files.ts
Démontre le streaming pour fichiers >1 GB.

### 12-network-failures.ts
Démontre le retry et le backoff.

## Estimation

- 4 examples supplémentaires : ~400 LOC
- **Total : ~400 LOC**

## Liens

- [packages/contracts/examples/](../../packages/contracts/examples/)
- [P2-C200-G property tests](P2-C200-G-property-tests.md)