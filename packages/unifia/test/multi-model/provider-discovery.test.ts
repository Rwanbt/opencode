/**
 * provider-discovery.test.ts — TEAM-B02
 *
 * Unit tests for multi-model/provider-discovery.ts (canonical substrate).
 *
 * Coverage:
 *   - includeJudgeInList (pure, sync)
 *       * empty list, undefined judge → unchanged
 *       * non-empty list, undefined judge → unchanged
 *       * judge already in list → no duplicate
 *       * judge not in list → prepended with role="judge"
 *   - discoverAvailableProviders with explicit short-circuit
 *       * ≥ 2 distinct models → succeeds, returns DiscoveredProvider list
 *       * < 2 distinct models → InsufficientProvidersError
 *       * duplicate models → dedup before counting
 *       * empty explicit array → falls through to Provider.list() (we
 *         don't test the runtime path here; only the explicit branch)
 *   - AuthMethod enum is exhaustive (sanity check)
 */

import { Effect } from "effect"
import { describe, expect, test } from "bun:test"

import {
  AUTH_METHODS,
  includeJudgeInList,
  discoverAvailableProviders,
  InsufficientProvidersError,
  makeModelRef,
} from "../../src/multi-model/provider-discovery"
import { ModelInvalidRequestError } from "../../src/multi-model/types"

const ref = (providerID: string, modelID: string) => makeModelRef(providerID, modelID)

describe("multi-model/provider-discovery — includeJudgeInList", () => {
  test("returns the list unchanged when no judge is provided", () => {
    const list = [
      { model: ref("anthropic", "claude-sonnet-4-20250514"), authMethod: "api_key" as const },
    ]
    expect(includeJudgeInList(list, undefined)).toEqual(list)
    expect(includeJudgeInList(list)).toEqual(list)
  })

  test("returns the list unchanged when the judge is already present", () => {
    const judge = ref("anthropic", "claude-sonnet-4-20250514")
    const list = [
      { model: judge, authMethod: "api_key" as const },
      { model: ref("openai", "gpt-4.1"), authMethod: "api_key" as const },
    ]
    const result = includeJudgeInList(list, judge)
    expect(result).toHaveLength(2)
    expect(result[0]?.model).toEqual(judge)
  })

  test("prepends the judge with role='judge' when not already present", () => {
    const judge = ref("google", "gemini-2.5-pro")
    const list = [
      { model: ref("anthropic", "claude-sonnet-4-20250514"), authMethod: "api_key" as const },
      { model: ref("openai", "gpt-4.1"), authMethod: "api_key" as const },
    ]
    const result = includeJudgeInList(list, judge)
    expect(result).toHaveLength(3)
    expect(result[0]?.model).toEqual(judge)
    expect(result[0]?.role).toBe("judge")
    expect(result[0]?.authMethod).toBe("api_key")
  })

  test("returns empty array unchanged when empty input and undefined judge", () => {
    expect(includeJudgeInList([])).toEqual([])
    expect(includeJudgeInList([], undefined)).toEqual([])
  })
})

