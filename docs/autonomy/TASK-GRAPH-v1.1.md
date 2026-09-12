# TASK-GRAPH v1.1 — Unifia Workbench (mis à jour post-rebrand)

**Version :** 1.1 (mise à jour après rebrand complet v1.0)
**Date :** 2026-07-31
**Source :** Plan V3 (22 phases), audit Phase -1 (7 livrables)

## Statut global

| Phase | Cartes | Statut |
|---|---|---|
| -2 | 1 (LICENSE-AUDIT) | COMPLETE |
| -1 | 1 (audit comparatif) | COMPLETE |
| 0 | 10 (P0-C001..010) | COMPLETE (8 cartes rebrand + 2 docs gouvernance) |
| 1 | 6 (P1-C110, 120, 010×4, 011, 020×2, 030) | PARTIAL (cosmétique) |
| 2 | 20+ (P2-C040..230) | PARTIAL (cosmétique + plans + configs) |
| 3 | 0 (P3-C300 SECURITY-CRITICAL) | BLOQUÉ validation humaine |
| 4-19 | 0 | DEFERRED (code TS à compiler) |

## Cartes exécutées (cumulé)

### Phase -2 (5 livrables)
- LICENSE-AUDIT-UNIFIA.md
- THIRD-PARTY-NOTICES.md
- UPSTREAM-PROVENANCE.md
- UPSTREAM-SOURCES.lock.json
- ATTRIBUTION-TEMPLATE.md

### Phase -1 (7 livrables)
- TRI-REPO-ARCHITECTURE-INVENTORY.md
- FEATURE-OWNERSHIP-MATRIX.md
- DUPLICATION-MATRIX.md
- PORTABILITY-ASSESSMENT.md
- SECURITY-GAP-MATRIX.md
- IMPORT-CANDIDATES.md
- DO-NOT-IMPORT.md

