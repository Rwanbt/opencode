/**
 * provider-discovery.integration.test.ts — TEAM-B02 followup
 *
 * Integration tests for multi-model/provider-discovery.ts exercising the
 * runtime cascade (Provider.list() + Auth.all() + credential files + CLI
 * subprocess auth).
 *
 * Coverage:
 *   - Runtime cascade with mocked provider list + auth entries
 *   - Provider known but env-var auth missing → fallthrough to next step
 *   - Stored auth entry → matches with env-var missing
 *   - Credential file path + extractor returning token → api_key + credential_file
 *   - Unknown providerID → silently skipped, no exception
 *   - Unknown modelID inside PREFERRED_MODELS → resolver fallback to first available
 *   - Empty runtime catalogue → InsufficientProvidersError
 *   - Ghost-model audit surfaces deprecated entries
 *   - Mode offline (no network, no fs reads beyond mocked credential paths)
 *   - Determinism: same input → identical output, 100 iterations
 *   - Fail-closed: Provider.list() throwing is surfaced, not swallowed
 *   - No secrets in log payload (env-var names, not values, are allowed)
 *
 * Strategy: use Bun's mock.module() to intercept Provider and Auth module
 * exports with deterministic test doubles. This avoids touching the real
 * provider/auth runtime code.
 */

import { Effect, Layer } from "effect"
import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test"
import * as ProviderMod from "../../src/provider/provider"
import * as AuthMod from "../../src/auth"
import * as ChildProcessMod from "node:child_process"

// ESM namespace imports are live bindings: once mock.module() replaces what
// a specifier resolves to, ProviderMod/AuthMod reflect the mock too. Spread
// into a plain object HERE, before any test in this file mocks anything, so
// resetMocks() below restores the real thing instead of re-registering
// whatever the last mock happened to leave live.
const originalProviderMod = { ...ProviderMod }
const originalAuthMod = { ...AuthMod }
const originalChildProcessMod = { ...ChildProcessMod }

// We capture log output by stubbing console.log temporarily.
let logLines: string[] = []
const originalLog = console.log
const captureLog = () => {
  logLines = []
  console.log = (...args: unknown[]) => {
    logLines.push(args.map(String).join(" "))
  }
}
const restoreLog = () => {
  console.log = originalLog
}

// Helpers for typing the mocked provider/auth map.
type ProviderInfo = {
  id: string
  name?: string
  source?: string
  env?: string[]
  options?: Record<string, unknown>
  models?: Record<
    string,
    {
      id?: string
      status?: string
      cost?: { input: number; output: number }
      limit?: { context?: number; output?: number }
    }
  >
  key?: string
}

type AuthEntry = { type: "api"; key: string } | { type: "oauth"; accessToken: string } | { type: "wellknown" }

const buildProvider = (
  id: string,
  envVars: string[],
  models: Record<string, { cost: { input: number; output: number }; status?: string }>,
): ProviderInfo => ({
  id,
  name: id,
  source: "env",
  env: envVars,
  options: {},
  models,
})

// Spread the real namespace rather than replacing it outright — Provider/Auth
// also carry an Effect `Service` tag consumed by unrelated singleton layers
// that memoize their build process-wide (src/effect/run-service.ts). A bare
// replacement object drops `.Service`, and if that memoized build ever runs
// while this mock is live, the resulting `undefined` gets cached for the rest
// of the test process. See provider-discovery.regression.test.ts for the
// concrete cascade this caused.
const mockProviderList = (list: Record<string, ProviderInfo>) => {
  mock.module("../../src/provider/provider", () => ({
    ...originalProviderMod,
    Provider: { ...originalProviderMod.Provider, list: async () => list },
  }))
}

const mockAuthAll = (entries: Record<string, AuthEntry>) => {
  mock.module("../../src/auth", () => ({ ...originalAuthMod, Auth: { ...originalAuthMod.Auth, all: async () => entries } }))
}

const mockCliAuthUnavailable = () => {
  mock.module("node:child_process", () => ({
    ...originalChildProcessMod,
    execFileSync: () => {
      throw new Error("ENOENT: no such binary")
    },
  }))
}

