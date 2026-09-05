// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Unifia contributors
//
// FC-13 qualification loop: N hard-loss iterations for one candidate
// (ctrl|native|dbos). Fresh store disk per iteration (plan section 16).
// Host-side evidence per iteration (plan section 17).
//
// usage: bun run fc13-loop.ts <scenario> <from> <to> <evidenceDir>
import { bootGuest, waitForPattern } from "./qemu-boot.ts"
import { writeFileSync, mkdirSync, statSync } from "node:fs"
import { join } from "node:path"

const scenario = process.argv[2] ?? "ctrl"
const from = parseInt(process.argv[3] ?? "1")
const to = parseInt(process.argv[4] ?? "20")
const evidenceDir = process.argv[5] ?? "docs/automation-v2/m0/evidence-fc13"
const sourceCommit = process.argv[6] ?? "unknown"
const root = join(import.meta.dir, "..", "..", ".tools", "fc13")
const payloadDir = join(root, "payload").replace(/\\/g, "/")
const payloadDigest = {}
for (const name of ["bun", "fc13-ctrl.js", "fc13-native.js", "fc13-dbos", "dbos-writer.sh", "sbin/mke2fs"]) {
  try { payloadDigest[name] = require("node:crypto").createHash("sha256").update(require("node:fs").readFileSync(join(root, "payload", name))).digest("hex") } catch { payloadDigest[name] = "absent" }
}
mkdirSync(evidenceDir, { recursive: true })

let lost = 0, survived = 0, invalid = 0, harnessError = 0
for (let iteration = from; iteration <= to; iteration++) {
  const iterationId = `${scenario}-iter-${String(iteration).padStart(2, "0")}`
  const store = join(evidenceDir, `${iterationId}-disk.raw`)
  require("node:fs").writeFileSync(store, Buffer.alloc(64 * 1024 * 1024))
  let readyAt = 0, bootStart = Date.now(), killAt = 0, readyObserved = false, readyLine = ""
  try {
    const writeBoot = bootGuest({ store, payloadDir, mode: "write", scenario, iteration: String(iteration) })
    const readyText = await waitForPattern(writeBoot, `FC13-READY ${scenario} iter=${iteration}`, 300_000)
    readyObserved = true
    readyAt = Date.now()
    readyLine = (readyText.split("\n").find((line) => line.includes("FC13-READY")) ?? "").trim()
    writeBoot.kill()
    killAt = Date.now()
  } catch (error) {
    harnessError++
    writeFileSync(join(evidenceDir, `${iterationId}.json`), JSON.stringify({ candidate: scenario, iteration, sourceCommit, payloadDigest, verdict: "HARNESS_ERROR", error: String(error).slice(0, 300) }, null, 2))
    console.log(`${iterationId}: HARNESS_ERROR ${String(error).slice(0, 120)}`)
    try { require("node:fs").rmSync(store, { force: true }) } catch {}
    continue
  }
  // INSPECT: same disk, oracle reads durable state only.
  let resultLine = "no-result"
  try {
    const inspectBoot = bootGuest({ store, payloadDir, mode: "inspect", scenario, iteration: String(iteration) })
    const inspectText = await waitForPattern(inspectBoot, `FC13-RESULT ${scenario} iter=${iteration}`, 240_000)
    resultLine = (inspectText.split("\n").find((line) => line.includes("FC13-RESULT")) ?? "").trim()
    inspectBoot.kill()
  } catch (error) {
    inspectBoot.kill()
    resultLine = "HARNESS-ERROR-INSPECT " + String(error).slice(0, 120)
  }
  let verdict = "INVALID_ITERATION"
  if (resultLine.includes(" ABSENT") || resultLine.includes("CORRUPT:unable to open")) { verdict = "CONTROL_LOST_WRITE"; lost++ }
  else if (resultLine.includes("PRESENT") || resultLine.includes("PENDING_ONLY")) { verdict = "CONTROL_SURVIVED"; survived++ }
  else { invalid++; verdict = "INVALID_ITERATION" }
  const evidence = { candidate: scenario, iteration, iterationId, sourceCommit, payloadDigest, readyObserved, readyAt, killAt, readyKillLatencyMs: killAt - readyAt, bootDurationMs: readyAt - bootStart, readyLine, resultLine, verdict }
  writeFileSync(join(evidenceDir, `${iterationId}.json`), JSON.stringify(evidence, null, 2))
  console.log(`${iterationId}: ${verdict} (${resultLine})`)
}
console.log(`DISTRIBUTION ${scenario}: lost=${lost} survived=${survived} invalid=${invalid} harnessError=${harnessError} (iterations ${from}-${to})`)
process.exit(0)
