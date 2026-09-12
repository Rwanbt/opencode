---
id: 0021
title: Spec-Driven Development
status: PROPOSED
date: 2026-07-31
---

# ADR-0021: Spec-Driven Development

**Statut :** `PROPOSED`
**Date :** 2026-07-31
**Décideurs :** Erwan, Hermes Agent (MiniMax M3)
**Source :** Plan V3 §11 (Spec-driven development)

## Contexte

Unifia doit supporter un workflow **Spec-Driven Development** : l'utilisateur décrit ce qu''il veut en langage naturel, et l''agent produit une spec structurée (YAML) avant de coder.

## Décision

Adopter le pattern **SpecDriven** avec 5 méthodes :

```typescript
interface SpecDriven {
  parse(input: string): Promise<Spec>
  validate(spec: Spec): Promise<ValidationResult>
  generate(spec: Spec, target: TargetLanguage): Promise<CodeArtifact>
  diff(a: Spec, b: Spec): Promise<SpecDiff>
  sync(spec: Spec, code: CodeArtifact): Promise<Spec>
}
```

**Format** : YAML strict avec JSON Schema pour validation.

**Implémentations** :
- `YamlSpecDriven` (défaut)
- `JsonSpecDriven` (optionnel)

## Conséquences

### Positives
- Spec = source of truth, code = dérivé
- Pas de "magic code"
- Diff et sync bidirectionnel

### Négatives
- Friction : l''utilisateur doit écrire la spec
- Courbe d''apprentissage du YAML

## Plan

- Phase 11 : SpecDriven interface + YamlSpecDriven
- Phase 11 : UI Shell mode Design

## Liens

- ADR-0017 (OpenDesign) — sibling
- P11-C1100 plan détaillé
