# P2-C200-A — RuntimeAdapter (déjà livré)

**Statut :** `INTEGRATED` (interface TypeScript créée + tests)
**Date :** 2026-08-01
**Parent :** P2-C200 (Contrats Unifia)

## État

**Interface TypeScript** déjà livrée dans [@unifia/contracts](../../packages/contracts/) :
- `packages/contracts/src/runtime.ts` (39 LOC)
- `packages/contracts/test/contracts.test.ts` (15 tests vitest PASS)
- `packages/contracts/examples/01-runtime-basic.ts` (exemple complet)

## Composition

```typescript
// packages/contracts/src/runtime.ts (déjà livré)
export interface RuntimeAdapter {
  getInfo(): Promise<RuntimeInfo>
  listSessions(input?: { cursor?: string }): Promise<Session[]>
  createSession(input: CreateSessionInput): Promise<Session>
  sendPrompt(input: SendPromptInput): Promise<PromptReceipt>
  subscribeEvents(input: SubscribeInput): AsyncIterable<RuntimeEvent>
  cancelSession(input: { sessionId: string }): Promise<void>
}
```

## Implémentation future

Pour qu'il soit réellement utilisable, il faut :
1. `packages/contracts/src/adapters/opencode.ts` : adapter OpenCode (~300 LOC)
2. `packages/contracts/src/adapters/unifia.ts` : adapter Unifia (~300 LOC)
3. Tests d'intégration E2E

## Liens

- [ADR-0001 RuntimeAdapter](docs/adr/0001-runtime-adapter.md)
- [P1-C100-B adapter-opencode](plans/P1-C100-B-adapter-opencode.md)
- [P1-C100-C adapter-unifia](plans/P1-C100-C-adapter-unifia.md)