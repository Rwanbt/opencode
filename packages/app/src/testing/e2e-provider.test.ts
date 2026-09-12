// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Unifia contributors
//
// Original work. No upstream derivation.

import { describe, expect, test } from "bun:test"
import { createE2EProviderConfig, E2E_MODEL_ID, E2E_PROVIDER_ID, resolveE2ESeedModel } from "./e2e-provider"

describe("E2E provider", () => {
  const response = {
    providers: [{ id: E2E_PROVIDER_ID, models: { [E2E_MODEL_ID]: {} } }],
  }

  test("configures one hermetic OpenAI-compatible model", () => {
    const config = createE2EProviderConfig("http://127.0.0.1:1234/v1")
    const provider = config.provider[E2E_PROVIDER_ID]
    expect(provider.options.baseURL).toBe("http://127.0.0.1:1234/v1")
    expect(Object.keys(provider.models)).toEqual([E2E_MODEL_ID])
  })

  test("selects the first served model without an override", () => {
    expect(resolveE2ESeedModel(response)).toEqual({ providerID: E2E_PROVIDER_ID, modelID: E2E_MODEL_ID })
  })

  test("accepts an override only when the backend serves it", () => {
    expect(resolveE2ESeedModel(response, `${E2E_PROVIDER_ID}/${E2E_MODEL_ID}`)).toEqual({
      providerID: E2E_PROVIDER_ID,
      modelID: E2E_MODEL_ID,
    })
    expect(() => resolveE2ESeedModel(response, `${E2E_PROVIDER_ID}/missing`)).toThrow("does not serve requested model")
  })

  test("rejects a backend without models", () => {
    expect(() => resolveE2ESeedModel({ providers: [] })).toThrow("serves no models")
  })

  test("rejects an implicit fallback to a repository provider", () => {
    expect(() => resolveE2ESeedModel({ providers: [{ id: "repository-provider", models: { model: {} } }] })).toThrow(
      `does not serve provider ${E2E_PROVIDER_ID}`,
    )
  })
})