describe("multi-model/provider-discovery — discoverAvailableProviders (explicit branch)", () => {
  test("succeeds when ≥ 2 distinct explicit participants are provided", async () => {
    const explicit = [
      { providerID: "anthropic", modelID: "claude-sonnet-4-20250514" },
      { providerID: "openai", modelID: "gpt-4.1" },
    ]
    const exit = await Effect.runPromiseExit(discoverAvailableProviders(explicit))
    expect(exit._tag).toBe("Success")
    if (exit._tag !== "Success") return
    expect(exit.value.providers).toHaveLength(2)
    expect(exit.value.providers[0]?.model.providerID).toBe("anthropic")
    expect(exit.value.providers[0]?.model.modelID).toBe("claude-sonnet-4-20250514")
    expect(exit.value.providers[0]?.authMethod).toBe("api_key")
    expect(exit.value.providers[1]?.model.providerID).toBe("openai")
    expect(exit.value.ghostWarnings).toEqual([])
  })

  test("deduplicates identical (providerID, modelID) pairs", async () => {
    const explicit = [
      { providerID: "anthropic", modelID: "claude-sonnet-4-20250514" },
      { providerID: "anthropic", modelID: "claude-sonnet-4-20250514", role: "duplicate" },
      { providerID: "openai", modelID: "gpt-4.1" },
    ]
    const exit = await Effect.runPromiseExit(discoverAvailableProviders(explicit))
    expect(exit._tag).toBe("Success")
    if (exit._tag !== "Success") return
    expect(exit.value.providers).toHaveLength(2)
  })

  test("fails with InsufficientProvidersError when only 1 distinct model is provided", async () => {
    const explicit = [{ providerID: "anthropic", modelID: "claude-sonnet-4-20250514" }]
    const exit = await Effect.runPromiseExit(discoverAvailableProviders(explicit))
    expect(exit._tag).toBe("Failure")
    if (exit._tag !== "Failure") return
    // Effect stores failure reasons on .reasons, not .failures. Each reason
    // has a toJSON() that exposes { _tag, error } where error is a plain
    // object with .name and .data (prototype lost through serialization).
    const cause = exit.cause as unknown as {
      reasons?: Array<{ toJSON?: () => unknown }>
    }
    const reasons = cause.reasons ?? []
    expect(reasons.length).toBeGreaterThan(0)
    const json = reasons[0]?.toJSON?.() as
      | { _tag?: string; error?: { name?: string; data?: unknown } }
      | undefined
    expect(json?._tag).toBe("Fail")
    expect(json?.error?.name).toBe("InsufficientProvidersError")
    const data = json?.error?.data as { available?: number; required?: number } | undefined
    expect(data?.available).toBe(1)
    expect(data?.required).toBe(2)
  })

  test("preserves role field from explicit participants", async () => {
    const explicit = [
      { providerID: "anthropic", modelID: "claude-sonnet-4-20250514", role: "primary" },
      { providerID: "openai", modelID: "gpt-4.1", role: "annex" },
    ]
    const exit = await Effect.runPromiseExit(discoverAvailableProviders(explicit))
    expect(exit._tag).toBe("Success")
    if (exit._tag !== "Success") return
    expect(exit.value.providers[0]?.role).toBe("primary")
    expect(exit.value.providers[1]?.role).toBe("annex")
  })

  test("rejects explicit participants with invalid ModelRef shape", async () => {
    const explicit = [
      { providerID: "anthropic", modelID: "claude-sonnet-4-20250514" },
      { providerID: "evil provider with spaces", modelID: "gpt-4.1" },
    ]
    const exit = await Effect.runPromiseExit(discoverAvailableProviders(explicit))
    expect(exit._tag).toBe("Failure")
    if (exit._tag !== "Failure") return
    // Effect captures the synchronous throw from makeModelRef() as a Die
    // defect (or possibly Fail). Inspect each reason via toJSON() to
    // extract the original error name.
    const cause = exit.cause as unknown as {
      reasons?: Array<{ toJSON?: () => unknown }>
    }
    const reasons = cause.reasons ?? []
    expect(reasons.length).toBeGreaterThan(0)
    const json = reasons[0]?.toJSON?.() as
      | { _tag?: string; error?: { name?: string }; defect?: { name?: string } }
      | undefined
    expect(json).toBeDefined()
    const errorName = json?.error?.name ?? json?.defect?.name
    expect(errorName).toBe("ModelInvalidRequestError")
  })
})

describe("multi-model/provider-discovery — constants", () => {
  test("AUTH_METHODS contains exactly api_key, credential_file, cli_subprocess", () => {
    expect(AUTH_METHODS).toEqual(["api_key", "credential_file", "cli_subprocess"])
    expect(AUTH_METHODS).toHaveLength(3)
  })
})
