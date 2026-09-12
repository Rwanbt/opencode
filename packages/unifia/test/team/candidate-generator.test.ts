import { describe, expect, it } from "bun:test"
import {
  buildCandidateIndex,
  CandidateGeneratorInputError,
  endpointKey,
  generateCandidates,
  toRoutingCandidateInputs,
  type CandidateEndpoint,
} from "../../src/team/candidate-generator"

function endpoint(overrides: Partial<CandidateEndpoint> = {}): CandidateEndpoint {
  return {
    providerID: "anthropic",
    modelID: "claude-sonnet",
    family: "claude",
    status: "active",
    lifecycleStage: "general_eligible",
    capabilities: {
      structuredOutput: true,
      toolCalls: true,
      parallelToolCalls: true,
      visionInput: true,
      audioInput: false,
      videoInput: false,
      pdfInput: true,
      reasoning: true,
      caching: true,
      promptCaching: true,
      systemMessages: true,
    },
    inputModalities: ["text", "image"],
    contextTotalTokens: 200_000,
    contextOutputTokens: 8_000,
    providerRegions: ["US", "EU"],
    providerGuaranteesDataResidency: true,
    privacyPolicyRef: "https://example.test/privacy",
    ...overrides,
  }
}

describe("buildCandidateIndex", () => {
  it("indexes endpoints by provider and by lifecycle stage", () => {
    const index = buildCandidateIndex([
      endpoint(),
      endpoint({ providerID: "openai", modelID: "gpt", family: "gpt" }),
      endpoint({ modelID: "claude-haiku", lifecycleStage: "low_risk_eligible" }),
    ])

    expect(index.all).toHaveLength(3)
    expect(index.byProvider.get("anthropic")).toHaveLength(2)
    expect(index.byProvider.get("openai")).toHaveLength(1)
    expect(index.byLifecycleStage.get("general_eligible")).toHaveLength(2)
    expect(index.byLifecycleStage.get("low_risk_eligible")).toHaveLength(1)
  })

  it("rejects a duplicate provider/model endpoint", () => {
    expect(() => buildCandidateIndex([endpoint(), endpoint()])).toThrow(CandidateGeneratorInputError)
  })

  it("freezes indexed endpoints so a returned candidate cannot corrupt the snapshot", () => {
    const index = buildCandidateIndex([endpoint({ modelID: "x" })])
    const candidate = generateCandidates(index).eligible[0]!

    expect(Object.isFrozen(candidate)).toBe(true)
    expect(() => {
      // @ts-expect-error deliberately violating readonly to prove the freeze holds
      candidate.providerID = "HACKED"
    }).toThrow()
    expect(index.all[0]!.providerID).toBe("anthropic")
  })

  it("is unaffected by the caller mutating the source array after build", () => {
    const source = [endpoint({ modelID: "a" })]
    const index = buildCandidateIndex(source)
    source.push(endpoint({ modelID: "b" }))

    expect(index.all).toHaveLength(1)
  })

  it("rejects a malformed endpoint at the boundary", () => {
    // @ts-expect-error deliberately malformed for the boundary test
    expect(() => buildCandidateIndex([{ providerID: "", modelID: "x" }])).toThrow(CandidateGeneratorInputError)
  })
})

describe("generateCandidates — no requirements", () => {
  it("keeps every non-terminal endpoint when nothing is required", () => {
    const index = buildCandidateIndex([endpoint(), endpoint({ modelID: "b" }), endpoint({ modelID: "c" })])
    const result = generateCandidates(index)

    expect(result.eligible).toHaveLength(3)
    expect(result.eliminated).toHaveLength(0)
    expect(result.stats).toMatchObject({ totalEndpoints: 3, eligibleCount: 3, eliminatedCount: 0 })
  })

  it("always eliminates terminal lifecycle stages even with no requirements (C08)", () => {
    const index = buildCandidateIndex([
      endpoint(),
      endpoint({ modelID: "old", lifecycleStage: "deprecated" }),
      endpoint({ modelID: "flagged", lifecycleStage: "quarantined" }),
    ])
    const result = generateCandidates(index)

    expect(result.eligible).toHaveLength(1)
    expect(result.eliminated.map((item) => item.rule)).toEqual(["LIFECYCLE_TERMINAL", "LIFECYCLE_TERMINAL"])
  })

  it("preserves input order in both output lists", () => {
    const index = buildCandidateIndex([
      endpoint({ modelID: "a" }),
      endpoint({ modelID: "b", lifecycleStage: "deprecated" }),
      endpoint({ modelID: "c" }),
      endpoint({ modelID: "d", lifecycleStage: "quarantined" }),
    ])
    const result = generateCandidates(index)

    expect(result.eligible.map((item) => item.modelID)).toEqual(["a", "c"])
    expect(result.eliminated.map((item) => item.modelID)).toEqual(["b", "d"])
  })
})

