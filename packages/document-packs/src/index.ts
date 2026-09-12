/* SPDX-License-Identifier: MIT */
import type { ArtifactStore, ArtifactInput, ArtifactKind, ArtifactVersion } from "@unifia/artifact-runtime"
import { pdfWorker } from "./workers/pdf.js"
import { convertWorker, docxWorker, inspectWorker, pptxWorker, xlsxWorker } from "./workers/ooxml.js"

export * from "./zip.js"
export { convertWorker, docxWorker, inspectWorker, pptxWorker, xlsxWorker } from "./workers/ooxml.js"
export { createDeterministicPdf, pdfWorker } from "./workers/pdf.js"
export { CONSUMED_TOKENS, applyDesignTokens, type TokenApplication } from "./tokens.js"

export type DocumentPackId = "unifia.document.docx" | "unifia.document.pptx" | "unifia.document.xlsx" | "unifia.document.pdf" | "unifia.document.convert" | "unifia.document.inspect"
export type DocumentPackManifest = {
  id: DocumentPackId
  version: string
  inputSchema: string
  outputKind: ArtifactKind
  maxInputBytes: number
  network: "off"
  license: "MIT" | "Apache-2.0"
  provenance: string
}
export type DocumentWorkerContext = { workspaceId: string; network: "off" }
export type DocumentWorker = (input: string | Uint8Array, context: DocumentWorkerContext) => Promise<ArtifactInput>

export const DOCUMENT_PACK_MANIFESTS: readonly DocumentPackManifest[] = [
  "docx", "pptx", "xlsx", "pdf", "convert", "inspect",
].map((kind) => ({
  id: `unifia.document.${kind}` as DocumentPackId,
  version: "0.1.0",
  inputSchema: "unifia.document.input.v1",
  outputKind: kind === "docx" || kind === "pptx" || kind === "xlsx" || kind === "pdf" ? kind : "text",
  maxInputBytes: 32 * 1024 * 1024,
  network: "off",
  license: "MIT",
  provenance: "Unifia-owned worker boundary; no upstream code imported",
}))

export class DocumentPackRegistry {
  readonly #artifactStore: ArtifactStore
  readonly #manifests = new Map<DocumentPackId, DocumentPackManifest>()
  readonly #workers = new Map<DocumentPackId, DocumentWorker>()

  constructor(artifactStore: ArtifactStore, manifests: readonly DocumentPackManifest[] = DOCUMENT_PACK_MANIFESTS) {
    this.#artifactStore = artifactStore
    for (const manifest of manifests) this.register(manifest, undefined)
  }

  register(manifest: DocumentPackManifest, worker: DocumentWorker | undefined): void {
    if (manifest.network !== "off") throw new Error("document pack network must be off")
    if (!manifest.provenance || !manifest.license) throw new Error("document pack provenance and license are required")
    this.#manifests.set(manifest.id, { ...manifest })
    if (worker) this.#workers.set(manifest.id, worker)
  }

  manifest(id: DocumentPackId): DocumentPackManifest | undefined {
    const manifest = this.#manifests.get(id)
    return manifest ? { ...manifest } : undefined
  }

  async execute(id: DocumentPackId, workspaceId: string, input: string | Uint8Array): Promise<ArtifactVersion> {
    const manifest = this.#manifests.get(id)
    const worker = this.#workers.get(id)
    if (!manifest || !worker) throw new Error("document pack worker is not registered")
    const bytes = typeof input === "string" ? Buffer.byteLength(input) : input.byteLength
    if (bytes > manifest.maxInputBytes) throw new Error("document pack input quota exceeded")
    const output = await worker(input, { workspaceId, network: "off" })
    if (output.kind !== manifest.outputKind) throw new Error("document worker output does not match manifest")
    return this.#artifactStore.create(output)
  }
}
export const registerBuiltInDocumentWorkers = (registry: DocumentPackRegistry): void => {
  const manifest = registry.manifest("unifia.document.pdf")
  if (!manifest) throw new Error("built-in PDF manifest is missing")
  registry.register(manifest, (input) => pdfWorker(input))
  for (const [id, worker] of [["unifia.document.docx", docxWorker], ["unifia.document.pptx", pptxWorker], ["unifia.document.xlsx", xlsxWorker], ["unifia.document.convert", convertWorker], ["unifia.document.inspect", inspectWorker]] as const) {
    const formatManifest = registry.manifest(id)
    if (!formatManifest) throw new Error(`${id} manifest is missing`)
    registry.register(formatManifest, (input) => worker(input))
  }
}