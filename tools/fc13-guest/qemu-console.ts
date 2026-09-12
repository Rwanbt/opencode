// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Unifia contributors

// FC-13 QEMU console driver — boots the Alpine live ISO headless (serial
// console over stdio pipes), logs in as root, and executes commands.
// The VM is later hard-killed by the orchestrator (TerminateProcess on
// the QEMU process = virtual machine power loss; the guest never shuts
// down, no graceful flush is triggered).
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process"

export const QEMU = new URL("../../../../.tools/qemu/qemu-system-x86_64.exe", import.meta.url).pathname.replace(/^\//, "").replace(/\//g, "\\")

export interface GuestHandle {
  proc: ChildProcessWithoutNullStreams
  run(command: string, opts?: { settleMs?: number }): Promise<string>
  kill(): void
}

export async function bootGuest(opts: { storeDisk: string; payloadDir?: string; iso: string; kernel: string; initrd: string }): Promise<GuestHandle> {
  const args = [
    "-m", "512",
    "-kernel", opts.kernel,
    "-initrd", opts.initrd,
    "-append", "console=ttyS0 modules=loop,squashfs,sd-mod,usb-storage quiet",
    "-cdrom", opts.iso,
    "-drive", `file=${opts.storeDisk},if=virtio,cache=directsync,format=raw`,
    "-nic", "user",
    "-nographic",
  ]
  if (opts.payloadDir) args.push("-drive", `file=fat:${opts.payloadDir},if=virtio,format=raw,readonly=on`)
  const proc = spawn(QEMU, args, { stdio: ["pipe", "pipe", "pipe"] })
  let buffer = ""
  const waiters: { pattern: RegExp; resolve: (text: string) => void }[] = []
  proc.stdout.on("data", (chunk: Buffer) => {
    buffer += chunk.toString("utf8")
    for (const waiter of [...waiters]) {
      if (waiter.pattern.test(buffer)) {
        waiters.splice(waiters.indexOf(waiter), 1)
        const text = buffer
        buffer = ""
        waiter.resolve(text)
      }
    }
  })
  proc.stderr.on("data", (chunk: Buffer) => { buffer += chunk.toString("utf8") })
  const run = (command: string, opts2?: { settleMs?: number }): Promise<string> =>
    new Promise<string>((resolve) => {
      const settle = opts2?.settleMs ?? 800
      const pattern = new RegExp(`[\\s\\S]*${command.slice(0, 24).replace(/[.*+?^${}()|[\\]\\\\]/g, "\\\\$&")}.*(?:#|$)`, "s")
      waiters.push({ pattern, resolve: (text) => setTimeout(() => resolve(text), settle) })
      proc.stdin.write(command + "\n")
    })
  // Wait for the login prompt, log in as root (no password on live Alpine).
  await new Promise<void>((resolve) => {
    const timer = setTimeout(() => resolve(), 120_000)
    const check = setInterval(() => {
      if (buffer.includes("login:")) { clearTimeout(timer); clearInterval(check); resolve() }
    }, 250)
  })
  await new Promise((resolve) => setTimeout(resolve, 500))
  proc.stdin.write("root\n")
  await new Promise((resolve) => setTimeout(resolve, 1500))
  buffer = ""
  return { proc, run, kill: () => { try { proc.kill("SIGKILL") } catch { /* noop */ } } }
}
