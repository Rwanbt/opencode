# P15-C1500 — Plan détaillé : Skill Hub & Marketplace

**Carte parente :** P15-C1500 (Phase 15, DEFERRED → DETAILED)
**Statut :** `PROPOSED` — bloqué code TS
**Date :** 2026-07-31
**Source :** Plan V3 §15 (Skills & Marketplace)

## Contexte

Phase 15 implémente le **Skill Hub** : un marketplace public de Capability Packs où les développeurs peuvent publier et où les utilisateurs peuvent installer en 1-click.

## Découpage en sous-cartes (10)

### P15-C1500a — SkillSchema
- **Statut :** `PROPOSED`
- **Scope :** `packages/skill-hub/src/schema.ts` (~200 lignes)
- **Livrable :** JSON Schema pour skill manifests
- **Acceptance :** validation stricte

### P15-C1500b — LocalRegistry
- **Statut :** `PROPOSED`
- **Scope :** `packages/skill-hub/src/registry/local.ts` (~300 lignes)
- **Livrable :** Registry local
- **Acceptance :** install, search, update

### P15-C1500c — RemoteRegistry
- **Statut :** `PROPOSED`
- **Scope :** `packages/skill-hub/src/registry/remote.ts` (~400 lignes)
- **Livrable :** Registry distant (optional)
- **Acceptance :** API REST, auth, pagination

### P15-C1500d — SkillPublisher
- **Statut :** `PROPOSED`
- **Scope :** `packages/skill-hub/src/publisher.ts` (~300 lignes)
- **Livrable :** Outil CLI de publication
- **Acceptance :** build, sign, push

### P15-C1500e — TrustLevels
- **Statut :** `PROPOSED`
- **Scope :** `packages/skill-hub/src/trust.ts` (~200 lignes)
- **Livrable :** untrusted / verified / official
- **Acceptance :** policies par trust

### P15-C1500f — SkillReviews
- **Statut :** `PROPOSED`
- **Scope :** `packages/skill-hub/src/reviews.ts` (~200 lignes)
- **Livrable :** Système de reviews
- **Acceptance :** rating, comments

### P15-C1500g — SkillInstaller
- **Statut :** `PROPOSED`
- **Scope :** `packages/skill-hub/src/installer.ts` (~300 lignes)
- **Livrable :** Install 1-click
- **Acceptance :** deps, conflicts, rollback

### P15-C1500h — SkillUI
- **Statut :** `PROPOSED`
- **Scope :** `packages/app/src/pages/hub.tsx` (~400 lignes)
- **Livrable :** UI Skill Hub
- **Acceptance :** browse, install, manage

### P15-C1500i — MarketplaceWeb
- **Statut :** `PROPOSED`
- **Scope :** `packages/web/src/pages/marketplace.tsx` (~500 lignes)
- **Livrable :** Site web public
- **Acceptance :** SEO, listing, search

### P15-C1500j — Tests
- **Statut :** `PROPOSED`
- **Scope :** `packages/skill-hub/test/` (~400 lignes)
- **Livrable :** Tests registry + publisher
- **Acceptance :** 100+ cas

## Critères de sortie Plan V3 §15

- [ ] Schema standard
- [ ] Local + Remote registries
- [ ] Publisher CLI
- [ ] Trust levels
- [ ] Reviews
- [ ] Installer 1-click
- [ ] UI Hub
- [ ] Site web
- [ ] Tests

## Estimation

**Total : 6-8 semaines solo**, 3-4 semaines équipe 2-3
