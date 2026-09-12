/* SPDX-License-Identifier: MIT */
import { createStoredZip, createStoredZipFromBytes, docxWorker, inspectStoredZip, pdfWorker, pptxWorker, readStoredZip, xlsxWorker } from "@unifia/document-packs"
import { UnsafeDocumentError, UnsupportedFormatError, diffArtifacts, previewArtifact, stripFormatMetadata, stripImageMetadata } from "../src/index.js"

let checks = 0
const check = (condition: boolean, message: string): void => {
  checks += 1
  if (!condition) throw new Error(message)
}
const refuses = (run: () => unknown, expected: typeof UnsafeDocumentError | typeof UnsupportedFormatError, message: string): void => {
  checks += 1
  try {
    run()
  } catch (error) {
    if (error instanceof expected) return
    throw new Error(`${message} (threw ${String(error)})`)
  }
  throw new Error(`${message} (did not refuse)`)
}

const bytes = (input: string | Uint8Array): Uint8Array => (typeof input === "string" ? new TextEncoder().encode(input) : input)
const asBytes = async (produce: Promise<{ content: string | Uint8Array }>): Promise<Uint8Array> => bytes((await produce).content)

// --- Preview extracts inert text ---------------------------------------------
const docx = await asBytes(docxWorker("Quarterly report"))
const preview = previewArtifact("docx", docx)
check(preview.text === "Quarterly report", `docx preview produced ${JSON.stringify(preview.text)}`)
check(preview.parts.includes("word/document.xml"), "docx preview did not report the parts it read")

check(previewArtifact("pptx", await asBytes(pptxWorker("Slide body"))).text === "Slide body", "pptx preview did not extract slide text")
check(previewArtifact("xlsx", await asBytes(xlsxWorker("Cell value"))).text === "Cell value", "xlsx preview did not extract cell text")
check(previewArtifact("pdf", await asBytes(pdfWorker("Printed line"))).text === "Printed line", "pdf preview did not extract text runs")
check(previewArtifact("text", bytes("plain")).text === "plain", "text preview did not pass content through")

// A literal split with a line continuation is valid PDF (32000-1 §7.3.4.2). The
// regex this extractor replaced could not match one — JS `.` excludes newlines,
// so `\\.` failed and the whole run was silently dropped.
check(
  previewArtifact("pdf", bytes("%PDF-1.4\n(first\\\nsecond) Tj\n%%EOF")).text === "first\\\nsecond",
  "pdf preview dropped a literal using a line continuation",
)

// Guards the linearity of that extractor: `(\(\(\(...` used to make every other
// offset re-consume the tail, and 16k pairs took ~600 ms. Anything above a
// second here means the quadratic scan is back.
{
  const pathological = new TextEncoder().encode(`%PDF-1.4\n${"(\\".repeat(20_000)}\n%%EOF`)
  const started = performance.now()
  previewArtifact("pdf", pathological)
  const elapsed = performance.now() - started
  check(elapsed < 1_000, `pdf text extraction went quadratic again (${elapsed.toFixed(0)} ms on 20k escaped parens)`)
}

// Entities must come back decoded, not as markup.
check(previewArtifact("docx", await asBytes(docxWorker("a < b & c"))).text === "a < b & c", "docx preview did not decode XML entities")
refuses(() => previewArtifact("binary", bytes("x")), UnsupportedFormatError, "binary was given a textual preview")

// --- Preview refuses anything that can execute -------------------------------
const macroDoc = createStoredZip([
  { name: "[Content_Types].xml", content: "<Types/>" },
  { name: "word/document.xml", content: "<w:document><w:body><w:p><w:r><w:t>harmless</w:t></w:r></w:p></w:body></w:document>" },
  { name: "word/vbaProject.bin", content: "MZ-fake-macro" },
])
refuses(() => previewArtifact("docx", macroDoc), UnsafeDocumentError, "a macro-bearing document was previewed")

