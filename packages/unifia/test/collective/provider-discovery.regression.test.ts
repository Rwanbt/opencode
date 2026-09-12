/**
 * provider-discovery.regression.test.ts — TEAM-B05
 *
 * Non-regression gate for the TEAM-B02 migration of Debate's provider
 * discovery from a self-contained namespace
 * (src/collective/provider-discovery.ts) into a thin adapter over the
 * canonical multi-model substrate (src/multi-model/provider-discovery.ts).
 *
 * Method: this file runs the CURRENT production adapter
 * (`src/collective/provider-discovery.ts`, unmodified) side-by-side with
 * `PreB02ProviderDiscoveryOracle`, a verbatim, frozen copy of the adapter's
 * own pre-B02 implementation (see fixtures/pre-b02-provider-discovery-oracle.ts
 * for provenance — retrieved via `git show 55b47593b9:...`), against
 * IDENTICAL mocked Provider.list() / Auth.all() / credential-file /
 * CLI-subprocess inputs. Where outputs match, that is executed
 * (VERIFIED) proof of behavioural equivalence — not an assumption about
 * what the extraction "should" have preserved. Where outputs diverge,
 * this file documents the divergence explicitly, characterizes its real
 * impact by grepping/reading every current consumer, and pins the
 * CURRENT (adapter) behaviour with an assertion — so any future change
 * to that behaviour fails this suite and forces a conscious decision.
 *
 * Scope: this file deliberately covers ONLY the surface that the B02
 * migration touched — ProviderDiscovery.discover / includeJudge /
 * selectJudge and the auth-cascade + ghost-warning behaviour B02's own
 * card called out as "must preserve". It does not re-test debate rounds,
 * judge synthesis, or claim extraction — those were not touched by B01-B04
 * and are already covered by orchestrator.test.ts / synthesis-judge tests
 * / etc.
 *
 * ============================================================================
 * HISTORICAL FINDING — RESOLVED (see "Fail/Die parity" describe block below):
 *
 *   TEAM-B05 (this file, original version) found that the adapter's
 *   `discover()` converted `InsufficientProvidersError` from a recoverable
 *   Effect Fail (pre-B02 behaviour, confirmed via the oracle) into an
 *   unrecoverable Effect Die/defect. Root cause was
 *   src/collective/provider-discovery.ts:131-132 round-tripping the
 *   substrate's Effect through `Effect.runPromise` and re-wrapping the
 *   resulting Promise with `Effect.promise` (which by contract treats ANY
 *   rejection as a defect) instead of composing the Effect natively. This
 *   contradicted the adapter's own header comment ("Behaviour change vs
 *   the pre-B02 implementation: NONE") and silently invalidated the typed
 *   error channel declared at orchestrator.ts:49.
 *
 *   This was reported (not fixed, per TEAM-B05's scope) in
 *   B05-BLOCKED.md and fixed by corrective card TEAM-B02-FIX, commit
 *   a3343b7fda9d3b1694032e1be1e7372bf37bd270 (regression_origin: B02,
 *   discovered by TEAM-B05 worker, R-B05-001): `discover()` now does
 *   `yield* discoverAvailableProviders(explicitNorm, maxProviders)`
 *   directly instead of the Promise round-trip, restoring a genuine Fail.
 *   Independently reviewed and APPROVED_WITH_FOLLOWUP, and separately
 *   pinned by the fix's own test,
 *   test/collective/provider-discovery.fail-die.test.ts.
 *
 *   The "Fail/Die parity" describe block below was originally named "KNOWN
 *   REGRESSION" and pinned the OLD (buggy) Die behaviour as a trip-wire —
 *   its assertions were INVERTED here (2026-07-25, TEAM-B05 retry, on top
 *   of Team HEAD a3343b7fda9d3b1694032e1be1e7372bf37bd270) to assert the
 *   now-correct Fail behaviour instead, once the fix landed. That
 *   inversion is exactly the trip-wire doing its job: this suite forced a
 *   conscious update rather than silently drifting.
 * ============================================================================
 */

import { Cause, Effect } from "effect"
import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test"
import * as ProviderMod from "../../src/provider/provider"
import * as AuthMod from "../../src/auth"
import * as RealFsPromises from "node:fs/promises"
import * as RealChildProcess from "node:child_process"

// ESM namespace imports are live bindings: once mock.module() replaces what
// "node:fs/promises" resolves to, RealFsPromises.readFile reflects the mock
// too — including from inside the mock's own fallback branch, which would
// call itself forever. Spreading into a plain object HERE, before any test
// in this file has mocked anything, freezes real function values that later
// mock.module() calls cannot retroactively change.
const originalFsPromises = { ...RealFsPromises }
const originalChildProcess = { ...RealChildProcess }
const originalProviderMod = { ...ProviderMod }
const originalAuthMod = { ...AuthMod }

// --------------------------------------------------------------------------------------
// Mocking harness — mirrors the proven, already-passing pattern used by
// test/multi-model/provider-discovery.integration.test.ts (B02/B03
// coverage of the substrate itself). We reuse the identical strategy here
// so the adapter and the oracle see byte-identical mocked dependencies.
// --------------------------------------------------------------------------------------

