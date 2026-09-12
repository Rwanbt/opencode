# P16-C1600-A — MCP UI Server

**Statut :** `INTEGRATED` (design documenté)
**Date :** 2026-08-01
**Parent :** P16-C1600 (MCP UI Server)

## Objectif

Implémenter un **MCP (Model Context Protocol) UI Server** pour exposer Unifia via une API standardisée.

## Architecture

```
[AI Client (Claude, GPT)]
     ↓ MCP protocol
[MCP UI Server]
     ↓
[Unifia Runtime]
```

## Tools MCP exposés

```json
{
  "tools": [
    {
      "name": "unifia_session_create",
      "description": "Create a new session",
      "inputSchema": {
        "type": "object",
        "properties": {
          "workspaceId": { "type": "string" }
        }
      }
    },
    {
      "name": "unifia_session_send",
      "description": "Send a prompt",
      "inputSchema": {
        "type": "object",
        "properties": {
          "sessionId": { "type": "string" },
          "prompt": { "type": "string" }
        }
      }
    },
    {
      "name": "unifia_file_read",
      "description": "Read a file",
      "inputSchema": {
        "type": "object",
        "properties": {
          "path": { "type": "string" }
        }
      }
    }
  ]
}
```

## MCP resources

```json
{
  "resources": [
    {
      "uri": "unifia://workspace/{id}",
      "name": "Workspace",
      "description": "Workspace metadata"
    },
    {
      "uri": "unifia://session/{id}/events",
      "name": "Session events",
      "description": "Live event stream"
    }
  ]
}
```

## Prompts

```json
{
  "prompts": [
    {
      "name": "review_code",
      "description": "Review code in a workspace",
      "arguments": [
        { "name": "path", "required": true }
      ]
    }
  ]
}
```

## Server implementation

```typescript
import { Server } from "@modelcontextprotocol/sdk"

const server = new Server({
  name: "unifia-mcp",
  version: "1.0.0",
}, {
  capabilities: {
    tools: {},
    resources: {},
    prompts: {},
  },
})

server.setRequestHandler("tools/list", async () => ({
  tools: [/* ... */]
}))

server.setRequestHandler("tools/call", async (request) => {
  // Forward to Unifia
})

await server.connect()
```

## Estimation

- MCP server core : ~400 LOC
- Tools mapping : ~600 LOC
- Resources : ~300 LOC
- Prompts : ~200 LOC
- Tests : ~300 LOC
- **Total : ~1800 LOC**

## Liens

- [ADR-0020 MCP UI Server](docs/adr/0020-mcp-ui-server.md)
- [@modelcontextprotocol/sdk](https://github.com/modelcontextprotocol/typescript-sdk)