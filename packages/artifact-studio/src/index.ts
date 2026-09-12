/* SPDX-License-Identifier: MIT */

/**
 * Artifact Studio — Plan V3 section 26.
 *
 * Three surfaces the phase requires and that nothing implemented: stripping
 * format-level metadata, producing a preview that cannot execute anything, and
 * diffing two revisions semantically rather than by bytes.
 *
 * Everything here is pure and offline. No worker is spawned, no document is
 * rendered by a format engine, and no content is ever evaluated — the preview
 * extracts inert text and the diff compares extracted units. A document that
 * carries an execution surface is refused rather than previewed, because the
 * safe thing to do with a macro is not to render it carefully.
 */

import { createStoredZipFromBytes, readStoredZip, type ZipBinaryEntry } from "@unifia/document-packs/zip"
import { isJpeg, isPng, isSupportedImage, stripImageMetadata, type ImageStripResult } from "./images.js"
import { attribute, filterElements, textOf } from "./xml.js"

export type StudioFormat = "docx" | "pptx" | "xlsx" | "pdf" | "svg" | "text" | "binary" | "html"

const OOXML: ReadonlySet<StudioFormat> = new Set<StudioFormat>(["docx", "pptx", "xlsx"])

/** Package prefixes that carry authoring metadata rather than content. */
const METADATA_PREFIXES = ["docProps/", "customXml/"]

/** Parts that can execute. Their presence disqualifies a document from preview. */
const EXECUTABLE_SUFFIXES = ["vbaProject.bin", ".bin"]

/** PDF tokens that make a document active rather than inert. */
const ACTIVE_PDF_TOKENS = ["/JavaScript", "/JS", "/Launch", "/OpenAction", "/EmbeddedFile", "/AA"]

const MAX_PREVIEW_CHARS = 8192

export class UnsafeDocumentError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "UnsafeDocumentError"
  }
}

export class UnsupportedFormatError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "UnsupportedFormatError"
  }
}

// --- Metadata stripping ------------------------------------------------------

export type StripResult = {
  content: Uint8Array
  removedParts: readonly string[]
  /** Embedded images whose metadata was removed, with what came out of each. */
  sanitisedImages?: readonly { part: string; removed: readonly string[] }[]
  /**
   * Embedded images left byte-for-byte intact because their format is not
   * parsed here. Non-empty means the strip was **partial** — the caller must
   * not report the document as sanitised.
   */
  unsanitisedImages?: readonly string[]
}

/** Where OOXML packages keep embedded pictures. */
const MEDIA_PREFIXES = ["word/media/", "ppt/media/", "xl/media/", "word/embeddings/", "ppt/embeddings/"]
const isMediaPart = (name: string): boolean => MEDIA_PREFIXES.some((prefix) => name.startsWith(prefix))

const isMetadataPart = (name: string): boolean => METADATA_PREFIXES.some((prefix) => name.startsWith(prefix))

/**
 * Removes format-level metadata.
 *
 * For OOXML this deletes the metadata parts *and* the references to them, so
 * the result is a consistent package: a stripped archive that still declares an
 * Override or a Relationship for a part that is gone is corrupt, and a corrupt
 * export is worse than an unstripped one.
 *
 * Embedded pictures are stripped too. Removing the author from `docProps` while
 * shipping a phone JPEG with its GPS coordinates is worse than not stripping at
 * all, because the caller then believes the document is clean. Images whose
 * format is not parsed here are reported in `unsanitisedImages` instead of
 * being counted as clean.
 *
 * For PDF it refuses rather than pretends. Our own generator emits no /Info
 * dictionary, so a PDF that has one did not come from here, and editing an
 * arbitrary PDF needs a real parser. Failing closed keeps the caller from
 * believing a document was sanitised when it was not.
 */
export function stripFormatMetadata(format: StudioFormat, bytes: Uint8Array): StripResult {
  if (format === "text" || format === "binary") return { content: bytes, removedParts: [] }
  if (format === "pdf") return stripPdfMetadata(bytes)
  if (!OOXML.has(format)) throw new UnsupportedFormatError(`unsupported format: ${format}`)
  const entries = readStoredZip(bytes)
  const removedParts = entries.map((entry) => entry.name).filter(isMetadataPart)
  const sanitisedImages: { part: string; removed: readonly string[] }[] = []
  const unsanitisedImages: string[] = []
  const kept = entries
    .filter((entry) => !isMetadataPart(entry.name))
    .map(rewriteReferences)
    .map((entry) => {
      if (!isMediaPart(entry.name)) return entry
      const stripped = stripImageMetadata(entry.content)
      if (!stripped) {
        unsanitisedImages.push(entry.name)
        return entry
      }
      if (stripped.removed.length > 0) sanitisedImages.push({ part: entry.name, removed: stripped.removed })
      return { name: entry.name, content: stripped.content }
    })
  if (removedParts.length === 0 && sanitisedImages.length === 0) {
    return { content: bytes, removedParts: [], sanitisedImages: [], unsanitisedImages }
  }
  return { content: createStoredZipFromBytes(kept), removedParts, sanitisedImages, unsanitisedImages }
}

