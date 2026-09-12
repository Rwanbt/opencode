# P2-C200-F — RemoteTransportPort (déjà livré)

**Statut :** `INTEGRATED` (interface TypeScript créée + tests)
**Date :** 2026-08-01
**Parent :** P2-C200 (Contrats Unifia)

## État

**Interface TypeScript** déjà livrée :
- `packages/contracts/src/remote.ts` (50 LOC)
- 15 tests PASS
- `packages/contracts/examples/05-remote-port.ts` (Slack/Feishu)

## Composition

```typescript
export interface RemoteTransportPort {
  send(channelId: string, message: RemoteMessage): Promise<void>
  receive(subscription: RemoteSubscription): AsyncIterable<RemoteEvent>
  execute(command: RemoteCommand): Promise<RemoteCommandResult>
  pair(identity: Omit<RemoteIdentity, "pairedAt">): Promise<RemoteIdentity>
  unpair(identityId: string): Promise<void>
}
```

## Providers cibles

| Provider | Status | Use case |
|---|---|---|
| Slack | À implémenter | Cowork |
| Feishu/Lark | À implémenter | Cowork China |
| Discord | À implémenter | Community |
| Telegram | À implémenter | Notifications |
| WhatsApp | Future | Pro |

## Sécurité

- Pairing par code éphémère (5 min)
- Scopes granulaires (`workspace.read`, `session.write`)
- Audit obligatoire de chaque commande

## Liens

- [ADR-0020 MCP UI Server](docs/adr/0020-mcp-ui-server.md)
- [P9-C900 Remote bridges](plans/P9-C900-remote-bridges.md)