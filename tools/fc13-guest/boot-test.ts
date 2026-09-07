// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Unifia contributors

import { bootGuest } from "./qemu-console.ts"
import { join } from "node:path"
import { existsSync, statSync, mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
const root = join(import.meta.dir, "..", "..", ".tools", "fc13")
const iso = join(root, "downloads", "alpine-virt-3.22.2-x86_64.iso")
const kernel = join(root, "kernel", "vmlinuz-virt")
const initrd = join(root, "kernel", "initramfs-virt")
const store = join(tmpdir(), `fc13-boot-test-${Date.now()}.raw`)
// pre-create a 64MB sparse raw disk
if (!existsSync(store)) { require("node:fs").writeFileSync(store, Buffer.alloc(64 * 1024 * 1024)) }
console.log("store:", store, statSync(store).size)
const guest = await bootGuest({ storeDisk: store, iso, kernel, initrd })
const whoami = await guest.run("whoami")
console.log("WHOAMI OUTPUT:", whoami.split("\n").slice(-3).join(" | "))
const uname = await guest.run("uname -a")
console.log("UNAME OUTPUT:", uname.split("\n").slice(-3).join(" | "))
const disk = await guest.run("ls -la /dev/vda 2>&1")
console.log("VDA OUTPUT:", disk.split("\n").slice(-3).join(" | "))
guest.kill()
try { rmSync(store, { force: true }) } catch {}
process.exit(0)
