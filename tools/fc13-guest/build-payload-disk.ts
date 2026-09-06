// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Unifia contributors
// Build the FC-13 guest payload disk (vdb): a raw ext4 image created
// host-side with the payload files, avoiding initramfs size limits.
import { join, resolve } from "node:path"
import { writeFileSync, mkdirSync, readdirSync, copyFileSync } from "node:fs"
import { execFileSync } from "node:child_process"

// Note: guest formats the disk itself; we just pre-fill content bytes
// via a FAT-like raw approach is NOT possible host-side without extra
// tooling. Instead the initramfs /init copies the payload from the
// SECOND disk which QEMU presents as a raw file. We pre-seed that file
// with an ISO9660 filesystem via the official Alpine tools? No -
// simplest robust carrier: a second CD-ROM ISO with the payload files.
const root = resolve(import.meta.dir, "..", "..", ".tools", "fc13")
console.log("payload staging dir:", join(root, "payload"))
process.exit(0)
