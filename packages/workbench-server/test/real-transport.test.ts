/* SPDX-License-Identifier: MIT */

import { existsSync, mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"

import { mkdtemp, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { test } from "bun:test"
import { WIRE_PROTOCOL_VERSION, WORKBENCH_REQUEST_HEADERS } from "@unifia/contracts/workbench-wire"
import { WorkbenchClient } from "@unifia/workbench-shell"
import { createWorkbenchApp, type WorkbenchConfig } from "../src/bootstrap.js"

const signingKey = "workbench-real-transport-test-signing-key-0123456789"
const TAURI_ORIGIN = "http://tauri.localhost"

type ObservedPreflight = { headers: Record<string, string>; allowOrigin: string | null }

test("real Workbench transport exercises client, loopback HTTP, and browser CORS", async () => {
  // WHY a temp dir: the audit path used to resolve under the package itself,
  // so every run rewrote a git-tracked file and left the working tree dirty.
  const auditRoot = await mkdtemp(path.join(os.tmpdir(), "unifia-real-transport-"))
  const config: WorkbenchConfig = {
    signingKey,
    issuer: "unifia-real-transport-test",
    audience: "workbench",
    host: "127.0.0.1",
    port: 0,
    runtime: "fake",
    auditLogPath: path.join(auditRoot, ".unifia", "real-transport-audit.jsonl"),
    rateBudget: 240,
    rateWindowMs: 60_000,
    allowlistedCapabilities: new Set(),
    artifactRoot: mkdtempSync(path.join(tmpdir(), "unifia-artifacts-")),
    presentLinkTtlMs: 60_000,
  }
  const app = createWorkbenchApp(config)

  // The preflight is observed HERE, not in the browser. Chromium issues it from
  // the network service, below the renderer, so Playwright never surfaces it as
  // a page request event — and `access-control-allow-origin` is not a
  // CORS-safelisted response header, so page code always reads it as null. The
  // socket the browser actually talks to is the only place both are visible.
  const preflights: ObservedPreflight[] = []
  const listener = Bun.serve({
    hostname: config.host,
    port: config.port,
    idleTimeout: 0,
    fetch: async (request) => {
      const response = await app.server.fetch(request)
      if (request.method === "OPTIONS" && new URL(request.url).pathname === "/v1/handshake") {
        preflights.push({
          headers: Object.fromEntries(request.headers.entries()),
          allowOrigin: response.headers.get("access-control-allow-origin"),
        })
      }
      return response
    },
  })
  const port = listener.port
  if (typeof port !== "number") throw new Error("real transport listener did not expose an automatic port")
  const baseUrl = `http://${config.host}:${port}`
  const workspaceId = "real-transport-workspace"
  const lease = app.tokenIssuer.issue({
    principalId: "playwright-test",
    workspaceId,
    instanceId: app.server.instanceId,
    capabilities: ["workspace.read", "workspace.watch"],
  })
  try {
    const client = new WorkbenchClient({
      baseUrl,
      instanceId: lease.instanceId,
      token: {
        current: () => lease.token,
        refresh: async () => lease.token,
      },
    })
    const handshake = await client.handshake()
    if (!handshake.accepted || handshake.instanceId !== app.server.instanceId) {
      throw new Error("production WorkbenchClient did not complete the real loopback handshake")
    }

    // The browser half runs under Node: Playwright's Chromium transport hangs
    // under Bun on Windows (see test/real-transport-browser.mjs for the
    // evidence). Assertions stay here; the child only reports what it observed.
    const runner = fileURLToPath(new URL("./real-transport-browser.mjs", import.meta.url))
    // `.gitignore:154` excludes this harness, so it exists only on a machine
    // that built it by hand. Everywhere else `node` exits with
    // MODULE_NOT_FOUND, stdout is empty, and the parse below reported
    // "JSON Parse error: Unexpected EOF" — which sends the reader after a
    // transport bug that is not there. Say what is actually missing.
    if (!existsSync(runner)) {
      throw new Error(
        `browser transport harness is missing: ${runner}\n` +
          "It is excluded by .gitignore:154, so it is absent from every clone. " +
          "Either commit it or drop the test — this suite cannot prove the browser half without it.",
      )
    }
    const child = Bun.spawn(
      ["node", runner, JSON.stringify({ baseUrl, workspaceId, token: lease.token, instanceId: lease.instanceId, protocolVersion: WIRE_PROTOCOL_VERSION })],
      { stdout: "pipe", stderr: "pipe" },
    )
    const [stdout, stderr] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text()])
    await child.exited
    const observed = JSON.parse(stdout.trim().split("\n").at(-1) ?? "{}") as
      | { ok: true; response: { status: number } }
      | { ok: false; error: string }
    if (!observed.ok) {
      throw new Error(`browser transport harness failed: ${"error" in observed ? observed.error : "unknown"}${stderr ? `\n${stderr}` : ""}`)
    }

    // A real browser only hands the response to page code once its own CORS
    // check passes, so a 200 here already proves the server answered with an
    // allow-origin the browser accepted for this origin.
    if (observed.response.status !== 200) {
      throw new Error(`browser handshake failed: status=${observed.response.status}`)
    }

    if (preflights.length !== 1) throw new Error(`expected one real browser preflight, observed ${preflights.length}`)
    const preflight = preflights[0]
    if (preflight.headers.origin !== TAURI_ORIGIN) throw new Error("browser preflight did not carry the supported Tauri origin")
    if (preflight.allowOrigin !== TAURI_ORIGIN) throw new Error(`preflight answered allow-origin=${preflight.allowOrigin}, expected ${TAURI_ORIGIN}`)
    const requestedHeaders = preflight.headers["access-control-request-headers"]?.split(",").map((header) => header.trim()) ?? []
    const missing = requestedHeaders.filter((header) => !WORKBENCH_REQUEST_HEADERS.includes(header as (typeof WORKBENCH_REQUEST_HEADERS)[number]))
    if (missing.length > 0) throw new Error(`real CORS preflight omitted client headers: ${missing.join(",")}`)
  } finally {
    await app.server.shutdown()
    await listener.stop(true)
    await rm(auditRoot, { recursive: true, force: true })
  }
})
