# P18-C1800 — Plan détaillé : Release publique

**Carte parente :** P18-C1800 (Phase 18, DEFERRED → DETAILED)
**Statut :** `PROPOSED` — bloqué code TS
**Date :** 2026-07-31
**Source :** Plan V3 §18 (Release publique)

## Contexte

Phase 18 lance **Unifia en release publique** : site web, installateurs, marketing, support, et feedback loops.

## Découpage en sous-cartes (8)

### P18-C1800a — SiteWeb
- **Statut :** `PROPOSED`
- **Scope :** `packages/web/` (multi-fichiers)
- **Livrable :** Site unifia.dev
- **Acceptance :** SEO, landing, features

### P18-C1800b — LandingPages
- **Statut :** `PROPOSED`
- **Scope :** `packages/web/src/pages/landing/` (~400 lignes)
- **Livrable :** Pages marketing
- **Acceptance :** hero, features, pricing, contact

### P18-C1800c — Installers
- **Statut :** `PROPOSED`
- **Scope :** `infra/installer/` (~500 lignes)
- **Livrable :** .dmg, .deb, .exe, .AppImage
- **Acceptance :** auto-update, signing

### P18-C1800d — PricingStrategy
- **Statut :** `PROPOSED`
- **Scope :** `docs/PRICING.md` (~300 lignes)
- **Livrable :** Décision pricing
- **Acceptance :** free / freemium / paid

### P18-C1800e — SupportChannels
- **Statut :** `PROPOSED`
- **Scope :** `README.md` + `SUPPORT.md` (mis à jour)
- **Livrable :** Discord, GitHub, email
- **Acceptance :** 3 canaux actifs

### P18-C1800f — FeedbackLoop
- **Statut :** `PROPOSED`
- **Scope :** `packages/feedback/` (~300 lignes)
- **Livrable :** Système de feedback in-app
- **Acceptance :** surveys, NPS, issues

### P18-C1800g — MarketingCampaign
- **Statut :** `PROPOSED`
- **Scope :** `docs/MARKETING.md` (~500 lignes)
- **Livrable :** Plan de lancement
- **Acceptance :** date, channels, materials

### P18-C1800h — AnalyticsDashboard
- **Statut :** `PROPOSED`
- **Scope :** `packages/dashboard/` (~400 lignes)
- **Livrable :** Dashboard public (unifia.dev/stats)
- **Acceptance :** users, sessions, errors

## Critères de sortie Plan V3 §18

- [ ] Site web live
- [ ] Landing pages
- [ ] Installers macOS/Linux/Windows
- [ ] Pricing
- [ ] Support
- [ ] Feedback loop
- [ ] Marketing
- [ ] Analytics

## Dépendances

- **GATE C** passé
- Phase 17 (hardening) terminée

## Estimation

**Total : 6-8 semaines solo**, 3-4 semaines équipe 2-3
