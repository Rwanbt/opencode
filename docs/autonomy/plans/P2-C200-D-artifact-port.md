# P2-C200-D — ArtifactPort (déjà livré)

**Statut :** `INTEGRATED` (interface TypeScript créée + tests)
**Date :** 2026-08-01
**Parent :** P2-C200 (Contrats Unifia)

## État

**Interface TypeScript** déjà livrée :
- `packages/contracts/src/artifact.ts` (56 LOC)
- 15 tests PASS
- `packages/contracts/examples/06-artifact-port.ts` (multi-format)

## Composition

```typescript
export interface ArtifactPort {
  create(input: CreateInput): Promise<Artifact>
  version(input: VersionInput): Promise<ArtifactVersion>
  render(input: RenderInput): Promise<RenderResult>
  export(input: ExportInput): Promise<ExportResult>
}
```

## Formats supportés

- text/plain
- text/markdown
- text/html
- application/pdf
- image/png, image/jpeg, image/svg+xml
- application/json

## Sources de rendu

- Markdown → HTML, PDF
- Mermaid → PNG, SVG
- Code → syntax-highlighted HTML
- HTML → PDF

## Cibles d'export

- Filesystem local
- S3
- GitHub Gist
- Slack/Discord (paste)
- Memory (in-process)

## Implémentations cibles

- `LocalArtifactStore` : filesystem local (200 LOC)
- `S3ArtifactStore` : S3-compatible (300 LOC)
- `MemoryArtifactStore` : in-memory (50 LOC, déjà dans example 06)

## Liens

- [ADR-0004 ArtifactPort](docs/adr/0004-artifact-port.md)
- [P12-C1200 Artifact Studio](plans/P12-C1200-artifact-studio.md)