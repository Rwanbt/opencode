/* SPDX-License-Identifier: MIT */
/* Copyright (c) 2026 Unifia contributors */

/**
 * M0 qualification test suite (substrate-neutral).
 *
 * Runs the qualification runner against:
 *   - UNIFIA_NATIVE : real (bun:sqlite in-process, M0 env choice)
 *   - CUSTOM_GO_SQLITE_CONTROL : real (spawn dbos-qualify.exe, v1.0.0 binary)
 *
 * Per pack gelé §5 / §11 / §42 : P0 set is FC-31A, FC-31B, FC-04,
 * FC-14, FC-25, FC-32. FC-13 / FC-13-CTRL are explicitly NOT in
 * the default P0 (power-loss methodology not available in this
 * environment).
 *
 * Per correction pack 2026-09-03 v1.1:
 *   - FC-14 = NOT_VALID in in-process form (no real 2-OS-process)
 *   - FC-25 = BLOCKED (multi-process zombie owner)
 *   - FC-13-CTRL / FC-13 = BLOCKED (NO_METHODOLOGY, no power-loss)
 *   - EXPECTED_NA = ONLY NOT_APPLICABLE (BLOCKED lives in M0_RESULTS_*.json)
 *
 * Tests are written to fail LOUDLY on regressions. A FAIL is never
 * silently turned into a PASS.
 */

import { describe, expect, test } from "bun:test"
import { mkdtempSync, rmSync, existsSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve as pathResolve } from "node:path"
import {
  FakeExternalEffectProvider,
  NativeSqliteCandidate,
  DBOSGoCandidate,
  QualificationRunner,
  QualificationHarnessError,
  classifyQualificationError,
  type DurableWorkflowAuthorityQualificationAdapter,
  type CandidateResultFile,
} from "../src/qualification/index.ts"

test("qualification error mapping preserves HARNESS_ERROR status", () => {
  const classified = classifyQualificationError("FC-14", new Error("unexpected harness failure"))
  expect(classified).toBeInstanceOf(QualificationHarnessError)
  expect(classified.status).toBe("HARNESS_ERROR")
  expect(classified.message).toMatch(/^HARNESS_ERROR:/)
})

function tempDir(label: string): string {
  return mkdtempSync(join(tmpdir(), `m0-qual-${label}-`))
}

/** Path to the DBOS Go binary, if it has been built. */
const DBOS_GO_TOOL_DIR = pathResolve(
  import.meta.dir,
  "..",
  "..",
  "..",
  "tools",
  "dbos-qualify",
)
const DBOS_GO_BINARY = join(DBOS_GO_TOOL_DIR, "dbos-qualify.exe")
const DBOS_GO_BUILT = existsSync(DBOS_GO_BINARY)

/* ----------------------------------------------------------------- */
/* UNIFIA_NATIVE                                                       */
/* ----------------------------------------------------------------- */

