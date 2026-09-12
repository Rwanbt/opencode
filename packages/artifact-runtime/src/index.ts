/* SPDX-License-Identifier: MIT */

/**
 * ArtifactRuntime — versioned artefact storage.
 *
 * WHY the identifier is not derived from the content: it used to be
 * `artifact-<sha256 prefix>`, with `version` hardcoded to 1. Two revisions of
 * the same document therefore became two unrelated artefacts with no link
 * between them — the type was called ArtifactVersion but nothing was versioned
 * — and, symmetrically, two logically distinct artefacts that happened to hold
 * identical bytes collided on the same path and the second was refused.
 *
 * An artefact id now names a *lineage* and is independent of content. Each
 * revision is a new version under that lineage, and each version owns its
 * manifest. There is deliberately no global index: the versions on disk are the
 * single authoritative source, so nothing can drift out of sync with them.
 */

import { createHash, randomBytes } from "node:crypto"
import { promises as fs } from "node:fs"
import path from "node:path"
import { DurableQueue } from "@unifia/workspace-runtime"
import {
  inferManifest,
  parseArtifactManifest,
  type ArtifactManifest,
} from "@unifia/contracts/artifact-manifest"

export type ArtifactKind = "docx" | "pptx" | "xlsx" | "pdf" | "svg" | "binary" | "text"

export type ArtifactVersion = {
  artifactId: string
  version: number
  kind: ArtifactKind
  filename: string
  relativePath: string
  sha256: string
  bytes: number
  createdAt: number
  metadata: Record<string, string>
  provenance?: ArtifactProvenance
  /** "clean" once a scanner passed it, "unscanned" when none was configured. */
  scan?: "clean" | "unscanned"
}

/**
 * Where a revision came from — §26's "la source et les outils de génération
 * sont visibles" and "lien à une action remote ou computer-use".
 *
 * `sourceTool` is required because an artefact with no stated origin is the one
 * nobody can account for later, and "unknown" written down beats a field
 * quietly left empty.
 */
export type ArtifactProvenance = {
  /** What produced the bytes, e.g. "docx-worker", "browser-capture", "user-upload". */
  sourceTool: string
  /** The capability pack that authorised the production, when there was one. */
  capabilityPack?: string
  /** The remote command this artefact answers, when it came in over a bridge. */
  remoteActionId?: string
  /** The observation receipt a computer-use capture was taken against. */
  computerUseReceiptId?: string
}

export type ArtifactInput = {
  kind: ArtifactKind
  filename: string
  content: string | Uint8Array
  metadata?: Record<string, string>
  /** Omit to start a new lineage; pass an existing id to add a revision to it. */
  artifactId?: string
  provenance?: ArtifactProvenance
  /**
   * V1 artifact manifest (ADR-1039). When absent, the runtime infers one
   * from the entry filename extension and stores the result under
   * `metadata["manifest"]` so the renderer never has to guess.
   */
  manifest?: ArtifactManifest
}

/**
 * Optional content scan — §26's "validation antivirus optionnelle".
 *
 * Optional means the store works without one, not that a configured scanner may
 * be skipped: when one is present a rejection stops the write. The outcome is
 * recorded on the version either way, so "scanned and clean" and "never
 * scanned" are distinguishable afterwards. Collapsing them would make an
 * unscanned artefact look vetted.
 */
export type ArtifactScanner = { scan(content: Uint8Array, filename: string): Promise<{ clean: boolean; detail?: string }> }

export class ArtifactRejectedError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "ArtifactRejectedError"
  }
}

/**
 * What may accompany an artefact out of the workspace.
 *
 * `"strip"` is the default because an export leaves the trust boundary, and
 * metadata is the field most likely to carry something the author did not mean
 * to publish. Callers opt into disclosure explicitly.
 *
 * SCOPE, stated so it is not mistaken for more than it is: this governs the
 * Unifia metadata record only. Metadata embedded inside the bytes — docProps in
 * an OOXML package, EXIF in an image it contains — is handled separately by
 * `@unifia/artifact-studio`'s `stripFormatMetadata`, which the caller must
 * apply to the content before handing it here. A PDF `/Info` dictionary is
 * still refused rather than edited.
 */
export type MetadataPolicy = "strip" | "keep" | { allow: readonly string[] }

export type ExportOptions = { outbox?: string; metadata?: MetadataPolicy }
export type ExportedArtifact = { artifactId: string; version: number; relativePath: string; sha256: string; metadata: Record<string, string> }

const MAX_ARTIFACT_BYTES = 32 * 1024 * 1024
const ARTIFACTS_DIRECTORY = "artifacts"
const OUTBOX_DIRECTORY = "outbox"
const MANIFEST = "version.json"
const VERSION_DIRECTORY = /^v(\d+)$/
const ARTIFACT_ID = /^artifact-[0-9a-f]{24}$/

