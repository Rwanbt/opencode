// FC-13 UNIFIA_NATIVE writer + post-cut inspector.
// WRITE mode: the candidate REAL durable commit path
// (NativeSqliteCandidate startRun + driveAttempt with a real in-process
// provider). The acknowledged attempt transition must survive the cut.
// INSPECT mode reads ONLY the durable attempts table.
import { Database } from "bun:sqlite"
import { NativeSqliteCandidate } from "../../packages/automate-m0-harness/src/qualification/adapters/native-sqlite.ts"
import { FakeExternalEffectProvider } from "../../packages/automate-m0-harness/src/qualification/providers/fake-external.ts"

const storeDir = process.env.FC13_STORE_DIR ?? "/mnt/store"
const iteration = process.env.FC13_ITERATION ?? "0"
const mode = process.env.FC13_MODE ?? "write"

if (mode === "inspect") {
  let result = "ABSENT"
  try {
    const db = new Database(`${storeDir}/native.sqlite`, { readonly: true })
    const rows = db.query("SELECT status FROM attempts ORDER BY started_at ASC").all() as { status: string }[]
    const succeeded = rows.filter((row) => row.status === "SUCCEEDED").length
    result = rows.length === 0 ? "ABSENT" : succeeded > 0 ? `PRESENT:${succeeded}` : `PENDING_ONLY:${rows.length}`
    db.close()
  } catch (error) {
    result = `CORRUPT:${String(error).slice(0, 60)}`
  }
  console.log(`FC13-RESULT native iter=${iteration} ${result}`)
  process.exit(0)
}

const provider = new FakeExternalEffectProvider({ storeDir: "/tmp/fake-provider", dropAckToCandidate: false })
await provider.initialize()
const candidate = new NativeSqliteCandidate({
  storeDir,
  version: "fc13",
  buildHash: "fc13-build",
})
await candidate.initialize()
const runId = await candidate.startRun({
  workflowVersionId: "wf-fc13" as never,
  ownerScope: { organizationId: "o1", workspaceId: "ws-fc13" },
  initialLogicalInvocation: {
    logicalInvocationId: `li-fc13-${iteration}` as never,
    effectKey: `ek-fc13-${iteration}`,
    canonicalInput: { iteration },
  },
  seedCanonicalValue: { iteration },
})
const attempt = await candidate.driveAttempt(runId, `li-fc13-${iteration}` as never, {
  effectKey: `ek-fc13-${iteration}`,
  outcome: "SUCCEEDED",
  canonicalResult: { iteration, durable: true },
  ackLost: false,
  idempotencyKey: `ik-fc13-${iteration}`,
  providerCommittedAtEpochMs: Date.now(),
})
console.log(`FC13-READY native iter=${iteration} attemptId=${attempt.attemptId} status=${attempt.status} runId=${runId}`)
await new Promise(() => {})