type ProviderInfo = {
  id: string
  env?: string[]
  models?: Record<string, { status?: string; cost?: { input: number; output: number } }>
}

const buildProvider = (
  id: string,
  envVars: string[],
  models: Record<string, { cost?: { input: number; output: number }; status?: string }>,
): ProviderInfo => ({ id, env: envVars, models })

// Spread the real namespace (captured before any mocking, via the static
// imports below) rather than replacing it outright. `Provider`/`Auth` also
// carry an Effect `Service` tag consumed by unrelated singleton layers
// (src/config/config.ts, src/share/share-next.ts) that memoize their build
// via a process-wide MemoMap (src/effect/run-service.ts). If that memoized
// build ever ran while a partial replacement object (missing `.Service`) was
// live in the module registry, the resulting `undefined` gets cached for the
// rest of the test process — cascading into hundreds of unrelated failures
// in later files, regardless of resetMocks() running correctly afterward.
const mockProviderList = (list: Record<string, ProviderInfo>) => {
  mock.module("../../src/provider/provider", () => ({
    ...originalProviderMod,
    Provider: { ...originalProviderMod.Provider, list: async () => list },
  }))
}

const mockAuthAll = (entries: Record<string, unknown>) => {
  mock.module("../../src/auth", () => ({ ...originalAuthMod, Auth: { ...originalAuthMod.Auth, all: async () => entries } }))
}

// Path-aware and spreads the real module (see the Provider/Auth mocks above
// for why): a bare readFile replacement ignores its path argument, so ANY
// unrelated file read anywhere in the process — even from a completely
// different test file — gets this fixture's content back if it happens to
// run while this mock is live (observed: test/session/llm.test.ts's fixture
// loader failing to JSON.parse "not valid json {{{"). Scoping to the actual
// auth file names and falling back to the real readFile for everything else
// bounds the damage regardless of any afterEach/reset timing.
const mockCredentialFile = (content: string | null) => {
  mock.module("node:fs/promises", () => ({
    ...originalFsPromises,
    readFile: async (path: Parameters<typeof originalFsPromises.readFile>[0], ...rest: unknown[]) => {
      const p = String(path)
      // "~/.claude/.credentials.json" is the ONLY path this test simulates
      // (src/multi-model/provider-discovery.ts's anthropic credential-file
      // extractor). Do NOT also match "auth.json": the SAME source file's
      // openai extractor reads "~/.codex/auth.json" — a real, unrelated file
      // that may genuinely exist on a dev machine — and src/auth/index.ts's
      // own storage file is already covered by mockAuthAll, not this mock.
      if (p.endsWith(".credentials.json")) {
        if (content === null) throw new Error("ENOENT: no such file")
        return content
      }
      return (originalFsPromises.readFile as (...args: unknown[]) => Promise<unknown>)(path, ...rest)
    },
  }))
}

const mockCliAuth = (succeeds: boolean) => {
  mock.module("node:child_process", () => ({
    ...originalChildProcess,
    execFileSync: () => {
      if (!succeeds) throw new Error("ENOENT: no such binary")
      return Buffer.from("")
    },
  }))
}

// Restore from the frozen snapshots, not the live ProviderMod/AuthMod/
// RealFsPromises/RealChildProcess bindings — those are live ESM namespace
// views that reflect whatever mock.module() last installed, so passing them
// straight through here would just re-register the CURRENT (possibly still
// mocked) state instead of the pristine original.
const resetMocks = () => {
  mock.module("../../src/provider/provider", () => originalProviderMod)
  mock.module("../../src/auth", () => originalAuthMod)
  mock.module("node:fs/promises", () => originalFsPromises)
  mock.module("node:child_process", () => originalChildProcess)
}

// Bun caches ES modules; every test gets a cache-busted fresh import of
// BOTH the adapter and the oracle so each test's mock.module() calls (set
// up before this beforeEach body runs, inside each `test()`) take effect.
// Because the adapter, its production dependency (multi-model/provider-discovery.ts)
// and the oracle all reference Provider/Auth/fs/child_process by the SAME
// resolved absolute path, mock.module's registry-level replacement reaches
// all of them once re-imported.
let ProviderDiscovery: typeof import("../../src/collective/provider-discovery").ProviderDiscovery
let Oracle: typeof import("./fixtures/pre-b02-provider-discovery-oracle").PreB02ProviderDiscoveryOracle

async function loadFresh() {
  const bust = crypto.randomUUID()
  const adapterMod = await import(`../../src/collective/provider-discovery?bust=${bust}`)
  ProviderDiscovery = adapterMod.ProviderDiscovery
  const oracleMod = await import(`./fixtures/pre-b02-provider-discovery-oracle?bust=${bust}`)
  Oracle = oracleMod.PreB02ProviderDiscoveryOracle
}

afterEach(() => resetMocks())

// ============================================================================
// SECTION 1 — cascade discovery: oracle vs adapter, byte-for-byte
// ============================================================================

