/* SPDX-License-Identifier: MIT */

/**
 * Stored-ZIP primitives shared by every OOXML surface.
 *
 * Extracted from workers/ooxml.ts because they are format infrastructure, not
 * OOXML specifics: the artefact studio reads and rewrites packages with them
 * too, and duplicating a ZIP writer is how two subtly different archives start
 * being produced.
 *
 * Only the stored (method 0) subset is supported, deliberately: no inflate
 * means no decompression bomb, and the sizes in the directory can be trusted
 * against the bytes actually present.
 */

type ZipEntry = { name: string; content: string }
export type ZipBinaryEntry = { name: string; content: Uint8Array }

const crc32 = (bytes: Uint8Array): number => {
  let value = 0xffffffff
  for (const byte of bytes) {
    value ^= byte
    for (let bit = 0; bit < 8; bit += 1) value = (value >>> 1) ^ ((value & 1) ? 0xedb88320 : 0)
  }
  return (value ^ 0xffffffff) >>> 0
}
const u16 = (value: number): Uint8Array => Uint8Array.from([value & 255, (value >>> 8) & 255])
const u32 = (value: number): Uint8Array => Uint8Array.from([value & 255, (value >>> 8) & 255, (value >>> 16) & 255, (value >>> 24) & 255])
const join = (...parts: Uint8Array[]): Uint8Array => {
  const result = new Uint8Array(parts.reduce((total, part) => total + part.length, 0))
  let offset = 0
  for (const part of parts) { result.set(part, offset); offset += part.length }
  return result
}

const assertSafeName = (name: string): void => {
  if (!name || name.includes("..") || name.startsWith("/") || name.includes("\\")) throw new Error("unsafe ZIP entry name")
}

export const createStoredZipFromBytes = (entries: readonly ZipBinaryEntry[]): Uint8Array => {
  const encoder = new TextEncoder()
  const local: Uint8Array[] = []
  const central: Uint8Array[] = []
  let offset = 0
  for (const entry of entries) {
    assertSafeName(entry.name)
    const name = encoder.encode(entry.name)
    const content = entry.content
    const crc = crc32(content)
    const header = join(u32(0x04034b50), u16(20), u16(0), u16(0), u16(0), u16(0), u32(crc), u32(content.length), u32(content.length), u16(name.length), u16(0), name, content)
    local.push(header)
    central.push(join(u32(0x02014b50), u16(20), u16(20), u16(0), u16(0), u16(0), u16(0), u32(crc), u32(content.length), u32(content.length), u16(name.length), u16(0), u16(0), u16(0), u16(0), u32(0), u32(offset), name))
    offset += header.length
  }
  const localBytes = join(...local)
  const centralBytes = join(...central)
  const end = join(u32(0x06054b50), u16(0), u16(0), u16(entries.length), u16(entries.length), u32(centralBytes.length), u32(localBytes.length), u16(0))
  return join(localBytes, centralBytes, end)
}

export const createStoredZip = (entries: readonly ZipEntry[]): Uint8Array => {
  const encoder = new TextEncoder()
  return createStoredZipFromBytes(entries.map((entry) => ({ name: entry.name, content: encoder.encode(entry.content) })))
}

export type ZipInspection = { entries: string[]; totalUncompressedBytes: number }

type CentralEntry = { name: string; localOffset: number; size: number }

function scanCentralDirectory(input: Uint8Array, limits: { maxEntries?: number; maxUncompressedBytes?: number }): { entries: CentralEntry[]; total: number } {
  const maxEntries = limits.maxEntries ?? 128
  const maxUncompressedBytes = limits.maxUncompressedBytes ?? 32 * 1024 * 1024
  const view = new DataView(input.buffer, input.byteOffset, input.byteLength)
  let end = -1
  for (let index = input.byteLength - 22; index >= Math.max(0, input.byteLength - 65557); index -= 1) if (view.getUint32(index, true) === 0x06054b50) { end = index; break }
  if (end < 0) throw new Error("ZIP end record is missing")
  const count = view.getUint16(end + 10, true)
  const centralSize = view.getUint32(end + 12, true)
  const centralOffset = view.getUint32(end + 16, true)
  if (count > maxEntries || centralOffset + centralSize > input.byteLength) throw new Error("ZIP structure exceeds safety limits")
  const decoder = new TextDecoder()
  const entries: CentralEntry[] = []
  let cursor = centralOffset
  let total = 0
  for (let index = 0; index < count; index += 1) {
    if (cursor + 46 > input.byteLength || view.getUint32(cursor, true) !== 0x02014b50) throw new Error("ZIP central directory is invalid")
    const flags = view.getUint16(cursor + 8, true)
    const method = view.getUint16(cursor + 10, true)
    const compressed = view.getUint32(cursor + 20, true)
    const uncompressed = view.getUint32(cursor + 24, true)
    const nameLength = view.getUint16(cursor + 28, true)
    const extraLength = view.getUint16(cursor + 30, true)
    const commentLength = view.getUint16(cursor + 32, true)
    const localOffset = view.getUint32(cursor + 42, true)
    if (flags !== 0 || method !== 0 || localOffset + 30 > input.byteLength || compressed !== uncompressed || total + uncompressed > maxUncompressedBytes) throw new Error("ZIP entry violates safety limits")
    const name = decoder.decode(input.slice(cursor + 46, cursor + 46 + nameLength))
    assertSafeName(name)
    if (view.getUint32(localOffset, true) !== 0x04034b50) throw new Error("ZIP local header is invalid")
    entries.push({ name, localOffset, size: uncompressed })
    total += uncompressed
    cursor += 46 + nameLength + extraLength + commentLength
  }
  if (cursor !== centralOffset + centralSize) throw new Error("ZIP central directory length mismatch")
  return { entries, total }
}

export const inspectStoredZip = (input: Uint8Array, limits: { maxEntries?: number; maxUncompressedBytes?: number } = {}): ZipInspection => {
  const { entries, total } = scanCentralDirectory(input, limits)
  return { entries: entries.map((entry) => entry.name), totalUncompressedBytes: total }
}

/** Reads every entry's bytes. Validates the archive with the same limits as inspection. */
export const readStoredZip = (input: Uint8Array, limits: { maxEntries?: number; maxUncompressedBytes?: number } = {}): ZipBinaryEntry[] => {
  const view = new DataView(input.buffer, input.byteOffset, input.byteLength)
  return scanCentralDirectory(input, limits).entries.map((entry) => {
    const nameLength = view.getUint16(entry.localOffset + 26, true)
    const extraLength = view.getUint16(entry.localOffset + 28, true)
    const start = entry.localOffset + 30 + nameLength + extraLength
    if (start + entry.size > input.byteLength) throw new Error("ZIP entry data extends past the archive")
    return { name: entry.name, content: input.slice(start, start + entry.size) }
  })
}
