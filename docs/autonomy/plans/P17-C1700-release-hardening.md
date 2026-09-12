# P17-C1700 — Plan détaillé : Release Hardening

**Carte parente :** P17-C1700 (Phase 17, DEFERRED → DETAILED)
**Statut :** `PROPOSED` — bloqué code TS
**Date :** 2026-07-31
**Source :** Plan V3 §17 (Release hardening)

## Contexte

Phase 17 prépare le **release hardening** : tests E2E, coverage, monitoring, performance, et tous les critères de qualité avant publication.

## Découpage en sous-cartes (10)

### P17-C1700a — E2ETestSuite
- **Statut :** `PROPOSED`
- **Scope :** `packages/e2e/` (~1000 lignes)
- **Livrable :** Tests Playwright cross-platform
- **Acceptance :** 50+ scénarios, macOS/Linux/Windows

### P17-C1700b — CoverageThresholds
- **Statut :** `PROPOSED`
- **Scope :** `vitest.config.ts` (~100 lignes)
- **Livrable :** Seuils de coverage
- **Acceptance :** 80%+ global, 90%+ domain

### P17-C1700c — PerformanceBench
- **Statut :** `PROPOSED`
- **Scope :** `packages/bench/` (~400 lignes)
- **Livrable :** Benchmarks critiques
- **Acceptance :** < 5s startup, < 100ms command

### P17-C1700d — MonitoringHooks
- **Statut :** `PROPOSED`
- **Scope :** `packages/observability/` (~300 lignes)
- **Livrable :** Hooks Sentry/OpenTelemetry
- **Acceptance :** errors, traces, metrics

### P17-C1700e — LoadTests
- **Statut :** `PROPOSED`
- **Scope :** `packages/load-test/` (~300 lignes)
- **Livrable :** Tests de charge
- **Acceptance :** 1000 users concurrent

### P17-C1700f — SecurityFuzz
- **Statut :** `PROPOSED`
- **Scope :** `packages/fuzz/` (~300 lignes)
- **Livrable :** Fuzzing property-based
- **Acceptance :** 0 crash sur 100k randoms

### P17-C1700g — VulnerabilityAudit
- **Statut :** `PROPOSED`
- **Scope :** `scripts/audit-vulns.sh` (~200 lignes)
- **Livrable :** Audit deps + CVE
- **Acceptance :** 0 CVE high/critical

### P17-C1700h — PenetrationReport
- **Statut :** `PROPOSED`
- **Scope :** `docs/security/PENTEST.md` (~500 lignes)
- **Livrable :** Rapport de penetration test
- **Acceptance :** rapport auditeur externe

### P17-C1700i — DocumentationComplete
- **Statut :** `PROPOSED`
- **Scope :** `docs/` (multi-fichiers)
- **Livrable :** API ref + guides + tutorials
- **Acceptance :** 100% API couverte

### P17-C1700j — ReleaseChecklist
- **Statut :** `PROPOSED`
- **Scope :** `RELEASE-CHECKLIST.md` (~200 lignes)
- **Livrable :** Checklist de release
- **Acceptance :** tous critères cochés

## Critères de sortie Plan V3 §17

- [ ] E2E 50+ scénarios
- [ ] Coverage 80%+
- [ ] Benchmarks OK
- [ ] Monitoring actif
- [ ] Load tests passent
- [ ] Fuzzing 0 crash
- [ ] 0 CVE
- [ ] Pen test OK
- [ ] Doc complète
- [ ] Checklist remplie

## Dépendances

- **GATE A, B, C** tous passés
- Audit security externe

## Estimation

**Total : 6-8 semaines solo**, 3-4 semaines équipe 2-3 + audit externe
