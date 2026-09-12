# P16-C1600 — Plan détaillé : MCP UI Server

**Carte parente :** P16-C1600 (Phase 16, DEFERRED → DETAILED)
**Statut :** `PROPOSED` — bloqué code TS
**Date :** 2026-07-31
**Source :** Plan V3 §16 (MCP UI Server)

## Contexte

Phase 16 implémente le **MCP UI Server** : Unifia expose ses capabilities à des clients externes (autres apps, IDE, plugins) via MCP (Model Context Protocol).

## Découpage en sous-cartes (8)

### P16-C1600a — McpServerBase
- **Statut :** `PROPOSED`
- **Scope :** `packages/mcp-ui/src/server.ts` (~300 lignes)
- **Livrable :** Serveur MCP générique
- **Acceptance :** JSON-RPC 2.0 compliant

### P16-C1600b — HttpTransport
- **Statut :** `PROPOSED`
- **Scope :** `packages/mcp-ui/src/transport/http.ts` (~300 lignes)
- **Livrable :** HTTP transport
- **Acceptance :** routes, CORS, etc.

### P16-C1600c — StdioTransport
- **Statut :** `PROPOSED`
- **Scope :** `packages/mcp-ui/src/transport/stdio.ts` (~200 lignes)
- **Livrable :** STDIO transport (Claude Desktop)
- **Acceptance :** spawn process, pipe

### P16-C1600d — CapabilityAdapter
- **Statut :** `PROPOSED`
- **Scope :** `packages/mcp-ui/src/adapter.ts` (~300 lignes)
- **Livrable :** CapabilityPort → MCP adapter
- **Acceptance :** 100+ capabilities exposées

### P16-C1600e — AuthLayer
- **Statut :** `PROPOSED`
- **Scope :** `packages/mcp-ui/src/auth/` (~400 lignes)
- **Livrable :** JWT + OAuth 2.0
- **Acceptance :** tokens, scopes, refresh

### P16-C1600f — RateLimit
- **Statut :** `PROPOSED`
- **Scope :** `packages/mcp-ui/src/rate-limit.ts` (~200 lignes)
- **Livrable :** Rate limiting per-client
- **Acceptance :** Redis backend, sliding window

### P16-C1600g — StreamingSSE
- **Statut :** `PROPOSED`
- **Scope :** `packages/mcp-ui/src/streaming.ts` (~200 lignes)
- **Livrable :** SSE events
- **Acceptance :** heartbeat, reconnect

### P16-C1600h — OpenAPIGen
- **Statut :** `PROPOSED`
- **Scope :** `packages/mcp-ui/src/openapi.ts` (~200 lignes)
- **Livrable :** OpenAPI spec auto-gen
- **Acceptance :** spec 3.0.3 valid

## Critères de sortie Plan V3 §16

- [ ] Server MCP compliant
- [ ] HTTP + STDIO transports
- [ ] 100+ capabilities
- [ ] Auth JWT + OAuth
- [ ] Rate limiting
- [ ] SSE streaming
- [ ] OpenAPI 3.0.3

## Dépendances

- **P2-C200** (Contrats) — CapabilityPort
- **P3-C300** (Security) — auth, rate limiting
- ADR-0020 (MCP UI Server) — design

## Estimation

**Total : 4-6 semaines solo**, 2-3 semaines équipe 2-3
