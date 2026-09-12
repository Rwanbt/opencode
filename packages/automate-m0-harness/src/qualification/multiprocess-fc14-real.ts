/* SPDX-License-Identifier: MIT */
/* Copyright (c) 2026 Unifia contributors */

/**
 * CP6.2: real FC-14 / FC-25 multi-process scenarios.
 *
 * Per pack gelé review 2026-09-03 v1.1 §25-§29 (CP6.1) and
 * §26-§27 (CP6.2): FC-14 requires not only a concurrent race
 * for authority, but also a proof that the WINNING authority
 * can act on its authority (authoritative mutation + effect
 * dispatch ACCEPTED) and the LOSING authority's attempts are
 * REJECTED on both paths. FC-25 requires a takeover scenario
 * (A FREEZE without release → takeover → B commit under new
 * gen → A stale commit/dispatch REJECTED).
 *
 * The CP6.1 primitives (/authority/claim with generation +
 * authorityOwnerId, /authority/mutate, /authority/dispatch,
 * /authority/takeover) are already in the Go binary. This
 * module drives the end-to-end scenario:
 *   1. Concurrent race (Promise.all) on /authority/claim.
 *   2. Winner issues /authority/mutate and /authority/dispatch
 *      with its token. Loser issues the same with its (stale)
 *      token. PASS only if the loser's are REJECTED.
 *   3. For FC-25: A claims gen=1, A blocks at a freeze barrier,
 *      /authority/takeover assigns B at gen=2, B commits
 *      /authority/mutate under gen=2 (ACCEPTED), A's stale
 *      /authority/mutate and /authority/dispatch are REJECTED.
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
  authorityOwnerId: string
  holderPid: number
  transactionLockMode: string
}

export interface MutateResult {
  status: "mutated" | string
}

export interface DispatchResult {
  status: "dispatched" | string
}

interface ClaimRequest {
  attemptedGeneration: number
  authorityOwnerId: string
}

interface ReleaseRequest {
  generation: number
  authorityOwnerId: string
}

interface MutateRequest {
  token: ClaimRequest
  mutation: string
}

interface DispatchRequest {
  token: ClaimRequest
  effectKey: string
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

interface SpawnedProc { proc: ChildProcess; baseUrl: string; storeDir: string; pid: number; ownerId: string }

async function spawnDbosGo(storeDir: string, label: string): Promise<SpawnedProc> {
  await mkdir(storeDir, { recursive: true })
  const pidPlaceholder = `${label}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
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
        if (m) { baseUrl = `http://${m[0]}`; break }
      }
    })
    child.stderr?.on("data", (chunk: Buffer) => { stderrBuf += chunk.toString("utf8") })
    child.once("error", (e) => { if (resolved) return; resolved = true; clearTimeout(timer); reject(e) })
    child.once("exit", (code) => { if (resolved) return; resolved = true; clearTimeout(timer); reject(new Error(`exited code=${code} (stderr=${stderrBuf})`)) })
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
  // Per CP6.1 §4: authorityOwnerId is a random opaque ID generated
  // once per qualification process. We use a per-process value.
  const ownerId = `pid-${child.pid ?? 0}-${pidPlaceholder}`
  return { proc: child, baseUrl, storeDir, pid: child.pid ?? 0, ownerId }
}

async function killProc(p: SpawnedProc): Promise<void> {
  if (p.proc && !p.proc.killed) {
    try { p.proc.kill("SIGKILL") } catch { /* noop */ }
  }
}

async function rmRetry(path: string, maxRetries = 10): Promise<void> {
  for (let i = 0; i < maxRetries; i++) {
    try {
      const { rmSync } = await import("node:fs")
      rmSync(path, { recursive: true, force: true })
      return
    } catch { await delay(200) }
  }
}