const externalDoc = createStoredZip([
  { name: "[Content_Types].xml", content: "<Types/>" },
  { name: "word/_rels/document.xml.rels", content: '<Relationships><Relationship Id="rId9" Target="http://evil.example/x" TargetMode="External"/></Relationships>' },
  { name: "word/document.xml", content: "<w:document><w:body><w:t>text</w:t></w:body></w:document>" },
])
refuses(() => previewArtifact("docx", externalDoc), UnsafeDocumentError, "a document with an external relationship was previewed")

const activePdf = new TextEncoder().encode("%PDF-1.4\n<< /OpenAction << /S /JavaScript >> >>\n(hi) Tj\n%%EOF")
refuses(() => previewArtifact("pdf", activePdf), UnsafeDocumentError, "a PDF with an OpenAction was previewed")
refuses(() => previewArtifact("pdf", bytes("not a pdf")), UnsupportedFormatError, "a non-PDF was previewed as a PDF")

// --- Metadata stripping -------------------------------------------------------
const withMetadata = createStoredZip([
  { name: "[Content_Types].xml", content: '<Types><Override PartName="/word/document.xml" ContentType="main"/><Override PartName="/docProps/core.xml" ContentType="core"/></Types>' },
  { name: "_rels/.rels", content: '<Relationships><Relationship Id="rId1" Target="word/document.xml"/><Relationship Id="rId2" Target="docProps/core.xml"/></Relationships>' },
  { name: "docProps/core.xml", content: "<cp:coreProperties><dc:creator>Erwan</dc:creator></cp:coreProperties>" },
  { name: "docProps/app.xml", content: "<Properties><Company>Secret Corp</Company></Properties>" },
  { name: "customXml/item1.xml", content: "<item>tracking</item>" },
  { name: "word/document.xml", content: "<w:document><w:body><w:p><w:r><w:t>content</w:t></w:r></w:p></w:body></w:document>" },
])
const stripped = stripFormatMetadata("docx", withMetadata)
check(stripped.removedParts.length === 3, `stripping removed ${stripped.removedParts.join(", ")}`)
const remaining = inspectStoredZip(stripped.content).entries
check(!remaining.some((name) => name.startsWith("docProps/")), "a docProps part survived stripping")
check(!remaining.some((name) => name.startsWith("customXml/")), "a customXml part survived stripping")
check(remaining.includes("word/document.xml"), "stripping removed the content part")

// The package must stay consistent: no reference may point at a removed part.
const decoder = new TextDecoder()
const strippedEntries = new Map(remaining.map((name, index) => [name, index]))
check(strippedEntries.has("[Content_Types].xml") && strippedEntries.has("_rels/.rels"), "stripping removed the package descriptors")
const rebuilt = previewArtifact("docx", stripped.content)
check(rebuilt.text === "content", "the stripped package is no longer previewable")
const types = decoder.decode(readEntry(stripped.content, "[Content_Types].xml"))
check(!types.includes("docProps"), "a Content_Types override still references a removed part")
check(types.includes("/word/document.xml"), "stripping dropped the override of a kept part")
const rels = decoder.decode(readEntry(stripped.content, "_rels/.rels"))
check(!rels.includes("docProps"), "a relationship still references a removed part")
check(rels.includes("word/document.xml"), "stripping dropped the relationship of a kept part")

// Nothing to strip must not rewrite the archive.
const clean = stripFormatMetadata("docx", docx)
check(clean.removedParts.length === 0 && clean.content === docx, "stripping rewrote an archive that had no metadata")
check(stripFormatMetadata("text", bytes("plain")).removedParts.length === 0, "text stripping reported removals")

// PDF fails closed rather than pretending.
check(stripFormatMetadata("pdf", await asBytes(pdfWorker("clean"))).removedParts.length === 0, "a generated PDF was reported as carrying metadata")
refuses(() => stripFormatMetadata("pdf", new TextEncoder().encode("%PDF-1.4\ntrailer\n<< /Info 9 0 R >>\n%%EOF")), UnsafeDocumentError, "a PDF with an /Info dictionary was reported as stripped")

