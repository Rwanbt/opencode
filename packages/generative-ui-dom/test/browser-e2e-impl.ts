/* SPDX-License-Identifier: MIT */

/**
 * End-to-end proof in a real browser — the part that runs under Node.
 *
 * Chain exercised: real Chromium loads a page over a real socket, mounts a
 * server-described UI with the real DOM consumer, a real click is dispatched,
 * the request travels back over HTTP into `WorkbenchServer.fetch`, and the
 * decision lands in the durable audit log.
 *
 * Scope, stated precisely rather than overclaimed: the browser-to-server hop is
 * real HTTP through `node:http`, so routing, serialisation and the DOM are all
 * genuinely exercised. The `Bun.serve` adapter specifically is not — that is
 * covered by workbench-server/test/bootstrap.test.ts, which drives the same
 * server through `Bun.serve` over a real socket.
 *
 * WHY the harness holds the tokens: the page and the workbench would otherwise
 * be different origins, and opening CORS on a server that holds filesystem
 * capabilities to satisfy a test is the wrong trade. Keeping the credentials
 * server-side is also the posture a real deployment wants — the browser never
 * sees a bearer token.
 *
 * WHY Node and not Bun: playwright cannot drive Chromium under Bun through
 * either transport (pipe needs stdio fds 3 and 4; connectOverCDP's websocket
 * handshake never completes). browser.e2e.ts bundles this file for Node with
 * `bun build`, which also sidesteps Node's inability to resolve the `.js`
 * specifiers the workspace uses for `.ts` files.
 */

