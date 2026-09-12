/* SPDX-License-Identifier: MIT */

export const WORKSPACE_MANIFEST_VERSION = 1 as const
export const WORKSPACE_MANIFEST_PATH = ".unifia/workspace.json" as const

export type DesignSystemTokens = {
  colors: Readonly<Record<string, string>>
  spacing: Readonly<Record<string, number>>
  typography: Readonly<Record<string, string>>
}

export type DesignSystemCatalog = {
  id: string
  name: string
  version: string
  source: string
  tokens: DesignSystemTokens
}

export type WorkspaceManifest = {
  version: typeof WORKSPACE_MANIFEST_VERSION
  designSystems: readonly DesignSystemCatalog[]
}

function record(value: unknown, field: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${field} must be an object`)
  return value as Record<string, unknown>
}

function stringMap(value: unknown, field: string): Record<string, string> {
  return Object.fromEntries(Object.entries(record(value, field)).map(([key, item]) => {
    if (typeof item !== "string" || !item) throw new Error(`${field}.${key} must be a non-empty string`)
    return [key, item]
  }))
}

function numberMap(value: unknown, field: string): Record<string, number> {
  return Object.fromEntries(Object.entries(record(value, field)).map(([key, item]) => {
    if (typeof item !== "number" || !Number.isFinite(item) || item < 0) throw new Error(`${field}.${key} must be a non-negative number`)
    return [key, item]
  }))
}

export function parseDesignSystemCatalog(value: unknown): DesignSystemCatalog {
  const input = record(value, "design system catalog")
  if (typeof input.id !== "string" || !/^[a-z][a-z0-9-]{2,63}$/.test(input.id)) throw new Error("design system id is invalid")
  if (typeof input.name !== "string" || !input.name.trim()) throw new Error("design system name is required")
  if (typeof input.version !== "string" || !/^\d+\.\d+\.\d+$/.test(input.version)) throw new Error("design system version is invalid")
  if (typeof input.source !== "string" || !input.source.trim()) throw new Error("design system source is required")
  const tokens = record(input.tokens, "design system tokens")
  return {
    id: input.id,
    name: input.name,
    version: input.version,
    source: input.source,
    tokens: {
      colors: stringMap(tokens.colors ?? {}, "colors"),
      spacing: numberMap(tokens.spacing ?? {}, "spacing"),
      typography: stringMap(tokens.typography ?? {}, "typography"),
    },
  }
}

/**
 * Version gate for the persisted workspace manifest.
 * WHY this rejects unknown versions: silently treating a future schema as v1
 * could make a workspace appear valid while dropping design-system data.
 */
export function migrateWorkspaceManifest(value: unknown): WorkspaceManifest {
  const input = record(value, "workspace manifest")
  if (input.version !== WORKSPACE_MANIFEST_VERSION) throw new Error(`unsupported workspace manifest version: ${String(input.version)}`)
  if (!Array.isArray(input.designSystems) || input.designSystems.length === 0) throw new Error("workspace manifest must declare at least one design system")
  const designSystems = input.designSystems.map(parseDesignSystemCatalog)
  const ids = new Set<string>()
  for (const catalog of designSystems) {
    if (ids.has(catalog.id)) throw new Error(`workspace manifest contains duplicate design system id: ${catalog.id}`)
    ids.add(catalog.id)
  }
  return { version: WORKSPACE_MANIFEST_VERSION, designSystems }
}