// --- Semantic diff -------------------------------------------------------------
const before = await asBytes(docxWorker("line one"))
const after = await asBytes(docxWorker("line two"))
const changed = diffArtifacts("docx", before, after)
check(!changed.identical, "a changed document was reported identical")
check(changed.added === 1 && changed.removed === 1, `diff reported +${changed.added}/-${changed.removed}`)
check(changed.units.some((unit) => unit.op === "added" && unit.value === "line two"), "the diff did not report the new text")

const same = diffArtifacts("docx", before, await asBytes(docxWorker("line one")))
check(same.identical && same.added === 0 && same.removed === 0, "two equal documents were reported as different")

const multi = diffArtifacts("text", bytes("a\nb\nc"), bytes("a\nc\nd"))
check(multi.unchanged === 2 && multi.removed === 1 && multi.added === 1, `text diff reported =${multi.unchanged} -${multi.removed} +${multi.added}`)
check(multi.units.filter((unit) => unit.op === "unchanged").map((unit) => unit.value).join(",") === "a,c", "the diff kept the wrong common units")
refuses(() => diffArtifacts("docx", macroDoc, docx), UnsafeDocumentError, "a macro document was diffed instead of refused")


// --- Embedded image metadata (§26) ------------------------------------------------
// A phone JPEG carries GPS coordinates, a capture time and often a camera serial
// in APP1. Stripping docProps while shipping that is worse than not stripping.

const GPS_MARKER = "GPS:48.8584,2.2945"
const CAMERA_SERIAL = "SERIAL-XYZ-991"

const jpegWithExif = (): Uint8Array => {
  const exif = new TextEncoder().encode(`Exif\0\0${GPS_MARKER} ${CAMERA_SERIAL}`)
  const comment = new TextEncoder().encode("authored by someone")
  const out: number[] = [0xff, 0xd8]
  // APP0 JFIF — structural, must survive.
  const jfif = new TextEncoder().encode("JFIF\0")
  out.push(0xff, 0xe0, 0x00, jfif.length + 2, ...jfif)
  out.push(0xff, 0xe1, ((exif.length + 2) >> 8) & 0xff, (exif.length + 2) & 0xff, ...exif)
  out.push(0xff, 0xfe, ((comment.length + 2) >> 8) & 0xff, (comment.length + 2) & 0xff, ...comment)
  // APP2 ICC — colour management, must survive.
  const icc = new TextEncoder().encode("ICC_PROFILE\0")
  out.push(0xff, 0xe2, 0x00, icc.length + 2, ...icc)
  // SOS then entropy data containing a bare 0xFF, which a naive walker would
  // mistake for a marker and truncate the image at.
  out.push(0xff, 0xda, 0x00, 0x03, 0x01, 0xde, 0xad, 0xff, 0x00, 0xbe, 0xef)
  out.push(0xff, 0xd9)
  return Uint8Array.from(out)
}

const pngChunk = (type: string, payload: Uint8Array): number[] => {
  const length = payload.length
  return [(length >>> 24) & 0xff, (length >>> 16) & 0xff, (length >>> 8) & 0xff, length & 0xff, ...new TextEncoder().encode(type), ...payload, 0x00, 0x00, 0x00, 0x00]
}
const pngWithText = (): Uint8Array =>
  Uint8Array.from([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
    ...pngChunk("IHDR", Uint8Array.from([0, 0, 0, 1, 0, 0, 0, 1, 8, 6, 0, 0, 0])),
    ...pngChunk("tEXt", new TextEncoder().encode(`Author\0${CAMERA_SERIAL}`)),
    ...pngChunk("eXIf", new TextEncoder().encode(GPS_MARKER)),
    ...pngChunk("sRGB", Uint8Array.from([0])),
    ...pngChunk("IDAT", Uint8Array.from([0x78, 0x9c, 0x63, 0x00])),
    ...pngChunk("IEND", new Uint8Array(0)),
  ])

