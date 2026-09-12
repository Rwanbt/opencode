# docs/autonomy/ — Index de navigation v4.0

**Date :** 2026-07-31
**Statut :** `v4.0` — index complet

## Vue d'ensemble

Ce dossier contient la **gouvernance** d'Unifia Workbench : audit, plans, ADRs, rapports, et migration.

## Structure

```
docs/autonomy/
├── index.md (ce fichier)
├── PLAN-DIRECTEUR-V3.md (49 KB)
├── TASK-GRAPH-v1.0.yaml (28 KB, DEPRECATED)
├── TASK-GRAPH-v1.1.md (6 KB, DEPRECATED)
├── TASK-GRAPH-v2.0.yaml (26 KB, 102 cartes, RECOMMANDÉ)
├── TASK-GRAPH-DRAFT.yaml (22 KB, DEPRECATED)
├── BLOCKED-DECISIONS.md (5.5 KB, 9 décisions bloquantes)
├── BASELINE.md
├── REPO-INVENTORY.md
├── LICENSE-AUDIT-UNIFIA.md
├── THIRD-PARTY-NOTICES.md
├── UPSTREAM-PROVENANCE.md
├── UPSTREAM-SOURCES.lock.json
├── UNIFIA-AUDIT-PACK.md (8.9 KB)
├── ATTRIBUTION-TEMPLATE.md
├── DO-NOT-IMPORT.md
├── IMPORT-CANDIDATES.md
├── TRI-REPO-ARCHITECTURE-INVENTORY.md
├── FEATURE-OWNERSHIP-MATRIX.md
├── DUPLICATION-MATRIX.md
├── PORTABILITY-ASSESSMENT.md
├── SECURITY-GAP-MATRIX.md
├── MIGRATION-PLAN.md
├── CRITICAL-DEPS.md (7 KB, 15 deps documentées)
├── I18N-USER-INVENTORY.{md,json}
├── SBOM-cyclonedx.json
├── EXECUTION-LOG.jsonl
├── DX-DEVEX-GUIDE.md (3.7 KB)
├── SDK-README.md (5 KB, @unifia/sdk)
├── plans/ (22 plans détaillés)
├── reports/ (6 rapports)
└── adr/ (39 — 25 nouveaux + 14 héritage fork)
```

## Reading paths

### Pour comprendre le projet

1. **README.md** (racine)
2. **GOVERNANCE.md** (racine)
3. **docs/autonomy/PLAN-DIRECTEUR-V3.md**
4. **docs/autonomy/TASK-GRAPH-v2.0.yaml**
5. **docs/autonomy/UNIFIA-AUDIT-PACK.md**

### Pour contribuer

1. **CONTRIBUTING.md** (racine)
2. **CODE_OF_CONDUCT.md** (racine)
3. **docs/autonomy/DX-DEVEX-GUIDE.md**
4. **unifia-tasks.md** (racine)
5. **PRODUCTION_READINESS.md** (racine)

### Pour déployer

1. **scripts/unifia-migrate.sh** — migration opencode → unifia
2. **scripts/unifia-verify.sh** — validation post-install
3. **scripts/unifia-install.sh** — installation from scratch
4. **scripts/unifia-doctor.sh** — diagnostic
5. **RELEASE-NOTES.md** — notes de release v1.0.0
6. **MIGRATION-PLAN.md** — plan non-breaking

### Pour la sécurité

1. **SECURITY.md** (racine)
2. **SECURITY-INCIDENT-RESPONSE.md** (racine)
3. **SECURITY-CHECKLIST.md** (racine)
4. **docs/autonomy/DO-NOT-IMPORT.md**
5. **docs/autonomy/BLOCKED-DECISIONS.md**
6. **docs/adr/0006-policy-engine.md** à **0012-provenance**

### Pour les décisions architecturales

- **docs/adr/** — 39 ADRs (25 nouveaux + 14 héritage fork)

## Statistiques (2026-07-31)

| Catégorie | Nombre |
|---|---:|
| Cartes TASK-GRAPH v2.0 | 102 |
| Plans détaillés | 22 |
| ADRs (total) | 39 |
| Sous-cartes détaillées | 170+ |
| Rapports de session | 6 |
| Décisions bloquantes | 9 |
| Upstream SHA verrouillés | 2 |
| Deps tierces documentées | 269+ |
| CRITICAL-DEPS documentées | 15 |
| Fixtures workspace | 12 (8 normal + 4 broken) |
| Fixtures contractes | 3 examples |
| Schemas | 1 (skill-hub-manifest) |
| Scripts shell | 4 (migrate, verify, install, doctor) |
| Scripts cmd | 1 (migrate.cmd) |
| Tests vitest | 1 (contracts.test.ts) |
| Skills | 2 (unifia-rebrand, spec-driven) |

## Cartes par statut (TASK-GRAPH v2.0)

| Statut | Cartes |
|---|---:|
| INTEGRATED_LOCAL | 78 |
| PARTIAL | 1 |
| DEFERRED | 19 |
| BLOCKED_DEPENDENCY | 2 |
| BLOCKED_SECURITY_CRITICAL | 2 |

## Versions

- TASK-GRAPH v0.1 (DRAFT) : 17 cartes basées sur hypothèses
- TASK-GRAPH v1.0 : 17 cartes alignées Plan V3 (statuses obsolètes)
- TASK-GRAPH v1.1 (md) : 60+ cartes en markdown (backup)
- TASK-GRAPH v2.0 (yaml) : 102 cartes alignées état réel (recommandé)

## Voir aussi

- **racine README.md** — point d'entrée
- **racine GOVERNANCE.md** — gouvernance
- **racine UPSTREAM-STRATEGY.md** — stratégie upstream
- **racine CHANGELOG.md** — changelog
- **racine RELEASE-NOTES.md** — release notes
- **racine PRODUCTION_READINESS.md** — readiness
- **racine SECURITY.md** — sécurité
- **racine SECURITY-INCIDENT-RESPONSE.md** — process incidents
- **racine SECURITY-CHECKLIST.md** — checklist release
- **racine CODE_OF_CONDUCT.md** — code de conduite
- **racine LICENSE-FAQ.md** — FAQ license
- **racine SUPPORT.md** — channels support
- **racine unifia-tasks.md** — cheat sheet
- **racine scripts/** — migrate, verify, install, doctor
- **racine packages/contracts/** — @unifia/contracts v0.1.0
- **racine packages/contracts/examples/** — 3 examples TS
- **racine packages/contracts/test/** — tests vitest
- **racine tests/fixtures/workspaces/** — 12 fixtures
- **racine capability-packs/** — schema skill-hub
- **racine skills/unifia-rebrand/** — skill rebrand
- **racine skills/spec-driven/** — skill spec-driven
- **racine docs/autonomy/reports/** — 6 rapports de session
- **racine docs/autonomy/plans/** — 22 plans détaillés
- **racine docs/autonomy/adr/** — 39 ADRs