describe("discover() cascade — adapter matches pre-B02 oracle exactly", () => {
  test("env-var auth: 2 providers, identical shape (providerID/modelID/authMethod/cost)", async () => {
    mockProviderList({
      anthropic: buildProvider("anthropic", ["FAKE_ANTHROPIC_KEY"], {
        "claude-sonnet-4-20250514": { cost: { input: 3, output: 15 } },
      }),
      openai: buildProvider("openai", ["FAKE_OPENAI_KEY"], {
        "gpt-4.1": { cost: { input: 2, output: 8 } },
      }),
    })
    mockAuthAll({})
    await loadFresh()

    process.env.FAKE_ANTHROPIC_KEY = "test-anthropic"
    process.env.FAKE_OPENAI_KEY = "test-openai"
    try {
      const oracleResult = await Effect.runPromise(Oracle.discover())
      const adapterResult = await Effect.runPromise(ProviderDiscovery.discover())
      expect(adapterResult.providers).toEqual(oracleResult.providers)
      expect(adapterResult.ghostWarnings).toEqual(oracleResult.ghostWarnings)
      expect(adapterResult.providers.every((p) => p.authMethod === "api_key")).toBe(true)
    } finally {
      delete process.env.FAKE_ANTHROPIC_KEY
      delete process.env.FAKE_OPENAI_KEY
    }
  })

  test("characterized divergence: model resolved but has NO cost field — oracle DIES, adapter succeeds gracefully", async () => {
    // Oracle's cascade does `cost: model ? {input: model.cost.input, ...} : undefined`.
    // `model` (provider.models[mid]) is truthy whenever resolveModelID found a
    // key, but if that model entry has no `.cost` field at all,
    // `model.cost.input` throws `TypeError: undefined is not an object`
    // inside the oracle's Effect.gen body — an unguarded defect (Die), not a
    // typed Fail. The substrate's readCost() guards this
    // (`if (!cost) return undefined`), so the adapter succeeds instead,
    // simply omitting the `cost` key. This is the substrate being more
    // defensive than the code it replaced — an accidental fix, not a
    // regression — but it IS a real, executable divergence, so it's pinned
    // here rather than only described in prose.
    mockProviderList({
      anthropic: buildProvider("anthropic", ["FAKE_ANTHROPIC_KEY"], {
        "claude-sonnet-4-20250514": {},
      }),
      openai: buildProvider("openai", ["FAKE_OPENAI_KEY"], {
        "gpt-4.1": { cost: { input: 1, output: 2 } },
      }),
    })
    mockAuthAll({})
    await loadFresh()

    process.env.FAKE_ANTHROPIC_KEY = "1"
    process.env.FAKE_OPENAI_KEY = "1"
    try {
      const oracleExit = await Effect.runPromiseExit(Oracle.discover())
      const adapterExit = await Effect.runPromiseExit(ProviderDiscovery.discover())

      expect(oracleExit._tag).toBe("Failure")
      if (oracleExit._tag === "Failure") {
        expect(Cause.hasDies(oracleExit.cause)).toBe(true)
      }

      expect(adapterExit._tag).toBe("Success")
      if (adapterExit._tag === "Success") {
        const anthropic = adapterExit.value.providers.find((p) => p.providerID === ("anthropic" as never))
        expect(anthropic).not.toHaveProperty("cost")
      }
    } finally {
      delete process.env.FAKE_ANTHROPIC_KEY
      delete process.env.FAKE_OPENAI_KEY
    }
  })

  test("stored-auth fallback (env absent, Auth.all() present): identical shape", async () => {
    mockProviderList({
      anthropic: buildProvider("anthropic", ["FAKE_ANTHROPIC_KEY"], {
        "claude-sonnet-4-20250514": { cost: { input: 3, output: 15 } },
      }),
      openai: buildProvider("openai", ["FAKE_OPENAI_KEY"], {
        "gpt-4.1": { cost: { input: 2, output: 8 } },
      }),
    })
    mockAuthAll({
      anthropic: { type: "api", key: "stored-anthropic-key" },
      openai: { type: "api", key: "stored-openai-key" },
    })
    await loadFresh()

    const oracleResult = await Effect.runPromise(Oracle.discover())
    const adapterResult = await Effect.runPromise(ProviderDiscovery.discover())
    expect(adapterResult.providers).toEqual(oracleResult.providers)
    expect(adapterResult.providers.every((p) => p.authMethod === "api_key")).toBe(true)
  })

  test("credential-file auth (anthropic, ~/.claude/.credentials.json extractor): identical shape", async () => {
    mockProviderList({
      anthropic: buildProvider("anthropic", ["FAKE_ANTHROPIC_ENV_UNSET"], {
        "claude-sonnet-4-20250514": { cost: { input: 3, output: 15 } },
      }),
      openai: buildProvider("openai", ["FAKE_OPENAI_ENV_SET"], {
        "gpt-4.1": { cost: { input: 2, output: 8 } },
      }),
    })
    mockAuthAll({})
    mockCredentialFile(JSON.stringify({ claudeAiOauth: { accessToken: "cred-token-xyz" } }))
    await loadFresh()

    process.env.FAKE_OPENAI_ENV_SET = "1"
    try {
      const oracleResult = await Effect.runPromise(Oracle.discover())
      const adapterResult = await Effect.runPromise(ProviderDiscovery.discover())
      expect(adapterResult.providers).toEqual(oracleResult.providers)
      const anthropic = adapterResult.providers.find((p) => p.providerID === ("anthropic" as never))
      expect(anthropic?.authMethod).toBe("credential_file")
      // credential_file entries never carry a cost field (pre- and post-extraction).
      expect(anthropic).not.toHaveProperty("cost")
    } finally {
      delete process.env.FAKE_OPENAI_ENV_SET
    }
  })

  test("credential-file extractor returns null (malformed JSON) -> falls through, no crash", async () => {
    mockProviderList({
      anthropic: buildProvider("anthropic", ["FAKE_ANTHROPIC_ENV_UNSET"], {
        "claude-sonnet-4-20250514": { cost: { input: 3, output: 15 } },
      }),
      openai: buildProvider("openai", ["FAKE_OPENAI_ENV_SET"], {
        "gpt-4.1": { cost: { input: 2, output: 8 } },
      }),
    })
    mockAuthAll({})
    mockCredentialFile("not valid json {{{")
    mockCliAuth(false)
    await loadFresh()

    process.env.FAKE_OPENAI_ENV_SET = "1"
    try {
      const oracleExit = await Effect.runPromiseExit(Oracle.discover())
      const adapterExit = await Effect.runPromiseExit(ProviderDiscovery.discover())
      // Only openai discoverable (anthropic's credential file is unusable) -> both fail
      // with InsufficientProvidersError(available=1).
      expect(oracleExit._tag).toBe("Failure")
      expect(adapterExit._tag).toBe("Failure")
      if (oracleExit._tag === "Failure" && adapterExit._tag === "Failure") {
        const oracleErr = Cause.squash(oracleExit.cause) as InstanceType<typeof Oracle.InsufficientProvidersError>
        const adapterErr = Cause.squash(adapterExit.cause) as InstanceType<
          typeof ProviderDiscovery.InsufficientProvidersError
        >
        expect(adapterErr.data).toEqual(oracleErr.data)
      }
    } finally {
      delete process.env.FAKE_OPENAI_ENV_SET
    }
  })

  test("cli-subprocess auth (google, no credential-file config for google): identical shape", async () => {
    mockProviderList({
      google: buildProvider("google", ["FAKE_GOOGLE_ENV_UNSET"], {
        "gemini-2.5-pro": { cost: { input: 1, output: 2 } },
      }),
      openai: buildProvider("openai", ["FAKE_OPENAI_ENV_SET"], {
        "gpt-4.1": { cost: { input: 2, output: 8 } },
      }),
    })
    mockAuthAll({})
    mockCliAuth(true)
    await loadFresh()

    process.env.FAKE_OPENAI_ENV_SET = "1"
    try {
      const oracleResult = await Effect.runPromise(Oracle.discover())
      const adapterResult = await Effect.runPromise(ProviderDiscovery.discover())
      expect(adapterResult.providers).toEqual(oracleResult.providers)
      const google = adapterResult.providers.find((p) => p.providerID === ("google" as never))
      expect(google?.authMethod).toBe("cli_subprocess")
      expect(google).not.toHaveProperty("cost")
    } finally {
      delete process.env.FAKE_OPENAI_ENV_SET
    }
  })

  test("cli-subprocess auth fails (binary not found) -> provider skipped, no crash, identical shape", async () => {
    mockProviderList({
      google: buildProvider("google", ["FAKE_GOOGLE_ENV_UNSET"], {
        "gemini-2.5-pro": { cost: { input: 1, output: 2 } },
      }),
      openai: buildProvider("openai", ["FAKE_OPENAI_ENV_SET"], {
        "gpt-4.1": { cost: { input: 2, output: 8 } },
      }),
      mistral: buildProvider("mistral", ["FAKE_MISTRAL_ENV_SET"], {
        "mistral-large-latest": { cost: { input: 1, output: 3 } },
      }),
    })
    mockAuthAll({})
    mockCliAuth(false)
    await loadFresh()

    process.env.FAKE_OPENAI_ENV_SET = "1"
    process.env.FAKE_MISTRAL_ENV_SET = "1"
    try {
      const oracleResult = await Effect.runPromise(Oracle.discover())
      const adapterResult = await Effect.runPromise(ProviderDiscovery.discover())
      expect(adapterResult.providers).toEqual(oracleResult.providers)
      // google (cli_subprocess only) must be absent — the mocked CLI always fails.
      expect(adapterResult.providers.find((p) => p.providerID === ("google" as never))).toBeUndefined()
      expect(adapterResult.providers).toHaveLength(2)
    } finally {
      delete process.env.FAKE_OPENAI_ENV_SET
      delete process.env.FAKE_MISTRAL_ENV_SET
    }
  })

  test("ghost-model audit (deprecated status): identical warnings", async () => {
    mockProviderList({
      anthropic: buildProvider("anthropic", ["FAKE_ANTHROPIC_KEY"], {
        "claude-sonnet-4-20250514": { cost: { input: 3, output: 15 }, status: "deprecated" },
      }),
      openai: buildProvider("openai", ["FAKE_OPENAI_KEY"], {
        "gpt-4.1": { cost: { input: 2, output: 8 } },
      }),
    })
    mockAuthAll({})
    await loadFresh()

    process.env.FAKE_ANTHROPIC_KEY = "1"
    process.env.FAKE_OPENAI_KEY = "1"
    try {
      const oracleResult = await Effect.runPromise(Oracle.discover())
      const adapterResult = await Effect.runPromise(ProviderDiscovery.discover())
      expect(adapterResult.ghostWarnings).toEqual(oracleResult.ghostWarnings)
      expect(adapterResult.ghostWarnings).toHaveLength(1)
      expect(adapterResult.ghostWarnings[0]?.reason).toMatch(/deprecated/)
    } finally {
      delete process.env.FAKE_ANTHROPIC_KEY
      delete process.env.FAKE_OPENAI_KEY
    }
  })

  test("unknown modelID in PREFERRED_MODELS -> resolver falls back to first available model, identical", async () => {
    mockProviderList({
      anthropic: buildProvider("anthropic", ["FAKE_ANTHROPIC_KEY"], {
        "some-other-anthropic-model": { cost: { input: 1, output: 1 } },
      }),
      openai: buildProvider("openai", ["FAKE_OPENAI_KEY"], {
        "gpt-4.1": { cost: { input: 2, output: 8 } },
      }),
    })
    mockAuthAll({})
    await loadFresh()

    process.env.FAKE_ANTHROPIC_KEY = "1"
    process.env.FAKE_OPENAI_KEY = "1"
    try {
      const oracleResult = await Effect.runPromise(Oracle.discover())
      const adapterResult = await Effect.runPromise(ProviderDiscovery.discover())
      expect(adapterResult.providers).toEqual(oracleResult.providers)
      const anthropic = adapterResult.providers.find((p) => p.providerID === ("anthropic" as never))
      expect(anthropic?.modelID).toBe("some-other-anthropic-model" as never)
    } finally {
      delete process.env.FAKE_ANTHROPIC_KEY
      delete process.env.FAKE_OPENAI_KEY
    }
  })

  test("provider unknown to registry (present in env, absent from Provider.list) -> silently skipped, identical", async () => {
    mockProviderList({
      openai: buildProvider("openai", ["FAKE_OPENAI_KEY"], {
        "gpt-4.1": { cost: { input: 2, output: 8 } },
      }),
      mistral: buildProvider("mistral", ["FAKE_MISTRAL_KEY"], {
        "mistral-large-latest": { cost: { input: 1, output: 3 } },
      }),
    })
    mockAuthAll({})
    await loadFresh()

    process.env.FAKE_GOOGLE_KEY = "1" // not consulted; google absent from Provider.list
    process.env.FAKE_OPENAI_KEY = "1"
    process.env.FAKE_MISTRAL_KEY = "1"
    try {
      const oracleResult = await Effect.runPromise(Oracle.discover())
      const adapterResult = await Effect.runPromise(ProviderDiscovery.discover())
      expect(adapterResult.providers).toEqual(oracleResult.providers)
      expect(adapterResult.providers.find((p) => p.providerID === ("google" as never))).toBeUndefined()
    } finally {
      delete process.env.FAKE_GOOGLE_KEY
      delete process.env.FAKE_OPENAI_KEY
      delete process.env.FAKE_MISTRAL_KEY
    }
  })
})

