/* SPDX-License-Identifier: MIT */
/* Copyright (c) 2026 Unifia contributors */

/** Shared real external-effect provider process (master plan section 28).
 *
 * One OS process, its own durable SQLite journal, real HTTP transport.
 * Every finalist dispatches against the SAME endpoints; the journal is
 * inspected independently of any candidate state.
 */

import { spawn, type ChildProcess } from "node:child_process"
import { join, resolve as pathResolve } from "node:path"

const PROVIDER_SCRIPT = pathResolve(import.meta.dir, "..", "..", "..", "..", "..", "tools", "fake-provider-process", "main.ts")

export interface RealProviderProcess {
  readonly baseUrl: string
  readonly pid: number
  stop(): void
}

/** Spawn the provider OS process and wait for its bind address on stdout. */
export async function startRealProviderProcess(journalDir: string): Promise<RealProviderProcess> {
  const child: ChildProcess = spawn(process.execPath, ["run", PROVIDER_SCRIPT], {
    env: { ...process.env, FAKE_PROVIDER_JOURNAL_DIR: journalDir },
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  })
  let stderrBuf = ""
  const baseUrl = await new Promise<string>((resolve, reject) => {
    const timer = setTimeout(() => {
      try { child.kill() } catch { /* noop */ }
      reject(new Error("fake provider process did not bind within 30s (stderr=" + stderrBuf + ")"))
    }, 30_000)
    child.stdout?.on("data", (chunk: Buffer) => {
      const match = chunk.toString("utf8").match(/http:\/\/127\.0\.0\.1:\d+/)
      if (match) { clearTimeout(timer); resolve(match[0]) }
    })
    child.stderr?.on("data", (chunk: Buffer) => { stderrBuf += chunk.toString("utf8") })
    child.once("exit", (code) => {
      clearTimeout(timer)
      reject(new Error("fake provider process exited early (code=" + code + ", stderr=" + stderrBuf + ")"))
    })
  })
  return { baseUrl, pid: child.pid ?? 0, stop: () => { try { child.kill() } catch { /* noop */ } } }
}
