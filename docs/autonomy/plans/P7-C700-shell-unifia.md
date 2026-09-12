# P7-C700 — Plan détaillé : Shell Unifia (Code/Work/Design/Automate)

**Carte parente :** P7-C700 (Phase 7, DEFERRED → DETAILED)
**Statut :** `PROPOSED`
**Date :** 2026-07-31
**Source :** Plan V3 §19 « Shell Unifia et expérience Code/Work »

## Contexte

Le Shell Unifia est l'**expérience utilisateur** unifiée qui combine :
- **Code** : IDE, file explorer, terminal
- **Work** : Documents, artifacts, browser
- **Design** : Spec-driven, OpenDesign
- **Automate** : Workflows, computer use

## Découpage en sous-cartes (15)

- **P7-C700a** : Layout unifié (4 modes Code/Work/Design/Automate)
- **P7-C700b** : Code mode (IDE + file explorer + terminal)
- **P7-C700c** : Work mode (documents + artifacts + browser)
- **P7-C700d** : Design mode (spec-driven + OpenDesign)
- **P7-C700e** : Automate mode (workflows + computer use)
- **P7-C700f** : Trace Panel (alimenté par AuditRuntime)
- **P7-C700g** : Approval dialogs (alimenté par ApprovalBroker)
- **P7-C700h** : Capability Hub UI
- **P7-C700i** : Theme picker (intégration theme Unifia)
- **P7-C700j** : i18n UI (intégration traduction utilisateur)
- **P7-C700k** : Tauri desktop integration
- **P7-C700l** : Mobile responsive
- **P7-C700m** : Tests E2E (Playwright)
- **P7-C700n** : Documentation utilisateur
- **P7-C700o** : Onboarding

## Critères de sortie Plan V3 §19

- [ ] Shell unifié
- [ ] 4 modes fonctionnels
- [ ] Trace Panel
- [ ] Approval dialogs
- [ ] Capability Hub
- [ ] i18n
- [ ] Mobile responsive

## Dépendances

- **P2-C200** (Contrats) — tous les ports
- **P3-C300** (Security)
- **P4-C400** (Workspace)
- **P5-C500** (OpenWork server)
- **P6-C600** (Open Cowork skills)
- **P7-I18N-MIGRATION** (i18n utilisateur, BLOQUÉ BD-9)
- **brand/unifia/** (Brand kit, déjà installé)

## Risques

| Risque | Niveau | Mitigation |
|---|---|---|
| Shell trop complexe | `HIGH` | Design simple, progressive disclosure |
| Performance | `MEDIUM` | Lazy loading, virtual scrolling |
| 4 modes = 4× le code | `MEDIUM` | Code partagé (state, theming, i18n) |
| i18n incomplet | `MEDIUM` | Bloqué BD-9, traduction fork par défaut |

## Estimation

**Total : 8-10 semaines solo**, 4-5 semaines équipe 2-3 (Plan V3 §19)
