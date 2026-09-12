---
id: 0017
title: OpenDesign integration
status: PROPOSED
date: 2026-07-31
---

# ADR-0017: OpenDesign et Spec-Driven Development

**Statut :** `PROPOSED`
**Date :** 2026-07-31
**Décideurs :** Erwan, Hermes Agent (MiniMax M3)
**Source :** Plan V3 §11 (« Spec-driven et OpenDesign »)

## Contexte

Unifia doit supporter un mode **Design** (cf. Shell Unifia §7) où l'utilisateur décrit ce qu'il veut, et un agent transforme ça en spec, design, et code. Le mode Design s'inspire d'**OpenDesign** (un projet open-source) qui combine :
- Spec-driven development (spécification avant code)
- Diagram-driven design (visualisation des relations)
- Code generation contrôlée (l'agent ne code pas tout, il suit la spec)

## Décision

Adopter le pattern **OpenDesign** pour le mode Design d'Unifia :

```typescript
interface OpenDesignPort {
  createSpec(input: SpecInput): Promise<Spec>
  validateSpec(spec: SpecId): Promise<ValidationResult>
  generateCode(spec: SpecId, target: TargetLanguage): Promise<CodeArtifact>
  importDiagram(diagram: DiagramFormat): Promise<Spec>
  exportSpec(specId: SpecId, format: ExportFormat): Promise<Blob>
}
```

**Inputs** :
- Description textuelle (FR/EN, etc.)
- Diagrammes (Mermaid, draw.io, Excalidraw)
- Spec existante (`.yaml`, `.json`)
- Code legacy (reverse-engineering)

**Outputs** :
- Spec YAML (structurée, versionnée)
- Diagrammes (auto-générés depuis la spec)
- Code (TypeScript, Python, Rust, etc.)
- Documentation (MDX, MD)

**Implémentations** :
1. `YamlOpenDesignPort` (défaut — spec en YAML)
2. `MermaidOpenDesignPort` (import/export diagrammes)
3. `ExcalidrawOpenDesignPort` (import/export Excalidraw JSON)

## Conséquences

### Positives
- ✅ **Spec-first** : pas de code avant la spec
- ✅ **Découplage** : la spec est l'autorité, le code est dérivé
- ✅ **Diagrammes** : visualisation des relations dès la spec
- ✅ **Validation** : chaque spec est validée avant génération
- ✅ **Réversibilité** : changer la spec → regénérer le code

### Négatives
- ❌ **Friction** : l'utilisateur doit écrire la spec d'abord
- ❌ **Limites** : certaines logiques sont difficiles à specifier (UI/UX, performance)
- ❌ **Apprentissage** : courbe d'apprentissage du format YAML
- ❌ **Validation rigoureuse** : une spec invalide peut casser le code généré

### Neutres
- Le mode Design n'est pas obligatoire (l'utilisateur peut passer directement au code)

## Alternatives considérées

### A. Pas de mode Design (direct code)
- **Rejeté** : limite les use cases, Plan V3 §11 le demande explicitement

### B. Design = Claude/Codeium-style inline
- **Rejeté** : trop magic, pas de spec visible

### C. OpenDesign comme mode natif (cette décision)
- **Adopté** : équilibre entre spec-first et rapidité

## Plan d'implémentation

- **Phase 2** : OpenDesign interface + YamlOpenDesignPort
- **Phase 4** : génération code TypeScript depuis YAML
- **Phase 7** : UI Shell Unifia mode Design
- **Phase 11** : import/export diagrammes

## Liens

- Plan V3 §11 (Spec-driven et OpenDesign)
- ADR-0001 (RuntimeAdapter) — interface commune
- ADR-0004 (ArtifactPort) — code généré = artifact
- ADR-0016 (Gates) — Gate C inclut OpenDesign
