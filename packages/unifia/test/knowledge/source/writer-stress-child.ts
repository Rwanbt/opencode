/* SPDX-License-Identifier: MIT */
/**
 * Helper for the W-MUT-04 cross-process stress test.
 *
 * The parent (`writer-stress.test.ts`) spawns N copies of this script
 * and releases them simultaneously by writing the "go" file. Each
 * child opens the same vault, waits at the barrier, and creates one
 * note. The lock then serialises them and the parent inspects the
 * result. The script lives next to the test so its imports resolve
 * against its own location.
 */

import { existsSync, writeFileSync, appendFileSync, mkdirSync } from "node:fs"
import { join, dirname, resolve } from "node:path"
import { VaultMutationWriter } from "../../../src/knowledge/mutation/writer.js"

const root = process.argv[2]
const id = process.argv[3]
const readyDir = process.argv[4]
const goFile = process.argv[5]

if (root === undefined || id === undefined || readyDir === undefined || goFile === undefined) {
  console.error("usage: writer-stress-child.ts <root> <id> <readyDir> <goFile>")
  process.exit(64)
}

const log = (msg: string) => {
  try {
    const logFile = join(readyDir, `${id}.log`)
    appendFileSync(logFile, `${new Date().toISOString()} ${msg}\n`)
  } catch {
    // best effort
  }
}

log(`start pid=${process.pid}`)

const readyMarker = join(readyDir, `${id}.ready`)
writeFileSync(readyMarker, String(process.pid))
log(`ready written`)

let waited = 0
while (!existsSync(goFile)) {
  await new Promise((r) => setTimeout(r, 5))
  waited += 5
  if (waited > 60_000) {
    log(`timeout waiting for go file`)
    process.exit(4)
  }
}
log(`go file seen after ${waited}ms`)

try {
  log(`opening writer`)
  const w = new VaultMutationWriter({ root })
  log(`writer opened`)
  const r = await w.apply({
    intent: {
      kind: "create",
      targetLocator: `notes/${id}.md`,
      newContent: {
        type: "decision",
        restrictions: { remoteModel: "deny", localModel: "allow", embeddable: "allow", exportable: "deny" },
        body: `from ${id}`,
      },
      reason: "stress",
      source: `child-${id}`,
    },
    reason: "stress",
    source: `child-${id}`,
  })
  log(`apply result applied=${r.applied}`)
  process.exit(r.applied ? 0 : 2)
} catch (e) {
  log(`apply failed: ${(e as Error).message}`)
  console.error("child failed:", (e as Error).message)
  process.exit(3)
}

void resolve
void dirname
void mkdirSync
