# @unifia/sdk — GUIDE

**Statut :** `DRAFT` — guide d'usage
**Date :** 2026-07-31

## Vue d'ensemble

`@unifia/sdk` est le SDK TypeScript officiel pour intégrer Unifia Workbench dans des applications tierces (bots, IDE, dashboards, etc.).

## Installation

```bash
bun add @unifia/sdk
# ou
npm install @unifia/sdk
```

## Quickstart

```typescript
import { UnifiaClient } from "@unifia/sdk"

const client = new UnifiaClient({
  endpoint: "https://api.unifia.dev",
  apiKey: process.env.UNIFIA_API_KEY,
})

// List sessions
const sessions = await client.sessions.list()
console.log("Sessions:", sessions)

// Create a session
const session = await client.sessions.create({
  workspaceId: "my-project",
})

// Send a prompt
await client.sessions.prompt(session.id, "Hello, Unifia!")

// Subscribe to events
for await (const event of client.sessions.events(session.id)) {
  console.log("Event:", event)
}
```

## API Reference

### Sessions

```typescript
// List
sessions.list({ workspaceId? }): Promise<Session[]>

// Get
sessions.get(id: string): Promise<Session>

// Create
sessions.create({ workspaceId, runtime? }): Promise<Session>

// Delete
sessions.delete(id: string): Promise<void>

// Send prompt
sessions.prompt(id: string, prompt: string, options?): Promise<void>

// Subscribe to events
sessions.events(id: string): AsyncIterable<RuntimeEvent>

// Cancel
sessions.cancel(id: string): Promise<void>
```

### Workspaces

```typescript
workspaces.list(): Promise<Workspace[]>
workspaces.create({ name, path }): Promise<Workspace>
workspaces.get(id: string): Promise<Workspace>
workspaces.delete(id: string): Promise<void>
workspaces.read(id: string, paths: string[]): Promise<FileReadResult[]>
workspaces.write(id: string, writes: FileWrite[]): Promise<FileWriteResult[]>
```

### Capabilities

```typescript
capabilities.search(query: CapabilityQuery): Promise<CapabilityDescriptor[]>
capabilities.execute(request: CapabilityExecutionRequest): Promise<CapabilityExecution>
capabilities.cancel(executionId: string): Promise<void>
```

### Artifacts

```typescript
artifacts.create(input: ArtifactCreateInput): Promise<Artifact>
artifacts.render(id: string, format: string): Promise<RenderResult>
artifacts.export(id: string, destination: ExportDestination): Promise<ExportResult>
```

## Authentication

```typescript
// API key
const client = new UnifiaClient({
  endpoint: "https://api.unifia.dev",
  apiKey: "unfk_xxxxxxxxxxxxxxxxxxxxxxxxxx",
})

// OAuth 2.0
const client = await UnifiaClient.fromOAuth({
  endpoint: "https://api.unifia.dev",
  clientId: "your-client-id",
  clientSecret: "your-client-secret",
  scopes: ["session.read", "session.write", "workspace.read"],
})
```

## Error handling

```typescript
import { UnifiaError } from "@unifia/sdk"

try {
  await client.sessions.prompt(sessionId, "...")
} catch (err) {
  if (err instanceof UnifiaError) {
    switch (err.code) {
      case "session.not_found":
        console.error("Session not found")
        break
      case "policy.denied":
        console.error("Policy denied this action")
        break
      case "approval.required":
        console.error("Approval required")
        break
      default:
        console.error("Unifia error:", err.message)
    }
  }
}
```

## Streaming

```typescript
// Stream events
const stream = client.sessions.events(sessionId)
for await (const event of stream) {
  switch (event.type) {
    case "text":
      process.stdout.write(event.data)
      break
    case "tool-call":
      console.log("Tool:", event.data)
      break
  }
}
```

## Pagination

```typescript
// Cursor-based pagination
const page = await client.sessions.list({ limit: 20, cursor: "abc123" })
console.log("Items:", page.items)
console.log("Next cursor:", page.nextCursor)
```

## Rate limiting

```typescript
// Check your rate limits
const limits = await client.rateLimits.get()
console.log("Limit:", limits.requests, "Remaining:", limits.remaining)

// Handle 429 with backoff
import { UnifiaError } from "@unifia/sdk"
try {
  await client.sessions.list()
} catch (err) {
  if (err instanceof UnifiaError && err.code === "rate_limit.exceeded") {
    await new Promise((r) => setTimeout(r, err.retryAfter * 1000))
    // Retry
  }
}
```

## Webhooks

```typescript
import { WebhookHandler } from "@unifia/sdk/webhook"

const handler = new WebhookHandler({
  secret: process.env.UNIFIA_WEBHOOK_SECRET,
})

handler.on("session.created", (event) => {
  console.log("New session:", event.sessionId)
})

app.post("/webhook", handler.middleware())
```

## Versioning

`@unifia/sdk` suit le semver strict.
- MAJOR : breaking changes
- MINOR : new features
- PATCH : bug fixes

Compatibilité N-1 garantie.

## License

MIT — voir [LICENSE](LICENSE).

## Liens

- [unifia.dev](https://unifia.dev) — site web
- [API reference](https://unifia.dev/api) — référence complète
- [SKILL.md](skills/unifia-rebrand/SKILL.md) — pour les rebrand
- [@unifia/contracts](packages/contracts/) — les types TypeScript
