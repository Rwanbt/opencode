/* SPDX-License-Identifier: MIT */
/**
 * P0 spikes: bounded native call, atomic write, sandbox containment,
 * SQLite/FTS availability, Git pre-push scan.
 *
 * These are exploratory primitives with no production consumer — nothing
 * outside this module's tests imports them. They stay because each encodes a
 * real measurement or matrix worth keeping; they are not a runtime.
 *
 * `buildSyntheticRetrieval` used to live here: it fabricated a candidate with
 * `trust: "verified"` and `restriction: "allow"` hardcoded, then returned
 * `decision === "allow" ? [] : []` — two identical branches, so the egress
 * decision it computed changed nothing. Real retrieval is `ContextRouter`
 * over `VaultSource`; a synthetic stand-in beside it is a trap, so it is
 * deleted rather than kept as a second answer to the same question.
 */


// --- P0.2 NativeKnowledgePort bounds ---

export interface NativeCallResult<T> {
  value: T | null
  timedOut: boolean
  cancelled: boolean
  oversize: boolean
}

export interface NativeCallBudget {
  maxBytes: number
  deadlineMs: number
  signal: { aborted: boolean }
}

export function callBounded<T>(
  budget: NativeCallBudget,
  run: () => Promise<T>,
): Promise<NativeCallResult<T>> {
  return new Promise((resolve) => {
    const start = Date.now()
    let resolved = false
    const timer = setTimeout(() => {
      if (resolved) return
      resolved = true
      resolve({ value: null, timedOut: true, cancelled: false, oversize: false })
    }, budget.deadlineMs)
    if (budget.signal.aborted) {
      clearTimeout(timer)
      resolved = true
      resolve({ value: null, timedOut: false, cancelled: true, oversize: false })
      return
    }
    void (async () => {
      try {
        const v = await run()
        if (resolved) return
        clearTimeout(timer)
        const json = JSON.stringify(v)
        const oversize = json.length > budget.maxBytes
        if (oversize) {
          resolved = true
          resolve({ value: null, timedOut: false, cancelled: false, oversize: true })
          return
        }
        resolved = true
        resolve({ value: v, timedOut: false, cancelled: false, oversize: false })
      } catch (_err) {
        if (resolved) return
        clearTimeout(timer)
        resolved = true
        resolve({ value: null, timedOut: Date.now() - start >= budget.deadlineMs, cancelled: false, oversize: false })
      }
    })()
  })
}

// --- P0.3 atomic-write matrix (declared capabilities) ---

export type StorageSurface = "app_private" | "shared" | "removable" | "network" | "memory"

export interface AtomicWriteResult {
  surface: StorageSurface
  /** True if temp + fsync + atomic rename are all supported. */
  atomic: boolean
  /** True if cross-process locking is supported. */
  lockable: boolean
  /** Notes for the test report. */
  notes: string
}

/**
 * Test matrix of atomic-write capabilities per storage surface.
 * In V1, this is a static table derived from the spike; the
 * device tests in P10.2 will populate it.
 */
export const ATOMIC_WRITE_MATRIX: AtomicWriteResult[] = [
  { surface: "app_private", atomic: true, lockable: true, notes: "ext4 / APFS / NTFS" },
  { surface: "shared", atomic: false, lockable: false, notes: "VFS+ may not atomic-rename" },
  { surface: "removable", atomic: false, lockable: false, notes: "SD cards lack posix guarantees" },
  { surface: "network", atomic: false, lockable: false, notes: "SMB / NFS not safe" },
  { surface: "memory", atomic: true, lockable: true, notes: "in-process" },
]

export function isAtomicWriteSupported(surface: StorageSurface): boolean {
  return ATOMIC_WRITE_MATRIX.find((r) => r.surface === surface)?.atomic ?? false
}

// --- P0.5 SQLite/FTS5 availability ---

export interface FtsAvailability {
  /** True if the FTS5 virtual table is constructible in this process. */
  fts5: boolean
  /** True if WAL is supported. */
  wal: boolean
  /** Notes (e.g. "linked statically" / "loaded from extension"). */
  notes: string
}

/**
 * In V1 we do not bind to a specific SQLite. The function returns
 * a conservative "unknown" state; Phase 3 wires the real probe.
 */
export function checkFtsAvailability(): FtsAvailability {
  return { fts5: false, wal: false, notes: "V1 stub: FTS5 availability is decided at P3" }
}

// --- P0.4 sandbox containment (declared boundaries) ---

export type SandboxCapability =
  | "filesystem.read"
  | "filesystem.write"
  | "network.outbound"
  | "subprocess.spawn"
  | "env.read"
  | "env.write"

export interface SandboxBoundary {
  capability: SandboxCapability
  allowed: boolean
  reason: string
}

export const DEFAULT_SANDBOX: SandboxBoundary[] = [
  { capability: "filesystem.read", allowed: true, reason: "vault + index" },
  { capability: "filesystem.write", allowed: true, reason: "knowledge root only" },
  { capability: "network.outbound", allowed: false, reason: "PROVIDER_INDEPENDENCE" },
  { capability: "subprocess.spawn", allowed: false, reason: "audit risk" },
  { capability: "env.read", allowed: true, reason: "PATHS only" },
  { capability: "env.write", allowed: false, reason: "forbidden" },
]

export function isCapabilityAllowed(c: SandboxCapability): boolean {
  return DEFAULT_SANDBOX.find((b) => b.capability === c)?.allowed ?? false
}

// --- P0.7 Git pre-push scan (declarative hook) ---

export interface PrepushScanConfig {
  touchedLocators: string[]
  contents: ReadonlyArray<{ locator: string; commit: string; content: string }>
}

export function runPrepushScan(cfg: PrepushScanConfig): {
  ok: boolean
  hits: number
} {
  const relevant = cfg.contents.filter((c) => cfg.touchedLocators.includes(c.locator))
  const patterns: RegExp[] = [
    /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
    /sk-[A-Za-z0-9]{20,}/,
    /AKIA[0-9A-Z]{16}/,
    /ghp_[A-Za-z0-9]{30,}/,
  ]
  let hits = 0
  for (const f of relevant) {
    for (const p of patterns) {
      if (p.test(f.content)) hits++
    }
  }
  return { ok: hits === 0, hits }
}

// --- P0.5a a Retrieval round-trip ---
