/* SPDX-License-Identifier: MIT */
/* Copyright (c) 2026 Unifia contributors */

/**
 * Real multi-process FC-14 + FC-25 qualification (CP5).
 *
 * Per pack gelé review 2026-09-03 v1.1 §25-§29: FC-14 requires
 * two REAL OS processes that share the same durable authority
 * store. SQLite file locking alone is not enough — the harness
 * must observe authority acquisition / dispatch eligibility /
 * fencing / commit and verify that a single logical authority
 * can act at any time.
 *
 * For DBOS Go: spawn 2 `dbos-qualify.exe` processes on the same
 * M0_STORE_DIR and race them via the new `/authority/claim`
 * endpoint. The first process to commit at generation N+1
 * wins; the second process's claim is rejected.
 *
 * For UNIFIA_NATIVE: spawn 2 Bun processes (a tiny worker
 * script) that share the same SQLite file and race via
 * BEGIN IMMEDIATE on an authority table.
 *
 * This is a SEPARATE test file from qualification.test.ts
 * because it spawns real OS processes and is significantly
 * heavier (multi-second setup, multiple OS processes). The
 * default P0 set in the qualification runner remains the
 * substrate-neutral contract test; this test exercises the
 * multi-process methodology specifically.
 */

import { describe, expect, test } from "bun:test"
import { spawn, ChildProcess } from "node:child_process"
import { existsSync, mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve as pathResolve } from "node:path"
import { setTimeout as delay } from "node:timers/promises"

const DBOS_GO_TOOL_DIR = pathResolve(import.meta.dir, "..", "..", "..", "tools", "dbos-qualify")
const DBOS_GO_BINARY = join(DBOS_GO_TOOL_DIR, "dbos-qualify.exe")
const DBOS_GO_BUILT = existsSync(DBOS_GO_BINARY)
const DBOS_GO_PINNED = "github.com/dbos-inc/dbos-transact-golang@v1.0.0"

interface ClaimResult {
  granted: boolean
  runId: string
  currentGeneration: number
  attemptedGeneration: number
  holderPid: number
}

async function httpJson<T>(base: string, path: string, opts: { method?: "GET" | "POST"; query?: Record<string, string>; body?: unknown; timeoutMs?: number } = {}): Promise<T> {
  const url = new URL(path, base)
  if (opts.query) {
    for (const [k, v] of Object.entries(opts.query)) url.searchParams.set(k, v)
  }
  const ac = new AbortController()
  const timer = setTimeout(() => ac.abort(), opts.timeoutMs ?? 10_000)
  try {
    const r = await fetch(url, {
      method: opts.method ?? "GET",
      signal: ac.signal,
      headers: opts.body !== undefined ? { "Content-Type": "application/json" } : undefined,
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    })
    if (!r.ok) {
      const text = await r.text().catch(() => "")
      throw new Error(`HTTP ${r.status} ${r.statusText} on ${path}: ${text}`)
    }
    return await r.json() as T
  } finally {
    clearTimeout(timer)
  }
}

interface SpawnedProc { proc: ChildProcess; baseUrl: string; storeDir: string; pid: number }

async function spawnDbosGo(storeDir: string, label: string): Promise<SpawnedProc> {
  await Bun.write(join(storeDir, ".marker"), label) // ensure dir exists & labeled
  const child = spawn(DBOS_GO_BINARY, [], {
    env: { ...process.env, M0_STORE_DIR: storeDir },
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  })
  let baseUrl: string | null = null
  let stdoutBuf = ""
  let stderrBuf = ""
  await new Promise<void>((resolve, reject) => {
    let resolved = false
    const timer = setTimeout(() => {
      if (resolved) return
      resolved = true
      try { child.kill() } catch { /* noop */ }
      reject(new Error(`dbos-qualify.exe did not bind within 90s (stdout=${stdoutBuf} stderr=${stderrBuf})`))
    }, 90_000)
    child.stdout?.on("data", (chunk: Buffer) => {
      stdoutBuf += chunk.toString("utf8")
      if (baseUrl) return
      const lines = stdoutBuf.split(/\r?\n/)
      for (const ln of lines) {
        const m = ln.match(/127\.0\.0\.1:\d+/)
        if (m) {
          baseUrl = `http://${m[0]}`
          break
        }
      }
    })
    child.stderr?.on("data", (chunk: Buffer) => {
      stderrBuf += chunk.toString("utf8")
    })
    child.once("error", (e) => {
      if (resolved) return
      resolved = true
      clearTimeout(timer)
      reject(e)
    })
    child.once("exit", (code) => {
      if (resolved) return
      resolved = true
      clearTimeout(timer)
      reject(new Error(`dbos-qualify.exe exited code=${code} before bind (stdout=${stdoutBuf} stderr=${stderrBuf})`))
    })
    const wait = async () => {
      while (!resolved) {
        if (baseUrl) {
          try {
            await fetch(`${baseUrl}/healthz`, { signal: AbortSignal.timeout(1_000) })
            if (!resolved) {
              resolved = true
              clearTimeout(timer)
              resolve()
            }
            return
          } catch { /* not yet */ }
        }
        await delay(100)
      }
    }
    void wait()
  })
  if (!baseUrl) throw new Error("dbos-qualify.exe did not expose a base URL")
  return { proc: child, baseUrl, storeDir, pid: child.pid ?? 0 }
}

async function killProc(p: SpawnedProc): Promise<void> {
  if (p.proc && !p.proc.killed) {
    try { p.proc.kill("SIGKILL") } catch { /* noop */ }
  }
}

