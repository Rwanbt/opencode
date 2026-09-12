---
id: 0015
title: i18n 21 languages
status: PROPOSED
date: 2026-07-31
---

# ADR-0015: i18n 21 langues et pas de nouvelles (BD-5)

**Statut :** `PROPOSED`
**Date :** 2026-07-31
**Décideurs :** Erwan, Hermes Agent (MiniMax M3)
**Source :** Plan V3 §3.2, BLOCKED-DECISIONS.md §BD-5

## Contexte

Le fork `Rwanbt/unifia` supporte **21 langues** : ar, bn, br, bs, da, de, es, fr, gr, it, ja, ko, no, pl, ru, th, tr, uk, vi, zh, zht

L'utilisateur Unifia a une **traduction i18n personnalisée** d'Open Cowork (16 langues, 325 fichiers, 11 660 clés) qui doit être préservée.

## Décision

**Garder les 21 langues existantes, ne pas en ajouter** (BD-5 par défaut).

**Langues supportées** : strictement les 21 du fork upstream.

**Mapping avec l'i18n utilisateur** (Open Cowork) :
- 14 langues mappables directement (ar, bs, da, de, es, fr, ja, ko, no, pl, ru, zh, zht — 14/16) avec alias (pt-BR → br, zh-TW → zht, nb → no)
- 2 langues manquantes (th, tr) : à créer si l'utilisateur le demande (mais BD-5 dit non par défaut)

**Implémentation** :
- `packages/app/src/i18n/` : 17 fichiers TS (16 langues + index)
- `packages/desktop/src/i18n/` : 16 fichiers TS (alias inclus)
- `packages/web/src/content/i18n/` : 18 fichiers JSON
- Racine : 21 × 4 fichiers = 84 fichiers (README, CONTRIBUTING, LICENSE, SECURITY × 21)

**Migration utilisateur** (P7-I18N-MIGRATION, bloqué BD-9) :
- Convertir le JSON utilisateur en TS au format fork
- Merger les traductions (priorité utilisateur, fallback fork)
- Tester la non-régression (P7-I18N-REGRESSION)

## Conséquences

### Positives
- ✅ **Cohérence** : Unifia reste sur les 21 langues upstream
- ✅ **Couverture existante** : pas de régression des traductions actuelles
- ✅ **i18n utilisateur préservée** : snapshot dans I18N-USER-INVENTORY

### Négatives
- ❌ **Pas d'expansion** : si un utilisateur demande une 22e langue, refus par défaut
- ❌ **Friction** : les nouvelles traductions passent par fork upstream d'abord

### Neutres
- L'utilisateur peut **toujours** traduire lui-même et proposer en PR upstream

## Alternatives considérées

### A. Supporter toute langue (pas de limite)
- **Rejeté** : inflation du bundle, maintenance élevée

### B. 21 langues + nouvelles sur demande explicite
- **À reconsidérer** si la demande est forte (Phase 15+ Skill Hub)

### C. Seulement 5 langues (en, fr, de, es, ja)
- **Rejeté** : trop restrictif, perte de couverture upstream

## Plan d'implémentation

- **v1.0 (cette release)** : 21 langues rebrandées (✅ fait dans P1-C010, P1-C011, P2-C120)
- **Phase 7 (P7-I18N-MIGRATION)** : intégration i18n utilisateur (BLOQUÉ BD-9)
- **Phase 15 (Skill Hub)** : permettre aux utilisateurs de proposer des langues via PR

## Liens

- `docs/autonomy/BLOCKED-DECISIONS.md` §BD-5 — décision par défaut
- `docs/autonomy/I18N-USER-INVENTORY.md` — inventaire traduction utilisateur (16 langues)
- Plan V3 §3.2 (Skills Open Cowork à reprendre)
- ADR-0003 (CapabilityPort) — capabilities localisées
- ADR-0011 (Migration non-breaking) — migration i18n