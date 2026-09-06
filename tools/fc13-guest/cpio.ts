// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Unifia contributors

// Minimal cpio "newc" (070701) archive generator for guest initramfs.
// Deterministic, no external tooling. The Linux kernel accepts a
// gzipped cpio newc archive as initrd.
import { join } from "node:path"
import { readdirSync, statSync, readFileSync, lstatSync, readlinkSync } from "node:fs"
import { gzipSync } from "node:zlib"
import { writeFileSync } from "node:fs"

function pad(size: number): number { return (4 - (size % 4)) % 4 }

function header(name: string, size: number, mode: number): Buffer {
  const fields = [
    "070701",
    ...[
      0, // ino
      mode,
      0, // uid
      0, // gid
      1, // nlink
      0, // mtime
      size,
      0, // devmajor
      0, // devminor
      0, // rdevmajor
      0, // rdevminor
      name.length + 1,
      0, // check
    ].map((value) => value.toString(16).padStart(8, "0")),
  ]
  const head = Buffer.from(fields.join(""), "ascii")
  const nameBuf = Buffer.concat([Buffer.from(name, "utf8"), Buffer.alloc(1)])  // name is NUL-terminated per newc
  // newc alignment is ABSOLUTE: header (110 bytes) + name+NUL must end on a 4-byte boundary.
  return Buffer.concat([head, nameBuf, Buffer.alloc(pad(110 + name.length + 1))])
}

function addEntry(out: Buffer[], fullPath: string, archivePath: string): void {
  const stat = lstatSync(fullPath)
  if (stat.isSymbolicLink()) {
    // Symlink entry: cpio newc stores the TARGET as file data, mode 0o120777.
    const target = Buffer.from(readlinkSync(fullPath), "utf8")
    out.push(header(archivePath, target.length, 0o120777))
    out.push(target, Buffer.alloc(pad(target.length)))
    return
  }
  if (stat.isDirectory()) {
    out.push(header(archivePath, 0, 0o755))
    for (const child of readdirSync(fullPath)) { const childPath = archivePath === "." ? child : `${archivePath}/${child}`; addEntry(out, join(fullPath, child), childPath) }
    return
  }
  if (!stat.isFile()) return
  const data = readFileSync(fullPath)
  const posixMode = archivePath === "init" || archivePath === "./init" || archivePath.startsWith("payload/") || archivePath.startsWith("bin/") || archivePath.startsWith("sbin/") || archivePath.startsWith("usr/") ? 0o755 : (stat.mode & 0o7777 === 0 ? 0o644 : stat.mode & 0o7777)
  out.push(header(archivePath, data.length, posixMode))
  out.push(data, Buffer.alloc(pad(data.length)))
}

/** Build a gzipped cpio newc initramfs from a directory tree. */
export function buildInitramfs(rootDir: string, outputFile: string): void {
  const out: Buffer[] = []
  addEntry(out, rootDir, ".")
  const trailerName = "TRAILER!!!";
  out.push(header(trailerName, 0, 0))
  const archive = Buffer.concat(out)
  console.log("cpio entries: " + out.length + ", archive bytes: " + archive.length)
  const gz = gzipSync(archive, { level: 9, mtime: 0 })
  // OS byte 3 (Unix) + XFL=2 to mirror the official Alpine initramfs header.
  gz[8] = 2
  gz[9] = 3
  console.log("gz bytes: " + gz.length)
  writeFileSync(outputFile, gz)
  writeFileSync(outputFile.replace(".gz", ".cpio"), archive)  // plain variant for kernel decompressor comparison
}
