// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Unifia contributors
//
// FC-13 qualification loop: N hard-loss iterations for one candidate
// (ctrl|native|dbos). Fresh store disk per iteration (plan section 16).
// Host-side evidence per iteration (plan section 17).
//
// usage: bun run fc13-loop.ts <scenario> <from> <to> <evidenceDir> <sourceCommit>
import { bootGuest, waitForPattern } from "./qemu-boot.ts"
import { writeFileSync, mkdirSync } from "node:fs"
import { join } from "node:path"

const scenario = process.argv[2] ?? "ctrl"
const from = parseInt(process.argv[3] ?? "1")
const to = parseInt(process.argv[4] ?? "20")
const evidenceDir = process.argv[5] ?? "docs/automation-v2/m0/evidence-fc13"
const sourceCommit = process.argv[6] ?? "unknown"
const root = join(import.meta.dir, "..", "..", ".tools", "fc13")
const payloadDir = join(root, "payload").replace(/\\/g, "/")
const payloadDigest: Record<string, string> = {}
for (const name of ["bun", "fc13-ctrl.js", "fc13-native.js", "fc13-dbos", "fc13-dbos-post.js", "dbos-writer.sh", "sbin/mke2fs"]) {
  try { payloadDigest[name] = require("node:crypto").createHash("sha256").update(require("node:fs").readFileSync(join(root, "payload", name))).digest("hex") } catch { payloadDigest[name] = "absent" }
}
mkdirSync(evidenceDir, { recursive: true })

let lost = 0, survived = 0, pending = 0, invalid = 0, harnessError = 0
for (let iteration = from; iteration <= to; iteration++) {
  const iterationId = `${scenario}-iter-${String(iteration).padStart(2, "0")}`
  const store = join(evidenceDir, `${iterationId}-disk.raw`)
  let readyAt = 0, bootStart = 0, killAt = 0, readyObserved = false, readyLine = ""
  // One clean retry on write-boot harness failure (host RAM pressure
  // kills QEMU occasionally); the retry re-creates the disk, so the
  // fresh-state guarantee (plan section 16) still holds.
  for (let attempt = 1; attempt <= 2; attempt++) {
    require("node:fs").writeFileSync(store, Buffer.alloc(64 * 1024 * 1024))
    bootStart = Date.now()
    try {
      const writeBoot = bootGuest({ store, payloadDir, mode: "write", scenario, iteration: String(iteration), memoryMb: 384 })
      const readyText = await waitForPattern(writeBoot, `FC13-READY ${scenario} iter=${iteration}`, 300_000)
      readyObserved = true
      readyAt = Date.now()
      readyLine = (readyText.split("\n").find((line) => line.includes("FC13-READY")) ?? "").trim()
      writeBoot.kill()
      killAt = Date.now()
      break
    } catch (error) {
      if (attempt === 2) {
        harnessError++
        writeFileSync(join(evidenceDir, `${iterationId}.json`), JSON.stringify({ candidate: scenario, iteration, iterationId, sourceCommit, payloadDigest, verdict: "HARNESS_ERROR", error: String(error).slice(0, 300) }, null, 2))
        console.log(`${iterationId}: HARNESS_ERROR ${String(error).slice(0, 120)}`)
        try { require("node:fs").rmSync(store, { force: true }) } catch {}
        continue
      }
      console.log(`${iterationId}: write-boot failure, retrying (${String(error).slice(0, 80)})`)
    }
  }
  if (!readyObserved) continue
  // INSPECT: same disk, oracle reads durable state only. dbos needs the
  // runId acknowledged before the cut (parsed from the READY line).
  const runId = (readyLine.match(/runId=(\S+)/) ?? [])[1]
  let resultLine = "no-result"
  const inspectBoot = bootGuest({ store, payloadDir, mode: "inspect", scenario, iteration: String(iteration), runId, memoryMb: 384 })
  try {
    const inspectText = await waitForPattern(inspectBoot, `FC13-RESULT ${scenario} iter=${iteration}`, 240_000)
    resultLine = (inspectText.split("\n").find((line) => line.includes("FC13-RESULT")) ?? "").trim()
  } catch (error) {
    resultLine = "HARNESS-ERROR-INSPECT " + String(error).slice(0, 120)
  } finally {
    inspectBoot.kill()
  }
  // Verdicts (frozen classification):
  //   ctrl    : ABSENT = CONTROL_LOST_WRITE (methodology requirement met)
  //   native  : PRESENT = DURABLE_SURVIVED | PENDING_ONLY = DURABLE_PENDING_ONLY | ABSENT = ACKED_TRANSITION_LOST
  //   dbos    : PRESENT (run record exists) = DURABLE_SURVIVED | ABSENT = ACKED_TRANSITION_LOST
  let verdict = "INVALID_ITERATION"
  if (resultLine.includes(" ABSENT")) {
    verdict = scenario === "ctrl" ? "CONTROL_LOST_WRITE" : "ACKED_TRANSITION_LOST"
    lost++
  } else if (resultLine.includes("PENDING_ONLY")) {
    verdict = scenario === "ctrl" ? "CONTROL_SURVIVED" : "DURABLE_PENDING_ONLY"
    pending++
  } else if (resultLine.includes("PRESENT") || resultLine.includes(" OBSERVED")) {
    verdict = scenario === "ctrl" ? "CONTROL_SURVIVED" : "DURABLE_SURVIVED"
    survived++
  } else {
    invalid++
  }
  const evidence = { candidate: scenario, iteration, iterationId, sourceCommit, payloadDigest, readyObserved, readyAt, killAt, readyKillLatencyMs: killAt - readyAt, bootDurationMs: readyAt - bootStart, readyLine, resultLine, verdict }
  writeFileSync(join(evidenceDir, `${iterationId}.json`), JSON.stringify(evidence, null, 2))
  console.log(`${iterationId}: ${verdict} (${resultLine})`)
}
console.log(`DISTRIBUTION ${scenario}: lost=${lost} survived=${survived} pending=${pending} invalid=${invalid} harnessError=${harnessError} (iterations ${from}-${to})`)
process.exit(0)