import { createServer } from "node:http"
import { mkdtemp, readFile, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { McpUiControlBroker } from "@unifia/contracts"
import { HmacTokenAuthenticator } from "@unifia/workbench-server"
import { createWorkbenchApp, loadConfigFromEnv } from "@unifia/workbench-server/bootstrap"
import { chromium } from "playwright"

let checks = 0
const check = (condition: boolean, message: string): void => {
  checks += 1
  if (!condition) throw new Error(message)
}

const SIGNING_KEY = "unifia-browser-e2e-signing-key-0123456789"
const UI_ACTIONS = new Set(["ui.run"])
const bundlePath = process.env.UNIFIA_E2E_BROWSER_BUNDLE
if (!bundlePath) throw new Error("UNIFIA_E2E_BROWSER_BUNDLE is required")
const script = await readFile(bundlePath, "utf8")

const root = await mkdtemp(path.join(os.tmpdir(), "unifia-e2e-"))
const auditLogPath = path.join(root, ".unifia", "audit.jsonl")
const config = loadConfigFromEnv({ UNIFIA_WORKBENCH_SIGNING_KEY: SIGNING_KEY, UNIFIA_WORKBENCH_AUDIT_LOG: auditLogPath })

// desktop.control is allowlisted so the capability gate does not intercept
// before the UI broker is reached: this suite proves the broker's own refusal,
// which server.test.ts does not cover end to end.
//
// The allowlist alone stopped being enough with the SEC-001/C2-3 matrix of
// 2026-08-17: #checkCapability now refuses any capability absent from
// principal.scopes BEFORE consulting the gate, and desktop.control is
// deliberately not step-up eligible (see STEP_UP_ELIGIBLE_CAPABILITIES). The
// principal below therefore carries the scope — which is what a caller with a
// legitimate reason to drive the desktop holds — so the request reaches the
// broker and the approval path stays under test rather than failing closed.
const app = createWorkbenchApp(
  { ...config, allowlistedCapabilities: new Set(["desktop.control"]) },
  {
    ui: new McpUiControlBroker({ inspect: async (componentId) => ({ componentId }), execute: async () => ({}) }, ["run"], { request: () => ({ id: "ui-approval-e2e" }) }),
    uiAllowedActions: UI_ACTIONS,
  },
)

const signer = new HmacTokenAuthenticator(SIGNING_KEY, config.issuer, config.audience)
const token = signer.sign({ id: "e2e", scopes: new Set(["workspace.register", "workspace.open", "desktop.control"]), workspaces: "*" }, Date.now() + 600_000)
const bearer = { authorization: `Bearer ${token}`, "content-type": "application/json" }
const call = (url: string, init: RequestInit) => app.server.fetch(new Request(`http://workbench${url}`, init))

const registered = await call("/v1/workspaces/register", { method: "POST", headers: bearer, body: JSON.stringify({ name: "e2e", path: root }) })
const workspace = await registered.json() as { id: string }
const opened = await call(`/v1/workspaces/${workspace.id}/open`, { method: "POST", headers: bearer })
const session = await opened.json() as { id: string; token: string }
const scoped = { ...bearer, "x-unifia-file-session": session.token }

const PAGE = `<!doctype html><html><body><div id="root"></div><script type="module">${script}</script></body></html>`

const harness = createServer((request, response) => {
  void (async () => {
    const url = new URL(request.url ?? "/", "http://127.0.0.1")
    if (url.pathname === "/") {
      response.writeHead(200, { "content-type": "text/html; charset=utf-8" })
      response.end(PAGE)
      return
    }
    if (url.pathname === "/ui") {
      const node = { type: "panel", id: "root", props: { title: "Generated" }, children: [{ type: "button", id: "run", props: { label: "Run report", actionId: "ui.run" } }] }
      const rendered = await call("/v1/ui/render", { method: "POST", headers: scoped, body: JSON.stringify({ workspaceId: session.id, node }) })
      response.writeHead(rendered.status, { "content-type": "application/json" })
      response.end(await rendered.text())
      return
    }
    if (url.pathname === "/action" && request.method === "POST") {
      const chunks: Buffer[] = []
      for await (const chunk of request) chunks.push(chunk as Buffer)
      const action = JSON.parse(Buffer.concat(chunks).toString("utf8")) as { componentId: string; actionId: string }
      const forwarded = await call("/v1/ui/actions", {
        method: "POST",
        headers: scoped,
        body: JSON.stringify({ workspaceId: session.id, action: { id: action.actionId.replace(/[^A-Za-z0-9_-]/g, "-"), componentId: action.componentId, kind: "click" } }),
      })
      response.writeHead(forwarded.status, { "content-type": "application/json" })
      response.end(await forwarded.text())
      return
    }
    response.writeHead(404)
    response.end("not found")
  })().catch((error: unknown) => {
    // WHY it answers 500 instead of swallowing: a harness failure must surface
    // as a page error the assertions can see, not as a silent hang.
    response.writeHead(500)
    response.end(String(error))
  })
})
await new Promise<void>((resolve) => harness.listen(0, "127.0.0.1", resolve))
const address = harness.address()
if (!address || typeof address !== "object") throw new Error("the harness did not bind a port")

const browser = await chromium.launch()
try {
  const page = await browser.newPage()
  const pageErrors: string[] = []
  page.on("pageerror", (error) => pageErrors.push(error.message))
  page.on("console", (message) => { if (message.type() === "error") pageErrors.push(message.text()) })

  await page.goto(`http://127.0.0.1:${address.port}/`, { waitUntil: "domcontentloaded" })
  await page.waitForSelector("section[data-unifia-id='root']", { timeout: 15_000 })

  check(await page.locator("section[data-unifia-id='root']").getAttribute("aria-label") === "Generated", "the panel did not mount with its accessible label in a real browser")
  const button = page.locator("button[data-unifia-id='run']")
  check(await button.textContent() === "Run report", "the button label did not render in a real browser")
  check(await button.getAttribute("onclick") === null, "an onclick attribute survived into a real browser")
  check(await page.locator("#root script").count() === 0, "a script element was created inside the mounted tree")

  await button.click()
  await page.waitForFunction("window.__unifiaLastResult !== undefined", undefined, { timeout: 15_000 })
  const result = await page.evaluate("window.__unifiaLastResult") as { status: number; body: { result?: { status: string; approvalId?: string } } }

  // The point of the whole chain: a click coming from a generated UI does not
  // execute. It becomes an approval request.
  check(result.status === 202, `the forwarded UI action returned ${result.status} instead of 202 pending-approval`)
  check(result.body.result?.status === "pending-approval", `the broker returned ${result.body.result?.status} instead of pending-approval`)
  check(typeof result.body.result?.approvalId === "string", "no approval id reached the browser")
  check(pageErrors.length === 0, `the page reported errors: ${pageErrors.join(" | ")}`)

  const audit = (await readFile(auditLogPath, "utf8")).trim().split("\n").map((line) => JSON.parse(line) as { capability: string; decision: string })
  check(audit.some((entry) => entry.capability === "ui.action" && entry.decision === "allow"), "the UI action was not recorded in the durable audit log")
  check(audit.some((entry) => entry.capability === "ui.render" && entry.decision === "allow"), "the UI render was not recorded in the durable audit log")

  console.log(`GenerativeUiBrowserE2E: ${checks}/${checks} passed`)
} finally {
  await browser.close()
  await new Promise<void>((resolve) => harness.close(() => resolve()))
  await app.server.shutdown()
  await rm(root, { recursive: true, force: true })
}
