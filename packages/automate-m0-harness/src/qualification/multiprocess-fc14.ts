/* SPDX-License-Identifier: MIT */
/* Copyright (c) 2026 Unifia contributors */

/**
 * Real multi-process FC-14 / FC-25 helper for the DBOS Go
 * candidate. Spawns 2 `dbos-qualify.exe` processes on the same
 * M0_STORE_DIR and races them on the same runId via the
 * `/authority/claim` endpoint.
 *
 * Per pack gelé review 2026-09-03 v1.1 §25-§29, this is the
 * substrate-neutral way to prove that a single logical authority
 * can act when two OS processes contend for the same run.
 *
 * Used by the qualification runner (CP5) and also by the
 * multiprocess-fc14.test.ts regression test.
 */

import { spawn, ChildProcess } from "node:child_process"
import { mkdir } from "node:fs/promises"
import { existsSync, mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve as pathResolve } from "node:path"
import { setTimeout as delay } from "node:timers/promises"
import { writeEvidence } from "./evidence-writer.ts"
import { evidencePath } from "./result.ts"

const DBOS_GO_TOOL_DIR = pathResolve(import.meta.dir, "..", "..", "..", "..", "tools", "dbos-qualify")
const DBOS_GO_BINARY = join(DBOS_GO_TOOL_DIR, "dbos-qualify.exe")

export interface ClaimResult {
  granted: boolean
  runId: string
  currentGeneration: number
  attemptedGeneration: number
  holderPid: number
}

export interface FC14MultiProcessResult {
  evidencePath: string
  sharedStore: string
  grantedCount: number
  winner: ClaimResult
  rejected: ClaimResult
}

export interface FC25MultiProcessResult {
  evidencePath: string
  sharedStore: string
  processIds: { a: number; b: number }
  claimA1: ClaimResult
  claimB2: ClaimResult
  claimAStale: ClaimResult
}

interface SpawnedProc { proc: ChildProcess; baseUrl: string; storeDir: string; pid: number }

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

