/**
 * WebSocket authentication helper (Sprint 5 item 6 — B2 client migration
 * skeleton).
 *
 * Goal: move the 3 clients (app/web/mobile/desktop) off the query-string
 * legacy path onto `/auth/ws-ticket` + `Sec-WebSocket-Protocol: bearer,<jwt>`.
 *
 * Strategy for Sprint 5:
 *   - Provide a single `createAuthenticatedWebSocket(baseUrl, wsPath,
 *     credentials)` helper that tries the ticket flow first and falls back to
 *     the legacy query-string path if the ticket endpoint is unavailable.
 *   - Do NOT flip `experimental.ws_auth_legacy` to false — that remains the
 *     server default so legacy clients keep working during QA.
 *   - Do NOT rewrite existing call sites yet. The migration is mechanical once
 *     the server is validated against all three clients in parallel (see the
 *     per-client checklist below).
 *
 * Per-client migration checklist (Sprint 6 item 3 update):
 *   [x] packages/app/src/components/terminal.tsx     -> migrated (Basic auth → ticket)
 *   [-] packages/app/src/hooks/use-collaborative.ts  -> N/A (collaborative tenant server, `token` query param, different auth domain)
 *   [-] packages/web/src/components/Share.tsx        -> N/A (anonymous /share_poll, no credentials)
 *   [ ] packages/mobile/src-tauri/assets/runtime/... -> mirror helper in Bun (out of scope: runtime bundle is a prebuilt JS, not a migration target)
 *
 * Once all four are shipped and telemetry shows zero query-string handshakes
 * for >=2 stable releases, flip `experimental.ws_auth_legacy` to false on the
 * server and remove the legacy branch entirely.
 */

export interface WsCredentials {
  /** HTTP basic-auth header value or bearer JWT consumed by /auth/ws-ticket. */
  authorization: string
}

export interface AuthenticatedWebSocketOptions {
  /** When true, skip the ticket attempt and go straight to the legacy path. */
  forceLegacy?: boolean
  /** Extra query-string params to merge into the legacy URL. */
  legacyParams?: Record<string, string>
  /** Timeout for the /auth/ws-ticket call in ms (default 3000). */
  ticketTimeoutMs?: number
}

interface TicketResponse {
  ticket: string
  expiresAt: number
}

async function fetchTicket(
  baseUrl: string,
  credentials: WsCredentials,
  timeoutMs: number,
): Promise<TicketResponse | null> {
  // The server mounts AuthRoutes() at /collab (see server.ts:101), so the
  // ticket endpoint lives at /collab/ws-ticket. Earlier iterations of the
  // client hit /auth/ws-ticket and always 404'd, which silently fell back
  // to the legacy query-string path — itself broken for Basic creds. We
  // try both paths for forward compat in case the server mount is renamed.
  const base = baseUrl.replace(/\/$/, "")
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    for (const path of ["/collab/ws-ticket", "/auth/ws-ticket"]) {
      const res = await fetch(`${base}${path}`, {
        method: "POST",
        headers: { Authorization: credentials.authorization, "Content-Type": "application/json" },
        credentials: "include",
        signal: controller.signal,
      })
      if (res.ok) return (await res.json()) as TicketResponse
      // 401 means the auth is wrong — don't bother trying the other path.
      if (res.status === 401) return null
    }
    return null
  } catch {
    return null
  } finally {
    clearTimeout(timer)
  }
}

/**
 * Open a WebSocket with the preferred ticket flow, falling back to the legacy
 * query-string path when the ticket endpoint is unavailable (older server).
 *
 * @param baseUrl  HTTP origin, e.g. "http://127.0.0.1:4096"
 * @param wsPath   Pathname, e.g. "/ws/events"
 */
export async function createAuthenticatedWebSocket(
  baseUrl: string,
  wsPath: string,
  credentials: WsCredentials,
  opts: AuthenticatedWebSocketOptions = {},
): Promise<WebSocket> {
  const wsUrl = new URL(wsPath, baseUrl)
  wsUrl.protocol = wsUrl.protocol.replace(/^http/, "ws")

  if (!opts.forceLegacy) {
    const ticket = await fetchTicket(baseUrl, credentials, opts.ticketTimeoutMs ?? 3000)
    if (ticket) {
      // Prefer the Sec-WebSocket-Protocol path (browsers cannot set arbitrary
      // headers on the WS handshake). The server middleware (Sprint 4 B2)
      // accepts `bearer,<jwt>`.
      return new WebSocket(wsUrl.toString(), ["bearer", ticket.ticket])
    }
  }

  // Legacy: append credentials to query-string. Kept for backward compat until
  // experimental.ws_auth_legacy flips to false.
  for (const [k, v] of Object.entries(opts.legacyParams ?? {})) {
    wsUrl.searchParams.set(k, v)
  }
  // `authorization` is the legacy param name expected by the middleware.
  wsUrl.searchParams.set("authorization", credentials.authorization)
  return new WebSocket(wsUrl.toString())
}