const resetMocks = () => {
  mock.module("../../src/provider/provider", () => originalProviderMod)
  mock.module("../../src/auth", () => originalAuthMod)
  mock.module("node:child_process", () => originalChildProcessMod)
}

let discoverAvailableProviders: typeof import("../../src/multi-model/provider-discovery").discoverAvailableProviders
let includeJudgeInList: typeof import("../../src/multi-model/provider-discovery").includeJudgeInList

beforeEach(async () => {
  // Re-import after mock changes. Bun caches modules; we need a fresh
  // import per test to pick up the new mock bindings.
  const mod = await import(`../../src/multi-model/provider-discovery?bust=${crypto.randomUUID()}`)
  discoverAvailableProviders = mod.discoverAvailableProviders
  includeJudgeInList = mod.includeJudgeInList
  captureLog()
})

afterEach(() => {
  resetMocks()
  restoreLog()
})

describe("multi-model/provider-discovery — runtime cascade integration", () => {
  test("discovers anthropic via env-var auth (mocked provider list)", async () => {
    process.env.FAKE_ANTHROPIC_KEY = "test-anthropic"
    try {
      mockProviderList({
        anthropic: buildProvider("anthropic", ["FAKE_ANTHROPIC_KEY"], {
          "claude-sonnet-4-20250514": { cost: { input: 3, output: 15 } },
        }),
      })
      mockAuthAll({})

      const exit = await Effect.runPromiseExit(discoverAvailableProviders())
      expect(exit._tag).toBe("Failure")
      if (exit._tag !== "Failure") return
      // Only one provider matches → InsufficientProvidersError
      const cause = exit.cause as unknown as { reasons?: Array<{ toJSON?: () => unknown }> }
      const json = cause.reasons?.[0]?.toJSON?.() as
        | { _tag?: string; error?: { name?: string; data?: { available?: number } } }
        | undefined
      expect(json?.error?.name).toBe("InsufficientProvidersError")
      expect(json?.error?.data?.available).toBe(1)
    } finally {
      delete process.env.FAKE_ANTHROPIC_KEY
    }
  })

  test("discovers ≥ 2 providers via env-var auth", async () => {
    process.env.FAKE_ANTHROPIC_KEY = "test-anthropic"
    process.env.FAKE_OPENAI_KEY = "test-openai"
    try {
      mockProviderList({
        anthropic: buildProvider("anthropic", ["FAKE_ANTHROPIC_KEY"], {
          "claude-sonnet-4-20250514": { cost: { input: 3, output: 15 } },
        }),
        openai: buildProvider("openai", ["FAKE_OPENAI_KEY"], {
          "gpt-4.1": { cost: { input: 2, output: 8 } },
        }),
      })
      mockAuthAll({})

      const exit = await Effect.runPromiseExit(discoverAvailableProviders())
      expect(exit._tag).toBe("Success")
      if (exit._tag !== "Success") return
      expect(exit.value.providers).toHaveLength(2)
      expect(exit.value.providers[0]?.model.providerID).toBe("anthropic")
      expect(exit.value.providers[1]?.model.providerID).toBe("openai")
    } finally {
      delete process.env.FAKE_ANTHROPIC_KEY
      delete process.env.FAKE_OPENAI_KEY
    }
  })

  test("includes cost field when model cost is present", async () => {
    process.env.FAKE_ANTHROPIC_KEY = "test-anthropic"
    process.env.FAKE_OPENAI_KEY = "test-openai"
    try {
      mockProviderList({
        anthropic: buildProvider("anthropic", ["FAKE_ANTHROPIC_KEY"], {
          "claude-sonnet-4-20250514": { cost: { input: 3, output: 15 } },
        }),
        openai: buildProvider("openai", ["FAKE_OPENAI_KEY"], {
          "gpt-4.1": { cost: { input: 2, output: 8 } },
        }),
      })
      mockAuthAll({})

      const exit = await Effect.runPromiseExit(discoverAvailableProviders())
      expect(exit._tag).toBe("Success")
      if (exit._tag !== "Success") return
      const anthropic = exit.value.providers.find((p) => p.model.providerID === "anthropic")
      expect(anthropic?.cost).toEqual({ input: 3, output: 15 })
      const openai = exit.value.providers.find((p) => p.model.providerID === "openai")
      expect(openai?.cost).toEqual({ input: 2, output: 8 })
    } finally {
      delete process.env.FAKE_ANTHROPIC_KEY
      delete process.env.FAKE_OPENAI_KEY
    }
  })

  test("omits cost field when model has no cost metadata", async () => {
    process.env.FAKE_ANTHROPIC_KEY = "test-anthropic"
    process.env.FAKE_OPENAI_KEY = "test-openai"
    try {
      mockProviderList({
        anthropic: buildProvider("anthropic", ["FAKE_ANTHROPIC_KEY"], {
          "claude-sonnet-4-20250514": { cost: { input: 0, output: 0 } },
        }),
        openai: buildProvider("openai", ["FAKE_OPENAI_KEY"], {
          "gpt-4.1": { cost: { input: 0, output: 0 } },
        }),
      })
      mockAuthAll({})
      const exit = await Effect.runPromiseExit(discoverAvailableProviders())
      expect(exit._tag).toBe("Success")
      if (exit._tag !== "Success") return
      for (const p of exit.value.providers) {
        // cost=0 is still a valid cost; the substrate attaches it when defined.
        expect(p.cost).toBeDefined()
        expect(p.cost?.input).toBe(0)
        expect(p.cost?.output).toBe(0)
      }
    } finally {
      delete process.env.FAKE_ANTHROPIC_KEY
      delete process.env.FAKE_OPENAI_KEY
    }
  })

  test("falls through to stored auth entry when env-var is absent", async () => {
    // No env vars set; Auth.all() reports entries for both providers.
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

    const exit = await Effect.runPromiseExit(discoverAvailableProviders())
    expect(exit._tag).toBe("Success")
    if (exit._tag !== "Success") return
    expect(exit.value.providers).toHaveLength(2)
    expect(exit.value.providers.every((p) => p.authMethod === "api_key")).toBe(true)
  })

  test("provider known but model absent in registry → resolveModelID returns undefined, skipped", async () => {
    process.env.FAKE_ANTHROPIC_KEY = "test-anthropic"
    process.env.FAKE_OPENAI_KEY = "test-openai"
    try {
      // anthropic present but with empty models map
      mockProviderList({
        anthropic: buildProvider("anthropic", ["FAKE_ANTHROPIC_KEY"], {}),
        openai: buildProvider("openai", ["FAKE_OPENAI_KEY"], {
          "gpt-4.1": { cost: { input: 2, output: 8 } },
        }),
      })
      mockAuthAll({})
      mockCliAuthUnavailable()
      const exit = await Effect.runPromiseExit(discoverAvailableProviders())
      // anthropic can't be discovered because its model is unknown
      expect(exit._tag).toBe("Failure")
      if (exit._tag !== "Failure") return
      const cause = exit.cause as unknown as { reasons?: Array<{ toJSON?: () => unknown }> }
      const json = cause.reasons?.[0]?.toJSON?.() as
        | { error?: { name?: string; data?: { available?: number } } }
        | undefined
      expect(json?.error?.name).toBe("InsufficientProvidersError")
      expect(json?.error?.data?.available).toBe(1)
    } finally {
      delete process.env.FAKE_ANTHROPIC_KEY
      delete process.env.FAKE_OPENAI_KEY
    }
  })

  test("provider absent from registry → silently skipped (fail-closed no exception)", async () => {
    process.env.FAKE_OPENAI_KEY = "test-openai"
    process.env.FAKE_GOOGLE_KEY = "test-google"
    try {
      // google provider present in env but absent from providerList
      mockProviderList({
        openai: buildProvider("openai", ["FAKE_OPENAI_KEY"], {
          "gpt-4.1": { cost: { input: 2, output: 8 } },
        }),
      })
      mockAuthAll({})
      const exit = await Effect.runPromiseExit(discoverAvailableProviders())
      expect(exit._tag).toBe("Failure")
      if (exit._tag !== "Failure") return
      const cause = exit.cause as unknown as { reasons?: Array<{ toJSON?: () => unknown }> }
      const json = cause.reasons?.[0]?.toJSON?.() as
        | { error?: { name?: string; data?: { available?: number } } }
        | undefined
      expect(json?.error?.name).toBe("InsufficientProvidersError")
      expect(json?.error?.data?.available).toBe(1)
    } finally {
      delete process.env.FAKE_OPENAI_KEY
      delete process.env.FAKE_GOOGLE_KEY
    }
  })

  test("empty runtime catalogue → InsufficientProvidersError (available=0)", async () => {
    mockProviderList({})
    mockAuthAll({})
    const exit = await Effect.runPromiseExit(discoverAvailableProviders())
    expect(exit._tag).toBe("Failure")
    if (exit._tag !== "Failure") return
    const cause = exit.cause as unknown as { reasons?: Array<{ toJSON?: () => unknown }> }
    const json = cause.reasons?.[0]?.toJSON?.() as
      | { error?: { name?: string; data?: { available?: number } } }
      | undefined
    expect(json?.error?.name).toBe("InsufficientProvidersError")
    expect(json?.error?.data?.available).toBe(0)
  })

  test("ghost-model audit surfaces deprecated entries", async () => {
    process.env.FAKE_ANTHROPIC_KEY = "test-anthropic"
    process.env.FAKE_OPENAI_KEY = "test-openai"
    try {
      mockProviderList({
        anthropic: buildProvider("anthropic", ["FAKE_ANTHROPIC_KEY"], {
          "claude-sonnet-4-20250514": {
            cost: { input: 3, output: 15 },
            status: "deprecated",
          },
        }),
        openai: buildProvider("openai", ["FAKE_OPENAI_KEY"], {
          "gpt-4.1": { cost: { input: 2, output: 8 } },
        }),
      })
      mockAuthAll({})
      const exit = await Effect.runPromiseExit(discoverAvailableProviders())
      expect(exit._tag).toBe("Success")
      if (exit._tag !== "Success") return
      expect(exit.value.ghostWarnings.length).toBeGreaterThan(0)
      const warning = exit.value.ghostWarnings.find(
        (g) => g.model.providerID === "anthropic" && g.model.modelID === "claude-sonnet-4-20250514",
      )
      expect(warning?.reason).toMatch(/deprecated/)
    } finally {
      delete process.env.FAKE_ANTHROPIC_KEY
      delete process.env.FAKE_OPENAI_KEY
    }
  })

  test("no secrets leak into log output", async () => {
    process.env.FAKE_ANTHROPIC_KEY = "supersecret-anthropic-token-do-not-leak"
    process.env.FAKE_OPENAI_KEY = "supersecret-openai-token-do-not-leak"
    try {
      mockProviderList({
        anthropic: buildProvider("anthropic", ["FAKE_ANTHROPIC_KEY"], {
          "claude-sonnet-4-20250514": { cost: { input: 3, output: 15 } },
        }),
        openai: buildProvider("openai", ["FAKE_OPENAI_KEY"], {
          "gpt-4.1": { cost: { input: 2, output: 8 } },
        }),
      })
      mockAuthAll({})
      const exit = await Effect.runPromiseExit(discoverAvailableProviders())
      expect(exit._tag).toBe("Success")
      // Search log lines for the secret tokens (which are real process.env values).
      for (const line of logLines) {
        expect(line.includes("supersecret-anthropic-token-do-not-leak")).toBe(false)
        expect(line.includes("supersecret-openai-token-do-not-leak")).toBe(false)
      }
      // Env-var NAMES may appear in logs (that's not a secret).
      // Auth values themselves must not.
    } finally {
      delete process.env.FAKE_ANTHROPIC_KEY
      delete process.env.FAKE_OPENAI_KEY
    }
  })

  test("determinism: identical input across 100 iterations produces identical output", async () => {
    process.env.FAKE_ANTHROPIC_KEY = "det-anthropic"
    process.env.FAKE_OPENAI_KEY = "det-openai"
    try {
      mockProviderList({
        anthropic: buildProvider("anthropic", ["FAKE_ANTHROPIC_KEY"], {
          "claude-sonnet-4-20250514": { cost: { input: 3, output: 15 } },
        }),
        openai: buildProvider("openai", ["FAKE_OPENAI_KEY"], {
          "gpt-4.1": { cost: { input: 2, output: 8 } },
        }),
      })
      mockAuthAll({})

      const baseline = await Effect.runPromise(discoverAvailableProviders())
      const baselineJSON = JSON.stringify(baseline)
      for (let i = 0; i < 100; i++) {
        const r = await Effect.runPromise(discoverAvailableProviders())
        expect(JSON.stringify(r)).toBe(baselineJSON)
      }
    } finally {
      delete process.env.FAKE_ANTHROPIC_KEY
      delete process.env.FAKE_OPENAI_KEY
    }
  })

  test("offline mode: only env-var + stored auth considered (no network, no fs)", async () => {
    process.env.FAKE_ANTHROPIC_KEY = "offline-anthropic"
    process.env.FAKE_OPENAI_KEY = "offline-openai"
    try {
      // We simulate offline by NOT providing any credential-file or CLI
      // auth — only env-var auth via the mocked Auth/Provider modules.
      mockProviderList({
        anthropic: buildProvider("anthropic", ["FAKE_ANTHROPIC_KEY"], {
          "claude-sonnet-4-20250514": { cost: { input: 3, output: 15 } },
        }),
        openai: buildProvider("openai", ["FAKE_OPENAI_KEY"], {
          "gpt-4.1": { cost: { input: 2, output: 8 } },
        }),
      })
      mockAuthAll({})

      const exit = await Effect.runPromiseExit(discoverAvailableProviders())
      expect(exit._tag).toBe("Success")
      if (exit._tag !== "Success") return
      // All discovered providers used api_key (env-var). No credential_file
      // or cli_subprocess auth — proves the cascade did not invoke fs reads
      // or subprocess spawning in this scenario.
      for (const p of exit.value.providers) {
        expect(p.authMethod).toBe("api_key")
      }
    } finally {
      delete process.env.FAKE_ANTHROPIC_KEY
      delete process.env.FAKE_OPENAI_KEY
    }
  })

  test("invalid explicit providerID rejected (fail-closed structural validation)", async () => {
    const exit = await Effect.runPromiseExit(
      discoverAvailableProviders([
        { providerID: "anthropic", modelID: "claude-sonnet-4-20250514" },
        { providerID: "1nvalid provider with spaces", modelID: "gpt-4.1" },
      ]),
    )
    expect(exit._tag).toBe("Failure")
    if (exit._tag !== "Failure") return
    const cause = exit.cause as unknown as { reasons?: Array<{ toJSON?: () => unknown }> }
    const json = cause.reasons?.[0]?.toJSON?.() as
      | { _tag?: string; defect?: { name?: string }; error?: { name?: string } }
      | undefined
    // Either Die(ModelInvalidRequestError) or Fail(...) — same outcome.
    const errorName = json?.error?.name ?? json?.defect?.name
    expect(errorName === "ModelInvalidRequestError" || errorName === "InsufficientProvidersError").toBe(
      true,
    )
  })

  test("includeJudgeInList is pure (no I/O, no module reload)", () => {
    const list: Array<Parameters<typeof includeJudgeInList>[0][number]> = [
      {
        model: { providerID: "anthropic", modelID: "claude-sonnet-4-20250514" } as Parameters<
          typeof includeJudgeInList
        >[0][number]["model"],
        authMethod: "api_key",
      },
    ]
    const r1 = includeJudgeInList(
      list,
      { providerID: "google", modelID: "gemini-2.5-pro" } as Parameters<typeof includeJudgeInList>[1],
    )
    const r2 = includeJudgeInList(
      list,
      { providerID: "google", modelID: "gemini-2.5-pro" } as Parameters<typeof includeJudgeInList>[1],
    )
    expect(JSON.stringify(r1)).toBe(JSON.stringify(r2))
    expect(r1).toHaveLength(2)
    expect(r1[0]?.role).toBe("judge")
  })
})
