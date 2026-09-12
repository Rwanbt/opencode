/* SPDX-License-Identifier: MIT */
/**
 * The agent's access to the Sovereign Knowledge Core.
 *
 * Three tools rather than one with an action flag: recalling, reading and
 * recording are three responsibilities, and an enum parameter that switches
 * between them is the mixed-abstraction smell the method warns about. It
 * also lets a permission ruleset allow recall while denying writes, which a
 * single tool could not express.
 *
 * The egress guard is not optional here. Every snippet these tools return
 * has been cleared for the *actual* model of the current turn, which is read
 * from the user message rather than assumed: a note that denies remote
 * models must not reach a cloud provider because a tool forgot which one it
 * was talking to.
 */

import z from "zod"
import { Tool } from "./tool"
import { Instance } from "../project/instance"
import { Config } from "../config/config"
import { destinationKindOf } from "../provider/locality"
import type { MessageV2 } from "../session/message-v2"
import { openMemory, resolveMemoryRoot, type MemorySettings } from "../knowledge/app/memory"
import type { Composed } from "../knowledge/facade/compose"
import type { MutationIntent, PortableRestrictions } from "@unifia/contracts/knowledge"
import SEARCH_DESCRIPTION from "./memory-search.txt"
import READ_DESCRIPTION from "./memory-read.txt"
import WRITE_DESCRIPTION from "./memory-write.txt"

/** Bounds for an explicit search, which the model asked for and will wait on. */
const SEARCH_MAX_CANDIDATES = 10
const SEARCH_DEADLINE_MS = 5_000
const SEARCH_SNIPPET_BYTES = 2_000
const SEARCH_PAYLOAD_BYTES = 64 * 1024

/**
 * Tool metadata shapes, declared rather than inferred.
 *
 * `Tool.define` infers the metadata type from the first `return` it sees, so
 * a second branch carrying one more field is a type error rather than a
 * wider type. Declaring them keeps every branch of a tool reporting the same
 * fields, which is what a consumer of `metadata` has to be able to assume.
 */
interface SearchMetadata {
  vault: string
  results: number
  withheld?: number
}

interface ReadMetadata {
  vault: string
  found: boolean
  versionHash?: string | null
}

interface WriteMetadata {
  vault: string
  applied: boolean
  auditId?: string
  locator?: string
}

interface ToolResult<M> {
  title: string
  output: string
  metadata: M
}

const MEMORY_TYPES = [
  "decision",
  "constraint",
  "preference",
  "failure",
  "learning",
  "procedure",
  "reference",
  "semantic",
  "episodic",
] as const

/**
 * What the current turn's model is, for the egress decision.
 *
 * Taken from the user message of this turn, which records the resolved
 * provider and model. Falling back to a guess would mean guessing the
 * destination a sovereignty decision is made against, so the absence of a
 * user message is an error rather than a default.
 */
function destinationOfTurn(messages: MessageV2.WithParts[]): {
  providerId: string
  destinationKind: "local" | "remote"
} {
  const user = messages.findLast((m) => m.info.role === "user")
  const providerID = user?.info.role === "user" ? user.info.model.providerID : undefined
  if (providerID === undefined) {
    throw new Error(
      "memory: cannot determine which model this turn is bound for, so no note can be cleared for it",
    )
  }
  return { providerId: providerID, destinationKind: destinationKindOf(providerID) }
}

async function settings(): Promise<MemorySettings | undefined> {
  return (await Config.get()).memory
}

/** Open the vault for this turn, or explain why there is nothing to open. */
async function open(
  messages: MessageV2.WithParts[],
  options: { writable?: boolean; create?: boolean } = {},
): Promise<{ composed: Composed; root: string } | { composed: undefined; root: string }> {
  const cfg = await settings()
  const dest = destinationOfTurn(messages)
  const root = resolveMemoryRoot(Instance.worktree, cfg)
  const composed = openMemory({
    worktree: Instance.worktree,
    settings: cfg,
    providerId: dest.providerId,
    destinationKind: dest.destinationKind,
    ...options,
  })
  return composed === undefined ? { composed: undefined, root } : { composed, root }
}

/**
 * Say why a recall came back empty.
 *
 * An empty answer has three very different causes — no vault, no match, and
 * *the policy withheld everything* — and collapsing them into "no results"
 * is how a sovereignty decision becomes invisible. The third one names the
 * setting that changes it.
 */
