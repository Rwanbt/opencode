# P12-C1200 — Plan détaillé : Artifact Studio

**Carte parente :** P12-C1200 (Phase 12, DEFERRED → DETAILED)
**Statut :** `PROPOSED` — bloqué code TS
**Date :** 2026-07-31
**Source :** Plan V3 §12 (Artifact Studio)

## Contexte

Artifact Studio est l'**éditeur visuel** d'Unifia pour les documents, sketches, et code. Il combine un canvas (au sens Figma) avec des capabilities de rendu.

## Découpage en sous-cartes (10)

### P12-C1200a — CanvasEditor
- **Statut :** `PROPOSED`
- **Scope :** `packages/artifact/src/canvas/editor.ts` (~400 lignes)
- **Livrable :** Canvas SVG/HTML éditable
- **Acceptance :** shapes, text, images, drag-drop

### P12-C1200b — LayerSystem
- **Statut :** `PROPOSED`
- **Scope :** `packages/artifact/src/canvas/layers.ts` (~200 lignes)
- **Livrable :** système de layers (Photoshop-like)
- **Acceptance :** ajout, suppression, réordonnement, opacity

### P12-C1200c — PropertyPanel
- **Statut :** `PROPOSED`
- **Scope :** `packages/artifact/src/canvas/properties.tsx` (~300 lignes)
- **Livrable :** panneau de propriétés (style, position, taille)
- **Acceptance :** binding 2-way avec le canvas

### P12-C1200d — Renderer (PDF/HTML/PNG)
- **Statut :** `PROPOSED`
- **Scope :** `packages/artifact/src/render/` (~500 lignes)
- **Livrable :** Renderer multi-format
- **Acceptance :** PDF, HTML, PNG, SVG

### P12-C1200e — Exporters
- **Statut :** `PROPOSED`
- **Scope :** `packages/artifact/src/export/` (~400 lignes)
- **Livrable :** Export vers filesystem, S3, GitHub
- **Acceptance :** 5+ destinations

### P12-C1200f — Versioning
- **Statut :** `PROPOSED`
- **Scope :** `packages/artifact/src/version.ts` (~150 lignes)
- **Livrable :** Versioning atomique des artifacts
- **Acceptance :** branches, tags, diff

### P12-C1200g — Templates
- **Statut :** `PROPOSED`
- **Scope :** `packages/artifact/src/templates/` (~300 lignes)
- **Livrable :** Templates built-in (slide, doc, sketch)
- **Acceptance :** 10+ templates

### P12-C1200h — Collaboration (optionnel)
- **Statut :** `PROPOSED`
- **Scope :** `packages/artifact/src/collab.ts` (~300 lignes)
- **Livrable :** Multi-user editing (CRDT)
- **Acceptance :** Yjs ou Automerge

### P12-C1200i — UI Shell
- **Statut :** `PROPOSED`
- **Scope :** `packages/app/src/pages/artifacts.tsx` (~400 lignes)
- **Livrable :** UI complète d'Artefact Studio
- **Acceptance :** UX testable

### P12-C1200j — Tests + property-based
- **Statut :** `PROPOSED`
- **Scope :** `packages/artifact/test/` (~500 lignes)
- **Livrable :** Tests Canvas + Rendering
- **Acceptance :** 100+ cas, fast-check

## Critères de sortie Plan V3 §12

- [ ] Canvas éditable
- [ ] Layers
- [ ] Properties
- [ ] Render PDF/HTML/PNG
- [ ] Export multi-format
- [ ] Versioning
- [ ] Templates
- [ ] UI Shell

## Dépendances

- **P2-C200** (Contrats) — ArtifactPort
- **P7-C700** (Shell Unifia) — UI
- ADR-0004 (ArtifactPort), ADR-0018 (Memory)

## Estimation

**Total : 6-8 semaines solo**, 3-4 semaines équipe 2-3
