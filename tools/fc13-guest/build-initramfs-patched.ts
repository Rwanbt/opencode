// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Unifia contributors
//
// Byte-splice builder: patch the OFFICIAL Alpine initramfs by replacing
// its /init entry data with the FC-13 guest script. The official cpio
// structure is kept byte-for-byte (proven to boot); only the init entry
// data changes. This eliminates every residual archive-format divergence:
// the kernel parses its own proven layout with one patched file.
import { writeFileSync, readFileSync } from "node:fs"
import { gunzipSync, gzipSync } from "node:zlib"

const root = "D:/App/unifia/.worktrees/rev3m-20260901/design/.tools/fc13"
const official = gunzipSync(readFileSync(root + "/kernel/initramfs-virt"))

function pad(n: number): number { return (4 - (n % 4)) % 4 }
function hex8(value: number): string { return value.toString(16).padStart(8, "0") }
function entryNext(buf: Buffer, offset: number): number {
  const f = buf.slice(offset + 6, offset + 110).toString("ascii").match(/.{8}/g) ?? []
  const namesize = parseInt(f[11], 16)
  const filesize = parseInt(f[6], 16)
  const headerEnd = offset + 110 + namesize
  const dataStart = headerEnd + ((4 - (headerEnd % 4)) % 4)
  return dataStart + filesize + ((4 - ((dataStart + filesize) % 4)) % 4)
}

// walk to the init entry
let offset = 0
let initOffset = -1
while (offset < official.length) {
  if (official.slice(offset, offset + 6).toString("ascii") !== "070701") throw new Error("chain broken at " + offset)
  const fields = official.slice(offset + 6, offset + 110).toString("ascii").match(/.{8}/g) ?? []
  const namesize = parseInt(fields[11], 16)
  const filesize = parseInt(fields[6], 16)
  const name = official.slice(offset + 110, offset + 110 + namesize).toString("utf8").replace(/\0.*$/, "")
  if (name === "init") { break }
  offset = entryNext(official, offset)
}
const fields = official.slice(offset + 6, offset + 110).toString("ascii").match(/.{8}/g) ?? []
const officialInitSize = parseInt(fields[6], 16)
const script = readFileSync("D:/App/unifia/.worktrees/rev3m-20260901/design/tools/fc13-guest/guest-init-spliced.sh")
if (script.length > officialInitSize) throw new Error("script too large for same-size patch")
const newInit = Buffer.concat([script, Buffer.alloc(officialInitSize - script.length)])
const dataStart = offset + 110 + 5 + ((4 - ((offset + 110 + 5) % 4)) % 4)
const dataEnd = dataStart + officialInitSize
official.write(newInit.toString("ascii"), dataStart, "binary")
const patched = official
const gz = gzipSync(patched, { level: 9, mtime: 0 })
gz[8] = 2
gz[9] = 3
writeFileSync(root + "/initramfs-patched.gz", gz)
console.log("patched initramfs: " + gz.length + " bytes")
process.exit(0)