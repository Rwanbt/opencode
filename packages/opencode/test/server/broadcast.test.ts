import { describe, it, expect, beforeEach } from "bun:test"
import { Broadcast } from "../../src/server/broadcast"

// Mock WebSocket
function mockWs(): { send: (data: string) => void; readyState: number; messages: string[] } {
  const messages: string[] = []
  return {
    messages,
    readyState: 1, // OPEN
    send(data: string) {
      messages.push(data)
    },
  }
}

describe("Broadcast", () => {
  it("registers and unregisters clients", () => {
    const ws = mockWs()
    const id = Broadcast.register(ws, "user1", "alice")
    expect(Broadcast.clientCount()).toBeGreaterThanOrEqual(1)
    Broadcast.unregister(id)
  })

  it("sends events to all connected clients", () => {
    const ws1 = mockWs()
    const ws2 = mockWs()
    const id1 = Broadcast.register(ws1, "user1", "alice")
    const id2 = Broadcast.register(ws2, "user2", "bob")

    Broadcast.send({ type: "test", data: "hello" })

    expect(ws1.messages.length).toBeGreaterThanOrEqual(1)
    expect(ws2.messages.length).toBeGreaterThanOrEqual(1)
    const parsed1 = JSON.parse(ws1.messages[ws1.messages.length - 1])
    expect(parsed1.type).toBe("test")

    Broadcast.unregister(id1)
    Broadcast.unregister(id2)
  })

  it("scopes broadcasts by directory", () => {
    const ws1 = mockWs()
    const ws2 = mockWs()
    const id1 = Broadcast.register(ws1, "user1", "alice", "/project-a")
    const id2 = Broadcast.register(ws2, "user2", "bob", "/project-b")

    const before1 = ws1.messages.length
    const before2 = ws2.messages.length

    Broadcast.send({ type: "scoped" }, "/project-a")

    expect(ws1.messages.length).toBe(before1 + 1)
    expect(ws2.messages.length).toBe(before2) // not in /project-a

    Broadcast.unregister(id1)
    Broadcast.unregister(id2)
  })

  it("sendToUser targets specific user", () => {
    const ws1 = mockWs()
    const ws2 = mockWs()
    const id1 = Broadcast.register(ws1, "user1", "alice")
    const id2 = Broadcast.register(ws2, "user2", "bob")

    const before2 = ws2.messages.length
    Broadcast.sendToUser("user1", { type: "direct" })

    expect(ws1.messages[ws1.messages.length - 1]).toContain("direct")
    expect(ws2.messages.length).toBe(before2) // bob didn't get it

    Broadcast.unregister(id1)
    Broadcast.unregister(id2)
  })

  it("returns connected clients info", () => {
    const ws = mockWs()
    const id = Broadcast.register(ws, "user1", "alice", "/project")
    const clients = Broadcast.connectedClients()
    const found = clients.find((c) => c.userID === "user1")
    expect(found).toBeTruthy()
    expect(found!.username).toBe("alice")
    Broadcast.unregister(id)
  })
})
