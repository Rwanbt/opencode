/* SPDX-License-Identifier: MIT */

import { describe, expect, test } from "bun:test"
import {
  DEFAULT_PLUGIN_CAPABILITY,
  PLUGIN_KINDS,
  PLUGIN_SPEC_VERSION,
  grantCapabilities,
  parsePluginManifest,
} from "../src/plugin-manifest"

const VALID = {
  specVersion: PLUGIN_SPEC_VERSION,
  name: "linear-export",
  version: "1.0.0",
  kind: "skill" as const,
  mode: "prototype" as const,
  capabilities: ["prompt:inject", "artifact.export"],
  inputs: [{ id: "token", label: "API token", required: true }],
}

describe("parsePluginManifest", () => {
  test("a valid manifest is accepted", () => {
    const parsed = parsePluginManifest(VALID)
    expect(parsed.name).toBe("linear-export")
    expect(parsed.kind).toBe("skill")
    expect(parsed.capabilities).toEqual(["prompt:inject", "artifact.export"])
  })

  test("an unknown specVersion is refused", () => {
    expect(() => parsePluginManifest({ ...VALID, specVersion: "2.0.0" })).toThrow(/unsupported/)
  })

  test("a kind outside the closed union is refused", () => {
    expect(() => parsePluginManifest({ ...VALID, kind: "macro" })).toThrow(/closed union/)
  })

  test("every kind in PLUGIN_KINDS is accepted", () => {
    for (const kind of PLUGIN_KINDS) {
      const parsed = parsePluginManifest({ ...VALID, kind })
      expect(parsed.kind).toBe(kind)
    }
  })

  test("a name not matching the id regex is refused", () => {
    expect(() => parsePluginManifest({ ...VALID, name: "LinearExport" })).toThrow(/id regex/)
  })

  test("a version not matching SemVer is refused", () => {
    expect(() => parsePluginManifest({ ...VALID, version: "1.0" })).toThrow(/SemVer/)
  })

  test("a missing name is refused", () => {
    const { name: _name, ...rest } = VALID
    void _name
    expect(() => parsePluginManifest(rest)).toThrow(/non-empty string/)
  })

  test("a capability outside the regex is refused", () => {
    expect(() =>
      parsePluginManifest({ ...VALID, capabilities: ["onClick"] })
    ).toThrow(/invalid entry/)
  })

  test("an input id outside the regex is refused", () => {
    expect(() =>
      parsePluginManifest({ ...VALID, inputs: [{ id: "Token", label: "API token", required: true }] })
    ).toThrow(/input id is invalid/)
  })

  test("a non-object input entry is refused", () => {
    expect(() => parsePluginManifest({ ...VALID, inputs: ["token"] })).toThrow(/non-object entry/)
  })

  test("a manifest with no capabilities parses with an empty array", () => {
    const { capabilities: _capabilities, ...rest } = VALID
    void _capabilities
    const parsed = parsePluginManifest(rest)
    expect(parsed.capabilities).toEqual([])
  })
})

describe("grantCapabilities", () => {
  test("the plugin is granted only the intersection with the workspace grant", () => {
    const grant = grantCapabilities(VALID, ["prompt:inject", "workspace.read"])
    expect(grant).toEqual(["prompt:inject"])
  })

  test("a plugin that asks for more than the grant is refused (no over-grant)", () => {
    const grant = grantCapabilities(VALID, ["prompt:inject"])
    expect(grant).toEqual(["prompt:inject"])
    expect(grant).not.toContain("artifact.export")
  })

  test("an empty grant yields an empty intersection", () => {
    expect(grantCapabilities(VALID, [])).toEqual([])
  })
})

describe("constants", () => {
  test("PLUGIN_SPEC_VERSION is 1.0.0", () => {
    expect(PLUGIN_SPEC_VERSION).toBe("1.0.0")
  })
  test("DEFAULT_PLUGIN_CAPABILITY is prompt:inject", () => {
    expect(DEFAULT_PLUGIN_CAPABILITY).toBe("prompt:inject")
  })
})
