import { Broadcast } from "./broadcast"
import { Log } from "../util/log"

const log = Log.create({ service: "presence" })

export namespace Presence {
  export type Status = "online" | "idle" | "away"

  export interface Info {
    userID: string
    username: string
    status: Status
    activeSessionID?: string
    directory?: string
    lastSeen: number
    connectedAt: number
  }

  const users = new Map<string, Info>()

  const IDLE_TIMEOUT = 60_000 // 60 seconds
  const AWAY_TIMEOUT = 300_000 // 5 minutes
  let checkInterval: ReturnType<typeof setInterval> | null = null

  function startChecker() {
    if (checkInterval) return
    checkInterval = setInterval(() => {
      const now = Date.now()
      for (const [userID, info] of users) {
        const elapsed = now - info.lastSeen
        let newStatus: Status = "online"
        if (elapsed > AWAY_TIMEOUT) newStatus = "away"
        else if (elapsed > IDLE_TIMEOUT) newStatus = "idle"

        if (newStatus !== info.status) {
          info.status = newStatus
          broadcastPresence()
        }
      }
    }, 15_000) // Check every 15 seconds
  }

  function stopChecker() {
    if (checkInterval && users.size === 0) {
      clearInterval(checkInterval)
      checkInterval = null
    }
  }

  function broadcastPresence() {
    Broadcast.send({
      type: "presence",
      users: list(),
      timestamp: Date.now(),
    })
  }

  export function connect(userID: string, username: string, directory?: string): void {
    const now = Date.now()
    const existing = users.get(userID)
    users.set(userID, {
      userID,
      username,
      status: "online",
      activeSessionID: existing?.activeSessionID,
      directory: directory ?? existing?.directory,
      lastSeen: now,
      connectedAt: existing?.connectedAt ?? now,
    })
    startChecker()
    broadcastPresence()
    log.info("user connected", { userID, username })
  }

  export function disconnect(userID: string): void {
    users.delete(userID)
    broadcastPresence()
    stopChecker()
    log.info("user disconnected", { userID })
  }

  export function heartbeat(userID: string): void {
    const info = users.get(userID)
    if (info) {
      info.lastSeen = Date.now()
      if (info.status !== "online") {
        info.status = "online"
        broadcastPresence()
      }
    }
  }

  export function updateActivity(userID: string, sessionID?: string): void {
    const info = users.get(userID)
    if (info) {
      info.activeSessionID = sessionID
      info.lastSeen = Date.now()
      info.status = "online"
      broadcastPresence()
    }
  }

  export function list(): Info[] {
    return Array.from(users.values())
  }

  export function get(userID: string): Info | undefined {
    return users.get(userID)
  }

  export function isOnline(userID: string): boolean {
    return users.has(userID)
  }

  export function onlineCount(): number {
    return users.size
  }
}