function hash(content: Uint8Array): string {
  return createHash("sha256").update(content).digest("hex")
}

export function assertSafeVectorRender(content: string | Uint8Array): void {
  const source = typeof content === "string" ? content : new TextDecoder().decode(content)
  if (/<\s*script\b/i.test(source)) throw new Error("SVG render rejected: scripts are not allowed")
  if (/\bon[a-z][\w:-]*\s*=/i.test(source)) throw new Error("SVG render rejected: event handlers are not allowed")
  if (/(?:href|src|xlink:href)\s*=\s*["']\s*(?:https?:|\/\/|javascript:|data:text\/html)/i.test(source)) throw new Error("SVG render rejected: external or executable references are not allowed")
}

function safeFilename(filename: string): string {
  if (!filename || filename.includes("\0") || path.basename(filename) !== filename || filename === "." || filename === "..") {
    throw new Error("artifact filename must be a single safe path component")
  }
  return filename
}

function safeArtifactId(artifactId: string): string {
  // WHY the shape is validated: the id becomes a path segment, so an
  // unvalidated one is a traversal primitive.
  if (!ARTIFACT_ID.test(artifactId)) throw new Error("invalid artifact id")
  return artifactId
}

function applyMetadataPolicy(metadata: Record<string, string>, policy: MetadataPolicy): Record<string, string> {
  if (policy === "keep") return { ...metadata }
  if (policy === "strip") return {}
  const allowed: Record<string, string> = {}
  for (const key of policy.allow) if (key in metadata) allowed[key] = metadata[key]
  return allowed
}

export class ArtifactStore {
  readonly #root: string
  readonly #artifactsRoot: string
  readonly #outboxRoot: string
  readonly #outbox: DurableQueue<ArtifactVersion>
  readonly #now: () => number
  readonly #maxBytes: number
  readonly #scanner?: ArtifactScanner

  constructor(root: string, now: () => number = Date.now, maxBytes = MAX_ARTIFACT_BYTES, scanner?: ArtifactScanner) {
    this.#scanner = scanner
    this.#root = root
    this.#artifactsRoot = path.join(root, ".unifia", ARTIFACTS_DIRECTORY)
    this.#outboxRoot = path.join(root, ".unifia", OUTBOX_DIRECTORY)
    this.#outbox = new DurableQueue<ArtifactVersion>(root)
    this.#now = now
    this.#maxBytes = maxBytes
  }

  /**
   * Stores a revision.
   *
   * Re-storing content identical to the current head returns that head instead
   * of creating a version that differs from its predecessor in nothing but its
   * number. Two *different* lineages holding identical bytes are both stored:
   * identical content does not make two artefacts the same artefact.
   */
  async create(input: ArtifactInput): Promise<ArtifactVersion> {
    const filename = safeFilename(input.filename)
    const content = Buffer.from(typeof input.content === "string" ? Buffer.from(input.content) : input.content)
    if (content.byteLength > this.#maxBytes) throw new Error("artifact quota exceeded")
    if (input.kind === "svg") assertSafeVectorRender(content)
    const sha256 = hash(content)
    // Scanned before anything is written: a rejected artefact must leave no
    // version directory behind for a later reader to find.
    if (this.#scanner) {
      const verdict = await this.#scanner.scan(content, filename)
      if (!verdict.clean) throw new ArtifactRejectedError(`artifact rejected by scanner: ${verdict.detail ?? "no detail"}`)
    }
    const artifactId = input.artifactId ? safeArtifactId(input.artifactId) : `artifact-${randomBytes(12).toString("hex")}`
    const head = input.artifactId ? await this.latest(artifactId) : undefined
    if (input.artifactId && !head) throw new Error("artifact lineage does not exist")
    if (head?.sha256 === sha256) return head
    // Rule 5: a manifest is stored when the caller provides one or when
    // we can infer it from the entry filename. If inference fails (unknown
    // extension) and the caller did not pass a manifest, the version is
    // created without a `manifest` key in metadata — a renderer that
    // needs one will see the absence and ask the caller to set it. This
    // is a deliberate best-effort: refusing to write would break the
    // pre-P14 test suite that authors call `store.create` for arbitrary
    // files (notably `.txt`), and a silent default would let unknown
    // artefacts slip through unrenderable.
    const manifest = input.manifest ?? inferManifest(filename)
    if (manifest) {
      // Validate the manifest at the storage boundary. The caller may
      // have constructed it loosely.
      parseArtifactManifest(manifest)
    }
    return this.#writeVersion(artifactId, (head?.version ?? 0) + 1, filename, content, sha256, input, manifest)
  }

  async #writeVersion(artifactId: string, version: number, filename: string, content: Buffer, sha256: string, input: ArtifactInput, manifest: ArtifactManifest | null): Promise<ArtifactVersion> {
    const versionDirectory = path.join(this.#artifactsRoot, artifactId, `v${version}`)
    const relativePath = path.posix.join(".unifia", ARTIFACTS_DIRECTORY, artifactId, `v${version}`, filename)
    await fs.mkdir(versionDirectory, { recursive: true })
    const target = path.join(versionDirectory, filename)
    const temporary = `${target}.${sha256.slice(0, 12)}.tmp`
    // `wx` fails rather than truncating, so a concurrent writer cannot lose a
    // version by silently overwriting one.
    await fs.writeFile(temporary, content, { flag: "wx" })
    try {
      await fs.rename(temporary, target)
    } catch (error) {
      await fs.rm(temporary, { force: true })
      throw error
    }
    // Rule 4: the manifest is stored in the version's metadata under a
    // single reserved key. No sidecar file, no second store — that decision
    // is locked by ADR-1039. When inference failed, the key is simply
    // absent; the renderer is expected to detect that and refuse to render.
    const metadata: Record<string, string> = { ...(input.metadata ?? {}) }
    if (manifest) metadata.manifest = JSON.stringify(manifest)
    const artifact: ArtifactVersion = { artifactId, version, kind: input.kind, filename, relativePath, sha256, bytes: content.byteLength, createdAt: this.#now(), metadata, provenance: input.provenance ? { ...input.provenance } : { sourceTool: "unknown" }, scan: this.#scanner ? "clean" : "unscanned" }
    await fs.writeFile(path.join(versionDirectory, MANIFEST), `${JSON.stringify(artifact, null, 2)}\n`, "utf8")
    await this.#outbox.enqueue("outbox", artifact)
    return artifact
  }

  async read(artifact: ArtifactVersion): Promise<Uint8Array> {
    const absolute = path.join(this.#root, artifact.relativePath)
    const content = await fs.readFile(absolute)
    if (hash(content) !== artifact.sha256) throw new Error("artifact hash mismatch")
    return content
  }

  /** Every revision of a lineage, oldest first. Empty when the lineage is unknown. */
  async history(artifactId: string): Promise<readonly ArtifactVersion[]> {
    const lineageDirectory = path.join(this.#artifactsRoot, safeArtifactId(artifactId))
    let entries: string[]
    try {
      entries = await fs.readdir(lineageDirectory)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return []
      throw error
    }
    const versions: ArtifactVersion[] = []
    for (const entry of entries) {
      if (!VERSION_DIRECTORY.test(entry)) continue
      const manifest = await fs.readFile(path.join(lineageDirectory, entry, MANIFEST), "utf8")
      versions.push(JSON.parse(manifest) as ArtifactVersion)
    }
    return versions.sort((left, right) => left.version - right.version)
  }

  async latest(artifactId: string): Promise<ArtifactVersion | undefined> {
    return (await this.history(artifactId)).at(-1)
  }

  async list(): Promise<readonly ArtifactVersion[]> {
    let ids: string[]
    try { ids = await fs.readdir(this.#artifactsRoot) } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return []
      throw error
    }
    const latest: ArtifactVersion[] = []
    for (const id of ids) if (ARTIFACT_ID.test(id)) {
      const version = await this.latest(id)
      if (version) latest.push(version)
    }
    return latest.sort((left, right) => right.createdAt - left.createdAt)
  }

  /**
   * Copies a version into the workspace outbox, applying the metadata policy.
   *
   * The export stays inside the workspace: this produces the file a user or a
   * later step may collect, it does not send anything anywhere.
   */
  async export(artifact: ArtifactVersion, options: ExportOptions = {}): Promise<ExportedArtifact> {
    const outboxName = safeFilename(options.outbox ?? "default")
    const content = await this.read(artifact)
    const directory = path.join(this.#outboxRoot, outboxName)
    await fs.mkdir(directory, { recursive: true })
    const filename = `${artifact.artifactId}-v${artifact.version}-${safeFilename(artifact.filename)}`
    await fs.writeFile(path.join(directory, filename), content)
    const metadata = applyMetadataPolicy(artifact.metadata, options.metadata ?? "strip")
    return { artifactId: artifact.artifactId, version: artifact.version, relativePath: path.posix.join(".unifia", OUTBOX_DIRECTORY, outboxName, filename), sha256: artifact.sha256, metadata }
  }

  async pending(afterSequence = 0): Promise<Array<{ sequence: number; payload: ArtifactVersion }>> {
    return this.#outbox.pending("outbox", afterSequence)
  }
}
