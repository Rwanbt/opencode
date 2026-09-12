/* SPDX-License-Identifier: MIT */

/**
 * P29 — Marketplace plugin manifest.
 *
 * A marketplace plugin is a serialisable descriptor of a code
 * package the user can install from the composeur. The manifest is
 * the only thing the host reads from the marketplace; the actual
 * plugin code is loaded by the existing `package.install` capability
 * once the user accepts the install.
 *
 * The manifest declares its capabilities. The intersection with the
 * workspace grant is the rule that decides what the plugin is
 * actually allowed to do — a plugin that asks for more than the
 * workspace grants is refused and audited.
 *
 * `specVersion` different from "1.0.0" is refused rather than
 * silently interpreted.
 */

import type { SkillMode } from "@unifia/skill-hub"

export const PLUGIN_SPEC_VERSION = "1.0.0" as const
export type PluginSpecVersion = typeof PLUGIN_SPEC_VERSION

export const PLUGIN_KINDS = ["skill", "scenario", "atom", "bundle"] as const
export type PluginKind = (typeof PLUGIN_KINDS)[number]

export type PluginManifestField = {
  id: string
  label: string
  required: boolean
}

export type PluginManifest = {
  specVersion: PluginSpecVersion
  name: string
  version: string
  kind: PluginKind
  mode: SkillMode
  capabilities: readonly string[]
  inputs: readonly PluginManifestField[]
}

const NAME_REGEX = /^[a-z][a-z0-9-]{2,63}$/
const VERSION_REGEX = /^\d+\.\d+\.\d+$/
const ID_REGEX = /^[a-z][a-z0-9_-]{1,63}$/
const CAPABILITY_REGEX = /^[a-z][a-z0-9._:-]{1,63}$/

function readString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.length === 0) throw new Error(`plugin manifest field \`${field}\` must be a non-empty string`)
  return value
}

function readStringArray(value: unknown, field: string, regex: RegExp): readonly string[] {
  if (!Array.isArray(value)) throw new Error(`plugin manifest field \`${field}\` must be an array of strings`)
  const out: string[] = []
  for (const item of value) {
    if (typeof item !== "string" || !regex.test(item)) throw new Error(`plugin manifest field \`${field}\` has an invalid entry: ${JSON.stringify(item)}`)
    out.push(item)
  }
  return out
}

function readInputArray(value: unknown): readonly PluginManifestField[] {
  if (!Array.isArray(value)) throw new Error("plugin manifest field `inputs` must be an array")
  const out: PluginManifestField[] = []
  for (const item of value) {
    if (!item || typeof item !== "object") throw new Error("plugin manifest field `inputs` has a non-object entry")
    const record = item as Record<string, unknown>
    const id = readString(record.id, "inputs.id")
    if (!ID_REGEX.test(id)) throw new Error(`plugin manifest input id is invalid: ${JSON.stringify(id)}`)
    const label = readString(record.label, "inputs.label")
    const required = typeof record.required === "boolean" ? record.required : true
    out.push({ id, label, required })
  }
  return out
}

/**
 * Parses a plugin manifest from an unknown value. Throws on:
 * - `specVersion` different from `PLUGIN_SPEC_VERSION`
 * - missing `name`, `version`, or `kind`
 * - `name` not matching the id regex
 * - `version` not matching the SemVer pattern
 * - `kind` outside the closed union
 * - `mode` outside the closed union (validated at runtime, not at
 *   parse time, so older manifests can still be read)
 * - `capabilities` array with an invalid entry
 * - `inputs` array with a malformed entry
 */
export function parsePluginManifest(value: unknown): PluginManifest {
  if (!value || typeof value !== "object") throw new Error("plugin manifest must be an object")
  const record = value as Record<string, unknown>
  const specVersion = readString(record.specVersion, "specVersion")
  if (specVersion !== PLUGIN_SPEC_VERSION) throw new Error(`unsupported plugin manifest specVersion: ${JSON.stringify(specVersion)}`)
  const name = readString(record.name, "name")
  if (!NAME_REGEX.test(name)) throw new Error(`plugin manifest \`name\` does not match the id regex: ${JSON.stringify(name)}`)
  const version = readString(record.version, "version")
  if (!VERSION_REGEX.test(version)) throw new Error(`plugin manifest \`version\` does not match the SemVer pattern: ${JSON.stringify(version)}`)
  const kind = readString(record.kind, "kind")
  if (!(PLUGIN_KINDS as readonly string[]).includes(kind)) throw new Error(`plugin manifest \`kind\` is not in the closed union: ${JSON.stringify(kind)}`)
  const mode = typeof record.mode === "string" ? record.mode : "prototype"
  const capabilities = readStringArray(record.capabilities ?? [], "capabilities", CAPABILITY_REGEX)
  const inputs = readInputArray(record.inputs ?? [])
  return {
    specVersion: PLUGIN_SPEC_VERSION,
    name,
    version,
    kind: kind as PluginKind,
    mode: mode as SkillMode,
    capabilities,
    inputs,
  }
}

/**
 * Returns the capabilities the plugin is allowed to use, given the
 * workspace's grant list. The intersection of the plugin's declared
 * capabilities and the grant is the authoritative answer; a plugin
 * cannot ask for more than the workspace allows.
 */
export function grantCapabilities(manifest: PluginManifest, grant: readonly string[]): readonly string[] {
  const grantSet = new Set(grant)
  return manifest.capabilities.filter((capability) => grantSet.has(capability))
}

/** The default capability an installation grants to a plugin. */
export const DEFAULT_PLUGIN_CAPABILITY = "prompt:inject" as const
