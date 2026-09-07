/* SPDX-License-Identifier: MIT */
/**
 * Automatic recall: the memory vault, consulted at the start of a turn.
 *
 * `ContextRouter` was built to produce exactly this — a bounded, ranked,
 * policy-cleared pack of notes for one query — and until now nothing outside
 * the knowledge subsystem ever asked it for one. A retrieval engine with no
 * caller is not a memory.
 *
 * The tools let the agent recall deliberately. This makes it recall without
 * being asked, which is the difference between a lookup facility and a
 * memory: the user should not have to know the feature exists for a decision
 * they made last week to be respected today.
 *
 * Everything here is bounded and best-effort. Recall runs on the turn's
 * critical path, so it holds a small token budget and a short deadline, and
 * a vault that cannot be read degrades the turn rather than failing it.
 */

import {
  DEFAULT_RECALL_DEADLINE_MS,
  DEFAULT_RECALL_MAX_NOTES,
  openMemory,
  type MemorySettings,
} from "../knowledge/app/memory"
import { destinationKindOf } from "../provider/locality"
import { Log } from "../util/log"

const log = Log.create({ service: "session.memory" })

/** Snippet bound per note. Enough for a decision and its rationale. */
const RECALL_SNIPPET_BYTES = 1_200

/** Payload ceiling, independent of the token budget, as a second guard. */
const RECALL_PAYLOAD_BYTES = 32 * 1024

/**
 * Below this, a cut note is a fragment rather than a memory, and injecting
 * it would cost budget to say almost nothing.
 */
const MIN_TRUNCATED_SNIPPET_CHARS = 120

/** One recalled note, framed so the model can address it by locator. */
function note(item: { ref: { locator: string; id: string }; type: string }, body: string): string {
  return `<note locator="${item.ref.locator}" type="${item.type}" id="${item.ref.id}">\n${body}\n</note>`
}

export interface RecallInput {
  worktree: string
  settings?: MemorySettings | undefined
  /** Provider of the model this turn runs on; decides the egress destination. */
  providerId: string
  /** What the user just asked. Recall is scoped to it, not to the whole session. */
  query: string
  /** Tokens this block may occupy. Zero or less disables recall. */
  budgetTokens: number
  /**
   * The user message this turn answers.
   *
   * The recall block is built once per turn and reused across the agent's
   * steps. Without this the search ran again on every step of the tool loop
   * — twenty vault scans for one question — and the block could change
   * mid-turn if the agent wrote a note, which moves the system prompt under
   * a conversation already in flight.
   */
  turnId: string
}

/**
 * The block built for the current turn.
 *
 * A single entry, so it cannot grow: a new turn replaces the old one. Not a
 * conversation-level cache — recall must answer *this* question, and a block
 * loaded once at the start of the discussion goes stale the moment the
 * subject changes.
 */
let turnCache: { turnId: string; block: string | undefined } | null = null

/** Forget the current turn's block. For tests, and for a workspace switch. */
export function resetRecallCache(): void {
  turnCache = null
}

/**
 * Build the memory block for the system prompt, or undefined.
 *
 * Undefined means there is nothing to inject — no vault, no match, or every
 * match withheld by the policy. Unlike the tools, this stays silent in that
 * case: a system-prompt block explaining why the memory is empty would spend
 * the turn's budget saying nothing, every turn.
 */
export async function recallMemoryContext(input: RecallInput): Promise<string | undefined> {
  if (input.budgetTokens <= 0) return undefined
  if (input.query.trim() === "") return undefined

  // Answered once per turn, including when the answer was "nothing": a miss
  // costs the same vault scan as a hit, and re-running it on every step of
  // the tool loop was the whole waste.
  if (turnCache !== null && turnCache.turnId === input.turnId) return turnCache.block
  const block = await buildRecallBlock(input)
  turnCache = { turnId: input.turnId, block }
  return block
}

async function buildRecallBlock(input: RecallInput): Promise<string | undefined> {
  let composed: ReturnType<typeof openMemory>
  try {
    composed = openMemory({
      worktree: input.worktree,
      settings: input.settings,
      providerId: input.providerId,
      destinationKind: destinationKindOf(input.providerId),
    })
  } catch (error) {
    // Not swallowed: a malformed policy or an unreadable vault is a real
    // fault and is reported. It is not allowed to fail the turn, because a
    // broken memory should degrade the assistant, not stop it.
    log.error("memory vault could not be opened", { error })
    return undefined
  }
  if (composed === undefined) return undefined

  const maxNotes = input.settings?.max_notes ?? DEFAULT_RECALL_MAX_NOTES
  const deadlineMs = input.settings?.deadline_ms ?? DEFAULT_RECALL_DEADLINE_MS

  try {
    const result = await composed.service.search({
      query: input.query,
      spaces: [],
      types: [],
      tags: [],
      maxCandidates: maxNotes,
      maxPayloadBytes: RECALL_PAYLOAD_BYTES,
      maxSnippetBytes: RECALL_SNIPPET_BYTES,
      deadlineMs,
    })
    // On disk before it reaches a prompt, never after.
    composed.controlLog?.flush()

    const items = result.pack.items
    if (items.length === 0) return undefined

    // The router already enforced the byte bounds; this is the token budget
    // the caller allotted, which the router does not know about.
    const budgetChars = input.budgetTokens * 4
    const blocks: string[] = []
    let used = 0
    for (const item of items) {
      const block = note(item, item.snippet.trim())
      if (used + block.length > budgetChars) break
      blocks.push(block)
      used += block.length
    }

    // A budget too small for a whole note is a small local model, which is
    // exactly the case this vault serves best. Returning nothing there would
    // withhold the most relevant memory over a formatting technicality, so
    // the top note goes in cut, and says that it is cut.
    if (blocks.length === 0) {
      const top = items[0]
      if (top === undefined) return undefined
      const room = budgetChars - note(top, "").length
      if (room <= MIN_TRUNCATED_SNIPPET_CHARS) return undefined
      blocks.push(note(top, `${top.snippet.trim().slice(0, room)}\n[cut to fit the context budget]`))
    }

    return [
      "<memory>",
      "Notes recalled from this project's memory vault, relevant to what the user just asked.",
      "They record decisions, constraints and failures from earlier sessions. Respect them, or",
      "say explicitly why you are departing from one. Use memory_search to recall more, and",
      "memory_write to record something new.",
      "",
      ...blocks,
      "</memory>",
    ].join("\n")
  } catch (error) {
    log.error("memory recall failed", { error })
    return undefined
  }
}