function rewriteReferences(entry: ZipBinaryEntry): ZipBinaryEntry {
  if (!entry.name.endsWith("[Content_Types].xml") && !entry.name.endsWith(".rels")) return entry
  const decoder = new TextDecoder()
  let xml = decoder.decode(entry.content)
  xml = filterElements(xml, "Override", (attributes) => {
    const part = attribute(attributes, "PartName") ?? ""
    return !isMetadataPart(part.replace(/^\//, ""))
  })
  xml = filterElements(xml, "Relationship", (attributes) => {
    const target = attribute(attributes, "Target") ?? ""
    return !isMetadataPart(target.replace(/^\//, ""))
  })
  return { name: entry.name, content: new TextEncoder().encode(xml) }
}

function stripPdfMetadata(bytes: Uint8Array): StripResult {
  const text = new TextDecoder().decode(bytes)
  if (!text.startsWith("%PDF-")) throw new UnsupportedFormatError("not a PDF document")
  if (text.includes("/Info")) {
    throw new UnsafeDocumentError("this PDF carries an /Info dictionary; stripping it needs a real PDF parser and is not implemented")
  }
  return { content: bytes, removedParts: [] }
}

// --- Preview -----------------------------------------------------------------

export type PreviewResult = { text: string; parts: readonly string[]; truncated: boolean }

/**
 * Produces an inert textual preview.
 *
 * @throws UnsafeDocumentError when the document carries an execution surface or
 * an external reference. Refusing is the point: a preview that renders a macro
 * document "carefully" is still a preview that opened it.
 */
export function previewArtifact(format: StudioFormat, bytes: Uint8Array): PreviewResult {
  if (format === "text") return truncate(new TextDecoder().decode(bytes), [])
  if (format === "binary") throw new UnsupportedFormatError("binary artefacts have no textual preview")
  if (format === "pdf") return previewPdf(bytes)
  if (!OOXML.has(format)) throw new UnsupportedFormatError(`unsupported format: ${format}`)
  const entries = readStoredZip(bytes)
  assertInertPackage(entries)
  const tag = format === "docx" ? "w:t" : format === "pptx" ? "a:t" : "t"
  const decoder = new TextDecoder()
  const collected: string[] = []
  for (const entry of entries) if (isContentPart(format, entry.name)) collected.push(...textOf(decoder.decode(entry.content), tag))
  return truncate(collected.join("\n"), entries.map((entry) => entry.name))
}

function assertInertPackage(entries: readonly ZipBinaryEntry[]): void {
  for (const entry of entries) {
    if (EXECUTABLE_SUFFIXES.some((suffix) => entry.name.endsWith(suffix))) throw new UnsafeDocumentError(`document carries an executable part: ${entry.name}`)
    if (!entry.name.endsWith(".rels")) continue
    if (new TextDecoder().decode(entry.content).includes('TargetMode="External"')) throw new UnsafeDocumentError(`document declares an external relationship in ${entry.name}`)
  }
}

function isContentPart(format: StudioFormat, name: string): boolean {
  if (format === "docx") return name === "word/document.xml"
  if (format === "pptx") return name.startsWith("ppt/slides/") && name.endsWith(".xml")
  return name.startsWith("xl/worksheets/") && name.endsWith(".xml")
}

function previewPdf(bytes: Uint8Array): PreviewResult {
  const text = new TextDecoder().decode(bytes)
  if (!text.startsWith("%PDF-")) throw new UnsupportedFormatError("not a PDF document")
  for (const token of ACTIVE_PDF_TOKENS) if (text.includes(token)) throw new UnsafeDocumentError(`PDF carries an active element: ${token}`)
  return truncate(pdfTextRuns(text).join("\n"), ["%PDF"])
}

/**
 * Extracts `(literal) Tj` show-text operands.
 *
 * Hand-scanned rather than `matchAll(/\((?:[^()\\]|\\.)*\)\s*Tj/g)`: that regex
 * is linear per attempt but `matchAll` restarts a failed one at start+1, so a
 * document of `(\(\(\(...` makes every other offset re-consume the whole tail —
 * quadratic on attacker-supplied bytes (CodeQL `js/polynomial-redos`). Resuming
 * where the failed scan stopped makes it linear.
 *
 * One deliberate behaviour change comes with it: `\\.` could not match a
 * backslash followed by a newline, because JS `.` excludes line terminators, so
 * the old regex silently dropped the whole run whenever a literal used a line
 * continuation — which PDF 32000-1 §7.3.4.2 explicitly allows. The scanner
 * treats an escape as covering the next character whatever it is. Differential
 * fuzzing over 500k inputs found this to be the only divergence.
 */
function pdfTextRuns(text: string): string[] {
  const runs: string[] = []
  let index = text.indexOf("(")
  while (index >= 0) {
    let cursor = index + 1
    let literal = ""
    // The literal body, matching the old character classes exactly: an escape
    // covers the next character whatever it is, and a bare paren ends the run.
    while (cursor < text.length) {
      const char = text[cursor]!
      if (char === "\\") {
        if (cursor + 1 >= text.length) break
        literal += text.slice(cursor, cursor + 2)
        cursor += 2
        continue
      }
      if (char === "(" || char === ")") break
      literal += char
      cursor++
    }
    if (text[cursor] === ")") {
      let after = cursor + 1
      while (after < text.length && /\s/.test(text[after]!)) after++
      if (text.startsWith("Tj", after)) {
        runs.push(literal.replaceAll("\\(", "(").replaceAll("\\)", ")").replaceAll("\\\\", "\\"))
      }
      cursor++
    }
    // Never rewind: `cursor > index` always, so the scan advances monotonically.
    index = text.indexOf("(", Math.max(cursor, index + 1))
  }
  return runs
}

function truncate(text: string, parts: readonly string[]): PreviewResult {
  const truncated = text.length > MAX_PREVIEW_CHARS
  return { text: truncated ? text.slice(0, MAX_PREVIEW_CHARS) : text, parts, truncated }
}

// --- Semantic diff -----------------------------------------------------------

export type DiffOperation = { op: "added" | "removed" | "unchanged"; value: string }
export type SemanticDiff = { units: readonly DiffOperation[]; added: number; removed: number; unchanged: number; identical: boolean }

/**
 * Compares two revisions by their extracted content units rather than bytes.
 *
 * Two OOXML packages that say the same thing differ in bytes for reasons the
 * reader does not care about, so a byte diff answers the wrong question. Both
 * sides go through `previewArtifact`, which means a document carrying an
 * execution surface is refused here too.
 */
export function diffArtifacts(format: StudioFormat, left: Uint8Array, right: Uint8Array): SemanticDiff {
  const before = previewArtifact(format, left).text.split("\n").filter((line) => line.length > 0)
  const after = previewArtifact(format, right).text.split("\n").filter((line) => line.length > 0)
  const units = diffUnits(before, after)
  const count = (op: DiffOperation["op"]) => units.filter((unit) => unit.op === op).length
  const added = count("added")
  const removed = count("removed")
  return { units, added, removed, unchanged: count("unchanged"), identical: added === 0 && removed === 0 }
}

/** Longest-common-subsequence diff. Quadratic, which is fine for document units. */
function diffUnits(before: readonly string[], after: readonly string[]): DiffOperation[] {
  const lengths: number[][] = Array.from({ length: before.length + 1 }, () => new Array<number>(after.length + 1).fill(0))
  for (let i = before.length - 1; i >= 0; i -= 1) {
    for (let j = after.length - 1; j >= 0; j -= 1) {
      lengths[i][j] = before[i] === after[j] ? lengths[i + 1][j + 1] + 1 : Math.max(lengths[i + 1][j], lengths[i][j + 1])
    }
  }
  const units: DiffOperation[] = []
  let i = 0
  let j = 0
  while (i < before.length && j < after.length) {
    if (before[i] === after[j]) { units.push({ op: "unchanged", value: before[i] }); i += 1; j += 1 }
    else if (lengths[i + 1][j] >= lengths[i][j + 1]) { units.push({ op: "removed", value: before[i] }); i += 1 }
    else { units.push({ op: "added", value: after[j] }); j += 1 }
  }
  while (i < before.length) { units.push({ op: "removed", value: before[i] }); i += 1 }
  while (j < after.length) { units.push({ op: "added", value: after[j] }); j += 1 }
  return units
}

export { isJpeg, isPng, isSupportedImage, stripImageMetadata, type ImageStripResult }
export { exportStandaloneHtml, type AssetResolver, type ExportStandaloneResult } from "./export-html.js"
export { EmptyRenderError, isEmptyRenderCapture, planPdfPages, POINTS_PER_INCH, type CapturedPage, type PdfPagePlan } from "./export-pdf.js"
export { buildArtifactArchive, ExecutablePartError, readArtifactArchive, EXECUTABLE_NAME_PATTERNS, type ArtifactArchiveEntry } from "./export-zip.js"
export { buildPptxBytes, buildPptxBytesAndPreview, buildPptxEntries, type PptxSlide } from "./export-pptx.js"
