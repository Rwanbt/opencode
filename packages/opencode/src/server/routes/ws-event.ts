import { Hono } from "hono"
import { Broadcast } from "../broadcast"
import { Presence } from "../presence"
import { JwtAuth } from "../auth-jwt"
import { Log } from "../../util/log"

const log = Log.create({ service: "ws-event" })

export const WsEventRoutes = () =>
  new Hono().get("/events", async (c) => {
    // Authenticate via query param (WebSocket can't send headers easily)
    const token = c.req.query("token")
    let userID = "anonymous"
    let username = "anonymous"
    let role = "viewer"

    if (token) {
      const payload = JwtAuth.verifyAccessToken(token)
      if (payload) {
        userID = payload.sub
        username = payload.username
        role = payload.role
      } else {
        return c.json({ error: "Invalid token" }, 401)
      }
    }

    const directory = c.req.query("directory")

    // Use Bun's native WebSocket upgrade
    const server = (c.env as any)?.server
    if (!server) {
      return c.json({ error: "WebSocket not supported" }, 400)
    }

    const success = server.upgrade(c.req.raw, {
      data: { userID, username, role, directory },
    })

    if (!success) {
      return c.json({ error: "WebSocket upgrade failed" }, 400)
    }

    return new Response(null, { status: 101 })
  })

/**
 * WebSocket handlers for Bun.serve() websocket option.
 * These are registered at the server level, not per-route.
 */
export const WsEventHandlers = {
  open(ws: any) {
    const { userID, username, directory } = ws.data || {}
    if (!userID) return

    const clientID = Broadcast.register(ws, userID, username, directory)
    ws.data.clientID = clientID

    Presence.connect(userID, username, directory)
    log.info("ws client connected", { userID, username, directory })
  },

  message(ws: any, message: string | Buffer) {
    // Handle ping/pong keepalive
    const { userID } = ws.data || {}
    if (!userID) return

    try {
      const data = JSON.parse(typeof message === "string" ? message : message.toString())
      if (data.type === "ping") {
        ws.send(JSON.stringify({ type: "pong", timestamp: Date.now() }))
        Presence.heartbeat(userID)
      } else if (data.type === "activity") {
        // Client reports what session they're working on
        Presence.updateActivity(userID, data.sessionID)
      }
    } catch {
      // Ignore malformed messages
    }
  },

  close(ws: any) {
    const { clientID, userID } = ws.data || {}
    if (clientID) {
      Broadcast.unregister(clientID)
    }
    if (userID) {
      Presence.disconnect(userID)
      log.info("ws client disconnected", { userID })
    }
  },
}
