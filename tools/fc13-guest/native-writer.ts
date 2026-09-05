// FC-13 UNIFIA_NATIVE writer + post-cut inspector.
//
// WRITE mode: the candidate REAL durable commit path
// (NativeSqliteCandidate startRun + driveAttempt). The acknowledged
// attempt transition must survive the hard power cut.
//
// INSPECT mode: read ONLY durable state, emit the oracle verdict.
import { Database } from "bun:sqlite"
import { NativeSqliteCandidate } from "../../packages/automate-m0-harness/src/qualification/adapters/native-sqlite.ts"

const storePath = process.env.FC13_STORE_PATH ?? "/mnt/store"
const iteration = process.env.FC13_ITERATION ?? "0"
const mode = process.env.FC13_MODE ?? "write"

if (mode === "inspect") {
  let result = "ABSENT"
  try {
    const db = new Database(`${storePath}/native.sqlite`, { readonly: true })
    const rows = db.query("SELECT status FROM attempts ORDER BY started_at ASC").all() as { status: string }[]
    const succeeded = rows.filter((row) => row.status === "SUCCEEDED").length
    result = rows.length === 0 ? "ABSENT" : succeeded > 0 ? `PRESENT:${succeeded}` : `PENDING_ONLY:${rows.length}`
    db.close()
  } catch (error) {
    result = `CORRUPT:${String(error).slice(0, 80)}`
  }
  console.log(`FC13-RESULT native iter=${iteration} ${result}`)
  process.exit(0)
}

// WRITE mode.
const candidate = new NativeSqliteCandidate({
  storeDir: storePath,
  provider: null as never,
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
// The candidate acknowledged the durable attempt transition.
console.log(`FC13-READY native iter=${iteration} attemptId=${attempt.attemptId} status=${attempt.status}`)
await new Promise(() => {})