// ============================================================================
// SECTION 2 — includeJudge / selectJudge: oracle vs adapter
// ============================================================================

describe("includeJudge() — pure function, oracle vs adapter", () => {
  test("prepends a judge not already present — identical result", async () => {
    await loadFresh()
    const base = [
      { providerID: "provider-a" as never, modelID: "model-a" as never, authMethod: "api_key" as const },
    ]
    const oracleResult = Oracle.includeJudge(base, "provider-judge" as never, "model-judge" as never)
    const adapterResult = ProviderDiscovery.includeJudge(base, "provider-judge" as never, "model-judge" as never)
    expect(adapterResult.map((p) => ({ providerID: p.providerID, modelID: p.modelID, role: p.role }))).toEqual(
      oracleResult.map((p) => ({ providerID: p.providerID, modelID: p.modelID, role: p.role })),
    )
  })

  test("does not duplicate an existing participant — identical result", async () => {
    await loadFresh()
    const base = [
      { providerID: "provider-judge" as never, modelID: "model-judge" as never, authMethod: "api_key" as const },
    ]
    const oracleResult = Oracle.includeJudge(base, "provider-judge" as never, "model-judge" as never)
    const adapterResult = ProviderDiscovery.includeJudge(base, "provider-judge" as never, "model-judge" as never)
    expect(adapterResult).toHaveLength(1)
    expect(oracleResult).toHaveLength(1)
  })

  test("no judge args -> passthrough unchanged — identical result", async () => {
    await loadFresh()
    const base = [
      { providerID: "provider-a" as never, modelID: "model-a" as never, authMethod: "api_key" as const },
    ]
    expect(ProviderDiscovery.includeJudge(base)).toEqual(Oracle.includeJudge(base))
  })
})

