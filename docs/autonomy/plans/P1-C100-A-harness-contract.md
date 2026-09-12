# P1-C100-A — Harness contract

**Statut :** `INTEGRATED` (design documenté)
**Date :** 2026-08-01
**Parent :** P1-C100 (Harness multi-runtime)

## Objectif

Définir le **contrat formel** entre les runtimes et le reste d'Unifia. Le harness est la couche qui permet de switcher entre OpenCode, OpenCodeRuntime, et de futurs runtimes sans changer le code applicatif.

## API minimale

```typescript
interface RuntimeHarness {
  // Identité
  id: "unifia-harness" | "opencode" | "opencode-mini"
  version: string

  // Capabilities
  capabilities: CapabilityDescriptor[]

  // Lifecycle
  start(config: HarnessConfig): Promise<HarnessHandle>
  stop(handle: HarnessHandle): Promise<void>

  // Health
  health(handle: HarnessHandle): Promise<HealthReport>

  // Sessions (forward vers RuntimeAdapter)
  createSession(input: CreateSessionInput): Promise<Session>
  sendPrompt(input: SendPromptInput): Promise<PromptReceipt>
  subscribeEvents(input: SubscribeInput): AsyncIterable<RuntimeEvent>
}
```

## Capabilités requises

- `workspace.read` : lecture workspace
- `workspace.write` : écriture workspace
- `command.run` : exécution command (avec sandbox)
- `message.send` : envoi prompt au LLM
- `event.subscribe` : stream events

## Capabilités optionnelles

- `file.diff` : calcul de diffs
- `image.render` : rendu d'images (Mermaid, etc.)
- `audio.transcribe` : transcription audio
- `browser.automate` : automation browser
- `computer.use` : control clavier/souris

## Runtimes cibles

| Runtime | Type | Priorité | Status |
|---|---|---|---|
| OpenCode | Fork existant | P1 | À migrer |
| OpenCodeRuntime | Native API | P2 | À créer |
| UnifiaRuntime | New build | P3 | Future |

## Tests à implémenter

```typescript
describe("RuntimeHarness", () => {
  test("start/stop cycle")
  test("createSession lifecycle")
  test("sendPrompt receipt")
  test("subscribeEvents stream")
  test("health report shape")
  test("capabilities declared")
})
```

## Fichiers cibles

- `packages/harness/src/harness.ts` — interface principale
- `packages/harness/src/adapters/opencode.ts` — adapter OpenCode
- `packages/harness/src/adapters/unifia.ts` — adapter Unifia (futur)
- `packages/harness/test/harness.test.ts` — tests

## Estimation

- Interface : 50 LOC
- Adapter OpenCode : 500 LOC
- Tests : 200 LOC
- **Total : ~750 LOC**

## Liens

- P1-C100 plan détaillé
- [ADR-0001 RuntimeAdapter](docs/adr/0001-runtime-adapter.md)
- [@unifia/contracts](../packages/contracts/)