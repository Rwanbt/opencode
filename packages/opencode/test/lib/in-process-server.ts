/**
 * In-process server helper (Sprint 5 — item 3).
 *
 * Boots the production `Server.listen` on a random local port using the
 * existing bun-test preload (OPENCODE_DB=:memory:, XDG_* rooted in a tmpdir).
 * Intended for e2e tests that want to hit real HTTP routes without standing
 * up a separate process.
 *
 * Usage:
 *   const h = await withInProcessServer({ password: "test" })
 *   try {
 *     const r = await h.fetch("/health")
 *   } finally {
 *     await h.close()
 *   }
 *
 * Caller is responsible for setting up any required auth state (e.g. via
 * `OPENCODE_SERVER_PASSWORD`). For provider calls, pair with `createMockProvider`
 * or `TestLLMServer` to avoid real network.
 *
 * Known limits — acknowledged for Sprint 5:
 *   - The `team` tool runtime requires Instance/Workspace/Permission scopes
 *     the unit preload does not bootstrap. DAG-level e2e (orchestrator →
 *     explore/critic/tester) remains skipped until `Instance.run` is exposed
 *     for tests. The helper here lets us unblock *everything else* (auth,
 *     CRUD routes, WS ticket flow end-to-end) in-process.
 */
import { Server } from "../../src/server/server"

export interface InProcessServer {
  url: string
  port: number
  fetch: (path: string, init?: RequestInit) => Promise<Response>
  close: () => Promise<void>
}

export interface InProcessServerOptions {
  /** Basic-auth password for the server. Set via OPENCODE_SERVER_PASSWORD env. */
  password?: string
  /** Basic-auth username. Default "opencode". */
  username?: string
  /** Additional env overrides applied before boot and restored on close. */
  env?: Record<string, string | undefined>
}

export async function withInProcessServer(opts: InProcessServerOptions = {}): Promise<InProcessServer> {
  const prevPassword = process.env.OPENCODE_SERVER_PASSWORD
  const prevUsername = process.env.OPENCODE_SERVER_USERNAME
  const saved: Record<string, string | undefined> = {}
  if (opts.env) {
    for (const k of Object.keys(opts.env)) {
      saved[k] = process.env[k]
      if (opts.env[k] === undefined) delete process.env[k]
      else process.env[k] = opts.env[k] as string
    }
  }
  if (opts.password !== undefined) process.env.OPENCODE_SERVER_PASSWORD = opts.password
  if (opts.username !== undefined) process.env.OPENCODE_SERVER_USERNAME = opts.username

  const server = Server.listen({ port: 0, hostname: "127.0.0.1" })
  const port = server.port ?? 0
  const url = `http://127.0.0.1:${port}`

  return {
    url,
    port,
    fetch: (path: string, init?: RequestInit) => fetch(new URL(path, url), init),
    close: async () => {
      await server.stop(true)
      // restore env
      if (prevPassword === undefined) delete process.env.OPENCODE_SERVER_PASSWORD
      else process.env.OPENCODE_SERVER_PASSWORD = prevPassword
      if (prevUsername === undefined) delete process.env.OPENCODE_SERVER_USERNAME
      else process.env.OPENCODE_SERVER_USERNAME = prevUsername
      if (opts.env) {
        for (const k of Object.keys(opts.env)) {
          if (saved[k] === undefined) delete process.env[k]
          else process.env[k] = saved[k] as string
        }
      }
    },
  }
}