describe("selectJudge() — oracle vs adapter, mocked Provider/Auth", () => {
  test("explicit judge wins — identical result", async () => {
    await loadFresh()
    const participants = [
      { providerID: "provider-a" as never, modelID: "model-a" as never, authMethod: "api_key" as const },
    ]
    const oracleJudge = await Effect.runPromise(
      Oracle.selectJudge(participants, "explicit-provider" as never, "explicit-model" as never),
    )
    const adapterJudge = await Effect.runPromise(
      ProviderDiscovery.selectJudge(participants, "explicit-provider" as never, "explicit-model" as never),
    )
    expect({ providerID: adapterJudge.providerID, modelID: adapterJudge.modelID, role: adapterJudge.role }).toEqual({
      providerID: oracleJudge.providerID,
      modelID: oracleJudge.modelID,
      role: oracleJudge.role,
    })
  })

  test("heuristic loop: first unused PREFERRED_MODELS entry with auth — identical result", async () => {
    mockProviderList({
      google: buildProvider("google", ["FAKE_GOOGLE_ENV_SET"], {
        "gemini-2.5-pro": { cost: { input: 1, output: 2 } },
      }),
    })
    mockAuthAll({})
    await loadFresh()

    process.env.FAKE_GOOGLE_ENV_SET = "1"
    try {
      const participants = [
        {
          providerID: "anthropic" as never,
          modelID: "claude-sonnet-4-20250514" as never,
          authMethod: "api_key" as const,
        },
      ]
      const oracleJudge = await Effect.runPromise(Oracle.selectJudge(participants))
      const adapterJudge = await Effect.runPromise(ProviderDiscovery.selectJudge(participants))
      expect({
        providerID: adapterJudge.providerID,
        modelID: adapterJudge.modelID,
        role: adapterJudge.role,
      }).toEqual({ providerID: oracleJudge.providerID, modelID: oracleJudge.modelID, role: oracleJudge.role })
      expect(adapterJudge.providerID).toBe("google" as never)
    } finally {
      delete process.env.FAKE_GOOGLE_ENV_SET
    }
  })

  test("fallback: strongest (highest output cost) participant when no PREFERRED_MODELS slot free — identical result", async () => {
    mockProviderList({}) // nothing available -> heuristic loop finds nothing
    mockAuthAll({})
    await loadFresh()

    const participants = [
      { providerID: "cheap" as never, modelID: "cheap-model" as never, authMethod: "api_key" as const, cost: { input: 1, output: 1 } },
      { providerID: "expensive" as never, modelID: "expensive-model" as never, authMethod: "api_key" as const, cost: { input: 1, output: 99 } },
    ]
    const oracleJudge = await Effect.runPromise(Oracle.selectJudge(participants))
    const adapterJudge = await Effect.runPromise(ProviderDiscovery.selectJudge(participants))
    expect(adapterJudge.providerID).toBe(oracleJudge.providerID)
    expect(adapterJudge.providerID).toBe("expensive" as never)
  })
})

