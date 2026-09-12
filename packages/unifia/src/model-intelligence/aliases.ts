/**
 * Alias resolution : lookup, replacedBy chain (depth ≤ 1), cycle detection.
 *
 * Règles :
 *   - alias unique globalement (déjà vérifié par le schéma Zod + ingestion)
 *   - replacedBy résolu récursivement avec profondeur ≤ 1 (anti-cycle)
 *   - alias deprecated résolu via replacedBy ; si replacedBy=null → null
 */

import type { Alias } from "./schema"
import { CyclicAliasError, DuplicateAliasError } from "./errors"

export interface ResolvedAlias {
  alias: string
  canonicalRef: { providerID: string; modelID: string }
  deprecated: boolean
  chainDepth: number
}

export function buildAliasIndex(aliases: Alias[]): Map<string, Alias> {
  const index = new Map<string, Alias>()
  for (const a of aliases) {
    if (index.has(a.alias)) {
      throw new DuplicateAliasError({ alias: a.alias, occurrences: 2 })
    }
    index.set(a.alias, a)
  }
  return index
}

export function resolveAlias(
  aliasInput: string,
  index: Map<string, Alias>,
): ResolvedAlias | null {
  const visited = new Set<string>()
  let current: string = aliasInput
  const originalDeprecated = index.get(aliasInput)?.deprecated ?? false

  while (true) {
    if (visited.has(current)) {
      throw new CyclicAliasError({ cycle: [...visited, current] })
    }
    visited.add(current)

    const entry = index.get(current)
    if (!entry) return null

    if (!entry.deprecated || !entry.replacedBy) {
      return {
        alias: aliasInput,
        canonicalRef: entry.canonicalRef,
        deprecated: originalDeprecated,
        chainDepth: visited.size,
      }
    }

    const nextAliasKey = entry.replacedBy.modelID
    if (visited.has(nextAliasKey)) {
      throw new CyclicAliasError({ cycle: [...visited, nextAliasKey] })
    }
    current = nextAliasKey
  }
}

export function resolveAllAliases(
  aliases: Alias[],
): Map<string, ResolvedAlias | null> {
  const index = buildAliasIndex(aliases)
  const resolved = new Map<string, ResolvedAlias | null>()
  for (const a of aliases) {
    resolved.set(a.alias, resolveAlias(a.alias, index))
  }
  return resolved
}