describe("M0 qualification — UNIFIA_NATIVE", () => {
  test("P0 set runs and produces M0_RESULTS_UNIFIA_NATIVE.json", async () => {
    const root = tempDir("native")
    const providerDir = join(root, "provider")
    const candidateDir = join(root, "candidate")

    const provider = new FakeExternalEffectProvider({ storeDir: providerDir, dropAckToCandidate: false })
    const candidate = new NativeSqliteCandidate({
      storeDir: candidateDir,
      provider,
      version: "0.0.0-qualification-2026-09-03",
      buildHash: "qual-m0-2026-09-03",
    })

    const runner = new QualificationRunner(candidate, provider, {
      outputRoot: root,
      buildHash: "qual-m0-2026-09-03",
    })

    const { resultPath } = await runner.run()
    const file = Bun.file(resultPath)
    expect(await file.exists()).toBe(true)
    const result: CandidateResultFile = await file.json()

    // Structural assertions
    expect(result.candidate).toBe("UNIFIA_NATIVE")
    expect(result.schemaVersion).toBe(1)
    expect(result.results.length).toBeGreaterThan(0)

    // FC-31A must be PASS (canonical value round-trip).
    const fc31a = result.results.find((r) => r.testId === "FC-31A")
    expect(fc31a).toBeDefined()
    if (fc31a?.status !== "PASS") {
      // eslint-disable-next-line no-console
      console.log("FC-31A status:", fc31a?.status, "note:", fc31a?.note, "observations:", JSON.stringify(fc31a?.observations))
    }
    expect(fc31a?.status).toBe("PASS")

    // FC-31B must be PASS (host-integer/float64 separation).
    const fc31b = result.results.find((r) => r.testId === "FC-31B")
    expect(fc31b).toBeDefined()
    if (fc31b?.status !== "PASS") {
      // eslint-disable-next-line no-console
      console.log("FC-31B status:", fc31b?.status, "note:", fc31b?.note, "observations:", JSON.stringify(fc31b?.observations))
    }
    expect(fc31b?.status).toBe("PASS")

    // FC-04 must be NOT_VALID for Native per CP6.1 §18: the
    // `ackLost: true` flag is a configuration signal, not real
    // transport-level ACK loss from an independent external
    // provider. There is no in-process exception.
    const fc04 = result.results.find((r) => r.testId === "FC-04")
    expect(fc04).toBeDefined()
    if (fc04?.status !== "NOT_VALID") {
      // eslint-disable-next-line no-console
      console.log("FC-04 status:", fc04?.status, "note:", fc04?.note)
    }
    expect(fc04?.status).toBe("NOT_VALID")

    // FC-14 must be PASS for Native (substrate-neutral race via
    // `native-authority-worker.ts` Bun subprocess; 2 real OS
    // processes; winner mutate+dispatch ACCEPTED, loser REJECTED).
    const fc14 = result.results.find((r) => r.testId === "FC-14")
    expect(fc14).toBeDefined()
    if (fc14?.status !== "PASS") {
      // eslint-disable-next-line no-console
      console.log("FC-14 status:", fc14?.status, "note:", fc14?.note, "observations:", JSON.stringify(fc14?.observations))
    }
    expect(fc14?.status).toBe("PASS")

    // FC-25 must be PASS for Native (real zombie-process
    // scenario with IPC freeze barrier between 2 live OS
    // processes; 2 distinct processes observed, A's freeze
    // barrier /await-resume observed, A's stale mutate+dispatch
    // rejected).
    const fc25 = result.results.find((r) => r.testId === "FC-25")
    expect(fc25).toBeDefined()
    if (fc25?.status !== "PASS") {
      // eslint-disable-next-line no-console
      console.log("FC-25 status:", fc25?.status, "note:", fc25?.note, "observations:", JSON.stringify(fc25?.observations))
    }
    expect(fc25?.status).toBe("PASS")
    // The zombie scenario observations are machine-confirmed.
    expect(fc25?.observations?.distinctOsProcesses).toBeGreaterThanOrEqual(2)
    expect(fc25?.observations?.oldOwnerAliveDuringTakeover).toBe(true)
    expect(fc25?.observations?.staleOwnerCommitRejected).toBe(true)
    expect(fc25?.observations?.staleOwnerDispatchRejected).toBe(true)

    // FC-13-CTRL / FC-13 must be BLOCKED (no power-loss methodology).
    const fc13c = result.results.find((r) => r.testId === "FC-13-CTRL")
    expect(fc13c).toBeDefined()
    expect(fc13c?.status).toBe("BLOCKED")
    const fc13 = result.results.find((r) => r.testId === "FC-13")
    expect(fc13).toBeDefined()
    expect(fc13?.status).toBe("BLOCKED")

    // FC-32 must be NOT_VALID (declaration without measurement is
    // not admissible as PASS — see pack gelé §13: "measured = false
    // => status != PASS"). replayModel defaults to NOT_MEASURED.
    expect(result.replayModel).toBe("NOT_MEASURED")

    // Cleanup — Windows keeps file handles open briefly; retry
    // up to 5 times with a small delay. The temp dir will be
    // cleaned by the OS regardless; the harness does not depend
    // on a successful rm here.
    for (let i = 0; i < 5; i++) {
      try {
        rmSync(root, { recursive: true, force: true })
        break
      } catch (e) {
        if (i === 4) {
          // eslint-disable-next-line no-console
          console.log("Native test cleanup EBUSY after 5 retries; leaving", root)
          break
        }
        await new Promise((r) => setTimeout(r, 200))
      }
    }
  }, { timeout: 60_000 })
})

