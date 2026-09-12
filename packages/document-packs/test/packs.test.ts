/* SPDX-License-Identifier: MIT */
import { createHash } from "node:crypto"
import { mkdtemp, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { ArtifactStore } from "@unifia/artifact-runtime"
import { CONSUMED_TOKENS, DOCUMENT_PACK_MANIFESTS, DocumentPackRegistry, applyDesignTokens, docxWorker, pptxWorker, readStoredZip, registerBuiltInDocumentWorkers, xlsxWorker } from "../src/index.js"
import { inspectStoredZip } from "../src/workers/ooxml.js"

const root = await mkdtemp(path.join(os.tmpdir(), "unifia-packs-"))
try {
  const store = new ArtifactStore(root, () => 5_000)
  const registry = new DocumentPackRegistry(store)
  registerBuiltInDocumentWorkers(registry)
  if (DOCUMENT_PACK_MANIFESTS.length !== 6 || DOCUMENT_PACK_MANIFESTS.some((manifest) => manifest.network !== "off" || !manifest.provenance || !manifest.license)) throw new Error("pack manifests are incomplete")
  const artifact = await registry.execute("unifia.document.inspect", "ws-1", "hello")
  if (artifact.kind !== "text" || artifact.filename !== "inspection.txt") throw new Error("worker output was not registered as artifact")
  const converted = await registry.execute("unifia.document.convert", "ws-1", "hello")
  if (converted.kind !== "text" || converted.filename !== "converted.md") throw new Error("built-in convert worker failed")
  const formats = ["docx", "xlsx", "pptx"] as const
  for (const format of formats) {
    const artifact = await registry.execute(`unifia.document.${format}`, "ws-1", `hello ${format}`)
    const bytes = await store.read(artifact)
    const digest = createHash("sha256").update(bytes).digest("hex")
    const golden = { docx: "01264d58430a65a6cae1326fbb0c9b728de5b435ae5c8e82afb9dbb9f70a7973", xlsx: "e83bac85c04569c9f00d6f2b3d515b6871b1221198f56bb2117a8d619615ccd9", pptx: "4b6a37f98adf6f3d65ea214701d75a6e203a92e79279c87ffb0e663dffcdd0af" }
    if (digest !== golden[format]) throw new Error(`${format} golden mismatch: ${digest}`)
    const inspection = inspectStoredZip(bytes)
    if (inspection.entries.length < 3 || inspection.totalUncompressedBytes <= 0) throw new Error(`${format} ZIP inspection failed`)
    if (artifact.kind !== format || Buffer.from(bytes).subarray(0, 2).toString() !== "PK") throw new Error(`${format} OOXML artifact is invalid`)
  }
  const pdf = await registry.execute("unifia.document.pdf", "ws-1", "hello")
  if (pdf.kind !== "pdf" || pdf.filename !== "document.pdf") throw new Error("PDF worker output is invalid")
  const bytes = await store.read(pdf)
  const digest = createHash("sha256").update(bytes).digest("hex")
  if (digest !== "23b19e6c4315b0ec5310a1bd12e19690378dc4138aec3a8a9df48f9b8c85bf97") throw new Error(`PDF golden mismatch: ${digest}`)
  if (!Buffer.from(bytes).subarray(0, 8).toString().startsWith("%PDF-1.4")) throw new Error("PDF header missing")
  let malformedRejected = false
  try { inspectStoredZip(new Uint8Array([1, 2, 3])) } catch { malformedRejected = true }
  if (!malformedRejected) throw new Error("malformed ZIP was accepted")

  // --- Design token consumption (§25) ---------------------------------------------
  // `resolveDesignTokens` existed and was imported by nothing but its own test.
  // Producing tokens nobody applies is not consumption, so this is the half that
  // was missing.
  const tokens = {
    "color.text": "#1A2B3C",
    "color.accent": "#FF7043",
    "typography.body": "Inter",
    "typography.heading": "Inter Tight",
    "spacing.body": "8",
    "color.unmapped": "#123456",
  }

  const partOf = (bytes: Uint8Array, name: string): string => {
    const entry = readStoredZip(bytes).find((candidate) => candidate.name === name)
    if (!entry) throw new Error(`part ${name} is missing`)
    return new TextDecoder().decode(entry.content)
  }
  const asBytes = (content: string | Uint8Array): Uint8Array => (typeof content === "string" ? new TextEncoder().encode(content) : content)

  // A part is only real if the package also declares it. An archive that carries
  // a part it never announces, or announces one it lacks, is corrupt — and a
  // corrupt document is a worse outcome than an unstyled one.
  const assertDeclared = (bytes: Uint8Array, part: string, relsPart: string, target: string): void => {
    const names = readStoredZip(bytes).map((entry) => entry.name)
    if (!names.includes(part)) throw new Error(`${part} was not written`)
    if (!partOf(bytes, "[Content_Types].xml").includes(`PartName="/${part}"`)) throw new Error(`${part} has no content-type override`)
    if (!partOf(bytes, relsPart).includes(`Target="${target}"`)) throw new Error(`${part} has no relationship`)
  }

  const styledDocx = applyDesignTokens(await docxWorker("Quarterly report"), tokens)
  const docxBytes = asBytes(styledDocx.input.content)
  assertDeclared(docxBytes, "word/styles.xml", "word/_rels/document.xml.rels", "styles.xml")
  const styles = partOf(docxBytes, "word/styles.xml")
  if (!styles.includes('w:ascii="Inter"')) throw new Error("the body font token did not reach word/styles.xml")
  if (!styles.includes('w:val="1A2B3C"')) throw new Error("the text colour token did not reach word/styles.xml")
  // Word counts paragraph spacing in twentieths of a point: 8 pt becomes 160.
  if (!styles.includes('w:after="160"')) throw new Error("the spacing token was not converted to twips")
  if (!partOf(docxBytes, "word/document.xml").includes("Quarterly report")) throw new Error("styling lost the document body")

  const styledPptx = applyDesignTokens(await pptxWorker("Slide body"), tokens)
  const pptxBytes = asBytes(styledPptx.input.content)
  assertDeclared(pptxBytes, "ppt/theme/theme1.xml", "ppt/_rels/presentation.xml.rels", "theme/theme1.xml")
  const theme = partOf(pptxBytes, "ppt/theme/theme1.xml")
  if (!theme.includes('val="FF7043"')) throw new Error("the accent token did not reach the pptx theme")
  if (!theme.includes('typeface="Inter Tight"')) throw new Error("the heading token did not reach the pptx theme")
  // The pre-existing slide relationship must survive the rewrite.
  if (!partOf(pptxBytes, "ppt/_rels/presentation.xml.rels").includes('Target="slides/slide1.xml"')) throw new Error("adding the theme dropped the slide relationship")

  const styledXlsx = applyDesignTokens(await xlsxWorker("cell"), tokens)
  const xlsxBytes = asBytes(styledXlsx.input.content)
  assertDeclared(xlsxBytes, "xl/styles.xml", "xl/_rels/workbook.xml.rels", "styles.xml")
  if (!partOf(xlsxBytes, "xl/styles.xml").includes('val="Inter"')) throw new Error("the body font token did not reach xl/styles.xml")
  if (!partOf(xlsxBytes, "xl/_rels/workbook.xml.rels").includes('Target="worksheets/sheet1.xml"')) throw new Error("adding styles dropped the worksheet relationship")

  // A token with no mapping is reported, never silently dropped: otherwise the
  // caller believes a brand colour reached the document when it did not.
  if (!styledDocx.ignored.includes("color.unmapped")) throw new Error("an unmapped token was silently discarded")
  if (styledDocx.applied.includes("color.unmapped")) throw new Error("an unmapped token was reported as applied")
  for (const name of CONSUMED_TOKENS) {
    if (!styledDocx.applied.includes(name)) throw new Error(`declared token ${name} was not reported as applied`)
  }

  // A format with no mapping comes back unchanged, with every token ignored.
  const untouched = applyDesignTokens({ kind: "text", filename: "notes.md", content: "plain" }, tokens)
  if (untouched.applied.length !== 0) throw new Error("a format with no token mapping reported tokens as applied")
  if (untouched.ignored.length !== Object.keys(tokens).length) throw new Error("an unmapped format did not report every token as ignored")
  if (untouched.input.content !== "plain") throw new Error("an unmapped format was rewritten anyway")

  // Applying twice is idempotent rather than accumulating duplicate parts.
  const twice = applyDesignTokens(styledDocx.input, tokens)
  const twiceBytes = asBytes(twice.input.content)
  const styleParts = readStoredZip(twiceBytes).filter((entry) => entry.name === "word/styles.xml").length
  if (styleParts !== 1) throw new Error(`re-applying tokens produced ${styleParts} styles parts`)
  const overrides = partOf(twiceBytes, "[Content_Types].xml").split('PartName="/word/styles.xml"').length - 1
  if (overrides !== 1) throw new Error(`re-applying tokens produced ${overrides} content-type overrides`)

  console.log("DocumentPackRegistry: 27/27 passed")
} finally {
  await rm(root, { recursive: true, force: true })
}
