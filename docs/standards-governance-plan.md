# Standards Governance Plan — OpenCode Fork

## Périmètre

Ce plan s'applique au fork `Rwanbt/opencode`. Il adapte les standards professionnels à un projet TypeScript/SolidJS/Tauri.

## Tier 1 — CI Enforcement (Automatique)

| Gate | Outil | Seuil | Status |
|------|-------|-------|--------|
| TypeScript typecheck | `tsgo --noEmit` | 0 erreurs | ✅ CI (typecheck.yml) |
| Biome lint | `biome check` | 0 warnings | ✅ CI (typecheck.yml) |
| Unit tests | `bun test` | 100% pass | ✅ CI (test.yml) |
| Security scan | CodeQL | 0 critiques | ✅ CI (codeql.yml) |
| Supply chain | SBOM + SLSA | attestation | ✅ CI (sbom.yml, slsa.yml) |
| LOC gate | script inline | 0 fichiers > 1500 LOC (scope: packages/app/) | ✅ CI (typecheck.yml) |

## Tier 2 — Conventions IA (CLAUDE.md)

Voir `CLAUDE.md` à la racine du projet. 23 règles couvertes.

## Tier 3 — Documentation

| Doc | Status | Responsable |
|-----|--------|-------------|
| CLAUDE.md | ✅ | Maintenu |
| ARCHITECTURE.md | ✅ | Maintenu |
| CONTRIBUTING.md | ✅ | Maintenu |
| ADRs (docs/adr/) | ✅ 3 docs | Ajouter à chaque décision archi |
| Glossary | ✅ | Mettre à jour à chaque nouveau concept |
| Ownership Map | ✅ | Mettre à jour après chaque extraction |
| Perf Baselines | ✅ | Mesurer après chaque change inference |

## Calendrier de review

- **Mensuel** : /verify-standards + scorecard
- **Avant chaque PR significative** : bun typecheck + bun lint
- **Avant chaque release** : CHANGELOG.md + VERSION sync

## Critères d'escalade

- LOC > 1500 dans packages/app/ → BLOQUER le commit
- Biome warning → CORRIGER avant commit (Boy Scout)
- TypeScript error → CORRIGER avant tout commit
