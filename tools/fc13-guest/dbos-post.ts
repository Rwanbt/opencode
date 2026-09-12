// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Unifia contributors
// FC-13 DBOS HTTP client (in-guest, run by bun): POST /runs (write mode)
// or GET /runs/<id> (inspect mode) against the REAL DBOS Go binary.
// The Alpine initramfs has no working HTTP client for the guest shell
// (busybox nc returns empty responses), so the HTTP path uses bun fetch,
// the same execution environment the other FC-13 writers are proven in.
const base = process.argv[2] ?? process.env.DBOS_BASE ?? ""
const mode = process.env.FC13_MODE ?? "write"
const iteration = process.env.FC13_ITERATION ?? "0"
const runIdIn = process.env.FC13_RUN_ID ?? ""

if (!base) { console.log("DBOS-CLIENT-ERROR no base"); process.exit(1) }

const health = await fetch(`http://${base}/healthz`)
if (!health.ok) throw new Error(`healthz ${health.status}`)

if (mode === "inspect") {
  const r = await fetch(`http://${base}/runs/${encodeURIComponent(runIdIn)}`)
  const text = r.ok ? await r.text() : ""
  const verdict = text.includes("run-") ? "PRESENT" : text.trim().length > 0 ? "OBSERVED" : "ABSENT"
  console.log(`FC13-RESULT dbos iter=${iteration} ${verdict}`)
  process.exit(0)
}

const body = {
  workflowVersionId: "wf-fc13",
  organizationId: "o1",
  workspaceId: "ws-fc13",
  logicalInvocationId: `li-fc13-${iteration}`,
  effectKey: `ek-fc13-${iteration}`,
  canonicalInputJson: "",
  seedCanonicalJson: "",
}
const r = await fetch(`http://${base}/runs`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })
const text = await r.text()
if (!r.ok) throw new Error(`POST /runs ${r.status}: ${text.slice(0, 200)}`)
const runId = (text.match(/run-[a-z0-9-]+/) ?? [])[0]
if (!runId) throw new Error(`no runId in response: ${text.slice(0, 200)}`)
console.log(`DBOS-POST-OK runId=${runId}`)