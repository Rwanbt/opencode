/* SPDX-License-Identifier: MIT */

/**
 * P27 — Build a PPTX package from a list of slide text content.
 *
 * The output is a valid OOXML PPTX that round-trips through
 * `previewArtifact("pptx", bytes)` of this same package. The build
 * here is intentionally minimal: one master, one layout, one slide
 * per text entry, and a single relationship graph. There is no
 * styling, no theme, no embedded media — the slide title is the text
 * content, and the body is left empty.
 *
 * No executable parts (`vbaProject.bin`, `.bin`) are emitted, ever.
 */

import { createStoredZipFromBytes, readStoredZip, type ZipBinaryEntry } from "@unifia/document-packs/zip"
import { previewArtifact } from "./index.js"

export type PptxSlide = {
  /** Title text rendered as the slide title. */
  title: string
  /** Optional body text. */
  body?: string
}

const CONTENT_TYPES_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/>
  <Override PartName="/ppt/slideMasters/slideMaster1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideMaster+xml"/>
  <Override PartName="/ppt/slideLayouts/slideLayout1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideLayout+xml"/>
</Types>`

const ROOT_RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="ppt/presentation.xml"/>
</Relationships>`

const PRESENTATION_XML = (slideCount: number): string => `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:presentation xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">
  <p:sldMasterIdLst>
    <p:sldMasterId id="2147483648" r:id="rIdMaster1"/>
  </p:sldMasterIdLst>
  <p:sldIdLst>${Array.from({ length: slideCount }, (_, index) => `<p:sldId id="${256 + index}" r:id="rIdSlide${index + 1}"/>`).join("")}
  </p:sldIdLst>
</p:presentation>`

const PRESENTATION_RELS = (slideCount: number): string => {
  const relationships = [
    `<Relationship Id="rIdMaster1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideMaster" Target="slideMasters/slideMaster1.xml"/>`,
    ...Array.from({ length: slideCount }, (_, index) =>
      `<Relationship Id="rIdSlide${index + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide${index + 1}.xml"/>`
    ),
  ]
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
${relationships.join("\n")}
</Relationships>`
}

const SLIDE_MASTER_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sldMaster xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">
  <p:cSld><p:spTree><p:nvGrpSpPr/></p:spTree></p:cSld>
  <p:clrMap bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink"/>
</p:sldMaster>`

const SLIDE_LAYOUT_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sldLayout xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" type="title">
  <p:cSld name="Title"><p:spTree><p:nvGrpSpPr/></p:spTree></p:cSld>
</p:sldLayout>`

const escapeXml = (text: string): string =>
  text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")

const SLIDE_XML = (slide: PptxSlide): string => {
  const body = slide.body
    ? `<p:sp><p:nvSpPr><p:cNvPr id="2" name="Body"/><p:cNvSpPr txBox="1"/><p:nvPr/></p:nvSpPr><p:spPr/><p:txBody><a:bodyPr/><a:p><a:r><a:rPr lang="en-US"/><a:t>${escapeXml(slide.body)}</a:t></a:r></a:p></p:txBody></p:sp>`
    : ""
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">
  <p:cSld><p:spTree>
    <p:sp><p:nvSpPr><p:cNvPr id="1" name="Title"/><p:cNvSpPr><a:spLbl/></p:cNvSpPr><p:nvPr/></p:nvSpPr><p:spPr/><p:txBody><a:bodyPr/><a:p><a:r><a:rPr lang="en-US"/><a:t>${escapeXml(slide.title)}</a:t></a:r></a:p></p:txBody></p:sp>
    ${body}
  </p:spTree></p:cSld>
  <p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr>
</p:sld>`
}

/** Builds the bytes of a minimal but valid PPTX package. */
export function buildPptxBytes(slides: readonly PptxSlide[]): Uint8Array {
  const enc = new TextEncoder()
  const entries: ZipBinaryEntry[] = [
    { name: "[Content_Types].xml", content: enc.encode(CONTENT_TYPES_XML) },
    { name: "_rels/.rels", content: enc.encode(ROOT_RELS) },
    { name: "ppt/presentation.xml", content: enc.encode(PRESENTATION_XML(slides.length)) },
    { name: "ppt/_rels/presentation.xml.rels", content: enc.encode(PRESENTATION_RELS(slides.length)) },
    { name: "ppt/slideMasters/slideMaster1.xml", content: enc.encode(SLIDE_MASTER_XML) },
    { name: "ppt/slideLayouts/slideLayout1.xml", content: enc.encode(SLIDE_LAYOUT_XML) },
  ]
  for (let index = 0; index < slides.length; index += 1) {
    const slide = slides[index]
    if (!slide) continue
    entries.push({ name: `ppt/slides/slide${index + 1}.xml`, content: enc.encode(SLIDE_XML(slide)) })
  }
  return createStoredZipFromBytes(entries)
}

/**
 * Self-test: build a PPTX, then read it back through the studio's
 * own preview function. The check refuses to ship a package the
 * studio cannot read.
 */
export function buildPptxBytesAndPreview(slides: readonly PptxSlide[]): { bytes: Uint8Array; preview: ReturnType<typeof previewArtifact> } {
  const bytes = buildPptxBytes(slides)
  const preview = previewArtifact("pptx", bytes)
  return { bytes, preview }
}

/** The list of entries produced by `buildPptxBytes`, useful for tests. */
export function buildPptxEntries(slides: readonly PptxSlide[]): readonly ZipBinaryEntry[] {
  const bytes = buildPptxBytes(slides)
  return readStoredZip(bytes)
}
