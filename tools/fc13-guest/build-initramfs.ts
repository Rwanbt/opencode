// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Unifia contributors
//
// FC-13 initramfs builder: assembles the guest root (minirootfs +
// virtio/ext4 kernel modules + payload binaries + /init) and emits a
// gzipped cpio newc archive for direct kernel boot. The modloop and
// apk trees are pre-extracted host-side (see .tools/fc13).
import { join, resolve } from "node:path"
import { mkdirSync, cpSync, existsSync, rmSync, writeFileSync, statSync, readdirSync, readFileSync } from "node:fs"
import { execFileSync } from "node:child_process"
import { buildInitramfs } from "./cpio.ts"

const root = resolve(import.meta.dir, "..", "..", ".tools", "fc13")
const work = join(root, "initramfs-work")
const payloadSource = join(root, "payload")

rmSync(work, { recursive: true, force: true })
mkdirSync(work, { recursive: true })

// 1. minirootfs base (busybox + shell)
execFileSync("tar", ["-xzf", join(root, "downloads", "alpine-minirootfs-3.22.2-x86_64.tar.gz"), "-C", work], { stdio: "pipe" })

// 2. kernel modules from the pre-extracted modloop (virtio + ext4 chain)
const modulesSource = join(root, "modloop-extract", "modules")
const version = readdirSync(modulesSource).filter((entry) => entry.startsWith("6."))[0]
// Copy ONLY the modules the FC-13 boot needs: virtio block chain + ext4
// chain (+ dependency files). The full modloop is ~230 MB.
const kernelTree = join(modulesSource, version, "kernel")
const modulePaths = readdirSync(kernelTree, { recursive: true }).map(String).filter((entry) => {
  const relative = entry.replace(/\\/g, "/")
  return relative.includes("/virtio") || relative.includes("ext4") || relative.includes("/jbd2/") || relative.includes("mbcache") || relative.includes("crc32c") || relative.includes("/crc/")
})
for (const relative of modulePaths) {
  const source = join(kernelTree, relative)
  if (statSync(source).isFile()) {
    const destination = join(work, "lib", "modules", version, "kernel", relative)
    mkdirSync(join(destination, ".."), { recursive: true })
    cpSync(source, destination)
  }
}

// 3. e2fsprogs (mke2fs + libs) from the pre-extracted apks
for (const apk of ["e2fsprogs-1.47.2-r2.apk", "e2fsprogs-libs-1.47.2-r2.apk", "libcom_err-1.47.2-r2.apk"]) {
  const finalRoot = join(root, "apk-extract", apk, "final")
  if (!existsSync(finalRoot)) throw new Error(`apk not pre-extracted: ${apk}`)
  for (const segment of ["sbin", "lib", "usr"]) {
    const source = join(finalRoot, segment)
    if (existsSync(source)) cpSync(source, join(work, segment), { recursive: true })
  }
}

// 4. payload binaries ride on the SECOND virtio disk (vdb), not in the
// initramfs - keeps the compressed initrd small (kernel decompressor limit).

// 5. /init (read from the committed guest-init.sh, no interpolation)
writeFileSync(join(work, "init"), readFileSync(join(import.meta.dir, "guest-init.sh")), { mode: 0o755 })

// 6. cpio + gzip
buildInitramfs(work, join(root, "initramfs-fc13.gz"))
console.log(`initramfs: ${statSync(join(root, "initramfs-fc13.gz")).size} bytes`)
