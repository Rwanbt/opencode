import z from "zod"
import { Tool } from "./tool"
import DESCRIPTION from "./debate.txt"
import { DebateSelection, Orchestrator } from "../collective"
import type { Collective } from "../collective/types"
import { Bus } from "../bus"
import * as Events from "../collective/events"

// ── Live participant tracking ───────────────────────────────────────────────
//
// Bus.subscribe delivers ProviderStarted/Completed/Failed/DebatePhaseChanged
// on independent async streams (see bus/index.ts: each event type gets its
// own PubSub + Stream.runForEach loop). Events for different participants —
// or even the same participant across phases — can therefore arrive as
// separate, independently-scheduled callback invocations. DebateLive.Tracker
// gives every inbound event a single FIFO queue and drains it (in order)
// before each flush, so ctx.metadata() always observes a fully-applied,
// consistent snapshot rather than a partial interleave between two
// concurrently-scheduled callbacks.
export namespace DebateLive {
  export type ParticipantStatus = "pending" | "running" | "done" | "failed"

  export interface ParticipantState {
    role?: string
    currentPhase: Collective.DebateStatus
    status: ParticipantStatus
    tokens?: number
    durationMs?: number
    error?: string
  }

  export type ParticipantMap = Record<string, ParticipantState>

  export type Event =
    | { kind: "started"; provider: string; role?: string; phase: Collective.DebateStatus }
    | { kind: "completed"; provider: string; tokens: number; durationMs: number; phase: Collective.DebateStatus }
    | { kind: "failed"; provider: string; error: string; phase: Collective.DebateStatus }
    | { kind: "phase"; phase: Collective.DebateStatus }

  export interface Snapshot {
    phase: Collective.DebateStatus
    participants: ParticipantMap
  }

  export interface Tracker {
    enqueue(event: Event): void
    snapshot(): Snapshot
  }

  export function createTracker(onFlush: (snapshot: Snapshot) => void): Tracker {
    const participants: ParticipantMap = {}
    let phase: Collective.DebateStatus = "pending"
    const queue: Event[] = []
    let draining = false

    function apply(event: Event) {
      if (event.kind === "phase") {
        phase = event.phase
        return
      }
      const existing = participants[event.provider]
      if (event.kind === "started") {
        participants[event.provider] = {
          role: event.role ?? existing?.role,
          currentPhase: event.phase,
          status: "running",
        }
        return
      }
      if (event.kind === "completed") {
        participants[event.provider] = {
          role: existing?.role,
          currentPhase: event.phase,
          status: "done",
          tokens: event.tokens,
          durationMs: event.durationMs,
        }
        return
      }
      participants[event.provider] = {
        role: existing?.role,
        currentPhase: event.phase,
        status: "failed",
        error: event.error,
      }
    }

    function snapshot(): Snapshot {
      return { phase, participants: { ...participants } }
    }

    function drain() {
      // Reentrancy guard: applyEvent/onFlush never enqueue synchronously today,
      // but this keeps the "process in order before each flush" contract true
      // even if a future event handler enqueues from within onFlush.
      if (draining) return
      draining = true
      try {
        while (queue.length > 0) apply(queue.shift()!)
      } finally {
        draining = false
      }
      onFlush(snapshot())
    }

    return {
      enqueue(event) {
        queue.push(event)
        drain()
      },
      snapshot,
    }
  }

  /** Wires the 4 debate Bus events into `tracker`, filtered to `debateID()`. Returns an unsubscribe-all function. */
  export function subscribe(debateID: () => Collective.DebateID | undefined, tracker: Tracker): () => void {
    function matches(id: Collective.DebateID) {
      const current = debateID()
      return current !== undefined && id === current
    }

    const unsubscribers = [
      Bus.subscribe(Events.ProviderStarted, (event) => {
        if (!matches(event.properties.debateID)) return
        tracker.enqueue({
          kind: "started",
          provider: event.properties.provider,
          role: event.properties.role,
          phase: event.properties.phase,
        })
      }),
      Bus.subscribe(Events.ProviderCompleted, (event) => {
        if (!matches(event.properties.debateID)) return
        tracker.enqueue({
          kind: "completed",
          provider: event.properties.provider,
          tokens: event.properties.tokens,
          durationMs: event.properties.durationMs,
          phase: event.properties.phase,
        })
      }),
      Bus.subscribe(Events.ProviderFailed, (event) => {
        if (!matches(event.properties.debateID)) return
        tracker.enqueue({
          kind: "failed",
          provider: event.properties.provider,
          error: event.properties.error,
          phase: event.properties.phase,
        })
      }),
      Bus.subscribe(Events.DebatePhaseChanged, (event) => {
        if (!matches(event.properties.debateID)) return
        tracker.enqueue({ kind: "phase", phase: event.properties.phase })
      }),
    ]

    return () => {
      for (const unsubscribe of unsubscribers) unsubscribe()
    }
  }

  function formatParticipantSummary(participants: ParticipantMap): string {
    return Object.entries(participants)
      .map(([provider, state]) => `${provider}: ${state.status}${state.error ? ` (${state.error})` : ""}`)
      .join(", ")
  }

