/* SPDX-License-Identifier: MIT */
/**
 * Supersede-plan (P11.34).
 *
 * Given a target note (by id or locator) and an optional successor
 * (by locator), produces the supersede plan:
 * - validates the target exists
 * - validates the target lifecycle is `active` (only active can be
 *   superseded — see ADR-KNOW-0009)
 * - validates the successor exists and is in a state that can
 *   supersede (active or candidate)
 * - emits a `supersede` MutationIntent ready to be applied by the
 *   mutation API
 *
 * This is a DRY-RUN helper: it does not write to disk. The operator
 * must apply the intent via the mutation API. This keeps the
 * admin tool a pure function with no side effects, matching the
 * sovereignty pattern (no I/O, no remote calls, no
 * uncontrolled mutations).
 */

import { readFileSync } from "node:fs"
import { createHash } from "node:crypto"
import { join, isAbsolute } from "node:path"
import { parseDocument } from "../parser/parser.js"
import { listMarkdownLocators } from "../classb/reachability.js"
import { isTransitionAllowed } from "../memory/lifecycle.js"
import type { KnowledgeId, MutationIntent } from "@unifia/contracts/knowledge"

export interface SupersedePlanInput {
  vaultRoot: string
  /** Target note id (UUID v7). Mutually exclusive with `targetLocator`. */
  targetId?: KnowledgeId
  /** Target note locator. Mutually exclusive with `targetId`. */
  targetLocator?: string
  /** Optional successor locator that will replace the target. */
  successorLocator?: string
  /** Source agent / user for the audit. */
  source: string
  /** Reason for the supersession, for audit. */
  reason: string
}

export interface SupersedePlan {
  ok: boolean
  reason?: string
  target?: {
    id: KnowledgeId
    locator: string
    lifecycle: string
    versionHash: string
  }
  successor?: {
    id: KnowledgeId
    locator: string
    lifecycle: string
  }
  intent?: MutationIntent
  warnings?: string[]
}

interface NoteRecord {
  id: KnowledgeId
  locator: string
  lifecycle: string
  versionHash: string
}

function readNote(vaultRoot: string, locator: string): NoteRecord | null {
  const full = join(vaultRoot, locator)
  let text: string
  try {
    text = readFileSync(full, "utf8")
  } catch {
    return null
  }
  let doc: ReturnType<typeof parseDocument>
  try {
    doc = parseDocument(text)
  } catch {
    return null
  }
  // SHA-256 hex (64 chars) of the raw bytes — matches `KnowledgeVersionHash`
  // pattern in @unifia/contracts/knowledge. The mutation API compares the
  // operator's intent.expectedVersionHash against the file's current hash
  // (CAS) to refuse stale updates.
  const versionHash = createHash("sha256").update(text, "utf8").digest("hex")
  return {
    id: doc.note.frontmatter.unifia_id,
    locator,
    lifecycle: doc.note.frontmatter.unifia_lifecycle,
    versionHash,
  }
}

function findById(vaultRoot: string, id: KnowledgeId): NoteRecord | null {
  const locators = listMarkdownLocators(vaultRoot)
  for (const locator of locators) {
    const rec = readNote(vaultRoot, locator)
    if (rec && rec.id === id) return rec
  }
  return null
}

export function planSupersede(input: SupersedePlanInput): SupersedePlan {
  if (!isAbsolute(input.vaultRoot)) {
    throw new Error(`vaultRoot must be absolute, got ${input.vaultRoot}`)
  }
  if (input.targetId === undefined && input.targetLocator === undefined) {
    return { ok: false, reason: "either targetId or targetLocator is required" }
  }
  if (input.targetId !== undefined && input.targetLocator !== undefined) {
    return { ok: false, reason: "targetId and targetLocator are mutually exclusive" }
  }
  if (!input.source || input.source.length === 0) {
    return { ok: false, reason: "source is required for audit" }
  }
  if (!input.reason || input.reason.length === 0) {
    return { ok: false, reason: "reason is required for audit" }
  }

  const target = input.targetId !== undefined
    ? findById(input.vaultRoot, input.targetId)
    : readNote(input.vaultRoot, input.targetLocator as string)
  if (!target) {
    return { ok: false, reason: "target note not found" }
  }
  if (target.lifecycle !== "active") {
    return {
      ok: false,
      reason: `target lifecycle is '${target.lifecycle}', only 'active' notes can be superseded`,
    }
  }
  if (!isTransitionAllowed("active", "superseded")) {
    return { ok: false, reason: "transition active -> superseded is not allowed" }
  }

  const plan: SupersedePlan = {
    ok: true,
    target: {
      id: target.id,
      locator: target.locator,
      lifecycle: target.lifecycle,
      versionHash: target.versionHash,
    },
  }

  if (input.successorLocator !== undefined) {
    const successor = readNote(input.vaultRoot, input.successorLocator)
    if (!successor) {
      return { ok: false, reason: `successor not found at ${input.successorLocator}` }
    }
    if (successor.lifecycle !== "active" && successor.lifecycle !== "candidate") {
      return {
        ok: false,
        reason: `successor lifecycle is '${successor.lifecycle}', expected 'active' or 'candidate'`,
      }
    }
    plan.successor = {
      id: successor.id,
      locator: successor.locator,
      lifecycle: successor.lifecycle,
    }
  }

  const warnings: string[] = []
  if (!plan.successor) {
    warnings.push("no successorLocator provided — the supersede intent will be emitted without a successor link")
  }
  plan.warnings = warnings.length > 0 ? warnings : undefined

  plan.intent = {
    kind: "supersede",
    targetId: target.id,
    expectedVersionHash: target.versionHash as MutationIntent["expectedVersionHash"],
    reason: input.reason,
    source: input.source,
  }
  return plan
}
