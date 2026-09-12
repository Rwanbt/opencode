# P18-C1800-A — Release public

**Statut :** `INTEGRATED` (design documenté)
**Date :** 2026-08-01
**Parent :** P18-C1800 (Release)

## Objectif

Coordonner le **release public** d'Unifia v1.0.0 sur GitHub, Docker Hub, et autres canaux.

## Canaux

| Canal | Status | Date |
|---|---|---|
| GitHub Release | Prévu v1.0.0 | 2026 Q4 |
| Docker Hub | Prévu | 2026 Q4 |
| Homebrew | Prévu | 2027 Q1 |
| Snapcraft | Future | 2027 |
| AUR | Future | 2027 |

## Pre-release checklist

### Code
- [x] All Phase 2 contracts (interfaces)
- [ ] All Phase 3 security (BLOQUÉ humain)
- [ ] All Phase 4-10 runtime
- [ ] All Phase 11-19 features

### Documentation
- [x] Plan V3 complet
- [x] 30 ADRs
- [x] 22 plans détaillés
- [x] Migration guide
- [x] Status reports

### Outillage
- [x] 4 scripts unifia
- [x] 8 tools dev
- [x] 220 tests (155 PASS integration + 15 vitest)
- [x] Docker
- [x] CI/CD

### Compliance
- [x] LICENSE (MIT)
- [x] SBOM (CycloneDX 1.5)
- [x] Provenance (UPSTREAM-*.lock)
- [x] Security (SECURITY-INCIDENT-RESPONSE)

## Communication plan

### T-30 days
- Announce on Discord (preview)
- Email to beta testers
- Update website "coming soon"

### T-7 days
- Release candidate 1
- Bug bash with community
- Update CHANGELOG

### T-0
- GitHub Release v1.0.0
- Docker image push
- Blog post
- Twitter/Mastodon thread
- Reddit r/programming
- HackerNews "Show HN"

### T+7 days
- Patch release v1.0.1 (urgent fixes)
- Collect feedback
- Plan v1.1

## Estimation

- GitHub release config : ~50 LOC (déjà partiel)
- Docker push : ~100 LOC
- Website update : ~200 LOC (manuel)
- Communication : manuel
- Tests finaux : ~500 LOC
- **Total : ~850 LOC + manuel**

## Liens

- [ADR-0027 Release Strategy](docs/adr/0027-release-strategy.md)
- [ADR-0030 Compatibility policy](docs/adr/0030-compatibility-policy.md)
- [ULTIMATE-FINAL-STATUS-V2.md](ULTIMATE-FINAL-STATUS-V2.md)
- [handoff/](../../handoff/)