describe("generateCandidates — permissions", () => {
  it("eliminates providers outside the allowed set without re-testing them", () => {
    const index = buildCandidateIndex([
      endpoint(),
      endpoint({ providerID: "openai", modelID: "gpt", family: "gpt" }),
      endpoint({ providerID: "google", modelID: "gemini", family: "gemini" }),
    ])
    const result = generateCandidates(index, { allowedProviderIDs: ["anthropic"] })

    expect(result.eligible.map((item) => item.providerID)).toEqual(["anthropic"])
    expect(result.eliminated.map((item) => item.rule)).toEqual(["PROVIDER_NOT_ALLOWED", "PROVIDER_NOT_ALLOWED"])
    expect(result.stats.byRule.PROVIDER_NOT_ALLOWED).toBe(2)
  })

  it("eliminates an explicitly denied provider even when it is otherwise allowed", () => {
    const index = buildCandidateIndex([endpoint(), endpoint({ providerID: "openai", modelID: "gpt" })])
    const result = generateCandidates(index, { deniedProviderIDs: ["anthropic"] })

    expect(result.eligible.map((item) => item.providerID)).toEqual(["openai"])
    expect(result.eliminated[0]!.rule).toBe("PROVIDER_DENIED")
  })

  it("does not double-count when allowedProviderIDs repeats a provider", () => {
    const index = buildCandidateIndex([endpoint({ modelID: "m1" }), endpoint({ modelID: "m2" })])
    const result = generateCandidates(index, { allowedProviderIDs: ["anthropic", "anthropic"] })

    expect(result.eligible.map((item) => item.modelID)).toEqual(["m1", "m2"])
    expect(result.stats.eligibleCount + result.stats.eliminatedCount).toBe(result.stats.totalEndpoints)
  })

  it("surfaces an allow-list provider that matches nothing in the index", () => {
    const index = buildCandidateIndex([endpoint()])
    const typo = generateCandidates(index, { allowedProviderIDs: ["anthropikc"] })

    // Without this signal a typo is indistinguishable from a legitimate
    // "everything filtered out" result.
    expect(typo.stats.unknownAllowedProviderIDs).toEqual(["anthropikc"])
    expect(typo.eligible).toHaveLength(0)

    const correct = generateCandidates(index, { allowedProviderIDs: ["anthropic"] })
    expect(correct.stats.unknownAllowedProviderIDs).toEqual([])
  })

  it("reports every endpoint exactly once across eligible and eliminated", () => {
    const index = buildCandidateIndex([
      endpoint({ providerID: "a", modelID: "1" }),
      endpoint({ providerID: "b", modelID: "2" }),
      endpoint({ providerID: "c", modelID: "3", lifecycleStage: "deprecated" }),
    ])
    const result = generateCandidates(index, { allowedProviderIDs: ["a", "c"] })

    const reported = [...result.eligible.map(endpointKey), ...result.eliminated.map((item) => item.endpointKey)]
    expect(reported.sort()).toEqual(["a::1", "b::2", "c::3"])
    expect(new Set(reported).size).toBe(3)
  })
})

describe("generateCandidates — lifecycle and status", () => {
  it("restricts to the allowed lifecycle stages", () => {
    const index = buildCandidateIndex([
      endpoint({ modelID: "trusted", lifecycleStage: "trusted_by_domain" }),
      endpoint({ modelID: "probed", lifecycleStage: "probed" }),
    ])
    const result = generateCandidates(index, { allowedLifecycleStages: ["trusted_by_domain"] })

    expect(result.eligible.map((item) => item.modelID)).toEqual(["trusted"])
    expect(result.eliminated[0]!.rule).toBe("LIFECYCLE_STAGE_NOT_ALLOWED")
  })

  it("restricts to the allowed statuses", () => {
    const index = buildCandidateIndex([endpoint(), endpoint({ modelID: "beta-model", status: "beta" })])
    const result = generateCandidates(index, { allowedStatuses: ["active"] })

    expect(result.eligible.map((item) => item.modelID)).toEqual(["claude-sonnet"])
    expect(result.eliminated[0]!.rule).toBe("STATUS_NOT_ALLOWED")
  })
})