const jpegStripped = stripImageMetadata(jpegWithExif())
check(jpegStripped !== undefined, "a JPEG was reported as an unparseable format")
const jpegText = new TextDecoder().decode(jpegStripped!.content)
check(!jpegText.includes(GPS_MARKER), "the JPEG kept its GPS coordinates")
check(!jpegText.includes(CAMERA_SERIAL), "the JPEG kept its camera serial")
check(!jpegText.includes("authored by someone"), "the JPEG kept its COM comment")
check(jpegText.includes("JFIF"), "stripping removed the structural JFIF segment")
check(jpegText.includes("ICC_PROFILE"), "stripping removed the ICC colour profile")
// The entropy-coded data after SOS is copied verbatim, 0xFF bytes and all.
const out = jpegStripped!.content
const sos = out.findIndex((byte, index) => byte === 0xff && out[index + 1] === 0xda)
check(sos > 0, "the scan header was lost")
const entropy = Array.from(out.subarray(sos + 5))
check(entropy.join(",") === "222,173,255,0,190,239,255,217", `the entropy data was altered: ${entropy.join(",")}`)
check(jpegStripped!.content.at(-2) === 0xff && jpegStripped!.content.at(-1) === 0xd9, "the JPEG lost its end-of-image marker")

const pngStripped = stripImageMetadata(pngWithText())
check(pngStripped !== undefined, "a PNG was reported as an unparseable format")
const pngText = new TextDecoder().decode(pngStripped!.content)
check(!pngText.includes(CAMERA_SERIAL) && !pngText.includes(GPS_MARKER), "the PNG kept its text or EXIF chunks")
check(pngText.includes("IHDR") && pngText.includes("IDAT") && pngText.includes("IEND"), "stripping removed a critical PNG chunk")
check(pngText.includes("sRGB"), "stripping removed a colour chunk it had no reason to touch")
check(pngStripped!.removed.includes("tEXt") && pngStripped!.removed.includes("eXIf"), "the PNG strip did not report what it removed")

// An unparseable image is reported as such, never counted as clean.
check(stripImageMetadata(new Uint8Array([0x47, 0x49, 0x46, 0x38])) === undefined, "a GIF was reported as sanitised")

// End to end: the picture inside a .docx is sanitised with the package.
const withPicture = createStoredZip([
  { name: "[Content_Types].xml", content: "<Types/>" },
  { name: "word/document.xml", content: "<w:t>text</w:t>" },
  { name: "docProps/core.xml", content: "<cp:coreProperties/>" },
])
const packed = readStoredZip(withPicture).map((entry) => entry)
packed.push({ name: "word/media/image1.jpeg", content: jpegWithExif() })
packed.push({ name: "word/media/diagram.emf", content: Uint8Array.from([0x01, 0x00, 0x00, 0x00]) })
const docWithMedia = createStoredZipFromBytes(packed)
const strippedDoc = stripFormatMetadata("docx", docWithMedia)
const rebuiltImage = readStoredZip(strippedDoc.content).find((entry) => entry.name === "word/media/image1.jpeg")
check(rebuiltImage !== undefined, "the picture disappeared from the stripped package")
check(!new TextDecoder().decode(rebuiltImage!.content).includes(GPS_MARKER), "the picture inside the .docx kept its GPS coordinates")
check(strippedDoc.removedParts.includes("docProps/core.xml"), "the package metadata was not removed")
check((strippedDoc.sanitisedImages ?? []).some((image) => image.part === "word/media/image1.jpeg"), "the sanitised picture was not reported")
// The EMF cannot be parsed here, so the strip is partial and says so.
check((strippedDoc.unsanitisedImages ?? []).includes("word/media/diagram.emf"), "an unparseable embedded image was silently counted as clean")

console.log(`ArtifactStudio: ${checks}/${checks} passed`)

function readEntry(archive: Uint8Array, name: string): Uint8Array {
  const entry = readStoredZip(archive).find((candidate) => candidate.name === name)
  if (!entry) throw new Error(`entry ${name} is missing from the archive`)
  return entry.content
}