  /** Builds the failure message for the catch path: preserves the last live snapshot instead of a bare `{failed:true}`. */
  export function describeFailure(snapshot: Snapshot, cause: unknown): string {
    const message = cause instanceof Error ? cause.message : String(cause)
    const participantSummary = formatParticipantSummary(snapshot.participants)
    const context = participantSummary
      ? `phase "${snapshot.phase}", participants: ${participantSummary}`
      : `phase "${snapshot.phase}", no participant activity recorded`
    return `Debate failed (${context}): ${message}`
  }
}

const parameters = z.object({
  question: z.string().describe("The question or topic for the multi-model debate"),
  context: z
    .string()
    .optional()
    .describe("Additional context (code snippets, requirements, constraints) to include in the debate"),
  tier: z
    .enum(["free", "quick", "standard", "deep"])
    .optional()
    .describe(
      "Debate depth tier. 'free'=free models only, 'quick'=2-3 models no convergence, 'standard'=full pipeline with convergence, 'deep'=all features including red team and canary. Default: auto-classified based on question complexity.",
    ),
})

/**
 * Runs a debate with live per-participant status tracking. Factored out of
 * `execute()` so the Bus-subscribe / serialize / try-finally-unsubscribe
 * wiring is testable without depending on the real Orchestrator pipeline
 * (which requires live model providers) — tests inject a fake `run`.
 */
export async function executeWithLiveTracking(
  config: Collective.DebateConfig,
  ctx: { metadata(input: { title?: string; metadata?: Record<string, unknown> }): void },
  run: (
    config: Collective.DebateConfig,
    onDebateID: (id: Collective.DebateID) => void,
  ) => Promise<Collective.DebateReport>,
) {
  let currentDebateID: Collective.DebateID | undefined
  const tracker = DebateLive.createTracker((snapshot) => {
    ctx.metadata({
      metadata: {
        phase: snapshot.phase,
        participants: snapshot.participants,
      },
    })
  })

  const unsubscribeAll = DebateLive.subscribe(() => currentDebateID, tracker)

  try {
    const report = await run(config, (id) => {
      currentDebateID = id
    })

    const summary = [
      `## Debate Complete`,
      ``,
      `**${report.providers.length} models** participated | **${report.blindSpots.length} blind spots** found | **${report.consensus.length} consensus** claims`,
      `**Cost**: $${report.cost.toFixed(4)} | **Duration**: ${(report.durationMs / 1000).toFixed(1)}s`,
      report.meta?.fragility !== undefined && report.meta.fragility > 0.6
        ? `\n> ⚠️ **CONSENSUS FRAGILE** (fragility: ${(report.meta.fragility * 100).toFixed(0)}%)`
        : "",
      report.failedProviders.length > 0
        ? `\n> ⚠️ **Providers indisponibles**\n${report.failedProviders.map((p) => `> - **${p.provider}** — ${p.error}`).join("\n")}`
        : "",
      report.shadowBaselineDelta
        ? `\n> ${report.shadowBaselineDelta.blindSpotDelta > 0 ? `+${report.shadowBaselineDelta.blindSpotDelta} blind spots vs single-model` : "No additional blind spots vs single-model"}`
        : "",
      ``,
      report.markdown,
    ]
      .filter(Boolean)
      .join("\n")

    return {
      title: `Debate: ${report.blindSpots.length} blind spots, ${report.consensus.length} consensus (${report.providers.length} models)`,
      metadata: {
        failed: false,
        debateID: report.id,
        tier: report.tier,
        providerCount: report.providers.length,
        blindSpotCount: report.blindSpots.length,
        consensusCount: report.consensus.length,
        cost: report.cost,
        durationMs: report.durationMs,
        participants: tracker.snapshot().participants,
      },
      output: summary,
    }
  } catch (error) {
    throw new Error(DebateLive.describeFailure(tracker.snapshot(), error), { cause: error })
  } finally {
    unsubscribeAll()
  }
}

type DebateMetadata = {
  failed?: boolean
  participants?: DebateLive.ParticipantMap
  debateID?: Collective.DebateID
  tier?: Collective.DebateTier
  providerCount?: number
  blindSpotCount?: number
  consensusCount?: number
  cost?: number
  durationMs?: number
}

export const DebateTool = Tool.define("debate", async () => {
  return {
    description: DESCRIPTION,
    parameters,
    async execute(args, ctx): Promise<{ title: string; metadata: DebateMetadata; output: string }> {
      const selection = await DebateSelection.get(ctx.sessionID)
      const config: Collective.DebateConfig = {
        question: args.question,
        context: args.context,
        tier: args.tier ?? "quick",
        participants: selection?.participants,
        judgeProviderID: selection?.primary.providerID,
        judgeModelID: selection?.primary.modelID,
        redTeam: "auto",
        enableMeta: true,
        enableCanary: args.tier === "deep",
        enableShadowBaseline: true,
        noMemory: false,
        maxRounds: 2,
      }

      try {
        return await executeWithLiveTracking(config, ctx, Orchestrator.runPromiseExport)
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        return {
          title: "Debate: failed to get a quorum of models",
          metadata: { failed: true },
          output: [
            `## Debate Failed`,
            ``,
            message,
            ``,
            `Tell the user the debate could not run and why. Do not answer the question yourself as a substitute — ask them to pick different annex models or retry.`,
          ].join("\n"),
        }
      }
    },
  }
})