async function spawnDbosGo(storeDir: string): Promise<SpawnedProc> {
  await mkdir(storeDir, { recursive: true })
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
      reject(new Error(`dbos-qualify.exe exited code=${code} (stdout=${stdoutBuf} stderr=${stderrBuf})`))
    })
    const wait = async () => {
      while (!resolved) {
        if (baseUrl) {
          try {
            await fetch(`${baseUrl}/healthz`, { signal: AbortSignal.timeout(1_000) })
            if (!resolved) { resolved = true; clearTimeout(timer); resolve() }
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

export async function runDbosGoMultiProcessFC14(outputRoot: string): Promise<FC14MultiProcessResult> {
  if (!existsSync(DBOS_GO_BINARY)) {
    throw new Error(`dbos-qualify.exe not built at ${DBOS_GO_BINARY}. Build with: scripts/bootstrap-go.sh && cd tools/dbos-qualify && ../../.tools/go/go1.25.12/bin/go build -buildvcs=false -o dbos-qualify.exe .`)
  }
  const folder = evidencePath(outputRoot, "DBOS_GO_SQLITE", "FC-14")
  const root = mkdtempSync(join(tmpdir(), "m0-fc14-runner-"))
  const storeDir = join(root, "store")
  await mkdir(storeDir, { recursive: true })
  const runId = `run-mp-fc14-${Date.now()}`
  let procA: SpawnedProc | null = null
  let procB: SpawnedProc | null = null
  try {
    procA = await spawnDbosGo(storeDir)
    procB = await spawnDbosGo(storeDir)
    const ownerA = `pid-${procA.pid}-ns-${Date.now()}-a`
    const ownerB = `pid-${procB.pid}-ns-${Date.now()}-b`
    const claimA = await httpJson<ClaimResult>(procA.baseUrl, "/authority/claim", {
      method: "POST", query: { runId }, body: { attemptedGeneration: 1, authorityOwnerId: ownerA }, timeoutMs: 5_000,
    })
    const claimB = await httpJson<ClaimResult>(procB.baseUrl, "/authority/claim", {
      method: "POST", query: { runId }, body: { attemptedGeneration: 1, authorityOwnerId: ownerB }, timeoutMs: 5_000,
    })
    const grantedCount = (claimA.granted ? 1 : 0) + (claimB.granted ? 1 : 0)
    const winner = claimA.granted ? claimA : claimB
    const rejected = claimA.granted ? claimB : claimA
    const evidence = await writeEvidence(folder, "result.json", {
      pass: grantedCount === 1 ? 1 : 0,
      fail: grantedCount === 1 ? 0 : 1,
      runId,
      sharedStore: storeDir,
      processAPid: procA.pid,
      processBPid: procB.pid,
      claimA,
      claimB,
      winner,
      rejected,
      grantedCount,
      observations: {
        measured: true,
        processIds: { a: procA.pid, b: procB.pid },
        sharedStore: storeDir,
        result: { grantedCount, winner, rejected },
        singleAuthority: grantedCount === 1,
      },
    })
    if (grantedCount !== 1) {
      throw new Error(`FC-14 multi-process race produced ${grantedCount} granted claims, expected exactly 1`)
    }
    return {
      evidencePath: evidence,
      sharedStore: storeDir,
      grantedCount,
      winner,
      rejected,
    }
  } finally {
    await killProc(procA!)
    await killProc(procB!)
    // Best-effort cleanup; on Windows the SQLite file lock may
    // be released lazily.
    for (let i = 0; i < 5; i++) {
      try {
        const { rmSync } = await import("node:fs")
        rmSync(root, { recursive: true, force: true })
        break
      } catch { await delay(200) }
    }
  }
}

export async function runDbosGoMultiProcessFC25(outputRoot: string): Promise<FC25MultiProcessResult> {
  if (!existsSync(DBOS_GO_BINARY)) {
    throw new Error(`dbos-qualify.exe not built at ${DBOS_GO_BINARY}.`)
  }
  const folder = evidencePath(outputRoot, "DBOS_GO_SQLITE", "FC-25")
  const root = mkdtempSync(join(tmpdir(), "m0-fc25-runner-"))
  const storeDir = join(root, "store")
  await mkdir(storeDir, { recursive: true })
  const runId = `run-mp-fc25-${Date.now()}`
  let procA: SpawnedProc | null = null
  let procB: SpawnedProc | null = null
  try {
    procA = await spawnDbosGo(storeDir)
    procB = await spawnDbosGo(storeDir)
    // Step 1: A claims at gen 1. CP6.1: JSON body with
    // (generation, authorityOwnerId).
    const ownerA = `pid-${procA.pid}-ns-${Date.now()}-a`
    const ownerB = `pid-${procB.pid}-ns-${Date.now()}-b`
    const claimA1 = await httpJson<ClaimResult>(procA.baseUrl, "/authority/claim", {
      method: "POST", query: { runId }, body: { attemptedGeneration: 1, authorityOwnerId: ownerA }, timeoutMs: 5_000,
    })
    if (!claimA1.granted) {
      throw new Error(`FC-25 step 1: A claim at gen 1 was rejected, expected granted`)
    }
    // Step 2: A transfers authority.
    await httpJson<{ status: string }>(procA.baseUrl, "/authority/release", {
      method: "POST", query: { runId }, body: { generation: 1, authorityOwnerId: ownerA }, timeoutMs: 5_000,
    })
    // Step 3: B claims at gen 2.
    const claimB2 = await httpJson<ClaimResult>(procB.baseUrl, "/authority/claim", {
      method: "POST", query: { runId }, body: { attemptedGeneration: 2, authorityOwnerId: ownerB }, timeoutMs: 5_000,
    })
    if (!claimB2.granted) {
      throw new Error(`FC-25 step 3: B claim at gen 2 was rejected, expected granted`)
    }
    // Step 4: A "resumes" and tries stale claim at gen 1.
    const claimAStale = await httpJson<ClaimResult>(procA.baseUrl, "/authority/claim", {
      method: "POST", query: { runId }, body: { attemptedGeneration: 1, authorityOwnerId: ownerA }, timeoutMs: 5_000,
    })
    if (claimAStale.granted) {
      throw new Error(`FC-25 step 4: A's stale claim at gen 1 was granted, expected rejected`)
    }
    if (claimAStale.currentGeneration !== 2) {
      throw new Error(`FC-25 step 4: stale claim sees current gen ${claimAStale.currentGeneration}, expected 2`)
    }
    const evidence = await writeEvidence(folder, "result.json", {
      pass: 1, fail: 0,
      runId, sharedStore: storeDir,
      processAPid: procA.pid, processBPid: procB.pid,
      claimA1, claimB2, claimAStale,
      observations: {
        measured: true,
        processIds: { a: procA.pid, b: procB.pid },
        sharedStore: storeDir,
        staleClaimRejected: true,
      },
    })
    return {
      evidencePath: evidence,
      sharedStore: storeDir,
      processIds: { a: procA.pid, b: procB.pid },
      claimA1, claimB2, claimAStale,
    }
  } finally {
    await killProc(procA!)
    await killProc(procB!)
    for (let i = 0; i < 5; i++) {
      try {
        const { rmSync } = await import("node:fs")
        rmSync(root, { recursive: true, force: true })
        break
      } catch { await delay(200) }
    }
  }
}
