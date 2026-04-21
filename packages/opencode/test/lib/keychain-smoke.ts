#!/usr/bin/env bun
/**
 * Keychain endpoint runtime smoke test (Sprint 6 item 4).
 *
 * Usage:
 *   export OPENCODE_KEYCHAIN_URL=http://127.0.0.1:<port>
 *   export OPENCODE_KEYCHAIN_TOKEN=<token>
 *   bun run packages/opencode/test/lib/keychain-smoke.ts
 *
 * How to obtain the env vars:
 *   1. Launch the desktop shell (`bun tauri dev` or a packaged build).
 *   2. Watch stdout for the line:
 *        `keychain endpoint listening at http://127.0.0.1:XXXXX`
 *   3. The token is printed alongside (log level info). Copy both into the
 *      exports above.
 *
 * What this script does:
 *   - PUT  /kc/<service>/<key>   (upsert)
 *   - GET  /kc/<service>/<key>   (expect 200 + matching value)
 *   - DELETE /kc/<service>/<key> (expect 204)
 *   - GET  /kc/<service>/<key>   (expect 404)
 *
 * Exit codes:
 *   0 — round-trip OK
 *   1 — env missing or any step failed
 */

const url = process.env.OPENCODE_KEYCHAIN_URL
const token = process.env.OPENCODE_KEYCHAIN_TOKEN

if (!url || !token) {
  console.error("ERROR: OPENCODE_KEYCHAIN_URL and OPENCODE_KEYCHAIN_TOKEN must be set.")
  console.error("       Start the desktop shell, copy the values from its stdout, then re-run.")
  process.exit(1)
}

const service = "smoke"
const key = `smoke-${Date.now()}`
const value = "hello-from-smoke-" + Math.random().toString(36).slice(2, 10)

const endpoint = `${url.replace(/\/$/, "")}/kc/${encodeURIComponent(service)}/${encodeURIComponent(key)}`
const headers = { "X-Keychain-Token": token, "Content-Type": "application/octet-stream" }

function fail(step: string, status: number, body: string): never {
  console.error(`FAIL ${step}: status=${status} body=${body}`)
  process.exit(1)
}

// PUT
{
  const res = await fetch(endpoint, { method: "PUT", headers, body: JSON.stringify(value) })
  if (!res.ok && res.status !== 204) fail("PUT", res.status, await res.text().catch(() => ""))
  console.log(`PUT    ${key} -> ${res.status}`)
}

// GET (expect match)
{
  const res = await fetch(endpoint, { method: "GET", headers })
  if (!res.ok) fail("GET", res.status, await res.text().catch(() => ""))
  const { value: got } = (await res.json()) as { value: string }
  let parsed: unknown
  try {
    parsed = JSON.parse(got)
  } catch {
    parsed = got
  }
  if (parsed !== value) fail("GET/match", res.status, `expected=${value} got=${String(parsed)}`)
  console.log(`GET    ${key} -> ${res.status} OK`)
}

// DELETE
{
  const res = await fetch(endpoint, { method: "DELETE", headers })
  if (!res.ok && res.status !== 204) fail("DELETE", res.status, await res.text().catch(() => ""))
  console.log(`DELETE ${key} -> ${res.status}`)
}

// GET (expect 404)
{
  const res = await fetch(endpoint, { method: "GET", headers })
  if (res.status !== 404) fail("GET-after-delete", res.status, await res.text().catch(() => ""))
  console.log(`GET    ${key} -> 404 (expected)`)
}

console.log("\nOK — keychain endpoint round-trip passed.")
process.exit(0)