function explainEmpty(input: {
  root: string
  droppedByRestriction: number
  remoteRecall: boolean
  destinationKind: "local" | "remote"
}): string {
  if (input.droppedByRestriction === 0) {
    return `No memory note matches. Vault: ${input.root}`
  }
  const withheld = `${input.droppedByRestriction} note(s) matched but were withheld by the egress policy`
  if (input.destinationKind === "local") {
    return `${withheld}: they carry \`local_model: deny\`. Vault: ${input.root}`
  }
  return input.remoteRecall
    ? `${withheld}: they carry \`remote_model: deny\`, and this turn runs on a remote model. Vault: ${input.root}`
    : `${withheld}: this turn runs on a remote model and \`memory.remote_recall\` is false. Set it to true, or run a local model, to recall them. Vault: ${input.root}`
}

export const MemorySearchTool = Tool.define("memory_search", async () => ({
  description: SEARCH_DESCRIPTION,
  parameters: z.object({
    query: z.string().min(1).describe("What to recall, in the user's own words or yours"),
    types: z
      .array(z.enum(MEMORY_TYPES))
      .optional()
      .describe("Restrict to these memory types. Omit to search all types."),
    tags: z.array(z.string()).optional().describe("Restrict to notes carrying all of these tags"),
  }),
  async execute(params, ctx): Promise<ToolResult<SearchMetadata>> {
    const { composed, root } = await open(ctx.messages)
    if (composed === undefined) {
      return {
        title: params.query,
        output: `No memory vault yet at ${root}. Use memory_write to record the first note.`,
        metadata: { vault: root, results: 0 },
      }
    }

    const cfg = await settings()
    const result = await composed.service.search({
      query: params.query,
      spaces: [],
      types: params.types ?? [],
      tags: params.tags ?? [],
      maxCandidates: SEARCH_MAX_CANDIDATES,
      maxPayloadBytes: SEARCH_PAYLOAD_BYTES,
      maxSnippetBytes: SEARCH_SNIPPET_BYTES,
      deadlineMs: SEARCH_DEADLINE_MS,
    })
    // The trail is the artefact that outlives the process; flushing before
    // returning means a decision is on disk before its content is in a
    // prompt, never after.
    composed.controlLog?.flush()

    const items = result.pack.items
    if (items.length === 0) {
      return {
        title: params.query,
        output: explainEmpty({
          root,
          droppedByRestriction: result.pack.diagnostics.candidatesDroppedByRestriction,
          remoteRecall: cfg?.remote_recall === true,
          destinationKind: composed.plan.destinationKind === "local" ? "local" : "remote",
        }),
        metadata: { vault: root, results: 0 },
      }
    }

    const lines = items.map(
      (item) =>
        `## ${item.ref.locator}\n` +
        `type: ${item.type} | lifecycle: ${item.temporalState ?? "unknown"} | relevance: ${item.relevance.toFixed(2)} | id: ${item.ref.id}\n\n` +
        item.snippet.trim(),
    )
    const withheld = result.pack.diagnostics.candidatesDroppedByRestriction
    const footer = [
      result.truncated ? "Truncated by a retrieval bound; narrow the query for more." : "",
      withheld > 0 ? `${withheld} further note(s) withheld by the egress policy.` : "",
    ].filter((s) => s !== "")

    return {
      title: params.query,
      output: [`${items.length} note(s) from ${root}`, "", ...lines, ...footer].join("\n\n"),
      metadata: { vault: root, results: items.length, withheld },
    }
  },
}))

export const MemoryReadTool = Tool.define("memory_read", async () => ({
  description: READ_DESCRIPTION,
  parameters: z.object({
    locator: z.string().optional().describe("Vault-relative path, e.g. `decisions/why-sqlite.md`"),
    id: z.string().optional().describe("The note's `unifia_id`, as reported by memory_search"),
  }),
  async execute(params, ctx): Promise<ToolResult<ReadMetadata>> {
    if (params.locator === undefined && params.id === undefined) {
      throw new Error("memory_read requires a locator or an id")
    }
    const { composed, root } = await open(ctx.messages)
    if (composed === undefined) {
      return {
        title: params.locator ?? params.id ?? "",
        output: `No memory vault yet at ${root}.`,
        metadata: { vault: root, found: false },
      }
    }

    const found = await composed.service.get(params.id as never, params.locator as never)
    composed.controlLog?.flush()
    const candidate = found?.candidates[0]
    if (candidate === undefined) {
      // `get` answers null for a note the policy withholds exactly as for one
      // that does not exist: confirming a denied note exists is a disclosure.
      return {
        title: params.locator ?? params.id ?? "",
        output: `No readable note at ${params.locator ?? params.id} in ${root}. It does not exist, or the egress policy withholds it from this model.`,
        metadata: { vault: root, found: false },
      }
    }

    // The handle an update must present. Asked for here rather than left to
    // the caller: an update without it is refused, and a model that has to
    // remember a second call to obtain it will not make it.
    const versionHash = await composed.service.versionHash(params.id as never, params.locator as never)

    return {
      title: candidate.locator,
      output: [
        `# ${candidate.locator}`,
        `id: ${candidate.id} | type: ${candidate.type} | versionHash: ${versionHash ?? "unavailable"}`,
        "",
        candidate.snippet,
      ].join("\n"),
      metadata: { vault: root, found: true, versionHash },
    }
  },
}))