describe("generateCandidates — technical capability and context", () => {
  it("eliminates an endpoint missing a required capability, naming it", () => {
    const index = buildCandidateIndex([
      endpoint(),
      endpoint({ modelID: "no-audio", capabilities: { ...endpoint().capabilities, audioInput: false } }),
    ])
    const result = generateCandidates(index, { requiredCapabilities: ["audioInput"] })

    expect(result.eligible).toHaveLength(0)
    expect(result.eliminated).toHaveLength(2)
    expect(result.eliminated[0]!.rule).toBe("MISSING_CAPABILITY")
    expect(result.eliminated[0]!.reason).toContain("audioInput")
  })

  it("eliminates an endpoint missing a required input modality", () => {
    const index = buildCandidateIndex([endpoint({ inputModalities: ["text"] })])
    const result = generateCandidates(index, { requiredInputModalities: ["image"] })

    expect(result.eliminated[0]!.rule).toBe("MISSING_INPUT_MODALITY")
    expect(result.eliminated[0]!.reason).toContain("image")
  })

  it("eliminates an endpoint whose context window is too small", () => {
    const index = buildCandidateIndex([endpoint({ contextTotalTokens: 8_000 })])
    const result = generateCandidates(index, { minContextTotalTokens: 100_000 })

    expect(result.eliminated[0]!.rule).toBe("CONTEXT_TOTAL_TOO_SMALL")
    expect(result.eliminated[0]!.reason).toContain("100000")
  })

  it("eliminates an endpoint whose output window is too small", () => {
    const index = buildCandidateIndex([endpoint({ contextOutputTokens: 1_000 })])
    const result = generateCandidates(index, { minContextOutputTokens: 4_000 })

    expect(result.eliminated[0]!.rule).toBe("CONTEXT_OUTPUT_TOO_SMALL")
  })

  it("accepts an endpoint exactly at the context threshold (boundary is inclusive)", () => {
    const index = buildCandidateIndex([endpoint({ contextTotalTokens: 100_000 })])
    const result = generateCandidates(index, { minContextTotalTokens: 100_000 })

    expect(result.eligible).toHaveLength(1)
  })
})

describe("generateCandidates — privacy", () => {
  it("eliminates a provider that does not guarantee data residency", () => {
    const index = buildCandidateIndex([endpoint({ providerGuaranteesDataResidency: false })])
    const result = generateCandidates(index, { requiresDataResidency: true })

    expect(result.eliminated[0]!.rule).toBe("PRIVACY_NO_DATA_RESIDENCY")
  })

  it("eliminates a provider serving no allowed region", () => {
    const index = buildCandidateIndex([endpoint({ providerRegions: ["US"] })])
    const result = generateCandidates(index, { allowedRegions: ["EU"] })

    expect(result.eliminated[0]!.rule).toBe("PRIVACY_REGION_NOT_ALLOWED")
  })

  it("keeps a provider serving at least one allowed region", () => {
    const index = buildCandidateIndex([endpoint({ providerRegions: ["US", "EU"] })])
    const result = generateCandidates(index, { allowedRegions: ["EU", "FR"] })

    expect(result.eligible).toHaveLength(1)
  })

  it("rejects a lowercase region code instead of silently matching nothing", () => {
    // A silent non-match here would eliminate the endpoint on privacy
    // grounds for what is really a data-formatting mistake.
    expect(() => buildCandidateIndex([endpoint({ providerRegions: ["eu"] })])).toThrow(CandidateGeneratorInputError)
    expect(() => generateCandidates(buildCandidateIndex([endpoint()]), { allowedRegions: ["eu"] })).toThrow(
      CandidateGeneratorInputError,
    )
  })

  it("eliminates a provider with no published privacy policy when one is required", () => {
    const index = buildCandidateIndex([endpoint({ privacyPolicyRef: null })])
    const result = generateCandidates(index, { requiresPublishedPrivacyPolicy: true })

    expect(result.eliminated[0]!.rule).toBe("PRIVACY_NO_POLICY")
  })
})

