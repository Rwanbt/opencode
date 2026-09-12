# P6-C600 — Plan détaillé : Skills bureautiques Open Cowork (Capability Packs)

**Carte parente :** P6-C600 (Phase 6, DEFERRED → DETAILED)
**Statut :** `PROPOSED`
**Date :** 2026-07-31
**Source :** Plan V3 §18 « Extraction Open Cowork : documents et artefacts bureautiques »

## Contexte

Open Cowork upstream a des **skills bureautiques** (PPTX, DOCX, XLSX, PDF) avec 78 fichiers XSD (schémas). Unifia doit les importer comme **Capability Packs** (Plan V3 §6.4).

## Découpage en sous-cartes (8)

- **P6-C600a** : Cloner `OpenCoworkAI/open-cowork@ec5bd27` (déjà fait) en lecture seule
- **P6-C600b** : Identifier les 4 skills : DOCX, PPTX, XLSX, PDF
- **P6-C600c** : Convertir chaque skill en `Capability Pack` (manifest + code TS)
- **P6-C600d** : Créer le format `unifia.document.docx` (manifest + schema)
- **P6-C600e** : Idem PPTX, XLSX, PDF
- **P6-C600f** : Tests de chaque Capability Pack
- **P6-C600g** : Documentation utilisateur
- **P6-C600h** : Distribution via Skill Hub (Phase 15)

## Critères de sortie Plan V3 §18 (Gate A)

- [ ] 4 Capability Packs (DOCX, PPTX, XLSX, PDF) chargeables
- [ ] Chaque pack passe les tests
- [ ] Format `unifia.document.<type>` documenté
- [ ] Distribution prête (Phase 15)

## Dépendances

- **P2-C200d** (CapabilityPort interface)
- **P3-C300b** (PolicyEngine — chaque capability doit être autorisée)
- **P4-C400** (WorkspaceRuntime — les artefacts vont dans le storage)
- **P5-C500** (OpenCode server — pour orchestrer les skills)

## Risques

| Risque | Niveau | Mitigation |
|---|---|---|
| Open Cowork a des dépendances lourdes (LibreOffice) | `MEDIUM` | Sandbox optionnel |
| XSD 78 fichiers = parsing complexe | `MEDIUM` | Validation XML stricte |
| License Open Cowork | `LOW` | MIT confirmé (clone upstream) |

## Estimation

**Total : 2-3 semaines solo**, 1-1.5 semaines équipe 2-3
