/**
 * In-process mock of the desktop shell's keychain HTTP endpoint.
 *
 * Mirrors the protocol consumed by `KeychainStorage` in `src/auth/index.ts`:
 *
 *   GET    /kc/:service                 -> 200 [key, key, ...]
 *   GET    /kc/:service/:key            -> 200 {"value": "<json-stringified>"} | 404
 *   PUT    /kc/:service/:key  (body)    -> 204
 *   DELETE /kc/:service/:key            -> 204
 *
 * Auth:  `X-Keychain-Token: <token>` must match the token minted by the
 *        server; requests without it return 401.
 *
 * The backing store is a plain `Map<key, string>` scoped per service.
 *
 * Usage:
 *   const kc = await startMockKeychainServer()
 *   process.env.OPENCODE_KEYCHAIN_URL = kc.url
 *   process.env.OPENCODE_KEYCHAIN_TOKEN = kc.token
 *   // ... exercise code under test ...
 *   await kc.close()
 */
import http from "node:http"

export interface MockKeychainServer {
  url: string
  token: string
  /** Direct access to the backing store for assertions (service -> key -> json). */
  store: Map<string, Map<string, string>>
  close: () => Promise<void>
  /** Force the server socket shut to simulate a transport error. */
  kill: () => Promise<void>
}

export interface MockKeychainOptions {
  /** Override the auth token; default is a random 32-hex string. */
  token?: string
  /** Pre-seed the backing store. */
  seed?: Record<string, Record<string, unknown>>
}

function randomToken(): string {
  const bytes = new Uint8Array(16)
  crypto.getRandomValues(bytes)
  return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("")
}

export async function startMockKeychainServer(
  opts: MockKeychainOptions = {},
): Promise<MockKeychainServer> {
  const token = opts.token ?? randomToken()
  const store = new Map<string, Map<string, string>>()

  if (opts.seed) {
    for (const [service, entries] of Object.entries(opts.seed)) {
      const m = new Map<string, string>()
      for (const [key, value] of Object.entries(entries)) {
        m.set(key, JSON.stringify(value))
      }
      store.set(service, m)
    }
  }

  const getService = (service: string) => {
    let m = store.get(service)
    if (!m) {
      m = new Map<string, string>()
      store.set(service, m)
    }
    return m
  }

  const server = http.createServer((req, res) => {
    try {
      if (req.headers["x-keychain-token"] !== token) {
        res.writeHead(401)
        res.end()
        return
      }
      const url = new URL(req.url ?? "/", "http://127.0.0.1")
      // paths: /kc/:service or /kc/:service/:key
      const parts = url.pathname.split("/").filter(Boolean)
      if (parts[0] !== "kc" || parts.length < 2 || parts.length > 3) {
        res.writeHead(404)
        res.end()
        return
      }
      const service = decodeURIComponent(parts[1])
      const key = parts[2] !== undefined ? decodeURIComponent(parts[2]) : undefined

      if (!key) {
        // service-level: list keys
        if (req.method !== "GET") {
          res.writeHead(405)
          res.end()
          return
        }
        const keys = [...getService(service).keys()]
        res.writeHead(200, { "Content-Type": "application/json" })
        res.end(JSON.stringify(keys))
        return
      }

      // key-level operations
      const svc = getService(service)
      if (req.method === "GET") {
        const v = svc.get(key)
        if (v === undefined) {
          res.writeHead(404)
          res.end()
          return
        }
        res.writeHead(200, { "Content-Type": "application/json" })
        res.end(JSON.stringify({ value: v }))
        return
      }
      if (req.method === "PUT") {
        const chunks: Buffer[] = []
        req.on("data", (c) => chunks.push(c))
        req.on("end", () => {
          const body = Buffer.concat(chunks).toString("utf8")
          svc.set(key, body)
          res.writeHead(204)
          res.end()
        })
        return
      }
      if (req.method === "DELETE") {
        svc.delete(key)
        res.writeHead(204)
        res.end()
        return
      }
      res.writeHead(405)
      res.end()
    } catch (err) {
      res.writeHead(500)
      res.end(String(err))
    }
  })

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
  const addr = server.address()
  if (!addr || typeof addr === "string") {
    throw new Error("mock keychain server failed to bind")
  }
  const url = `http://127.0.0.1:${addr.port}`

  let closed = false
  const close = async () => {
    if (closed) return
    closed = true
    await new Promise<void>((resolve) => server.close(() => resolve()))
  }
  const kill = async () => {
    if (closed) return
    closed = true
    // Hard shutdown: destroy sockets so in-flight requests fail immediately.
    server.closeAllConnections?.()
    await new Promise<void>((resolve) => server.close(() => resolve()))
  }

  return { url, token, store, close, kill }
}
