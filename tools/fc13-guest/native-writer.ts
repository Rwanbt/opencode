// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Unifia contributors

// FC-13 UNIFIA_NATIVE writer: the candidate REAL durable commit path
// (NativeSqliteCandidate startRun + driveAttempt - the attempt row is
// a durable transition acknowledged by the candidate). The
// acknowledged transition must survive the hard power cut.
import { NativeSqliteCandidate } from "@unifia/automate-m0-harness/qualification/adapters/native-sqlite.ts"

const storePath = process.env.FC13_STORE_PATH ?? "/mnt/store"
const readyUrl = process.env.FC13_READY_URL ?? "http://10.0.2.2:8099/ready"
const iteration = process.env.FC13_ITERATION ?? "0"

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
console.log(`FC13-ACK ${attempt.attemptId} ${attempt.status}`)
const ready = await fetch(`${readyUrl}?iter=${iteration}&who=native&ack=${attempt.status}`, { signal: AbortSignal.timeout(10_000) }).catch(() => null)
if (!ready) console.log("READY-SIGNAL-FAILED")
await new Promise(() => {})
