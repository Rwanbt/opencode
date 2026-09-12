// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Unifia contributors
//
// Original work. No upstream derivation.

export type E2EModel = { providerID: string; modelID: string }

export const E2E_PROVIDER_ID = "e2e"
export const E2E_MODEL_ID = "test-model"

type ProviderResponse = {
  providers?: Array<{ id: string; models?: Record<string, unknown> }>
}

export function createE2EProviderConfig(baseURL: string) {
  return {
    provider: {
      [E2E_PROVIDER_ID]: {
        name: "E2E Provider",
        npm: "@ai-sdk/openai-compatible",
        env: [],
        models: {
          [E2E_MODEL_ID]: {
            name: "E2E Test Model",
            tool_call: true,
            limit: { context: 131_072, output: 4_096 },
          },
        },
        options: { apiKey: "test-key", baseURL },
      },
    },
  }
}

export function resolveE2ESeedModel(body: ProviderResponse, override?: string): E2EModel {
  const served = (body.providers ?? []).flatMap((provider) =>
    Object.keys(provider.models ?? {}).map((modelID) => ({ providerID: provider.id, modelID })),
  )
  if (!served.length) throw new Error("The E2E backend serves no models")
  if (!override) {
    const configured = served.find((item) => item.providerID === E2E_PROVIDER_ID)
    if (configured) return configured
    throw new Error(`The E2E backend does not serve provider ${E2E_PROVIDER_ID}`)
  }

  const [providerID, modelID] = override.split("/")
  const requested = served.find((item) => item.providerID === providerID && item.modelID === modelID)
  if (requested) return requested
  throw new Error(`The E2E backend does not serve requested model ${override}`)
}
