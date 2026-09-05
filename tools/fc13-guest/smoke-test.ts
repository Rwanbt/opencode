// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Unifia contributors
//
// FC-13 smoke test: boot guest (write mode, ctrl scenario), observe the
// READY barrier on the console, hard-kill QEMU, reboot in inspect mode
// and read the oracle verdict. Smoke test only - not FC-13 evidence.
import { spawn } from "node:child_process"
import { mkdtempSync, rmSync, existsSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"

const root = join(import.meta.dir, "..", "..", ".tools", "fc13")
const QEMU = join(root, "..", "qemu", "qemu-system-x86_64.exe")
const payloadDisk = join(tmpdir(), `fc13-payload-${Date.now()}.raw`)
const store = join(tmpdir(), `fc13-smoke-${Date.now()}.raw`)
require("node:fs").writeFileSync(store, Buffer.alloc(64 * 1024 * 1024))
require("node:fs").writeFileSync(payloadDisk, Buffer.alloc(256 * 1024 * 1024))

function boot(mode: string, scenario: string, iteration: string) {
  const args = [
    "-m", "512",
    "-cpu", "max,-tsc-deadline",
    "-kernel", join(root, "kernel", "vmlinuz-virt"),
    "-initrd", join(root, "initramfs-fc13.gz"),
    "-append", `console=ttyS0 fc13_mode=${mode} fc13_scenario=${scenario} fc13_iteration=${iteration} quiet`,
    "-drive", `file=${store},if=virtio,cache=directsync,format=raw`,
    "-drive", `file=${payloadDisk},if=virtio,cache=writeback,format=raw`,
    "-nic", "user",
    "-nographic",
  ]
  return spawn(QEMU, args, { stdio: ["ignore", "pipe", "pipe"] })
}

function waitFor(proc: import("node:child_process").ChildProcess, pattern: string, timeoutMs: number): Promise<string> {
  return new Promise((resolve, reject) => {
    let text = ""
    const timer = setTimeout(() => { proc.kill("SIGKILL"); reject(new Error(`timeout waiting for ${pattern}; got: ${text.slice(-400)}`)) }, timeoutMs)
    proc.stdout.on("data", (chunk: Buffer) => {
      text += chunk.toString("utf8")
      if (text.includes(pattern)) { clearTimeout(timer); resolve(text) }
    })
    proc.stderr.on("data", (chunk: Buffer) => { text += chunk.toString("utf8") })
    proc.once("exit", () => { clearTimeout(timer); if (text.includes(pattern)) resolve(text); else reject(new Error(`guest exited while waiting for ${pattern}; got: ${text.slice(-400)}`)) })
  })
}

// WRITE phase: fresh disk, writer acknowledges, emits READY; host kills.
const writeBoot = boot("write", "ctrl", "smoke")
const writeStart = Date.now()
await waitFor(writeBoot, "FC13-READY ctrl iter=smoke", 240_000)
console.log(`READY observed after ${Date.now() - writeStart}ms; hard-cutting VM`)
writeBoot.kill("SIGKILL")
const cutAt = Date.now()

// INSPECT phase: same disk, read-only oracle.
const inspectBoot = boot("inspect", "ctrl", "smoke")
const text = await waitFor(inspectBoot, "FC13-RESULT ctrl iter=smoke", 180_000)
const resultLine = text.split("\n").find((line) => line.includes("FC13-RESULT"))
console.log(`RESULT: ${resultLine?.trim()} (cut->inspect ${Date.now() - cutAt}ms)`)
inspectBoot.kill("SIGKILL")
try { rmSync(store, { force: true }) } catch {}
process.exit(0)