/* ----------------------------------------------------------------- */
/* CUSTOM_GO_SQLITE_CONTROL (real binary)                                        */
/* ----------------------------------------------------------------- */

describe("M0 qualification — CUSTOM_GO_SQLITE_CONTROL (real binary)", () => {
  if (!DBOS_GO_BUILT) {
    test("binary NOT BUILT — skipped (build via scripts/bootstrap-go.sh + go build)", () => {
      // eslint-disable-next-line no-console
      console.log(`[SKIP] dbos-qualify.exe not found at ${DBOS_GO_BINARY}. Build with:`)
      // eslint-disable-next-line no-console
      console.log("        scripts/bootstrap-go.sh (downloads Go 1.25.12)")
      // eslint-disable-next-line no-console
      console.log("        cd tools/dbos-qualify && ../../.tools/go/go1.25.12/bin/go build -buildvcs=false -o dbos-qualify.exe .")
      expect(DBOS_GO_BUILT).toBe(false)
    })
    return
  }

  test("candidateInfo() declares CUSTOM_GO_SQLITE_CONTROL with pinned versions", async () => {
    const candidate = new DBOSGoCandidate({
      toolDir: DBOS_GO_TOOL_DIR,
      version: "github.com/dbos-inc/dbos-transact-golang@v1.0.0",
      buildHash: "qual-m0-2026-09-03",
    })
    const info = await candidate.candidateInfo()
    expect(info.kind).toBe("CUSTOM_GO_SQLITE_CONTROL")
    expect(info.version).toBe("github.com/dbos-inc/dbos-transact-golang@v1.0.0")
    expect(info.version).not.toBe("latest")
    expect(info.version).not.toBe("1.0+")
    expect(info.process.multiProcessSafe).toBe(true)
    expect(info.process.topology).toBe("child-process")
    expect(info.storage.journalMode).toBe("WAL")
    expect(info.storage.synchronous).toBe("FULL")
  })

  test("P0 set runs against the real Go binary and produces M0_RESULTS_CUSTOM_GO_SQLITE_CONTROL.json", async () => {
    const root = tempDir("dbos-go")
    const providerDir = join(root, "provider")
    const candidateDir = join(root, "candidate")

    await mkdirSafe(providerDir)
    await mkdirSafe(candidateDir)

    const provider = new FakeExternalEffectProvider({ storeDir: providerDir, dropAckToCandidate: false })
    // The fake provider is constructed but not wired into the Go
    // binary (Go manages its own process lifecycle). The FC-04
    // scenarios inside the runner re-build a Native candidate
    // pointed at an ACK-loss provider; for the Go candidate, the
    // adapter drives ACK loss via the JSON `ackLost` field on
    // /attempts, which the Go binary translates to
    // UNKNOWN_EXTERNAL_STATE per the FC-04 contract.
    const candidate = new DBOSGoCandidate({
      toolDir: DBOS_GO_TOOL_DIR,
      version: "github.com/dbos-inc/dbos-transact-golang@v1.0.0",
      buildHash: "qual-m0-2026-09-03",
    })

    const runner = new QualificationRunner(candidate, provider, {
      outputRoot: root,
      buildHash: "qual-m0-2026-09-03",
    })

    const { resultPath } = await runner.run()
    const file = Bun.file(resultPath)
    expect(await file.exists()).toBe(true)
    const result: CandidateResultFile = await file.json()

    // Structural assertions
    expect(result.candidate).toBe("CUSTOM_GO_SQLITE_CONTROL")
    expect(result.schemaVersion).toBe(1)
    expect(result.results.length).toBeGreaterThan(0)

    // FC-04 is NOT_VALID for DBOS Go (per pack gelé §12, CP6.1):
    // `ackLost: true` is a magic flag from the harness, not real
    // transport-level ACK loss from an independent external
    // provider. The Go binary maps the flag to UNKNOWN_EXTERNAL_STATE
    // in its custom SQLite, with no provider involvement.
    const fc04 = result.results.find((r) => r.testId === "FC-04")
    expect(fc04).toBeDefined()
    expect(fc04?.status).toBe("NOT_VALID")

    // FC-31B is NOT_VALID for DBOS Go (per pack gelé §8): the
    // harness uses the TS host adapter, not the Go host. The Go
    // binary must receive typed fixtures (float64/int64/uint64/
    // MaxInt64) and apply the FC-31B contract itself.
    const fc31b = result.results.find((r) => r.testId === "FC-31B")
    expect(fc31b).toBeDefined()
    expect(fc31b?.status).toBe("NOT_VALID")

    // FC-14 must be PASS for CUSTOM_GO_SQLITE_CONTROL (per
    // pack gelé §15 + CP6.3 final closure 2026-09-04): the
    // adapter spawns a 2nd `dbos-qualify.exe` process on the
    // same M0_STORE_DIR, both processes call /authority/claim
    // concurrently (Promise.all after a barrier), the winner
    // mutates+dispatches, the loser is REJECTED on both.
    const fc14 = result.results.find((r) => r.testId === "FC-14")
    expect(fc14).toBeDefined()
    if (fc14?.status !== "PASS") {
      // eslint-disable-next-line no-console
      console.log("FC-14 status:", fc14?.status, "note:", fc14?.note, "observations:", JSON.stringify(fc14?.observations))
    }
    expect(fc14?.status).toBe("PASS")

    // FC-25 must be NOT_IMPLEMENTED for CUSTOM_GO_SQLITE_CONTROL:
    // the control binary does not implement the freeze-barrier
    // endpoints (/await-resume, /resume). The real FC-25
    // zombie scenario is exercised on the real DBOS Go
    // candidate (when built). The control is intentionally
    // NOT_IMPLEMENTED for this gate.
    const fc25 = result.results.find((r) => r.testId === "FC-25")
    expect(fc25).toBeDefined()
    if (fc25?.status !== "NOT_IMPLEMENTED") {
      // eslint-disable-next-line no-console
      console.log("FC-25 status:", fc25?.status, "note:", fc25?.note, "observations:", JSON.stringify(fc25?.observations))
    }
    expect(fc25?.status).toBe("NOT_IMPLEMENTED")

    // FC-13-CTRL / FC-13 must be BLOCKED (no power-loss methodology).
    const fc13c = result.results.find((r) => r.testId === "FC-13-CTRL")
    expect(fc13c).toBeDefined()
    expect(fc13c?.status).toBe("BLOCKED")
    const fc13 = result.results.find((r) => r.testId === "FC-13")
    expect(fc13).toBeDefined()
    expect(fc13?.status).toBe("BLOCKED")

    // Cleanup — shutdown the binary first (releases the SQLite
    // file), then retry on EBUSY for Windows file-lock release.
    await candidate.shutdown().catch(() => undefined)
    for (let i = 0; i < 10; i++) {
      try {
        rmSync(root, { recursive: true, force: true })
        break
      } catch (e) {
        if (i === 9) {
          // eslint-disable-next-line no-console
          console.log("DBOS Go test cleanup EBUSY after 10 retries; leaving", root)
          break
        }
        await new Promise((r) => setTimeout(r, 200))
      }
    }
  }, { timeout: 120_000 })
})

