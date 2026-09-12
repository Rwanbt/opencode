---
id: 0020
title: MCP UI Server
status: PROPOSED
date: 2026-07-31
---

# ADR-0020: MCP UI Server (exposition des capabilities)

**Statut :** `PROPOSED`
**Date :** 2026-07-31
**Décideurs :** Erwan, Hermes Agent (MiniMax M3)
**Source :** Plan V3 §16 (« MCP UI Server »)

## Contexte

Unifia doit exposer ses **capabilities** (ADR-0003) à des **clients externes** (autres apps, IDE, plugins) via **MCP** (Model Context Protocol). Le MCP UI Server d'Unifia permet :
- **Découverte** : lister les capabilities disponibles
- **Exécution** : appeler une capability à distance
- **Streaming** : recevoir les events temps réel
- **Auth** : authentifier le client (par token, oauth, etc.)

## Décision

Adopter le pattern **MCP UI Server** basé sur le **Model Context Protocol** (standard MCP d'Anthropic) :

```typescript
interface McpUiServer {
  start(port: number, options: McpServerOptions): Promise<McpServerHandle>
  stop(handle: McpServerHandle): Promise<void>
  registerCapability(capability: CapabilityDescriptor): Promise<void>
  unregisterCapability(capabilityId: string): Promise<void>
}
```

**Protocole** :
- **Transport** : JSON-RPC 2.0 over HTTP/STDIO
- **Format** : MCP standard (compatible Claude, OpenAI, etc.)
- **Auth** : JWT (par défaut) + OAuth 2.0 (optionnel)
- **Rate limiting** : par client (X req/min)

**Endpoints** :
- `GET /capabilities` : liste des capabilities
- `GET /capabilities/{id}` : détails d'une capability
- `POST /capabilities/{id}/execute` : exécution
- `GET /capabilities/{id}/events` : stream SSE
- `GET /health` : health check

**Implémentations** :
1. `HttpMcpUiServer` (defaut — HTTP + JSON-RPC)
2. `StdioMcpUiServer` (optionnel — pour intégration Claude Desktop)

## Conséquences

### Positives
- ✅ **Standard** : MCP = standard émergeant (compatibilité Claude, OpenAI, etc.)
- ✅ **Découverte** : les clients peuvent lister dynamiquement
- ✅ **Streaming** : events temps réel via SSE
- ✅ **Auth** : JWT et OAuth 2.0 standards
- ✅ **Composable** : chaque capability = 1 endpoint

### Négatives
- ❌ **Surface d'attaque** : serveur HTTP = vulnérabilités potentielles
- ❌ **Performance** : HTTP a un overhead vs IPC
- ❌ **Compatibilité** : MCP évolue (versions)
- ❌ **Rate limit** : peut frustrer les clients haute-fréquence

### Neutres
- Le port est configurable (default : 3000)

## Alternatives considérées

### A. Custom JSON-RPC (pas MCP)
- **Rejeté** : pas de standard, pas d'interop

### B. gRPC
- **Rejeté** : pas adapté à l'UI (browser), pas de MCP

### C. MCP standard (cette décision)
- **Adopté** : alignement avec l'écosystème

## Plan d'implémentation

- **Phase 2** : interfaces TypeScript + JsonSchema
- **Phase 16** : HttpMcpUiServer + JWT auth
- **Phase 16** : rate limiting
- **Phase 16** : StdioMcpUiServer (pour Claude Desktop)
- **Phase 16** : documentation pour clients externes

## Liens

- Plan V3 §16 (MCP UI Server)
- ADR-0003 (CapabilityPort) — ce qui est exposé
- ADR-0006 (PolicyEngine) — chaque appel MCP autorisé
- ADR-0007 (ApprovalBroker) — capability sensible = approbation
- ADR-0009 (AuditRuntime) — chaque appel tracé
- ADR-0016 (Gates) — Gate C inclut MCP UI Server
- [MCP spec](https://spec.modelcontextprotocol.io/)
