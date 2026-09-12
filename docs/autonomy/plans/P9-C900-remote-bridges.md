# P9-C900 — Remote bridges (Slack/Feishu/Discord)

**Statut :** `INTEGRATED` (design documenté)
**Date :** 2026-08-01
**Parent :** P9-C900 (Remote bridges)

## Objectif

Connecter Unifia à **Slack, Feishu (Lark), Discord** pour le Cowork.

## Architecture

```
[Slack user]  [Feishu user]  [Discord user]
     ↓             ↓              ↓
[WebSocket]   [WebSocket]   [WebSocket]
     ↓             ↓              ↓
┌─────────────────────────────────────┐
│   RemoteTransportPort               │  ← P2-C200-F
└─────────────────────────────────────┘
                ↓
[Unifia Session]
```

## Providers

### Slack
- WebSocket via `@slack/bolt`
- OAuth 2.0
- Slash commands
- Interactive components

### Feishu (Lark)
- WebSocket via `larksuiteoapi/lark`
- Bot verification token
- Card messages
- Event subscription

### Discord
- WebSocket via `discord.js`
- Bot token
- Slash commands
- Embeds

## Sécurité

- Pairing par code éphémère (5 min)
- Scopes granulaires (`session.read`, `session.write`)
- Audit obligatoire
- Rate limit par user

## Estimation

- Slack bridge : ~400 LOC
- Feishu bridge : ~400 LOC
- Discord bridge : ~400 LOC
- Common layer : ~300 LOC
- Tests : ~300 LOC
- **Total : ~1800 LOC**

## Liens

- [P2-C200-F RemoteTransportPort](plans/P2-C200-F-remote-transport.md)
- [ADR-0020 MCP UI Server](docs/adr/0020-mcp-ui-server.md)