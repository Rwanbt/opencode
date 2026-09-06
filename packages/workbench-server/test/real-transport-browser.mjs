/* SPDX-License-Identifier: MIT */
/**
 * The browser half of `real-transport.test.ts`.
 *
 * Everything else in that suite talks to the server through `fetch` in the
 * test process, which never issues a CORS preflight and never applies a
 * browser's CORS check. Those two things are the contract the desktop
 * WebView depends on, so proving them needs a real browser.
 *
 * This script runs under Node rather than Bun: Playwright's Chromium
 * transport hangs under Bun on Windows. It is spawned as a child, drives one
 * page, and prints a single JSON line on stdout. It asserts nothing — the
 * parent holds the assertions, because the parent is the only place that can
 * see the preflight (Chromium issues it from the network service, below the
 * renderer, so it never surfaces as a page request event; and
 * `access-control-allow-origin` is not a CORS-safelisted response header, so
 * page code always reads it as null).
 *
 * ## Why a real stub server rather than `page.route`
 *
 * The page has to be *at* `http://tauri.localhost`: that is the origin the
 * desktop WebView sends and the one the server's allowlist has to accept.
 *
 * Fulfilling that navigation from a route handler produces the right origin
 * but no real network address, so Chromium files the page under the
 * `unknown` address space — and Private Network Access then refuses every
 * request it makes to `127.0.0.1`:
 *
 *   Access to fetch at 'http://127.0.0.1:PORT/v1/handshake' from origin
 *   'http://tauri.localhost' has been blocked by CORS policy: Permission was
 *   denied for this request to access the `unknown` address space.
 *
 * That block is an artefact of the harness, not a property of the product:
 * the real WebView serves its page from a real origin. So the stub is served
 * over real HTTP from loopback, and `--host-resolver-rules` points
 * `tauri.localhost` at it. The URL keeps its default port, so the origin
 * stays exactly `http://tauri.localhost`, while the address space becomes
 * `local` — local to local, which is what the product does.
 *
 * Usage: node real-transport-browser.mjs '<json>'
 *   json: { baseUrl, workspaceId, token, instanceId, protocolVersion }
 * Output (last stdout line):
 *   { "ok": true,  "response": { "status": 200 } }
 *   { "ok": false, "error": "..." }
 */

import { createServer } from "node:http"

const ORIGIN = "http://tauri.localhost"
const STUB_PAGE = "<!doctype html><meta charset=utf-8><title>workbench transport probe</title>"

/** Print the one line the parent parses, then leave. */
function report(payload, code) {
  process.stdout.write(`${JSON.stringify(payload)}\n`)
  process.exitCode = code
}

/** A loopback server that answers anything with the stub page. */
function startStubServer() {
  return new Promise((resolve, reject) => {
    const server = createServer((_request, response) => {
      response.writeHead(200, { "content-type": "text/html; charset=utf-8" })
      response.end(STUB_PAGE)
    })
    server.once("error", reject)
    server.listen(0, "127.0.0.1", () => {
      const address = server.address()
      if (address === null || typeof address === "string") {
        reject(new Error("stub server did not expose a port"))
        return
      }
      resolve({ server, port: address.port })
    })
  })
}

async function main() {
  const raw = process.argv[2]
  if (!raw) {
    report({ ok: false, error: "missing argument: expected one JSON object" }, 64)
    return
  }

  let input
  try {
    input = JSON.parse(raw)
  } catch (error) {
    report({ ok: false, error: `argument is not valid JSON: ${error.message}` }, 64)
    return
  }

  let chromium
  try {
    ;({ chromium } = await import("playwright"))
  } catch (error) {
    // Distinct from a transport failure: nothing was proved either way.
    report({ ok: false, error: `playwright is not installed: ${error.message}` }, 69)
    return
  }

  const { server, port } = await startStubServer()
  let browser
  try {
    browser = await chromium.launch({
      headless: true,
      args: [`--host-resolver-rules=MAP tauri.localhost 127.0.0.1:${port}`],
    })
    const page = await browser.newPage()
    await page.goto(`${ORIGIN}/`, { waitUntil: "domcontentloaded" })

    // `content-type: application/json` and `authorization` are both
    // non-safelisted, so this is a preflighted cross-origin request — which
    // is the whole point. Every header here is in WORKBENCH_REQUEST_HEADERS;
    // the parent asserts the preflight asked for nothing outside that set.
    const status = await page.evaluate(
      async ({ baseUrl, token, instanceId, protocolVersion }) => {
        const response = await fetch(`${baseUrl}/v1/handshake`, {
          method: "POST",
          headers: {
            accept: "application/json",
            authorization: `Bearer ${token}`,
            "content-type": "application/json",
          },
          body: JSON.stringify({
            kind: "workbench.handshake",
            protocolVersion,
            supportedVersions: [protocolVersion],
            clientInstanceId: instanceId,
          }),
        })
        // Reaching here at all means the browser's own CORS check passed:
        // a refused response rejects before page code sees a status.
        return response.status
      },
      input,
    )

    report({ ok: true, response: { status } }, 0)
  } catch (error) {
    report({ ok: false, error: error instanceof Error ? error.message : String(error) }, 1)
  } finally {
    if (browser) await browser.close()
    await new Promise((resolve) => server.close(resolve))
  }
}

await main()
