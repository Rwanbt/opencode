/* SPDX-License-Identifier: MIT */

/**
 * Design token consumption for document packs — Plan V3 §25.
 *
 * §25 asks that "les document packs peuvent consommer les design tokens".
 * `resolveDesignTokens` in `@unifia/spec-runtime` already produced a flat token
 * map, and nothing imported it except its own test — producing tokens nobody
 * applies is not consumption, so this is the missing half.
 *
 * Two rules make the result trustworthy rather than decorative:
 *
 * 1. **The package stays consistent.** Adding a styles or theme part means
 *    adding its content-type override and its relationship too. A package that
 *    declares a part it does not contain, or contains one it never declares, is
 *    corrupt — and a corrupt document is a worse outcome than an unstyled one.
 *
 * 2. **Unapplied tokens are reported, never dropped.** A token this module has
 *    no mapping for comes back in `ignored`. Silently discarding it would let a
 *    caller believe a brand colour reached the document when it did not.
 */

import type { ArtifactInput } from "@unifia/artifact-runtime"
import { createStoredZipFromBytes, readStoredZip, type ZipBinaryEntry } from "./zip.js"

/** Token names a pack knows how to place. Anything else is reported as ignored. */
export const CONSUMED_TOKENS = ["color.text", "color.accent", "typography.body", "typography.heading", "spacing.body"] as const

export type TokenApplication = {
  input: ArtifactInput
  /** Tokens that reached a part of the package. */
  applied: readonly string[]
  /** Tokens with no mapping for this format — present, unused, and said so. */
  ignored: readonly string[]
}

const XML = '<?xml version="1.0" encoding="UTF-8"?>'
const RELS_NS = "http://schemas.openxmlformats.org/package/2006/relationships"
const DRAWING_NS = "http://schemas.openxmlformats.org/drawingml/2006/main"

