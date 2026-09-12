/* SPDX-License-Identifier: MIT */
/**
 * ArtifactPort — abstraction sur les artefacts (documents, fichiers générés)
 *
 * ADR-0004
 * Source : Plan V3 §7.4
 */
export type ArtifactId = string
export type ArtifactVersionId = string

export interface Artifact {
  id: ArtifactId
  type: string
  content: string | Uint8Array
  metadata: Record<string, string>
  createdAt: number
  parentId?: ArtifactId
}

export interface ArtifactVersion {
  artifactId: ArtifactId
  version: number
  content: string | Uint8Array
  diff?: string
  createdAt: number
}

export interface ArtifactCreateInput {
  type: string
  content: string | Uint8Array
  metadata?: Record<string, string>
  parentId?: ArtifactId
}

export interface ArtifactVersionInput {
  artifactId: ArtifactId
  content: string | Uint8Array
}

export interface ArtifactRenderInput {
  artifactId: ArtifactId
  format: string
  options?: Record<string, unknown>
}

export interface RenderResult {
  format: string
  content: Uint8Array
  renderTime: number
}

export interface ArtifactExportInput {
  artifactId: ArtifactId
  destination: { type: "filesystem"; path: string } | { type: "s3"; bucket: string; key: string }
}

export interface ExportResult {
  destination: string
  size: number
  exportedAt: number
}

export interface ArtifactPort {
  create(input: ArtifactCreateInput): Promise<Artifact>
  version(input: ArtifactVersionInput): Promise<ArtifactVersion>
  render(input: ArtifactRenderInput): Promise<RenderResult>
  export(input: ArtifactExportInput): Promise<ExportResult>
}
