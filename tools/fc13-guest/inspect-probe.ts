// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Unifia contributors
// FC-13 inspect-boot probe with FULL console transcript.
import { bootGuest, waitForPattern } from "./qemu-boot.ts"
import { join } from "node:path"
import { tmpdir } from "node:os"

const root = join(import.meta.dir, "..", "..", ".tools", "fc13")
const store = join(tmpdir(), `fc13-probe-${Date.now()}.raw`)
require("node:fs").writeFileSync(store, Buffer.alloc(64 * 1024 * 1024))
const payloadDir = join(root, "payload").replace(/\\/g, "/")

const writeBoot = bootGuest({ store, payloadDir, mode: "write", scenario: "ctrl", iteration: "probe" })
await waitForPattern(writeBoot, "FC13-READY ctrl iter=probe", 240_000)
console.log("READY ok; killing")
writeBoot.kill()

const inspectBoot = bootGuest({ store, payloadDir, mode: "inspect", scenario: "ctrl", iteration: "probe" })
const text = await waitForPattern(inspectBoot, "FC13-DONE", 180_000).catch(async (e) => {
  console.log("INSPECT-FAILED: " + String(e).slice(0, 200))
  console.log("--- transcript tail ---")
  console.log(inspectBoot.transcript().split("\n").slice(-25).join("\n"))
  process.exit(1)
})
console.log("--- inspect transcript tail ---")
console.log(String(text).split("\n").slice(-25).join("\n"))
inspectBoot.kill()
try { require("node:fs").rmSync(store, { force: true }) } catch {}
process.exit(0)
