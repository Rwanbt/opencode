/* SPDX-License-Identifier: MIT */
// Throwaway measurement script — not part of the test suite.
// Run with: `bun --expose-gc test/bench.ts`
//
// Produces a JSON line on stdout with the heap delta after 1 000 000
// `logger.info("bench")` calls. Captured into the EVIDENCE file.
import { createStructuredLogger, type LogSink } from "../src/index.js"
import type { DeploymentScope, OwnershipScope } from "@unifia/contracts"

const SCOPE_A: OwnershipScope = { organizationId: "org-A", workspaceId: "ws-1" }
const DEPLOY_A: DeploymentScope = { ownershipScope: SCOPE_A, environmentId: "prod" }

const sink: LogSink = { write() {} }
const logger = createStructuredLogger({ sink, scope: SCOPE_A, deployment: DEPLOY_A })

if (typeof globalThis.gc === "function") globalThis.gc()
const before = process.memoryUsage().heapUsed
for (let i = 0; i < 1_000_000; i++) logger.info("bench")
const after = process.memoryUsage().heapUsed
const delta = after - before
console.log(
  JSON.stringify({
    before_bytes: before,
    after_bytes: after,
    delta_bytes: delta,
    delta_kb: Math.round(delta / 1024),
    buffered: logger.buffered(),
    dropped: logger.dropped(),
    capacity_honored: logger.buffered() + logger.dropped() === 1_000_000,
  }),
)