describe("generateCandidates — reviewer separation (D-010 §6)", () => {
  it("never lets an endpoint review its own implementation", () => {
    const index = buildCandidateIndex([endpoint(), endpoint({ modelID: "claude-opus" })])
    const result = generateCandidates(index, {
      reviewerSeparation: {
        implementerEndpointKey: "anthropic::claude-sonnet",
        implementerFamily: "claude",
        forbidSameFamily: false,
      },
    })

    expect(result.eligible.map((item) => item.modelID)).toEqual(["claude-opus"])
    expect(result.eliminated[0]!.rule).toBe("REVIEWER_SAME_ENDPOINT")
  })

  it("excludes the whole implementer family when same-family review is forbidden", () => {
    const index = buildCandidateIndex([
      endpoint(),
      endpoint({ modelID: "claude-opus" }),
      endpoint({ providerID: "openai", modelID: "gpt", family: "gpt" }),
    ])
    const result = generateCandidates(index, {
      reviewerSeparation: {
        implementerEndpointKey: "anthropic::claude-sonnet",
        implementerFamily: "claude",
        forbidSameFamily: true,
      },
    })

    expect(result.eligible.map((item) => item.modelID)).toEqual(["gpt"])
    expect(result.eliminated.map((item) => item.rule)).toEqual(["REVIEWER_SAME_ENDPOINT", "REVIEWER_SAME_FAMILY"])
  })

  it("does not exclude a null-family endpoint as same-family", () => {
    const index = buildCandidateIndex([endpoint({ modelID: "unknown-family", family: null })])
    const result = generateCandidates(index, {
      reviewerSeparation: { implementerEndpointKey: null, implementerFamily: "claude", forbidSameFamily: true },
    })

    expect(result.eligible).toHaveLength(1)
  })
})

describe("generateCandidates — determinism and rule ordering", () => {
  it("reports the same first failing rule for an endpoint violating several requirements", () => {
    const index = buildCandidateIndex([endpoint({ status: "beta", contextTotalTokens: 10 })])
    const requirements = { allowedStatuses: ["active" as const], minContextTotalTokens: 100_000 }

    const first = generateCandidates(index, requirements)
    const second = generateCandidates(index, requirements)

    expect(first.eliminated[0]!.rule).toBe("STATUS_NOT_ALLOWED")
    expect(second.eliminated).toEqual(first.eliminated)
  })

  it("rejects an empty allowedProviderIDs at the runtime boundary", () => {
    // Type-legal but meaningless: an empty allow-list would silently
    // eliminate everything, so the schema requires .min(1) instead.
    expect(() => generateCandidates(buildCandidateIndex([endpoint()]), { allowedProviderIDs: [] })).toThrow(
      CandidateGeneratorInputError,
    )
  })
})

describe("toRoutingCandidateInputs — D01 bridge", () => {
  it("carries the elimination rule and reason, and never invents a workerId", () => {
    const index = buildCandidateIndex([endpoint(), endpoint({ modelID: "old", lifecycleStage: "deprecated" })])
    const projected = toRoutingCandidateInputs(generateCandidates(index))

    expect(projected).toHaveLength(2)
    expect(projected.every((item) => item.workerId === null)).toBe(true)
    expect(projected[0]!.rejectedReason).toContain("LIFECYCLE_TERMINAL")
    expect(projected[1]!.rejectedReason).toBeNull()
  })
})

// ---------------------------------------------------------------------
// Load test — acceptance criterion: p95 < 200 ms for 1000 endpoints,
// and the reduction must actually happen (no trivial pass by keeping all).
// ---------------------------------------------------------------------

const LOAD_ENDPOINT_COUNT = 1_000
const P95_BUDGET_MS = 200

const IMPLEMENTER_KEY = "google::implementer"

/**
 * Each archetype is a deliberate one-rule deviation from an otherwise
 * eligible endpoint, so the load set provably reaches every rule.
 *
 * An earlier version of this fixture derived every field from `i % n`
 * arithmetic. That looked like broad coverage but wasn't: the residency
 * rule (even `i`) and the region rule (`i % 4`) were correlated, so every
 * endpoint that would have failed the region check had already been cut
 * for residency, and the region rule never fired at 1000 endpoints. The
 * archetypes below state each case explicitly instead.
 */
const LOAD_ARCHETYPES: readonly (() => CandidateEndpoint)[] = [
  () => endpoint({ providerID: "mistral", family: "mistral", lifecycleStage: "trusted_by_domain" }),
  () => endpoint({ providerID: "meta", family: "llama", lifecycleStage: "deprecated" }),
  () => endpoint({ providerID: "anthropic", family: "claude", lifecycleStage: "probed" }),
  () => endpoint({ providerID: "openai", family: "gpt", status: "beta" }),
  () =>
    endpoint({
      providerID: "openai",
      family: "gpt",
      capabilities: { ...endpoint().capabilities, toolCalls: false },
    }),
  () => endpoint({ providerID: "mistral", family: "mistral", inputModalities: ["text"] }),
  () => endpoint({ providerID: "mistral", family: "mistral", contextTotalTokens: 8_000 }),
  () => endpoint({ providerID: "openai", family: "gpt", providerGuaranteesDataResidency: false }),
  () => endpoint({ providerID: "openai", family: "gpt", providerRegions: ["JP"] }),
  () => endpoint({ providerID: "openai", family: "gpt", privacyPolicyRef: null }),
  // Otherwise fully eligible, but shares the implementer's family.
  () => endpoint({ providerID: "google", family: "gemini" }),
]

