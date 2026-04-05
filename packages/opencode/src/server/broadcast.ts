import { Log } from "../util/log"

const log = Log.create({ service: "broadcast" })

export namespace Broadcast {
  export interface Client {
    ws: WebSocket | { send(data: string): void; readyState: number }
    userID: string
    username: string
    directory?: string
  }

  const clients = new Map<string, Client>()
  // directory -> set of client IDs for scoped broadcasts
  const directoryClients = new Map<string, Set<string>>()

  let idCounter = 0

  export function register(
    ws: Client["ws"],
    userID: string,
    username: string,
    directory?: string,
  ): string {
    const clientID = `bc_${++idCounter}`
    const client: Client = { ws, userID, username, directory }
    clients.set(clientID, client)

    if (directory) {
      if (!directoryClients.has(directory)) {
        directoryClients.set(directory, new Set())
      }
      directoryClients.get(directory)!.add(clientID)
    }

    log.info("client registered", { clientID, userID, username, directory })
    return clientID
  }

  export function unregister(clientID: string): void {
    const client = clients.get(clientID)
    if (!client) return

    clients.delete(clientID)
    if (client.directory) {
      const set = directoryClients.get(client.directory)
      if (set) {
        set.delete(clientID)
        if (set.size === 0) directoryClients.delete(client.directory)
      }
    }

    log.info("client unregistered", { clientID, userID: client.userID })
  }

  /** Send event to all clients, optionally scoped to a directory */
  export function send(event: object, directory?: string): void {
    const data = JSON.stringify(event)
    const targetIDs = directory ? directoryClients.get(directory) : undefined

    if (targetIDs) {
      for (const id of targetIDs) {
        const client = clients.get(id)
        if (client && client.ws.readyState === 1) {
          try {
            client.ws.send(data)
          } catch {
            unregister(id)
          }
        }
      }
    } else {
      // Broadcast to all clients
      for (const [id, client] of clients) {
        if (client.ws.readyState === 1) {
          try {
            client.ws.send(data)
          } catch {
            unregister(id)
          }
        }
      }
    }
  }

  /** Send event to a specific user */
  export function sendToUser(userID: string, event: object): void {
    const data = JSON.stringify(event)
    for (const [id, client] of clients) {
      if (client.userID === userID && client.ws.readyState === 1) {
        try {
          client.ws.send(data)
        } catch {
          unregister(id)
        }
      }
    }
  }

  /** Get all connected clients info (for presence) */
  export function connectedClients(): { userID: string; username: string; directory?: string }[] {
    const seen = new Set<string>()
    const result: { userID: string; username: string; directory?: string }[] = []
    for (const client of clients.values()) {
      if (!seen.has(client.userID)) {
        seen.add(client.userID)
        result.push({ userID: client.userID, username: client.username, directory: client.directory })
      }
    }
    return result
  }

  export function clientCount(): number {
    return clients.size
  }
}
