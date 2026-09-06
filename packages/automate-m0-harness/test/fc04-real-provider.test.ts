/* SPDX-License-Identifier: MIT */
/* Copyright (c) 2026 Unifia contributors */

/**
 * FC-04 through the shared REAL external-effect provider process
 * (master plan 28-30).
 *
 * Provider: separate OS process, own durable SQLite journal, real HTTP
 * transport. mode="drop" commits durably then resets the TCP connection -
 * the candidate observes a genuine transport failure (no truth flag).
 * Recovery reads the provider journal independently over HTTP.
 */

import { test, expect, beforeAll, afterAll } from "bun:test"
import { mkdtempSync, rmSync, existsSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { NativeSqliteCandidate } from "../src/qualification/adapters/native-sqlite.ts"
import { FakeExternalEffectProvider } from "../src/qualification/providers/fake-external.ts"

let testDir = ""
let providerProc: ReturnType<typeof Bun.spawn> | null = null
let providerBaseUrl = ""

async function startProviderProcess(journalDir: string): Promise<string> {
  const script = join(import.meta.dir, "..", "..", "..", "tools", "fake-provider-process", "main.ts")
  providerProc = Bun.spawn(["bun", "run", script], {
    env: { ...process.env, FAKE_PROVIDER_JOURNAL_DIR: journalDir },
    stdout: "pipe",
    stderr: "pipe",
  })
  const reader = (providerProc.stdout as ReadableStream<Uint8Array>).getReader()
  const deadline = Date.now() + 20_000
  while (Date.now() < deadline) {
    const { value, done } = await reader.read()
    if (done) break
    const text = new TextDecoder().decode(value)
    const match = text.match(/http:\/\/127\.0\.0\.1:\d+/)
    if (match) return match[0]
  }
  throw new Error("fake provider process did not expose base URL")
}

beforeAll(async () => {
  testDir = mkdtempSync(join(tmpdir(), "fc04-provider-"))
  providerBaseUrl = await startProviderProcess(join(testDir, "provider-journal"))
})

afterAll(() => {
  if (providerProc && !providerProc.killed) {
    try { providerProc.kill() } catch { /* noop */ }
  }
  // Windows: the provider holds the journal open; let the OS release it.
  if (testDir && existsSync(testDir)) {
    setTimeout(() => { try { rmSync(testDir, { recursive: true, force: true }) } catch { /* best effort */ } }, 500)
  }
})

test("FC-04: real transport ACK loss, provider journal confirms, recovery reconciles, zero blind retries", async () => {
  expect(providerBaseUrl).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/)
  const storeDir = join(testDir, "store")
  const candidate = new NativeSqliteCandidate({
    storeDir,
    provider: new FakeExternalEffectProvider({ storeDir: join(testDir, "legacy-provider"), dropAckToCandidate: false }),
    version: "fc04-test",
    buildHash: "fc04-build",
  })
  await candidate.initialize()
  try {
    const started = await candidate.fc32StartScenario!({ workflowVersionId: "wf-fc04" as never, ambient: { t: "t1", r: "r1", o: "o1" } })
    // Real dispatch with a REAL lost ACK: the provider commits durably,
    // resets the connection, and the candidate HTTP client fails.
    const outcome = await candidate.fc04Dispatch!({
      runId: started.runId,
      effectKey: "ek-fc04-ack-lost",
      canonicalInput: { op: "external-write" },
      providerBaseUrl,
      mode: "drop-ack",
    })
    expect(outcome.status).toBe("UNKNOWN_EXTERNAL_STATE")
    expect(outcome.transportError).not.toBeNull()

    // Crash + reopen on the same durable store.
    await candidate.forceProcessCrash()
    await candidate.reopen()

    // Recovery consults the provider journal independently (no truth flag).
    const recovery = await candidate.fc04Recover!({ runId: started.runId, effectKey: "ek-fc04-ack-lost", providerBaseUrl })
    expect(recovery.status).toBe("RECONCILED")
    expect(recovery.providerCanonicalResult).toBeTruthy()
    expect(recovery.blindRetryCount).toBe(0)

    const m = await candidate.fc04Measure!({ runId: started.runId, providerBaseUrl })
    expect(m.measured).toBe(true)
    expect(m.attemptStatuses).toContain("UNKNOWN_EXTERNAL_STATE")
    expect(m.providerJournalConfirmsCommit).toBe(true)
    expect(m.blindRetryCount).toBe(0)
    expect(m.recoveryStatus).toBe("RECONCILED")

    // Negative control: an effect the provider NEVER saw cannot reconcile.
    const never = await candidate.fc04Recover!({ runId: started.runId, effectKey: "ek-fc04-never-committed", providerBaseUrl })
    expect(never.status).toBe("UNKNOWN_EXTERNAL_STATE")
    expect(never.providerCanonicalResult).toBeNull()
  } finally {
    await candidate.shutdown()
  }
})