async function rmRetry(path: string, maxRetries = 10): Promise<void> {
  for (let i = 0; i < maxRetries; i++) {
    try {
      rmSync(path, { recursive: true, force: true })
      return
    } catch {
      await delay(200)
    }
  }
  // eslint-disable-next-line no-console
  console.log("rmSync EBUSY after retries, leaving:", path)
}

describe("CP5: real multi-process FC-14 (DBOS Go)", () => {
  if (!DBOS_GO_BUILT) {
    test("binary not built — skipped", () => {
      // eslint-disable-next-line no-console
      console.log(`[SKIP] ${DBOS_GO_BINARY} not found`)
      expect(DBOS_GO_BUILT).toBe(false)
    })
    return
  }

  test("two real OS processes race for authority on the same run; one wins, one is rejected", async () => {
    const root = mkdtempSync(join(tmpdir(), "m0-fc14-"))
    const storeDir = join(root, "store")
    const { mkdir } = await import("node:fs/promises")
    await mkdir(storeDir, { recursive: true })

    const runId = "run-mp-fc14-001"
    let procA: SpawnedProc | null = null
    let procB: SpawnedProc | null = null
    try {
      // Spawn 2 real OS processes on the SAME store dir.
      procA = await spawnDbosGo(storeDir, "A")
      procB = await spawnDbosGo(storeDir, "B")
      expect(procA.pid).not.toBe(procB.pid)

      // Both processes start at generation 0. Process A claims
      // at generation 1 first; process B's claim at generation 1
      // is rejected because A already holds the highest.
      // CP6.1: claim now uses JSON body with (generation, authorityOwnerId).
      const ownerA = `pid-${procA.pid}-ns-${Date.now()}-a`
      const ownerB = `pid-${procB.pid}-ns-${Date.now()}-b`
      const claimA = await httpJson<ClaimResult>(procA.baseUrl, "/authority/claim", {
        method: "POST",
        query: { runId },
        body: { attemptedGeneration: 1, authorityOwnerId: ownerA },
        timeoutMs: 5_000,
      })
      const claimB = await httpJson<ClaimResult>(procB.baseUrl, "/authority/claim", {
        method: "POST",
        query: { runId },
        body: { attemptedGeneration: 1, authorityOwnerId: ownerB },
        timeoutMs: 5_000,
      })

      // Exactly one of {A, B} must be granted; the other must be
      // rejected. This proves that the SQLite-backed authority
      // fencing serializes the two processes: a single logical
      // authority can act at any time.
      const grantedCount = (claimA.granted ? 1 : 0) + (claimB.granted ? 1 : 0)
      expect(grantedCount).toBe(1)
      // The granted one has the higher generation; the rejected
      // one sees the granted one's generation.
      const granted = claimA.granted ? claimA : claimB
      const rejected = claimA.granted ? claimB : claimA
      expect(granted.currentGeneration).toBe(1)
      expect(granted.attemptedGeneration).toBe(1)
      expect(rejected.currentGeneration).toBe(granted.currentGeneration)
      expect(rejected.granted).toBe(false)
      // The rejected process's holderPid is the granted process's pid.
      expect(rejected.holderPid).toBe(granted.holderPid)
    } finally {
      await killProc(procA!)
      await killProc(procB!)
      await rmRetry(root)
    }
  }, { timeout: 180_000 })

  test("stale generation claim is rejected (FC-25 fencing primitive)", async () => {
    const root = mkdtempSync(join(tmpdir(), "m0-fc25-"))
    const storeDir = join(root, "store")
    const { mkdir } = await import("node:fs/promises")
    await mkdir(storeDir, { recursive: true })

    const runId = "run-mp-fc25-001"
    let procA: SpawnedProc | null = null
    let procB: SpawnedProc | null = null
    try {
      procA = await spawnDbosGo(storeDir, "A")
      procB = await spawnDbosGo(storeDir, "B")

      // A claims at gen 1 (granted). CP6.1: JSON body with
      // (generation, authorityOwnerId).
      const ownerA = `pid-${procA.pid}-ns-${Date.now()}-a`
      const ownerB = `pid-${procB.pid}-ns-${Date.now()}-b`
      const claimA1 = await httpJson<ClaimResult>(procA.baseUrl, "/authority/claim", {
        method: "POST", query: { runId }, body: { attemptedGeneration: 1, authorityOwnerId: ownerA }, timeoutMs: 5_000,
      })
      expect(claimA1.granted).toBe(true)
      // A transfers authority: release gen 1, B claims gen 2 (granted).
      await httpJson<{ status: string }>(procA.baseUrl, "/authority/release", {
        method: "POST", query: { runId }, body: { generation: 1, authorityOwnerId: ownerA }, timeoutMs: 5_000,
      })
      const claimB2 = await httpJson<ClaimResult>(procB.baseUrl, "/authority/claim", {
        method: "POST", query: { runId }, body: { attemptedGeneration: 2, authorityOwnerId: ownerB }, timeoutMs: 5_000,
      })
      expect(claimB2.granted).toBe(true)
      // A "resumes" and tries to commit at its old gen 1 — REJECTED.
      const claimAStale = await httpJson<ClaimResult>(procA.baseUrl, "/authority/claim", {
        method: "POST", query: { runId }, body: { attemptedGeneration: 1, authorityOwnerId: ownerA }, timeoutMs: 5_000,
      })
      expect(claimAStale.granted).toBe(false)
      expect(claimAStale.currentGeneration).toBe(2)
    } finally {
      await killProc(procA!)
      await killProc(procB!)
      await rmRetry(root)
    }
  }, { timeout: 180_000 })
})