function buildLoadEndpoints(count: number): CandidateEndpoint[] {
  const endpoints: CandidateEndpoint[] = [
    // Exactly one endpoint is the implementer itself.
    endpoint({ providerID: "google", modelID: "implementer", family: "gemini" }),
  ]
  for (let i = endpoints.length; i < count; i++) {
    const archetype = LOAD_ARCHETYPES[i % LOAD_ARCHETYPES.length]!()
    endpoints.push({ ...archetype, modelID: `${archetype.providerID}-model-${i}` })
  }
  return endpoints
}

describe(`generateCandidates — load test (${LOAD_ENDPOINT_COUNT} endpoints)`, () => {
  const endpoints = buildLoadEndpoints(LOAD_ENDPOINT_COUNT)
  const index = buildCandidateIndex(endpoints)
  const requirements = {
    allowedLifecycleStages: ["general_eligible", "trusted_by_domain"] as const,
    allowedStatuses: ["active"] as const,
    requiredCapabilities: ["toolCalls", "structuredOutput"] as const,
    requiredInputModalities: ["image"] as const,
    minContextTotalTokens: 64_000,
    requiresDataResidency: true,
    allowedRegions: ["EU", "FR"] as const,
    requiresPublishedPrivacyPolicy: true,
    reviewerSeparation: {
      implementerEndpointKey: IMPLEMENTER_KEY,
      implementerFamily: "gemini",
      forbidSameFamily: true,
    },
  }

  it("indexes 1000 endpoints and explains every one of them", () => {
    expect(index.all).toHaveLength(LOAD_ENDPOINT_COUNT)

    const result = generateCandidates(index, requirements)
    expect(result.stats.totalEndpoints).toBe(LOAD_ENDPOINT_COUNT)
    expect(result.stats.eligibleCount + result.stats.eliminatedCount).toBe(LOAD_ENDPOINT_COUNT)
    // The filter must genuinely reduce: neither keep everything nor kill everything.
    expect(result.stats.eligibleCount).toBeGreaterThan(0)
    expect(result.stats.eligibleCount).toBeLessThan(LOAD_ENDPOINT_COUNT)
    // Every eliminated endpoint carries a non-empty explanation.
    expect(result.eliminated.every((item) => item.reason.length > 0)).toBe(true)
  })

  it("exercises every filter category at scale, not just lifecycle", () => {
    const result = generateCandidates(index, requirements)
    const fired = Object.keys(result.stats.byRule).sort()

    // Guards against a fixture that passes only because one cheap rule
    // eliminates almost everything before the later rules are ever reached.
    // PROVIDER_NOT_ALLOWED / PROVIDER_DENIED are absent by design: these
    // requirements set no provider restriction. Both are covered by the
    // dedicated permission tests above.
    expect(fired).toEqual([
      "CONTEXT_TOTAL_TOO_SMALL",
      "LIFECYCLE_STAGE_NOT_ALLOWED",
      "LIFECYCLE_TERMINAL",
      "MISSING_CAPABILITY",
      "MISSING_INPUT_MODALITY",
      "PRIVACY_NO_DATA_RESIDENCY",
      "PRIVACY_NO_POLICY",
      "PRIVACY_REGION_NOT_ALLOWED",
      "REVIEWER_SAME_ENDPOINT",
      "REVIEWER_SAME_FAMILY",
      "STATUS_NOT_ALLOWED",
    ])
  })

  it(`keeps p95 under ${P95_BUDGET_MS} ms across 100 queries`, () => {
    const samples: number[] = []
    for (let run = 0; run < 100; run++) {
      const started = performance.now()
      generateCandidates(index, requirements)
      samples.push(performance.now() - started)
    }
    samples.sort((a, b) => a - b)
    const p95 = samples[Math.floor(samples.length * 0.95)]!

    expect(p95).toBeLessThan(P95_BUDGET_MS)
  })
})
