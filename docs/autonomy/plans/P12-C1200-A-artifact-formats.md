# P12-C1200-A — Artifact formats

**Statut :** `INTEGRATED` (design documenté)
**Date :** 2026-08-01
**Parent :** P12-C1200 (Artifact Studio)

## Objectif

Définir les **formats d'artefacts** supportés par Artifact Studio.

## Formats d'entrée

| Format | MIME | Use case |
|---|---|---|
| Markdown | text/markdown | Docs, README |
| HTML | text/html | Web content |
| JSON | application/json | Data |
| YAML | text/yaml | Config |
| Code | text/x-* | Code files |
| Image | image/* | Sketches |

## Formats de sortie

| Format | Renderer | Use case |
|---|---|---|
| PDF | pandoc / weasyprint | Documents |
| PNG | chromium / mermaid | Diagrams |
| SVG | mermaid / vega | Diagrams |
| DOCX | pandoc | Word |
| HTML | static | Web |
| Gist | GitHub | Sharing |

## Pipeline

```typescript
interface ArtifactPipeline {
  parse(input: string | Uint8Array): Promise<ArtifactAST>
  transform(ast: ArtifactAST, transformer: string): Promise<ArtifactAST>
  render(ast: ArtifactAST, format: string): Promise<Uint8Array>
  export(rendered: Uint8Array, destination: ExportDestination): Promise<void>
}
```

## Estimation

- Pipeline : ~500 LOC
- Renderers (PDF, PNG, SVG, etc.) : ~1500 LOC
- Exporters (filesystem, S3, GitHub) : ~500 LOC
- Tests : ~500 LOC
- **Total : ~3000 LOC**

## Liens

- [P2-C200-D ArtifactPort](plans/P2-C200-D-artifact-port.md)
- [ADR-0004 ArtifactPort](docs/adr/0004-artifact-port.md)