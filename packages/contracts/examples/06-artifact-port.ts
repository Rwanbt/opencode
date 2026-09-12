/* SPDX-License-Identifier: MIT */
/**
 * Example 06: ArtifactPort — Document generation
 *
 * Demonstrates how to use the ArtifactPort to create, version, render,
 * and export artifacts (documents, sketches, etc.).
 *
 * Run with: bun run examples/06-artifact-port.ts
 */

import type {
  ArtifactPort,
  Artifact,
  ArtifactVersion,
  ArtifactCreateInput,
  ArtifactRenderInput,
  RenderResult,
  ArtifactExportInput,
  ExportResult,
} from "../src/artifact.js"

// === Step 1: Define a multi-format artifact store ===
class MultiFormatArtifactStore implements ArtifactPort {
  private artifacts: Map<string, Artifact[]> = new Map()

  async create(input: ArtifactCreateInput): Promise<Artifact> {
    const id = `a_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
    const artifact: Artifact = {
      id,
      type: input.type,
      content: input.content,
      metadata: input.metadata || {},
      createdAt: Date.now(),
      parentId: input.parentId,
    }
    if (!this.artifacts.has(id)) {
      this.artifacts.set(id, [])
    }
    this.artifacts.get(id)!.push(artifact)
    return artifact
  }

  async version(input: { artifactId: string; content: any }): Promise<ArtifactVersion> {
    const _newVersion = await this.create({
      type: "text",
      content: input.content,
      parentId: input.artifactId,
    })
    return {
      artifactId: input.artifactId,
      version: this.artifacts.get(input.artifactId)!.length,
      content: input.content,
      createdAt: Date.now(),
    }
  }

  async render(input: ArtifactRenderInput): Promise<RenderResult> {
    const artifact = this.artifacts.get(input.artifactId)?.at(-1)
    if (!artifact) throw new Error("Artifact not found")

    console.log(`Rendering ${input.artifactId} as ${input.format}`)
    const content = typeof artifact.content === "string"
      ? new TextEncoder().encode(artifact.content)
      : artifact.content

    return {
      format: input.format,
      content,
      renderTime: 0,
    }
  }

  async export(input: ArtifactExportInput): Promise<ExportResult> {
    const dest = input.destination.type === "filesystem"
      ? input.destination.path
      : `s3://${input.destination.bucket}/${input.destination.key}`
    console.log(`Exporting ${input.artifactId} to ${dest}`)
    return {
      destination: dest,
      size: 1024,
      exportedAt: Date.now(),
    }
  }
}

// === Step 2: Use it ===
async function main() {
  const store = new MultiFormatArtifactStore()

  // Create a DOCX artifact
  const doc = await store.create({
    type: "text",
    content: "# Hello, Unifia!\n\nThis is a test document.",
    metadata: { author: "Erwan", title: "Test" },
  })
  console.log("Created:", doc.id)

  // Version it
  const v2 = await store.version({
    artifactId: doc.id,
    content: "# Hello, Unifia!\n\nThis is a test document.\n\nVersion 2.",
  })
  console.log("Versioned:", v2.version)

  // Render as PDF
  const pdf = await store.render({
    artifactId: doc.id,
    format: "pdf",
  })
  console.log("Rendered:", pdf.format, pdf.content.byteLength, "bytes")

  // Export to filesystem
  const exported = await store.export({
    artifactId: doc.id,
    destination: { type: "filesystem", path: "/tmp/output.pdf" },
  })
  console.log("Exported to:", exported.destination)

  console.log("Done")
}

main().catch(console.error)