// ============================================================================
// SECTION 3 — characterized, non-blocking cosmetic divergences
//
// These ARE real shape differences between the oracle and the adapter,
// discovered by direct comparison. Both are pinned here with an
// explanation of why they do not affect any current Debate consumer
// (verified by reading every call site — see comments).
// ============================================================================

describe("characterized divergence: explicit-participant 'role' key presence", () => {
  test("oracle always has a 'role' OWN PROPERTY (possibly undefined); adapter omits it when absent", async () => {
    await loadFresh()
    const oracleResult = await Effect.runPromise(
      Oracle.discover([
        { providerID: "provider-a", modelID: "model-a" },
        { providerID: "provider-b", modelID: "model-b" },
      ]),
    )
    const adapterResult = await Effect.runPromise(
      ProviderDiscovery.discover([
        { providerID: "provider-a", modelID: "model-a" },
        { providerID: "provider-b", modelID: "model-b" },
      ]),
    )

    // The divergence, pinned:
    expect("role" in oracleResult.providers[0]!).toBe(true)
    expect("role" in adapterResult.providers[0]!).toBe(false)

    // Why it's safe: JSON-serialized shape is identical (JSON.stringify
    // drops undefined-valued keys either way) ...
    expect(JSON.stringify(adapterResult.providers[0])).toBe(JSON.stringify(oracleResult.providers[0]))
    // ... and `toEqual` (used throughout this suite and by
    // budget-tracker.ts's `p.cost ?? getDefaultCost(...)` /
    // orchestrator.ts's `"cost" in a && a.cost` reads on the COST field,
    // not role) treats an absent key and an own key with value `undefined`
    // as equivalent.
    expect(adapterResult.providers[0]).toEqual(oracleResult.providers[0])

    // Verified by reading every consumer (src/collective/orchestrator.ts):
    // the `role` field on a raw ProviderDiscovery.discover() participant is
    // NEVER read directly — orchestrator.ts builds its own
    // Collective.Participant.role from RoleAssigner.assign()'s output
    // (`role: roles[i]`), not from `d.role`. The only place a discovered
    // participant's `.role` is read is the judge entry appended by
    // includeJudge()/selectJudge(), which BOTH oracle and adapter set
    // explicitly to the literal "judge" (always present, non-undefined) —
    // unaffected by this divergence.
  })
})

