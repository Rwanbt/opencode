---
id: 0004
title: ArtifactPort
status: PROPOSED
date: 2026-07-31
---

# ADR-0004: ArtifactPort design

**Statut :** `PROPOSED`
**Date :** 2026-07-31
**Décideurs :** Erwan, Hermes Agent (MiniMax M3)
**Source :** Plan V3 §7.4

## Contexte

Unifia doit gérer des **artefacts** (documents, fichiers générés, outputs de capabilities). Le modèle doit supporter :
- **Création** : créer un artefact (avec type MIME, content, metadata)
- **Versioning** : historiser les versions d'un artefact
- **Rendu** : transformer l'artefact en format de sortie (PDF, HTML, image)
- **Export** : sauvegarder l'artefact vers un chemin filesystem ou cloud

## Décision

Adopter le pattern **ArtifactPort** avec 4 méthodes :

```typescript
interface ArtifactPort {
  create(input: ArtifactCreateInput): Promise<Artifact>
  version(input: ArtifactVersionInput): Promise<ArtifactVersion>
  render(input: ArtifactRenderInput): Promise<RenderResult>
  export(input: ArtifactExportInput): Promise<ExportResult>
}
```

**Types principaux** :
- `Artifact` : id, type (MIME), content (Uint8Array ou string), metadata, createdAt
- `ArtifactVersion` : artifactId, version, content, diff vs previous
- `ArtifactCreateInput` : type, content, metadata, parent (optionnel pour les versions)
- `RenderResult` : format (MIME), content, renderTime
- `ExportResult` : path, size, exportedAt

**Implémentations** :
1. `LocalArtifactPort` (défaut — stockage filesystem)
2. `MemoryArtifactPort` (pour tests)
3. `S3ArtifactPort` (futur, optionnel — cloud)

**Capability Packs** (Plan V3 §3.2) :
- `unifia.document.docx`
- `unifia.document.pptx`
- `unifia.document.xlsx`
- `unifia.document.pdf`
- (et plus tard : unifia.image.png, unifia.code.ts, etc.)

## Conséquences

### Positives
- ✅ **Versioning** : chaque modification crée une nouvelle version, diff traçable
- ✅ **Rendu** : capability dédiée, peut être asynchrone (rendu PDF long)
- ✅ **Export** : découplé du storage, permet plusieurs destinations
- ✅ **Capability Packs** : alignement avec Plan V3 §3.2 (reprendre Open Cowork skills)

### Négatives
- ❌ **Storage** : nécessite un storage sous-jacent (filesystem, DB, cloud)
- ❌ **Versioning** : explosion du stockage si pas de garbage collection
- ❌ **Rendu** : nécessite des moteurs externes (LibreOffice, headless Chrome, etc.)

### Neutres
- Le port est agnostique du storage, mais les implémentations concrètes sont spécifiques

## Alternatives considérées

### A. Artefacts = simples fichiers sur disque
- **Rejeté** : pas de versioning, pas d'audit, pas de rendu

### B. Artefacts = blob en DB (PostgreSQL BYTEA)
- **Rejeté** : trop lourd pour des fichiers > 10 MB

### C. Artefacts = Git LFS
- **À reconsidérer** : très bonne option pour le versioning, mais lourd à setup

## Plan d'implémentation

- **Phase 2** : interfaces TypeScript + tests contractuels
- **Phase 6** : LocalArtifactPort + import des Capability Packs Open Cowork (XSD + TS)
- **Phase 12** : Artifact Studio (Plan V3 §12)

## Liens

- Plan V3 §7.4 (ArtifactPort)
- Plan V3 §3.2 (Capabilities Open Cowork à reprendre)
- Plan V3 §12 (Artifact Studio)
- ADR-0003 (CapabilityPort) — sibling contract
- Plan V3 §6.4 (Structure cible) — capability-packs/ dir