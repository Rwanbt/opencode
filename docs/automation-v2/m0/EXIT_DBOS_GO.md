<!-- SPDX-License-Identifier: MIT -->
<!-- Copyright (c) 2026 Unifia contributors -->

# EXIT_DBOS_GO — UNIFIA AUTOMATE V2.3.1

> Source normative : `docs/adr/ADR-000-DURABLE-EXECUTION-SUBSTRATE-M0-FROZEN.md`
> §20 (EXIT_*.md obligatoire).

Si ADR-000 sélectionne **DBOS_GO_SQLITE** comme substrate final, la
stratégie de sortie doit aussi être documentée. **NOT EXECUTED EN M0**
(Go toolchain absent, voir `WINDOWS_PREFLIGHT.md` §3 et
`adapters/dbos-go.ts` STUB).

## 1. Données à exporter

DBOS Go expose deux APIs d'export :

| API | Format | Volume |
|---|---|---|
| `dbos.GetWorkflowStatus` | JSON | O(N_runs) |
| `dbos.ListWorkflows` | JSON array | O(N_runs) |
| DBOS Conductor state checkpoint | protobuf | O(active_runs) |
| SQLite file-level backup | `.sqlite` | O(store_size) |

## 2. Cible de migration

| Substrate cible | Effort | Compatibilité |
|---|---|---|
| UNIFIA_NATIVE | Modéré | Bon (même contrat M0) |
| DBOS TS + Postgres | Faible (DBOS upstream) | Bon (DBOS API) |
| Temporal | Élevé | Bon (workflow replay) |
| Custom (Rust) | Modéré | Bon (canonical value) |

## 3. Mécanisme d'export (esquissé, à confirmer sur environnement Go)

```go
// Pseudo-Go (DBOS Go API)
import "github.com/dbos-inc/dbos-transact-go/dbos"

status, err := dbos.GetWorkflowStatus(ctx, workflowID)
if err != nil { return err }
json.NewEncoder(output).Encode(status)
```

Pour un export massif, DBOS Conductor fournit un endpoint de
checkpoint/state-export (à confirmer sur la version pinned).

## 4. Stratégie de cutover

Même stratégie 5 phases que EXIT_NATIVE (stand-up, shadow run,
cutover, cooldown, decommission). Durée estimée : 6-8 semaines.

## 5. Risques spécifiques DBOS Go

- **License BSL 1.1 (DBOS Conductors)** vs MIT (DBOS core) : la
  version enterprise (Conductors) peut avoir des restrictions
  commerciales.
- **Vendor lock-in** : les outils DBOS Conductor (scheduler,
  recovery) sont DBOS-spécifiques et difficiles à reproduire
  fidèlement dans un autre substrate.
- **Version pinning** : DBOS Go 1.0 est stable mais le projet
  évolue vite (breaking changes à anticiper).

## 6. M0 limitation

**M0 ne peut pas produire ce document avec des chiffres réels** :
DBOS Go n'a pas été exécuté sur cette machine. Le contenu ci-dessus
est un **squelette** qui sera étoffé après l'exécution M0 de DBOS Go
sur environnement Go-équipé.

## 7. Source

- `docs/adr/ADR-000-DURABLE-EXECUTION-SUBSTRATE-M0-FROZEN.md` §22
- `docs/automation-v2/m0/DBOS_ADAPTER.md`
- `packages/automate-m0-harness/src/qualification/adapters/dbos-go.ts` (STUB)
