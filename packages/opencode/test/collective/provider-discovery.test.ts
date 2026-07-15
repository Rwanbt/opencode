import { Effect } from "effect"
import { describe, expect, test } from "bun:test"
import { ProviderDiscovery } from "../../src/collective/provider-discovery"

describe("ProviderDiscovery explicit participants", () => {
  test("keeps every distinct requested model beyond tier defaults", async () => {
    const explicit = Array.from({ length: 10 }, (_, index) => ({
      providerID: `provider-${index}`,
      modelID: `model-${index}`,
    }))
    const result = await Effect.runPromise(ProviderDiscovery.discover(explicit, 2))
    expect(result.providers).toHaveLength(10)
  })

  test("includes the primary judge once without duplicating an existing participant", () => {
    const providers = [
      { providerID: "provider-a" as any, modelID: "model-a" as any, authMethod: "api_key" as const },
    ]
    const withJudge = ProviderDiscovery.includeJudge(providers, "provider-judge" as any, "model-judge" as any)
    expect(withJudge.map((provider) => `${provider.providerID}/${provider.modelID}`)).toEqual([
      "provider-judge/model-judge",
      "provider-a/model-a",
    ])
    expect(ProviderDiscovery.includeJudge(withJudge, "provider-judge" as any, "model-judge" as any)).toHaveLength(2)
  })

  test("deduplicates the same model and rejects a one-model debate", async () => {
    const result = await Effect.runPromise(
      ProviderDiscovery.discover([
        { providerID: "provider-a", modelID: "model-a" },
        { providerID: "provider-a", modelID: "model-a", role: "duplicate" },
        { providerID: "provider-b", modelID: "model-b" },
      ]),
    )
    expect(result.providers).toHaveLength(2)
    await expect(
      Effect.runPromise(ProviderDiscovery.discover([{ providerID: "provider-a", modelID: "model-a" }])),
    ).rejects.toBeInstanceOf(ProviderDiscovery.InsufficientProvidersError)
  })
})