/* SPDX-License-Identifier: MIT */
/**
 * TS adapter for Class B (P2.4). Mirrors the Rust `ClassB` and
 * `reachability_report` so the JS side can compute GC plans
 * before calling the Rust GC.
 */

export interface ClassBEntry {
  alias: string
  locator: string
  externalSource?: string
  revision: number
}

export class ClassBValidationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "ClassBValidationError"
  }
}

export function upsertEntry(
  b: ReadonlyMap<string, ClassBEntry>,
  alias: string,
  locator: string,
  externalSource: string | undefined,
  nextRevision: number,
): { next: Map<string, ClassBEntry>; revision: number; entry: ClassBEntry } {
  if (alias.length === 0) throw new ClassBValidationError("alias must be non-empty")
  if (locator.length === 0) throw new ClassBValidationError("locator must be non-empty")
  if (nextRevision + 1 < 0) throw new ClassBValidationError("revision overflow")
  const next = new Map(b)
  const entry: ClassBEntry = { alias, locator, revision: nextRevision + 1 }
  if (externalSource !== undefined) entry.externalSource = externalSource
  next.set(alias, entry)
  return { next, revision: nextRevision + 1, entry }
}

export interface ReachabilityReport {
  reachable: Set<string>
  orphans: string[]
  missingFromB: string[]
}

export function reachabilityReport(
  classA: ReadonlySet<string>,
  b: ReadonlyMap<string, ClassBEntry>,
): ReachabilityReport {
  const bLocators = new Set<string>()
  for (const e of b.values()) bLocators.add(e.locator)
  const reachable = new Set<string>()
  for (const l of classA) if (bLocators.has(l)) reachable.add(l)
  const orphans: string[] = []
  for (const l of bLocators) if (!classA.has(l)) orphans.push(l)
  const missingFromB: string[] = []
  for (const l of classA) if (!bLocators.has(l)) missingFromB.push(l)
  return { reachable, orphans, missingFromB }
}