describe("characterized divergence: judge object key insertion order", () => {
  test("selectJudge's returned object has different key order (role before/after authMethod) but equal value", async () => {
    await loadFresh()
    const participants = [
      { providerID: "provider-a" as never, modelID: "model-a" as never, authMethod: "api_key" as const },
    ]
    const oracleJudge = await Effect.runPromise(
      Oracle.selectJudge(participants, "explicit-provider" as never, "explicit-model" as never),
    )
    const adapterJudge = await Effect.runPromise(
      ProviderDiscovery.selectJudge(participants, "explicit-provider" as never, "explicit-model" as never),
    )
    // Key order differs (oracle: providerID, modelID, role, authMethod;
    // adapter: providerID, modelID, authMethod, role) -> JSON.stringify
    // strings are NOT byte-identical, but structural equality holds and no
    // consumer depends on JSON key order (Debate never JSON.stringify's a
    // judge object for a checksum/hash — only for human-readable logs via
    // Log.create(), which uses util.inspect-style formatting, not raw
    // JSON.stringify comparison).
    expect(JSON.stringify(adapterJudge) === JSON.stringify(oracleJudge)).toBe(false)
    expect(adapterJudge).toEqual(oracleJudge)
  })
})

// ============================================================================
// SECTION 4 — insufficient-providers error: payload equality + Fail/Die parity
// ============================================================================

describe("InsufficientProvidersError — payload equality (available/required)", () => {
  test("explicit path, 1 unique participant: identical error data on both sides", async () => {
    await loadFresh()
    const oracleExit = await Effect.runPromiseExit(
      Oracle.discover([{ providerID: "provider-a", modelID: "model-a" }]),
    )
    const adapterExit = await Effect.runPromiseExit(
      ProviderDiscovery.discover([{ providerID: "provider-a", modelID: "model-a" }]),
    )
    expect(oracleExit._tag).toBe("Failure")
    expect(adapterExit._tag).toBe("Failure")
    if (oracleExit._tag === "Failure" && adapterExit._tag === "Failure") {
      const oracleErr = Cause.squash(oracleExit.cause) as InstanceType<typeof Oracle.InsufficientProvidersError>
      const adapterErr = Cause.squash(adapterExit.cause) as InstanceType<
        typeof ProviderDiscovery.InsufficientProvidersError
      >
      expect(adapterErr).toBeInstanceOf(ProviderDiscovery.InsufficientProvidersError)
      expect(adapterErr.data).toEqual({ available: 1, required: 2 })
      expect(adapterErr.data).toEqual(oracleErr.data)
    }
  })

  test("cascade path, 0 providers available: identical error data on both sides", async () => {
    mockProviderList({})
    mockAuthAll({})
    await loadFresh()

    const oracleExit = await Effect.runPromiseExit(Oracle.discover())
    const adapterExit = await Effect.runPromiseExit(ProviderDiscovery.discover())
    expect(oracleExit._tag).toBe("Failure")
    expect(adapterExit._tag).toBe("Failure")
    if (oracleExit._tag === "Failure" && adapterExit._tag === "Failure") {
      const oracleErr = Cause.squash(oracleExit.cause) as InstanceType<typeof Oracle.InsufficientProvidersError>
      const adapterErr = Cause.squash(adapterExit.cause) as InstanceType<
        typeof ProviderDiscovery.InsufficientProvidersError
      >
      expect(adapterErr.data).toEqual({ available: 0, required: 2 })
      expect(adapterErr.data).toEqual(oracleErr.data)
    }
  })

  test("Promise-boundary behaviour (.rejects.toBeInstanceOf) is unchanged — matches every current caller's error handling", async () => {
    // orchestrator.test.ts and tool/debate.ts's executeWithLiveTracking
    // both observe ProviderDiscovery.discover() failures ONLY via a
    // rejected Promise (plain try/catch / .catch()) — never via
    // Effect.catchTag/catchAll. This is the one guarantee that actually
    // matters for today's runtime behaviour, and it holds:
    await loadFresh()
    await expect(
      Effect.runPromise(ProviderDiscovery.discover([{ providerID: "provider-a", modelID: "model-a" }])),
    ).rejects.toBeInstanceOf(ProviderDiscovery.InsufficientProvidersError)
  })
})

