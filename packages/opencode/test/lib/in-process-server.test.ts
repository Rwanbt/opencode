import { describe, it, expect } from "bun:test"
import { withInProcessServer } from "./in-process-server"

describe("withInProcessServer", () => {
  it("boots on a random port and responds to a basic request", async () => {
    const h = await withInProcessServer({ password: "test" })
    try {
      expect(h.port).toBeGreaterThan(0)
      // Hit any unauthenticated route — /doc serves openapi spec with no auth
      // required, so it's a good smoke check that the Hono app is reachable.
      const r = await h.fetch("/doc")
      // 200 (openapi spec) or 401 if auth is enforced — either proves the
      // listener is live and routing requests to the app. We only require a
      // response, not a specific status, to keep this test decoupled from
      // auth config changes.
      expect(r.status).toBeGreaterThan(0)
    } finally {
      await h.close()
    }
  })
})