/**
 * The restrictions a newly recorded note carries.
 *
 * `remote_model` follows the user's configured intent and nothing else. The
 * agent cannot widen it per note: a model deciding what may leave the
 * machine is the one decision the sovereign core exists to keep away from
 * the model. It can always restrict further by asking for `private`.
 */
function restrictionsFor(input: { remoteRecall: boolean; private: boolean }): PortableRestrictions {
  const allowRemote = input.remoteRecall && !input.private
  return {
    remoteModel: allowRemote ? "allow" : "deny",
    localModel: input.private ? "deny" : "allow",
    embeddable: input.private ? "deny" : "allow",
    exportable: "deny",
  }
}

export const MemoryWriteTool = Tool.define("memory_write", async () => ({
  description: WRITE_DESCRIPTION,
  parameters: z.object({
    locator: z
      .string()
      .min(1)
      .describe("Vault-relative path ending in `.md`, e.g. `decisions/why-sqlite.md`"),
    type: z.enum(MEMORY_TYPES).describe("What kind of memory this is"),
    body: z.string().min(1).describe("The note itself, in Markdown. State the why, not the what."),
    reason: z.string().min(1).describe("Why this is worth remembering. Recorded in the audit log."),
    tags: z.array(z.string()).optional().describe("Tags for later retrieval"),
    id: z
      .string()
      .optional()
      .describe("Update this existing note instead of creating one. Requires expectedVersionHash."),
    expectedVersionHash: z
      .string()
      .optional()
      .describe("The versionHash memory_read reported. The write is refused if the note changed."),
    private: z
      .boolean()
      .optional()
      .describe("Mark the note as never leaving this machine, whatever the configuration says."),
  }),
  async execute(params, ctx): Promise<ToolResult<WriteMetadata>> {
    if (!params.locator.endsWith(".md")) {
      throw new Error(`memory_write: locator must end in .md, got ${params.locator}`)
    }
    if (params.id !== undefined && params.expectedVersionHash === undefined) {
      throw new Error(
        "memory_write: updating a note requires its expectedVersionHash. Call memory_read first.",
      )
    }

    const { composed, root } = await open(ctx.messages, { writable: true, create: true })
    if (composed === undefined) {
      // `create: true` means the only way here is memory being disabled.
      return {
        title: params.locator,
        output: "Memory is disabled (`memory.enabled: false`); nothing was recorded.",
        metadata: { vault: root, applied: false },
      }
    }

    const cfg = await settings()
    const restrictions = restrictionsFor({
      remoteRecall: cfg?.remote_recall === true,
      private: params.private === true,
    })

    const intent: MutationIntent = {
      kind: params.id === undefined ? "create" : "update",
      reason: params.reason,
      source: ctx.agent,
      newContent: { type: params.type, restrictions, body: params.body },
      ...(params.tags !== undefined ? { tags: params.tags } : {}),
      ...(params.id === undefined
        ? { targetLocator: params.locator as never }
        : {
            targetId: params.id as never,
            expectedVersionHash: params.expectedVersionHash as never,
          }),
    }

    const result = await composed.service.propose({
      intent,
      reason: params.reason,
      source: ctx.agent,
    })

    const recall =
      restrictions.remoteModel === "deny"
        ? " It is marked `remote_model: deny`, so a remote model will not recall it."
        : ""
    return {
      title: result.ref?.locator ?? params.locator,
      output: [
        `${params.id === undefined ? "Recorded" : "Updated"} ${result.ref?.locator ?? params.locator} in ${root}.`,
        `id: ${result.ref?.id ?? "unknown"} | versionHash: ${result.ref?.versionHash ?? "unknown"} | audit: ${result.auditId}`,
        recall,
      ]
        .filter((s) => s !== "")
        .join("\n"),
      metadata: {
        vault: root,
        applied: result.applied,
        auditId: result.auditId,
        locator: result.ref?.locator,
      },
    }
  },
}))