describe("Fail/Die parity — adapter now matches the pre-B02 oracle (TEAM-B02-FIX verified)", () => {
  // HISTORY: this block was originally named "KNOWN REGRESSION" and its two
  // tests asserted the OPPOSITE of what they assert now — they pinned the
  // adapter's Die (defect) behaviour as a deliberate trip-wire, because at
  // the time (TEAM-B05, commit 0e9225a1ed on the old base
  // d94b4108894477f166ea57b6fb15a769f82a7044) the production adapter really
  // did convert InsufficientProvidersError from a recoverable Effect Fail
  // into an unrecoverable Die. That finding was reported (not fixed, out of
  // this card's scope) in B05-BLOCKED.md and fixed by corrective card
  // TEAM-B02-FIX, commit a3343b7fda9d3b1694032e1be1e7372bf37bd270:
  // src/collective/provider-discovery.ts:131-132's
  // `Effect.promise(() => Effect.runPromise(...))` round-trip was replaced
  // with a direct `yield* discoverAvailableProviders(...)`, restoring a
  // genuine Fail. Independently reviewed and APPROVED_WITH_FOLLOWUP, and
  // separately pinned by the fix's own test,
  // test/collective/provider-discovery.fail-die.test.ts.
  //
  // Rebased onto Team HEAD a3343b7fda9d3b1694032e1be1e7372bf37bd270
  // (2026-07-25, TEAM-B05 retry) and re-verified: BOTH assertions below now
  // hold for BOTH oracle and adapter — i.e. the divergence this block used
  // to pin is gone. This is exactly what the trip-wire was for: the old
  // assertions (adapter hasFails=false/hasDies=true) would fail loudly the
  // moment the underlying code changed, forcing this conscious update
  // instead of silently drifting out of sync with reality.

  test("oracle (pre-B02): InsufficientProvidersError is a recoverable Effect Fail", async () => {
    await loadFresh()
    const exit = await Effect.runPromiseExit(
      Oracle.discover([{ providerID: "provider-a", modelID: "model-a" }]),
    )
    expect(exit._tag).toBe("Failure")
    if (exit._tag !== "Failure") return
    expect(Cause.hasFails(exit.cause)).toBe(true)
    expect(Cause.hasDies(exit.cause)).toBe(false)

    // Because it's a genuine Fail, Effect's typed recovery combinators
    // (Effect.catch / catchTag / catchTags) CAN intercept it without the
    // caller crashing:
    const recovered = await Effect.runPromise(
      Oracle.discover([{ providerID: "provider-a", modelID: "model-a" }]).pipe(
        Effect.catch(() => Effect.succeed("recovered" as const)),
      ),
    )
    expect(recovered).toBe("recovered")
  })

  test("adapter (current, post-B02-FIX): InsufficientProvidersError is a recoverable Effect Fail — SAME as the oracle", async () => {
    await loadFresh()
    const exit = await Effect.runPromiseExit(
      ProviderDiscovery.discover([{ providerID: "provider-a", modelID: "model-a" }]),
    )
    expect(exit._tag).toBe("Failure")
    if (exit._tag !== "Failure") return
    // Parity restored: hasFails is now true, hasDies is now false — matches
    // the oracle's cause shape for the identical input (previously this
    // asserted the exact inverse; see the describe-block history comment
    // above for why that inversion was deliberate and expected).
    expect(Cause.hasFails(exit.cause)).toBe(true)
    expect(Cause.hasDies(exit.cause)).toBe(false)

    expect(Cause.squash(exit.cause)).toBeInstanceOf(ProviderDiscovery.InsufficientProvidersError)

    // Effect.catch now recovers it cleanly, exactly like the oracle above —
    // this is the concrete, executable proof that Fail/Die parity is
    // restored: identical input, identical `.pipe(Effect.catch(...))`
    // composition, identical (successful, non-throwing) outcome.
    const recovered = await Effect.runPromise(
      ProviderDiscovery.discover([{ providerID: "provider-a", modelID: "model-a" }]).pipe(
        Effect.catch(() => Effect.succeed("recovered" as const)),
      ),
    )
    expect(recovered).toBe("recovered")
  })

  test("dedup to < 2 unique participants also fails as a recoverable Fail on both sides (matches provider-discovery.fail-die.test.ts)", async () => {
    await loadFresh()
    const oracleExit = await Effect.runPromiseExit(
      Oracle.discover([
        { providerID: "provider-a", modelID: "model-a" },
        { providerID: "provider-a", modelID: "model-a", role: "duplicate" },
      ]),
    )
    const adapterExit = await Effect.runPromiseExit(
      ProviderDiscovery.discover([
        { providerID: "provider-a", modelID: "model-a" },
        { providerID: "provider-a", modelID: "model-a", role: "duplicate" },
      ]),
    )
    expect(oracleExit._tag).toBe("Failure")
    expect(adapterExit._tag).toBe("Failure")
    if (oracleExit._tag !== "Failure" || adapterExit._tag !== "Failure") return
    expect(Cause.hasFails(oracleExit.cause)).toBe(true)
    expect(Cause.hasFails(adapterExit.cause)).toBe(true)
    expect(Cause.hasDies(adapterExit.cause)).toBe(false)
  })

  // Fix location (verified via `git show`, not modified by this card):
  //   src/collective/provider-discovery.ts:131-132 (post-fix)
  //     const result = yield* discoverAvailableProviders(explicitNorm, maxProviders)
  //   replacing the pre-fix:
  //     const result = yield* Effect.promise(() =>
  //       Effect.runPromise(discoverAvailableProviders(explicitNorm, maxProviders)),
  //     )
  //   `discoverAvailableProviders` already returns an Effect; composing it
  //   natively via `yield*` lets a typed `Effect.fail(...)` propagate as a
  //   genuine Fail through Effect's own error channel instead of being
  //   forced through a Promise-rejection round-trip that `Effect.promise`
  //   (by contract) reclassifies as an unrecoverable Die.
  //
  //   This restores the adapter's own documented claim: "Behaviour change
  //   vs the pre-B02 implementation: NONE" (src/collective/provider-discovery.ts:27)
  //   and re-validates the typed error channel declared at
  //   src/collective/orchestrator.ts:49
  //   (`InstanceType<typeof ProviderDiscovery.InsufficientProvidersError>`
  //   listed as part of `run`'s recoverable Effect<...> error type `E`) —
  //   that declaration is now actually true at runtime again.
})
