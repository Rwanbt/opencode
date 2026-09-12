/* SPDX-License-Identifier: MIT */
import { strict as assert } from "node:assert"
import { createServer } from "node:http"
import { mkdtemp, readFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { PlaywrightBrowserDriver } from "../src/playwright-driver.ts"

const server = createServer((_request, response) => { response.writeHead(200, { "content-type": "text/html" }); response.end('<main><h1>Unifia E2E</h1><p id="secret">secret-value</p></main>') })
await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
const address = server.address()
assert.ok(address && typeof address === "object")
const root = await mkdtemp(join(tmpdir(), "unifia-browser-"))
const driver = new PlaywrightBrowserDriver(root)
const profile = { workspaceId: "workspace-e2e", profileId: "browser-workspace-e2e", hostAllowlist: ["127.0.0.1"], cookiesIsolated: true as const, redactSelectors: ["#secret"] }
try {
  await driver.navigate(profile, `http://127.0.0.1:${address.port}/`)
  const snapshot = await driver.snapshot(profile)
  assert.match(String(snapshot), /Unifia E2E/)
  const screenshot = await driver.screenshot(profile)
  assert.ok(screenshot.byteLength > 100)
  const path = await driver.quarantineDownload(profile, "result.txt", new TextEncoder().encode("quarantined"))
  assert.equal(await readFile(path, "utf8"), "quarantined")
  console.log("PlaywrightBrowserDriver E2E: 4/4 passed")
} finally { await driver.close(); server.close(); await rm(root, { recursive: true, force: true }) }
