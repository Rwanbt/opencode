# P11-C1100 — Plan détaillé : Spec-Driven Development

**Carte parente :** P11-C1100 (Phase 11, DEFERRED → DETAILED)
**Statut :** `PROPOSED` — bloqué code TS
**Date :** 2026-07-31
**Source :** Plan V3 §11 (Spec-driven development)

## Contexte

Phase 11 implémente le **Spec-Driven Development** : un utilisateur décrit ce qu'il veut en langage naturel, et l'agent produit une spec structurée (YAML) avant de coder. Cette approche évite le code "magic" et donne une doc de référence.

## Découpage en sous-cartes (8)

### P11-C1100a — SpecParser
- **Statut :** `PROPOSED`
- **Scope :** `packages/spec/src/parser.ts` (~200 lignes)
- **Livrable :** Parser qui transforme texte libre → spec YAML
- **Acceptance :** 95%+ précision sur 50 exemples de test

### P11-C1100b — SpecValidator
- **Statut :** `PROPOSED`
- **Scope :** `packages/spec/src/validator.ts` (~150 lignes)
- **Livrable :** Validator JSON Schema pour les specs
- **Acceptance :** valide toutes les specs, rejette les invalides avec erreurs claires

### P11-C1100c — SpecGenerator (code)
- **Statut :** `PROPOSED`
- **Scope :** `packages/spec/src/generator.ts` (~300 lignes)
- **Livrable :** Spec → code TypeScript/Python/Rust
- **Acceptance :** génération pour 3 langages, templates extensibles

### P11-C1100d — SpecDiff
- **Statut :** `PROPOSED`
- **Scope :** `packages/spec/src/diff.ts` (~150 lignes)
- **Livrable :** diff entre 2 specs (changements)
- **Acceptance :** visuels, JSON, et migration auto

### P11-C1100e — SpecSync
- **Statut :** `PROPOSED`
- **Scope :** `packages/spec/src/sync.ts` (~200 lignes)
- **Livrable :** sync code ↔ spec (diff inverse)
- **Acceptance :** détection automatique code orphelin

### P11-C1100f — SpecStore
- **Statut :** `PROPOSED`
- **Scope :** `packages/spec/src/store.ts` (~150 lignes)
- **Livrable :** Storage des specs (SQLite)
- **Acceptance :** CRUD + versioning

### P11-C1100g — SpecUI
- **Statut :** `PROPOSED`
- **Scope :** `packages/app/src/pages/spec.tsx` (~300 lignes)
- **Livrable :** UI mode Design d'Unifia
- **Acceptance :** édition, preview, validation visuelle

### P11-C1100h — SpecTests
- **Statut :** `PROPOSED`
- **Scope :** `packages/spec/test/` (~400 lignes)
- **Livrable :** Suite de tests property-based
- **Acceptance :** 100+ cas, fast-check

## Critères de sortie Plan V3 §11

- [ ] Spec valide parsée en < 100ms
- [ ] Code généré compile sur tous les langages cibles
- [ ] Diff visuel clair (rouge/vert)
- [ ] Sync code↔spec fonctionne
- [ ] UI Design utilisable

## Dépendances

- **P2-C200** (Contrats) — interface SpecPort
- ADR-0017 (OpenDesign) — sibling

## Estimation

**Total : 4-6 semaines solo**, 2-3 semaines équipe 2-3
