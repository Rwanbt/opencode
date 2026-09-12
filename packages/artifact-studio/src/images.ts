/* SPDX-License-Identifier: MIT */

/**
 * Metadata stripping for images embedded in a document — Plan V3 §26.
 *
 * `stripFormatMetadata` removed `docProps/` and stopped there, which is the
 * wrong stopping point: a .docx keeps its pictures under `word/media/`, and a
 * phone JPEG carries GPS coordinates, a capture timestamp and often a camera
 * serial in its EXIF. Removing the author name from the package while shipping
 * the photograph's location is a worse outcome than not stripping at all,
 * because the caller now believes the document was sanitised.
 *
 * Only JPEG and PNG are handled. Anything else is reported as *not* sanitised
 * rather than passed off as clean — same rule as the PDF `/Info` refusal.
 */

const JPEG_SOI = 0xd8
const JPEG_EOI = 0xd9
const JPEG_SOS = 0xda

/**
 * JPEG application segments that carry descriptive metadata.
 *
 * APP0 (JFIF), APP2 (ICC profile) and APP14 (Adobe colour transform) are
 * deliberately absent: they are structural. Dropping APP14 in particular
 * changes how a CMYK/YCCK image decodes, so "strip everything that looks
 * optional" would corrupt colours to remove nothing.
 */
const JPEG_METADATA_MARKERS = new Set([
  0xe1, // APP1  — EXIF and XMP
  0xec, // APP12 — Ducky / picture info
  0xed, // APP13 — IPTC, Photoshop IRB
  0xfe, // COM   — free-text comment
])

/** PNG ancillary chunks that carry text, time or EXIF. */
const PNG_METADATA_CHUNKS = new Set(["tEXt", "zTXt", "iTXt", "eXIf", "tIME"])

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]

export type ImageStripResult = { content: Uint8Array; removed: readonly string[] }

export const isJpeg = (bytes: Uint8Array): boolean => bytes.length > 3 && bytes[0] === 0xff && bytes[1] === JPEG_SOI
export const isPng = (bytes: Uint8Array): boolean => bytes.length > 8 && PNG_SIGNATURE.every((byte, index) => bytes[index] === byte)
export const isSupportedImage = (bytes: Uint8Array): boolean => isJpeg(bytes) || isPng(bytes)

/**
 * Rewrites a JPEG without its metadata segments.
 *
 * Entropy-coded data after SOS is copied verbatim: it is not segment-framed, so
 * walking past SOS looking for markers would find `0xFF` bytes inside the
 * compressed stream and cut the image in half.
 */
function stripJpeg(bytes: Uint8Array): ImageStripResult {
  const output: number[] = [0xff, JPEG_SOI]
  const removed: string[] = []
  let index = 2
  while (index + 1 < bytes.length) {
    if (bytes[index] !== 0xff) break
    const marker = bytes[index + 1]!
    if (marker === JPEG_EOI) {
      output.push(0xff, marker)
      index += 2
      continue
    }
    if (marker === JPEG_SOS) {
      for (let rest = index; rest < bytes.length; rest += 1) output.push(bytes[rest]!)
      return { content: Uint8Array.from(output), removed }
    }
    if (index + 3 >= bytes.length) break
    const length = (bytes[index + 2]! << 8) | bytes[index + 3]!
    const end = index + 2 + length
    if (length < 2 || end > bytes.length) break
    if (JPEG_METADATA_MARKERS.has(marker)) {
      removed.push(`APP${(marker & 0x0f).toString()}:0x${marker.toString(16)}`)
    } else {
      for (let copy = index; copy < end; copy += 1) output.push(bytes[copy]!)
    }
    index = end
  }
  return { content: Uint8Array.from(output), removed }
}

/**
 * Rewrites a PNG without its text, time and EXIF chunks.
 *
 * No checksum work is needed: a PNG CRC covers only its own chunk, so removing
 * a whole chunk leaves every remaining CRC valid.
 */
function stripPng(bytes: Uint8Array): ImageStripResult {
  const output: number[] = [...PNG_SIGNATURE]
  const removed: string[] = []
  // Chunk types are four ASCII letters by specification, so they are read byte
  // by byte rather than through a decoder — no encoding question arises.
  const chunkType = (at: number): string => String.fromCharCode(bytes[at]!, bytes[at + 1]!, bytes[at + 2]!, bytes[at + 3]!)
  let index = PNG_SIGNATURE.length
  while (index + 8 <= bytes.length) {
    const length = (bytes[index]! << 24) | (bytes[index + 1]! << 16) | (bytes[index + 2]! << 8) | bytes[index + 3]!
    const type = chunkType(index + 4)
    const end = index + 12 + length
    if (length < 0 || end > bytes.length) break
    if (PNG_METADATA_CHUNKS.has(type)) removed.push(type)
    else for (let copy = index; copy < end; copy += 1) output.push(bytes[copy]!)
    index = end
    if (type === "IEND") break
  }
  return { content: Uint8Array.from(output), removed }
}

/**
 * Strips metadata from one embedded image.
 *
 * @returns the rewritten bytes, or `undefined` when the format is not one this
 * module can parse — the caller must treat that as "not sanitised", never as
 * "nothing to remove".
 */
export function stripImageMetadata(bytes: Uint8Array): ImageStripResult | undefined {
  if (isJpeg(bytes)) return stripJpeg(bytes)
  if (isPng(bytes)) return stripPng(bytes)
  return undefined
}