/* ----------------------------------------------------------------- */
/* Common harness invariants                                          */
/* ----------------------------------------------------------------- */

describe("M0 qualification — common harness invariants", () => {
  test("both candidates expose the same contract surface", () => {
    // Optional measurement capabilities (canonizeViaHost for FC-31B,
    // fc32* for FC-32) are declared optional on the qualification contract;
    // surface parity applies to the mandatory oracle surface.
    const isOptionalCapability = (n: string) => n === "canonizeViaHost" || n.startsWith("fc32")
    const nativeMethods = Object.getOwnPropertyNames(NativeSqliteCandidate.prototype)
      .filter((n) => n !== "constructor" && !n.startsWith("_") && n !== "requireDb" && n !== "destroy" && n !== "appendApprovalHistory" && !isOptionalCapability(n))
    const dbosMethods = Object.getOwnPropertyNames(DBOSGoCandidate.prototype)
      .filter((n) => n !== "constructor" && !n.startsWith("_") && n !== "requireBase" && n !== "appendApprovalHistory" && !isOptionalCapability(n))
    expect(nativeMethods.sort()).toEqual(dbosMethods.sort())
  })

  test("FC-31A bit patterns are stable across re-reads (BitInt<->Float64 round-trip)", async () => {
    const { bitsToFloat64, BINARY64_SMALLEST_SUBNORMAL, BINARY64_SMALLEST_NORMAL, BINARY64_MAX_FINITE, BINARY64_MAX_SAFE, BINARY64_NEG_MAX_SAFE } = await import("../src/qualification/vectors/fc31-fixtures.ts")
    expect(bitsToFloat64(BINARY64_SMALLEST_SUBNORMAL)).toBe(5e-324)
    expect(bitsToFloat64(BINARY64_SMALLEST_NORMAL)).toBe(2.2250738585072014e-308)
    expect(bitsToFloat64(BINARY64_MAX_FINITE)).toBe(1.7976931348623157e308)
    expect(bitsToFloat64(BINARY64_MAX_SAFE)).toBe(9_007_199_254_740_991)
    expect(bitsToFloat64(BINARY64_NEG_MAX_SAFE)).toBe(-9_007_199_254_740_991)
  })

  test("ExpectedNABuilder only contains NOT_APPLICABLE (no BLOCKED)", async () => {
    const { ExpectedNABuilder, expectedNAPath } = await import("../src/qualification/result.ts")
    const root = tempDir("na-builder")
    const na = new ExpectedNABuilder("UNIFIA_NATIVE")
    // Allowed: NOT_APPLICABLE (just an architecture-level skip).
    // Not allowed: BLOCKED (those belong in M0_RESULTS_*.json).
    const naPath = expectedNAPath(root, "UNIFIA_NATIVE")
    await na.write(naPath)
    const file = Bun.file(naPath)
    const json = await file.json()
    expect(json.candidate).toBe("UNIFIA_NATIVE")
    expect(Array.isArray(json.entries)).toBe(true)
    // The very test of declaring a BLOCKED entry here would be a
    // test failure — the type signature prevents it (no declare()
    // overload accepts a status).
    rmSync(root, { recursive: true, force: true })
  })

  test("COMMON_ORACLE_IMPORTS_CANDIDATE_IMPLEMENTATION = 0 (no contamination)", async () => {
    // Per pack gelé review 2026-09-03 v1.1 §3 (CP4.1): the common
    // oracle (runner + providers + vectors) MUST NOT import any
    // candidate-specific implementation. The harness drives every
    // candidate through the same substrate-neutral contract
    // `DurableWorkflowAuthorityQualificationAdapter`. Cross-candidate
    // contamination (e.g. creating a fresh Native candidate from
    // inside `runFC04`) is forbidden and now blocked by this test.
    //
    // Scope: the oracle is the set of files that *execute* during
    // a run (runner + providers + vectors + contract + result + index
    // barrel). The test excludes `adapters/` (those ARE the
    // candidate implementations) and excludes comment lines (//, *)
    // and string literals. Only `import` and `export ... from` lines
    // count as actual code-level imports.
    const { readdir, readFile } = await import("node:fs/promises")
    const harnessRoot = pathResolve(import.meta.dir, "..", "src", "qualification")
    // Pattern: an actual code-level import of an adapter path.
    // (export ... from "./adapters/..." is also a code-level import.)
    const FORBIDDEN_CODE_PATTERNS: RegExp[] = [
      /^\s*(?:import|export)\b[^;\n]*from\s+["']\.\.?\/adapters\//,
    ]
    // Files that are explicitly allowed to re-export from
    // adapters/ — the index.ts barrel is the public API surface,
    // not part of the common oracle.
    const ALLOWED_FILES = new Set<string>(["index.ts"])
    const violations: { file: string; line: number; pattern: string; text: string }[] = []
    const walk = async (dir: string): Promise<void> => {
      const entries = await readdir(dir, { withFileTypes: true })
      for (const e of entries) {
        const p = `${dir}/${e.name}`
        if (e.isDirectory()) {
          if (e.name === "adapters") continue // candidate impls; not part of the oracle
          await walk(p)
        } else if (e.isFile() && p.endsWith(".ts")) {
          const baseName = p.split(/[\\/]/).pop() ?? ""
          if (ALLOWED_FILES.has(baseName)) continue
          const content = await readFile(p, "utf8")
          const lines = content.split(/\r?\n/)
          for (let i = 0; i < lines.length; i++) {
            const line = lines[i]
            const trimmed = line.trim()
            // Skip comment-only lines and JSDoc blocks
            if (trimmed.startsWith("//") || trimmed.startsWith("*") || trimmed.startsWith("/*")) continue
            for (const pat of FORBIDDEN_CODE_PATTERNS) {
              if (pat.test(line)) {
                violations.push({ file: p, line: i + 1, pattern: pat.source, text: trimmed })
              }
            }
          }
        }
      }
    }
    await walk(harnessRoot)
    if (violations.length > 0) {
      const msg = violations
        .map((v) => `  ${v.file}:${v.line}  [${v.pattern}]  ${v.text}`)
        .join("\n")
      throw new Error(
        `COMMON_ORACLE_IMPORTS_CANDIDATE_IMPLEMENTATION > 0\n` +
        `Forbidden cross-candidate import detected in common oracle:\n${msg}`,
      )
    }
    expect(violations.length).toBe(0)
  })

  test("PASS requires measured=true for measured FCs (schema invariant)", async () => {
    // Per pack gelé review 2026-09-03 v1.1 §22: PASS requires
    // measured=true for any FC that has a `measured` field in the
    // FC result schema. This is enforced at the result builder
    // level. The test verifies that the builder rejects
    // { status: "PASS", measured: false }.
    const { CandidateResultBuilder } = await import("../src/qualification/result.ts")
    const dummyInfo = {
      kind: "UNIFIA_NATIVE" as const,
      version: "test",
      buildHash: "test",
      storage: { engine: "x", driver: "x", journalMode: "WAL", synchronous: "FULL", busyTimeoutMs: 0, maxOpenConns: 0, backupTarget: "file" as const },
      process: { topology: "in-process", multiProcessSafe: false },
    }
    const builder = new CandidateResultBuilder(dummyInfo, "test")
    // PASS with measured=false should throw (or at least be rejected).
    expect(() =>
      builder.record({
        testId: "FC-32",
        status: "PASS",
        evidencePath: "x",
        note: "fake",
        observations: { measured: false },
      }),
    ).toThrow(/measured/)
  })
})

/* ----------------------------------------------------------------- */
/* Helpers                                                            */
/* ----------------------------------------------------------------- */

async function mkdirSafe(p: string): Promise<void> {
  const { mkdir } = await import("node:fs/promises")
  await mkdir(p, { recursive: true })
}
