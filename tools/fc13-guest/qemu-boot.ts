// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Unifia contributors
// FC-13 QEMU boot helper: boots the guest once and waits for a console pattern. Used by smoke-test and the qualification loops.
import { spawn, type ChildProcess } from "node:child_process"
import { join } from "node:path"

const root = join(import.meta.dir, "..", "..", ".tools", "fc13")
const QEMU = join(root, "..", "qemu", "qemu-system-x86_64.exe")

export interface BootOptions {
  store: string
  payloadDir: string
  mode: string
  scenario: string
  iteration: string
  runId?: string
  memoryMb?: number
}

export interface GuestBoot {
  proc: ChildProcess
  transcript: () => string
  kill: () => void
}

export function bootGuest(opts: BootOptions): GuestBoot {
  const extra = opts.runId ? ` fc13_runid=${opts.runId}` : ""
  const args = [
    "-m", String(opts.memoryMb ?? 512),
    "-accel", "tcg,tb-size=128",
    "-cpu", "max,-tsc-deadline",
    "-kernel", join(root, "kernel", "vmlinuz-virt"),
    "-initrd", join(root, "initramfs-patched.gz"),
    "-append", `console=ttyS0 noapic fc13_mode=${opts.mode} fc13_scenario=${opts.scenario} fc13_iteration=${opts.iteration}${extra} quiet`,
    "-drive", `file=${opts.store},if=virtio,cache=directsync,format=raw`,
    `-drive`, `file=fat:rw:${opts.payloadDir},if=virtio,format=raw`,
    "-nic", "user",
    "-nographic",
  ]
  const proc = spawn(QEMU, args, { stdio: ["ignore", "pipe", "pipe"] })
  let text = ""
  proc.stdout?.on("data", (chunk: Buffer) => { text += chunk.toString("utf8") })
  proc.stderr?.on("data", (chunk: Buffer) => { text += chunk.toString("utf8") })
  return { proc, transcript: () => text, kill: () => { try { proc.kill("SIGKILL") } catch {} } }
}

export function waitForPattern(guest: GuestBoot, pattern: string, timeoutMs: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { guest.kill(); reject(new Error("timeout waiting for " + pattern)) }, timeoutMs)
    const poll = setInterval(() => {
      if (guest.transcript().includes(pattern)) { clearTimeout(timer); clearInterval(poll); resolve(guest.transcript()) }
    }, 200)
    guest.proc.once("exit", () => {
      clearTimeout(timer); clearInterval(poll)
      if (guest.transcript().includes(pattern)) resolve(guest.transcript())
      else reject(new Error("guest exited while waiting for " + pattern))
    })
  })
}