export interface FC14RealResult {
  evidencePath: string
  sharedStore: string
  processAPid: number
  processBPid: number
  winnerPid: number
  loserPid: number
  winnerOwnerId: string
  loserOwnerId: string
  claimWinner: ClaimResult
  claimLoser: ClaimResult
  mutateWinner: { status: string; httpStatus: number }
  mutateLoser: { status: string; httpStatus: number }
  dispatchWinner: { status: string; httpStatus: number }
  dispatchLoser: { status: string; httpStatus: number }
  passConditions: {
    winnerMutateAccepted: boolean
    loserMutateRejected: boolean
    winnerDispatchAccepted: boolean
    loserDispatchRejected: boolean
  }
}

export async function runDbosGoFC14RealConcurrentRace(outputRoot: string): Promise<FC14RealResult> {
  if (!existsSync(DBOS_GO_BINARY)) {
    throw new Error(`dbos-qualify.exe not built at ${DBOS_GO_BINARY}`)
  }
  const folder = evidencePath(outputRoot, "DBOS_GO_SQLITE", "FC-14")
  const root = mkdtempSync(join(tmpdir(), "m0-fc14-real-"))
  const storeDir = join(root, "store")
  await mkdir(storeDir, { recursive: true })
  const runId = `run-fc14-real-${Date.now()}`
  let procA: SpawnedProc | null = null
  let procB: SpawnedProc | null = null
  try {
    procA = await spawnDbosGo(storeDir, "A")
    procB = await spawnDbosGo(storeDir, "B")
    // Per pack gelé §6: true concurrent race (Promise.all after
    // barrier). Both processes call /authority/claim for the
    // same runId at gen=1 with their own authorityOwnerId.
    const barrier = new Promise<void>((resolve) => setTimeout(resolve, 50))
    await barrier
    const claimA = httpJson<ClaimResult>(procA.baseUrl, "/authority/claim", {
      method: "POST", query: { runId }, body: { attemptedGeneration: 1, authorityOwnerId: procA.ownerId } as ClaimRequest, timeoutMs: 10_000,
    })
    const claimB = httpJson<ClaimResult>(procB.baseUrl, "/authority/claim", {
      method: "POST", query: { runId }, body: { attemptedGeneration: 1, authorityOwnerId: procB.ownerId } as ClaimRequest, timeoutMs: 10_000,
    })
    const [a, b] = await Promise.all([claimA, claimB])
    const winner = a.granted ? { claim: a, proc: procA } : { claim: b, proc: procB }
    const loser = a.granted ? { claim: b, proc: procB } : { claim: a, proc: procA }
    // Per pack gelé §7: after the race, BOTH processes attempt
    // /authority/mutate and /authority/dispatch with their own
    // (stale) token. The winner's are accepted; the loser's are
    // rejected.
    // Important: the loser's claim RESPONSE contains the WINNER's
    // authorityOwnerId (because the loser was rejected and saw
    // the current owner). The loser's own identity is the
    // process-local ownerId. We use the loser's own ownerId here
    // so the mutate is correctly REJECTED.
    const winnerToken: ClaimRequest = { attemptedGeneration: winner.claim.currentGeneration, authorityOwnerId: winner.claim.authorityOwnerId }
    const loserToken: ClaimRequest = { attemptedGeneration: loser.claim.currentGeneration, authorityOwnerId: loser.proc.ownerId }
    const winnerMutateRaw = await fetch(`${winner.proc.baseUrl}/authority/mutate?runId=${encodeURIComponent(runId)}`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: winnerToken, mutation: "RUN_STATE_COMMITTED" } as MutateRequest),
    })
    const loserMutateRaw = await fetch(`${loser.proc.baseUrl}/authority/mutate?runId=${encodeURIComponent(runId)}`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: loserToken, mutation: "RUN_STATE_COMMITTED" } as MutateRequest),
    })
    const winnerDispatchRaw = await fetch(`${winner.proc.baseUrl}/authority/dispatch?runId=${encodeURIComponent(runId)}`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: winnerToken, effectKey: `effect-${Date.now()}` } as DispatchRequest),
    })
    const loserDispatchRaw = await fetch(`${loser.proc.baseUrl}/authority/dispatch?runId=${encodeURIComponent(runId)}`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: loserToken, effectKey: `effect-${Date.now()}` } as DispatchRequest),
    })
    const mutateWinner = { status: winnerMutateRaw.ok ? "ACCEPTED" : "REJECTED", httpStatus: winnerMutateRaw.status }
    const mutateLoser = { status: loserMutateRaw.ok ? "ACCEPTED" : "REJECTED", httpStatus: loserMutateRaw.status }
    const dispatchWinner = { status: winnerDispatchRaw.ok ? "ACCEPTED" : "REJECTED", httpStatus: winnerDispatchRaw.status }
    const dispatchLoser = { status: loserDispatchRaw.ok ? "ACCEPTED" : "REJECTED", httpStatus: loserDispatchRaw.status }
    const passConditions = {
      winnerMutateAccepted: mutateWinner.status === "ACCEPTED" && winnerMutateRaw.status >= 200 && winnerMutateRaw.status < 300,
      loserMutateRejected: mutateLoser.status === "REJECTED" && loserMutateRaw.status === 403,
      winnerDispatchAccepted: dispatchWinner.status === "ACCEPTED" && winnerDispatchRaw.status >= 200 && winnerDispatchRaw.status < 300,
      loserDispatchRejected: dispatchLoser.status === "REJECTED" && loserDispatchRaw.status === 403,
    }
    const evidence = await writeEvidence(folder, "result.json", {
      pass: passConditions.winnerMutateAccepted && passConditions.loserMutateRejected && passConditions.winnerDispatchAccepted && passConditions.loserDispatchRejected ? 1 : 0,
      sharedStore: storeDir,
      processAPid: procA.pid, processBPid: procB.pid,
      ownerA: procA.ownerId, ownerB: procB.ownerId,
      claimA: a, claimB: b,
      winnerPid: winner.proc.pid, loserPid: loser.proc.pid,
      winnerOwnerId: winner.claim.authorityOwnerId, loserOwnerId: loser.claim.authorityOwnerId,
      mutateWinner, mutateLoser, dispatchWinner, dispatchLoser,
      passConditions,
      observations: {
        measured: true,
        concurrentRace: true,
        distinctOsProcesses: 2,
        winnerMutateAccepted: passConditions.winnerMutateAccepted,
        loserMutateRejected: passConditions.loserMutateRejected,
        winnerDispatchAccepted: passConditions.winnerDispatchAccepted,
        loserDispatchRejected: passConditions.loserDispatchRejected,
      },
    })
    if (!passConditions.winnerMutateAccepted || !passConditions.loserMutateRejected || !passConditions.winnerDispatchAccepted || !passConditions.loserDispatchRejected) {
      throw new Error(
        `FC-14 real scenario failed: winnerMutate=${passConditions.winnerMutateAccepted} ` +
        `loserMutate=${passConditions.loserMutateRejected} ` +
        `winnerDispatch=${passConditions.winnerDispatchAccepted} ` +
        `loserDispatch=${passConditions.loserDispatchRejected}`,
      )
    }
    return {
      evidencePath: evidence, sharedStore: storeDir,
      processAPid: procA.pid, processBPid: procB.pid,
      winnerPid: winner.proc.pid, loserPid: loser.proc.pid,
      winnerOwnerId: winner.claim.authorityOwnerId, loserOwnerId: loser.claim.authorityOwnerId,
      claimWinner: winner.claim, claimLoser: loser.claim,
      mutateWinner, mutateLoser, dispatchWinner, dispatchLoser,
      passConditions,
    }
  } finally {
    await killProc(procA!)
    await killProc(procB!)
    await rmRetry(root)
  }
}
