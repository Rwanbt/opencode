import { afterEach, describe, expect, test } from "bun:test"
import { Orchestrator } from "../../src/collective/orchestrator"
import { DebateStore } from "../../src/collective/debate-store"
import { Collective } from "../../src/collective/types"
import { Instance } from "../../src/project/instance"
import { tmpdir } from "../fixture/fixture"

function withInstance(directory: string, fn: () => Promise<void>) {
  return Instance.provide({ directory, fn })
}

// Explicit, non-existent participants + explicit roles take every fast path
// in ProviderDiscovery.discover / RoleAssigner.assign that bypasses real
// provider config and LLM calls (see provider-discovery.ts:76 and
// role-assigner.ts:50). Phase 1 still calls the real Provider.getLanguage for
// these fake provider IDs, which fails deterministically (verified via a
// throwaway debug run): `resolveSDK` throws a `ProviderInitError` for an
// unregistered providerID, and — because `Provider.getLanguage` wraps its
// body in `Effect.promise` rather than `Effect.tryPromise` — that failure
// surfaces as an Effect defect. Defects bypass both the per-participant
// `Effect.catch()` in Phase 1 AND orchestrator.ts's own try/catch (so
// `store.setError`/`DebateFailed` are never reached; the debate row is left
// at whatever status was last set, here "phase1_diverge"). This is a
// pre-existing gap unrelated to this feature — noted, not fixed, out of
// scope. It's irrelevant to this test either way: it only exists to give
// `run()` a fast, deterministic failure so we can assert what happens
// BEFORE it — namely that onDebateID fires exactly once, immediately after
// the debate row is created, and that omitting it changes nothing else.
function fakeConfig(): Collective.DebateConfig {
  return {
    question: "does onDebateID fire before phase 1?",
    tier: "quick",
    participants: [
      { providerID: "orchestrator-test-fake-a" as any, modelID: "fake-model-a" as any },
      { providerID: "orchestrator-test-fake-b" as any, modelID: "fake-model-b" as any },
    ],
    roles: {
      "orchestrator-test-fake-a": "Advocate",
      "orchestrator-test-fake-b": "Critic",
    },
    redTeam: "off",
    enableMeta: false,
    enableCanary: false,
    enableShadowBaseline: false,
    noMemory: true,
    maxRounds: 0,
  }
}

describe("Orchestrator.run — onDebateID callback", () => {
  afterEach(() => Instance.disposeAll())

  test("fires exactly once with a real, persisted debate ID, before the effect settles", async () => {
    await using tmp = await tmpdir()

    await withInstance(tmp.path, async () => {
      const seen: Collective.DebateID[] = []

      await Orchestrator.runPromiseExport(fakeConfig(), (id) => {
        seen.push(id)
      }).catch(() => {
        // The debate is expected to fail (fake providers can't reach a real
        // model) — only the callback's own contract is under test here.
      })

      expect(seen.length).toBe(1)
      expect(seen[0]).toMatch(/^dbt_/)

      // Prove it's a REAL id, not a placeholder: the row must exist in the store,
      // created with the exact id observed by the callback.
      const stored = await DebateStore.getPromise(seen[0]!)
      expect(stored.id).toBe(seen[0])
    })
  })

  test("existing callers without a callback behave identically to callers with one (backward compatibility)", async () => {
    await using tmpA = await tmpdir()
    await using tmpB = await tmpdir()

    let outcomeWithoutCallback: { ok: boolean; message?: string } | undefined
    let outcomeWithCallback: { ok: boolean; message?: string } | undefined

    await withInstance(tmpA.path, async () => {
      try {
        await Orchestrator.runPromiseExport(fakeConfig())
        outcomeWithoutCallback = { ok: true }
      } catch (error) {
        outcomeWithoutCallback = { ok: false, message: error instanceof Error ? error.message : String(error) }
      }
    })

    await withInstance(tmpB.path, async () => {
      try {
        await Orchestrator.runPromiseExport(fakeConfig(), () => {})
        outcomeWithCallback = { ok: true }
      } catch (error) {
        outcomeWithCallback = { ok: false, message: error instanceof Error ? error.message : String(error) }
      }
    })

    expect(outcomeWithoutCallback).toBeDefined()
    expect(outcomeWithCallback).toBeDefined()
    expect(outcomeWithCallback!.ok).toBe(outcomeWithoutCallback!.ok)
    expect(outcomeWithCallback!.message).toBe(outcomeWithoutCallback!.message)
  })

  test("server route call site (no callback argument) is unaffected by the new optional parameter", async () => {
    await using tmp = await tmpdir()

    await withInstance(tmp.path, async () => {
      // Mirrors the exact call shape used by server/routes/debate.ts POST "/".
      await expect(Orchestrator.runPromiseExport(fakeConfig())).rejects.toBeInstanceOf(Error)
    })
  })
})
