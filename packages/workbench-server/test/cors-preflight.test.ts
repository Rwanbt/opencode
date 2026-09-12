/* SPDX-License-Identifier: MIT */

import { describe, expect, it } from "vitest"
import { WorkbenchServer } from "../src/index.js"

describe("workbench CORS preflight", () => {
  it("answers the native preflight without authenticating the browser request", async () => {
    const server = new WorkbenchServer({
      auth: { authenticate: async () => undefined },
      workspace: {} as never,
      runtime: {} as never,
      audit: { record: () => undefined },
      capability: { check: async () => "deny" },
    })
    const response = await server.fetch(new Request("http://127.0.0.1/v1/workspaces", {
      method: "OPTIONS",
      headers: { origin: "http://ipc.localhost", "access-control-request-method": "POST" },
    }))
    expect(response.status).toBe(204)
    expect(response.headers.get("access-control-allow-origin")).toBe("http://ipc.localhost")
    expect(response.headers.get("access-control-allow-methods")).toContain("POST")
  })
})
