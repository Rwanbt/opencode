/* SPDX-License-Identifier: MIT */
/**
 * Example 05: RemoteTransportPort — Slack/Feishu integration
 *
 * Demonstrates how to use the RemoteTransportPort to receive remote
 * commands from Slack or Feishu.
 *
 * Run with: bun run examples/05-remote-port.ts
 */

import type {
  RemoteTransportPort,
  RemoteMessage,
  RemoteCommand,
  RemoteCommandResult,
  RemoteIdentity,
  RemoteSubscription,
  RemoteEvent,
} from "../src/remote.js"

// === Step 1: Define a Mock Slack/Feishu implementation ===
class MockRemoteTransport implements RemoteTransportPort {
  private identity: Map<string, RemoteIdentity> = new Map()

  async send(_channelId: string, _message: RemoteMessage): Promise<void> {
    // providerId is inferred from the transport, not stored on the message
  }

  async *receive(subscription: RemoteSubscription): AsyncIterable<RemoteEvent> {
    // Simulate events
    for (const channelId of subscription.channels) {
      yield {
        type: "message",
        providerId: "slack",
        data: { channelId, text: `Hello from ${channelId}` } as any,
        timestamp: Date.now(),
      }
    }
  }

  async execute(command: RemoteCommand): Promise<RemoteCommandResult> {
    console.log(`Executing remote command: ${command.text}`)
    if (command.text.startsWith("/approve")) {
      return { commandId: command.id, status: "accepted" }
    }
    return { commandId: command.id, status: "pending-approval" }
  }

  async pair(identity: Omit<RemoteIdentity, "pairedAt">): Promise<RemoteIdentity> {
    const full = { ...identity, pairedAt: Date.now() }
    this.identity.set(identity.id, full)
    return full
  }

  async unpair(identityId: string): Promise<void> {
    this.identity.delete(identityId)
  }
}

// === Step 2: Use it ===
async function main() {
  const remote = new MockRemoteTransport()

  // Pair with Slack
  const identity = await remote.pair({
    id: "user-123",
    providerId: "slack",
    userId: "U123",
    scopes: ["workspace.read", "session.write"],
  })
  console.log("Paired:", identity.id)

  // Execute a command
  const result = await remote.execute({
    id: "cmd-1",
    text: "/approve build",
    scope: "workspace",
  })
  console.log("Command result:", result)

  // Send a message
  await remote.send("C123", {
    id: "msg-1",
    channelId: "C123",
    userId: "U123",
    text: "Build completed!",
    timestamp: Date.now(),
  } as any)  // providerId inferred from transport

  // Subscribe to events
  console.log("\nSubscribing to events...")
  for await (const event of remote.receive({
    channels: ["C123", "C456"],
    eventTypes: ["message"],
  })) {
    console.log("Event:", event)
    if (event.type === "message") break
  }

  // Unpair
  await remote.unpair("user-123")
  console.log("Unpaired")
}

main().catch(console.error)