### Phase 0 (rebrand cosmétique + gouvernance)
- P0-C001 : branche agent/integration
- P0-C002 : package.json racine → unifia-workbench
- P0-C003 : 22 packages @unifia/*
- P0-C004 : binaire CLI unifia
- P0-C005 : Tauri identifier/scheme/sidecar
- P0-C006 : README.md rebrand
- P0-C007 : suppression Bannière OpencodeX.png
- P0-C008 (a-g) : drop-in brand Unifia (130 fichiers)
- P0-C009 : GOVERNANCE.md
- P0-C010 : UPSTREAM-STRATEGY.md

### Phase 1 (CI, tests, i18n, rebrand)
- P1-C110 : SBOM CycloneDX 1.5
- P1-C120 : DO-NOT-IMPORT hooks pre-commit
- P1-C010 (a-d) : i18n 21 langues racine (84 fichiers)
- P1-C011 : i18n 16 fichiers desktop
- P1-C020 (a-b) : app/src rebrand (29 fichiers)
- P1-C030 : provider core rebrand (10 fichiers)

### Phase 2 (docs, workflows, packages, configs, plans, migration, release)
- P2-C040 : AGENTS.md
- P2-C041 : CLAUDE.md
- P2-C050 (a-b) : 31 workflows CI
- P2-C060 : 629 MDX docs publiques
- P2-C070 : console webapp (35 fichiers)
- P2-C080 (a-f) : 6 packages (ui, sdk-shared, slack, web, plugin, util+function)
- P2-C090 (a-e) : priority zones (.opencode, script, sdks, github, infra, tests, openapi)
- P2-C100 (a-d) : root + docs (4 sous-cartes)
- P2-C110 : root + docs strict (23 fichiers)
- P2-C120 : web i18n JSON (18 fichiers)
- P2-C130 : mobile package (11 fichiers)
- P2-C140 : desktop package (12 fichiers)
- P2-C150 : misc packages (22 fichiers)
- P2-C160 : opencode core runtime (96 fichiers)
- P2-C170 : desktop-electron (34 fichiers)
- P2-C180 : packages/app rest (62 fichiers)
- P2-C190 : docs (12 fichiers)
- P2-C200 : slack + theme schema (2 fichiers)
- P2-C210 : MIGRATION-PLAN.md
- P2-C220 : unifia-migrate.sh
- P2-C230 : RELEASE-NOTES.md

### Plans détaillés (11 plans, 95 sous-cartes)
- P1-C100 plan détaillé (5 sous-cartes)
- P1-C110 plan détaillé (5 sous-cartes)
- P2-C200 plan détaillé (9 sous-cartes)
- P3-C300 plan détaillé (15 sous-cartes, SECURITY-CRITICAL)
- P4-C400 plan détaillé (8 sous-cartes)
- P5-C500 plan détaillé (6 sous-cartes)
- P6-C600 plan détaillé (8 sous-cartes)
- P7-C700 plan détaillé (15 sous-cartes)
- P8-C800 plan détaillé (8 sous-cartes)
- P9-C900 plan détaillé (6 sous-cartes)
- P10-C1000 plan détaillé (8 sous-cartes)

### ADRs (15 ADRs)
- ADR-0001 : RuntimeAdapter
- ADR-0002 : WorkspacePort
- ADR-0003 : CapabilityPort
- ADR-0004 : ArtifactPort
- ADR-0005 : SandboxPort
- ADR-0006 : PolicyEngine
- ADR-0007 : ApprovalBroker
- ADR-0008 : SecretStore
- ADR-0009 : AuditRuntime
- ADR-0010 : TaintTracker
- ADR-0011 : Migration non-breaking
- ADR-0012 : Provenance /ee/ exclusion
- ADR-0013 : desktop-electron deprecation
- ADR-0014 : Provider unifia natif
- ADR-0015 : i18n 21 langues

### Configs (8 fichiers)
- CODEOWNERS
- .github/PULL_REQUEST_TEMPLATE.md
- .github/ISSUE_TEMPLATE/bug_report.md
- .github/ISSUE_TEMPLATE/feature_request.md
- .github/release-drafter.yml
- renovate.json
- scripts/unifia-verify.sh
- CHANGELOG.md (réécrit pour v1.0.0)

## Cartes BLOQUÉES (non-exécutables en autonomie)

### P-1-I18N-USER-SOURCE (inventaire fait, migration bloquée)
- Bloqueur : BD-9 licence snapshot i18n utilisateur

### P7-I18N-MIGRATION
- Bloqueur : BD-9 licence snapshot i18n utilisateur

### P7-I18N-REGRESSION
- Bloqueur : dépend de P7-I18N-MIGRATION

### P3-C300 (security foundation) — 15 sous-cartes
- Bloqueur : code TS à compiler + tester + SECURITY-CRITICAL (auto-revue interdite par pack)
- Plan détaillé livré (15 sous-cartes documentées)

### P2-C200 (contrats Unifia) — 9 sous-cartes
- Bloqueur : code TS à compiler
- Plan détaillé livré

## Cartes DEFERRED (gabarits)

| Carte | Plan détaillé | Statut |
|---|---|---|
| P1-C100 | OUI | READY (faux ready, attend toolchain) |
| P1-C110 | OUI (partiel) | PARTIAL (v0 fait) |
| P2-C200 | OUI | PROPOSED |
| P3-C300 | OUI | BLOCKED_SECURITY_CRITICAL |
| P4-C400 | OUI | PROPOSED |
| P5-C500 | OUI | PROPOSED |
| P6-C600 | OUI | PROPOSED |
| P7-C700 | OUI | PROPOSED |
| P8-C800 | OUI | PROPOSED |
| P9-C900 | OUI | PROPOSED |
| P10-C1000 | OUI | PROPOSED (EXTRÊMEMENT SECURITY-CRITICAL) |

## i18n utilisateur

- P-1-I18N-USER-SOURCE : inventaire (16 langues, 11 660 clés)
- P7-I18N-MIGRATION : BLOQUÉ BD-9 (licence)
- P7-I18N-REGRESSION : BLOQUÉ (dépend de P7-I18N-MIGRATION)

## Décisions bloquantes

| ID | Sujet | Statut |
|---|---|---|
| BD-2 | packages/enterprise/ | VIOLATED — décision utilisateur requise |
| BD-3 | packages/desktop-electron/ DEPRECATE | DEFERRED (rebrand fait) |
| BD-4 | Tauri certif macOS | NEEDS_EXTERNAL_E2 |
| BD-5 | i18n 21 langues uniquement | OPEN |
| BD-6 | Provider MiniMax natif | OPEN |
| BD-7 | URLs upstream + repo origin-unifia | OPEN |
| BD-8 | Accès OpenWork/OpenCowork | RESOLU |
| BD-9 | Licence snapshot i18n | BLOCKED_MISSING_LICENSE |

## Total session

| Métrique | Valeur |
|---|---:|
| Commits atomiques | ~130 |
| Fichiers modifiés | ~3300 |
| Lignes modifiées | ~22000 |
| Lignes ajoutées (docs/plans/ADRs) | ~3000 |
| Push distant | 0 (3 verrous) |
| Secrets introduits | 0 |
| Cartes exécutées | 45+ |
| Cartes avec plan détaillé | 12/12 |
| ADRs créés | 15 |
| Sous-cartes détaillées | 95 |
