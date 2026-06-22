import { describe, expect, test } from "bun:test"
import { Collective } from "../../src/collective/types"

describe("Collective.DebateID", () => {
  test("make produces prefixed ID", () => {
    const id = Collective.DebateID.make()
    expect(id.startsWith("dbt_")).toBe(true)
    expect(id.length).toBeGreaterThan(10)
  })

  test("zod validates correct ID", () => {
    const id = Collective.DebateID.make()
    const result = Collective.DebateID.zod.safeParse(id)
    expect(result.success).toBe(true)
  })

  test("zod rejects invalid prefix", () => {
    const result = Collective.DebateID.zod.safeParse("invalid_123")
    expect(result.success).toBe(false)
  })
})

describe("Collective.ClaimID", () => {
  test("make produces prefixed ID", () => {
    const id = Collective.ClaimID.make()
    expect(id.startsWith("clm_")).toBe(true)
  })
})

describe("Collective.DebateConfig", () => {
  test("parses minimal config", () => {
    const result = Collective.DebateConfig.safeParse({
      question: "How to secure auth?",
    })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.tier).toBe("quick")
      expect(result.data.redTeam).toBe("auto")
      expect(result.data.enableMeta).toBe(true)
      expect(result.data.enableCanary).toBe(false)
      expect(result.data.enableShadowBaseline).toBe(true)
      expect(result.data.noMemory).toBe(false)
      expect(result.data.maxRounds).toBe(2)
    }
  })

  test("parses full config", () => {
    const result = Collective.DebateConfig.safeParse({
      question: "Architecture review",
      context: "We have a monolith",
      tier: "deep",
      redTeam: "always",
      enableCanary: true,
      maxRounds: 3,
    })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.tier).toBe("deep")
      expect(result.data.redTeam).toBe("always")
      expect(result.data.enableCanary).toBe(true)
    }
  })

  test("rejects empty question", () => {
    const result = Collective.DebateConfig.safeParse({ question: "" })
    expect(result.success).toBe(false)
  })
})

describe("Collective.Claim", () => {
  test("parses valid claim", () => {
    const result = Collective.Claim.safeParse({
      claimId: Collective.ClaimID.make(),
      sourceId: "anon_abc123",
      sourceProvider: "anonymous",
      category: "security",
      content: "SQL injection possible via unsanitized input",
      confidenceSelf: 0.9,
      noveltyMarker: "unique",
      isActionable: true,
      supportedBy: ["anon_abc123"],
      contradictedBy: [],
    })
    expect(result.success).toBe(true)
  })

  test("validates confidence bounds", () => {
    const base = {
      claimId: Collective.ClaimID.make(),
      sourceId: "x",
      sourceProvider: "y",
      category: "security" as const,
      content: "test",
      noveltyMarker: "unique" as const,
      isActionable: false,
      supportedBy: [],
      contradictedBy: [],
    }
    expect(Collective.Claim.safeParse({ ...base, confidenceSelf: 1.5 }).success).toBe(false)
    expect(Collective.Claim.safeParse({ ...base, confidenceSelf: -0.1 }).success).toBe(false)
    expect(Collective.Claim.safeParse({ ...base, confidenceSelf: 0.5 }).success).toBe(true)
  })
})

describe("Collective.TIER_CONFIG", () => {
  test("free tier has no convergence", () => {
    const cfg = Collective.TIER_CONFIG.free
    expect(cfg.phases).not.toContain("phase3_converge")
    expect(cfg.maxConvergenceRounds).toBe(0)
    expect(cfg.enableCanary).toBe(false)
  })

  test("deep tier has all phases", () => {
    const cfg = Collective.TIER_CONFIG.deep
    expect(cfg.phases).toContain("phase3_converge")
    expect(cfg.maxConvergenceRounds).toBeGreaterThan(0)
    expect(cfg.enableCanary).toBe(true)
    expect(cfg.redTeam).toBe("always")
  })

  test("standard tier has convergence", () => {
    const cfg = Collective.TIER_CONFIG.standard
    expect(cfg.phases).toContain("phase3_converge")
    expect(cfg.cosineSimilarityThreshold).toBe(0.85)
  })

  test("all tiers have budgets", () => {
    for (const tier of ["free", "quick", "standard", "deep"] as const) {
      const cfg = Collective.TIER_CONFIG[tier]
      expect(cfg.budgetDefaults.maxTotalTokens).toBeGreaterThan(0)
      expect(cfg.budgetDefaults.maxCostUsd).toBeGreaterThanOrEqual(0)
    }
  })
})

describe("Collective.ProviderAuth", () => {
  test("parses api_key variant", () => {
    const result = Collective.ProviderAuth.safeParse({
      method: "api_key",
      key: "sk-test-123",
    })
    expect(result.success).toBe(true)
  })

  test("parses credential_file variant", () => {
    const result = Collective.ProviderAuth.safeParse({
      method: "credential_file",
      path: "~/.claude/creds.json",
      content: '{"token":"abc"}',
    })
    expect(result.success).toBe(true)
  })

  test("parses cli_subprocess variant", () => {
    const result = Collective.ProviderAuth.safeParse({
      method: "cli_subprocess",
      binary: "claude",
      args: ["--print"],
    })
    expect(result.success).toBe(true)
  })
})