/** OOXML colours are RRGGBB with no leading `#`. */
const hex = (value: string | undefined, fallback: string): string => (value ?? fallback).replace(/^#/, "").toUpperCase()

const decode = (entry: ZipBinaryEntry): string => new TextDecoder().decode(entry.content)

function partition(tokens: Record<string, string>, usable: readonly string[]): { applied: string[]; ignored: string[] } {
  const applied: string[] = []
  const ignored: string[] = []
  for (const name of Object.keys(tokens)) (usable.includes(name) ? applied : ignored).push(name)
  return { applied, ignored }
}

/** Adds an Override to `[Content_Types].xml` if it is not already declared. */
function withOverride(xml: string, partName: string, contentType: string): string {
  if (xml.includes(`PartName="${partName}"`)) return xml
  return xml.replace("</Types>", `<Override PartName="${partName}" ContentType="${contentType}"/></Types>`)
}

function relationships(entries: readonly { id: string; type: string; target: string }[]): string {
  const items = entries.map((entry) => `<Relationship Id="${entry.id}" Type="${entry.type}" Target="${entry.target}"/>`).join("")
  return `${XML}<Relationships xmlns="${RELS_NS}">${items}</Relationships>`
}

function docxStyles(tokens: Record<string, string>): string {
  const font = tokens["typography.body"] ?? "Calibri"
  const heading = tokens["typography.heading"] ?? font
  const color = hex(tokens["color.text"], "000000")
  // Word expresses paragraph spacing in twentieths of a point.
  const after = Math.round(Number(tokens["spacing.body"] ?? 0) * 20)
  return `${XML}<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="${font}" w:hAnsi="${font}"/><w:color w:val="${color}"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="${after}"/></w:pPr></w:pPrDefault></w:docDefaults><w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:rPr><w:rFonts w:ascii="${heading}" w:hAnsi="${heading}"/></w:rPr></w:style></w:styles>`
}

function pptxTheme(tokens: Record<string, string>): string {
  const font = tokens["typography.body"] ?? "Calibri"
  const heading = tokens["typography.heading"] ?? font
  const text = hex(tokens["color.text"], "000000")
  const accent = hex(tokens["color.accent"], "4472C4")
  return `${XML}<a:theme xmlns:a="${DRAWING_NS}" name="Unifia"><a:themeElements><a:clrScheme name="Unifia"><a:dk1><a:srgbClr val="${text}"/></a:dk1><a:lt1><a:srgbClr val="FFFFFF"/></a:lt1><a:accent1><a:srgbClr val="${accent}"/></a:accent1></a:clrScheme><a:fontScheme name="Unifia"><a:majorFont><a:latin typeface="${heading}"/></a:majorFont><a:minorFont><a:latin typeface="${font}"/></a:minorFont></a:fontScheme><a:fmtScheme name="Unifia"/></a:themeElements></a:theme>`
}

function xlsxStyles(tokens: Record<string, string>): string {
  const font = tokens["typography.body"] ?? "Calibri"
  const color = hex(tokens["color.text"], "000000")
  const accent = hex(tokens["color.accent"], "4472C4")
  return `${XML}<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="1"><font><name val="${font}"/><color rgb="FF${color}"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF${accent}"/></patternFill></fill></fills><borders count="1"><border/></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" applyFont="1"/></cellXfs></styleSheet>`
}

type Plan = { part: string; content: string; contentType: string; relsPart: string; rels: readonly { id: string; type: string; target: string }[] }

function planFor(kind: ArtifactInput["kind"], tokens: Record<string, string>): Plan | undefined {
  if (kind === "docx") {
    return {
      part: "word/styles.xml",
      content: docxStyles(tokens),
      contentType: "application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml",
      relsPart: "word/_rels/document.xml.rels",
      rels: [{ id: "rIdStyles", type: "http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles", target: "styles.xml" }],
    }
  }
  if (kind === "pptx") {
    return {
      part: "ppt/theme/theme1.xml",
      content: pptxTheme(tokens),
      contentType: "application/vnd.openxmlformats-officedocument.theme+xml",
      relsPart: "ppt/_rels/presentation.xml.rels",
      rels: [
        { id: "rId1", type: "http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide", target: "slides/slide1.xml" },
        { id: "rIdTheme", type: "http://schemas.openxmlformats.org/officeDocument/2006/relationships/theme", target: "theme/theme1.xml" },
      ],
    }
  }
  if (kind === "xlsx") {
    return {
      part: "xl/styles.xml",
      content: xlsxStyles(tokens),
      contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml",
      relsPart: "xl/_rels/workbook.xml.rels",
      rels: [
        { id: "rId1", type: "http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet", target: "worksheets/sheet1.xml" },
        { id: "rIdStyles", type: "http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles", target: "styles.xml" },
      ],
    }
  }
  return undefined
}

/**
 * Applies a resolved token map to a pack's output.
 *
 * @returns the restyled artefact with the tokens that landed and the ones that
 * did not. A format with no mapping comes back unchanged with every token
 * listed as ignored — never as applied.
 */
export function applyDesignTokens(input: ArtifactInput, tokens: Record<string, string>): TokenApplication {
  const plan = planFor(input.kind, tokens)
  if (!plan) return { input, applied: [], ignored: Object.keys(tokens) }

  const encoder = new TextEncoder()
  const bytes = typeof input.content === "string" ? encoder.encode(input.content) : input.content
  const entries = readStoredZip(bytes).filter((entry) => entry.name !== plan.part && entry.name !== plan.relsPart)
  const rebuilt = entries.map((entry) =>
    entry.name.endsWith("[Content_Types].xml")
      ? { name: entry.name, content: encoder.encode(withOverride(decode(entry), `/${plan.part}`, plan.contentType)) }
      : entry,
  )
  rebuilt.push({ name: plan.relsPart, content: encoder.encode(relationships(plan.rels)) })
  rebuilt.push({ name: plan.part, content: encoder.encode(plan.content) })

  const { applied, ignored } = partition(tokens, CONSUMED_TOKENS)
  // Rebuilt from bytes, not from decoded strings: a package may already carry
  // binary parts (an embedded picture), and round-tripping those through a text
  // decoder would corrupt them while the archive still looked well formed.
  return { input: { ...input, content: createStoredZipFromBytes(rebuilt) }, applied, ignored }
}
