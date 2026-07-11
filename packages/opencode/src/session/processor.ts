import { Cause, Effect, Layer, ServiceMap } from "effect"
import * as Stream from "effect/Stream"
import { Agent } from "@/agent/agent"
import { Bus } from "@/bus"
import { Config } from "@/config/config"
import { Permission } from "@/permission"
import { Plugin } from "@/plugin"
import { Snapshot } from "@/snapshot"
import { Log } from "@/util/log"
import { Session } from "."
import { LLM } from "./llm"
import { MessageV2 } from "./message-v2"
import { isOverflow } from "./overflow"
import { PartID } from "./schema"
import type { SessionID } from "./schema"
import { SessionRetry } from "./retry"
import { SessionStatus } from "./status"
import { SessionSummary } from "./summary"
import type { Provider } from "@/provider/provider"
import { Question } from "@/question"
import { ProviderTransform } from "@/provider/transform"
import { ObservabilityId } from "@/observability/id"
import { finishTool, startTool } from "@/observability/lifecycle"
import { resolveCapturePolicy } from "@/observability/capture-policy"
import { ObservabilityRuntime } from "@/observability/runtime"
import type { ObservabilityService } from "@/observability/service"
import type { TraceContext } from "@/observability/trace-context"
import { sanitizeText } from "@/observability/sanitizer"
import { hmacSha256 } from "@/observability/hmac"
import { secret as observabilitySecret } from "@/observability/hmac-secret"

// The skill tool is the only tool whose identity (name, absolute path) is
// itself sensitive — everything else is generic tool args/output already
// covered by sanitizeText(). HMAC only, regardless of capture level: the
// Phase 1 privacy matrix allows skill.name as "HMAC or absent" even at
// local_metadata, and absolute paths as "always HMAC only".
async function skillIdentityMetadata(name: unknown, dir: unknown) {
  const result: { skillHmac?: string; pathHmac?: string } = {}
  try {
    const secret = await observabilitySecret()
    if (typeof name === "string" && name.length > 0) result.skillHmac = hmacSha256(secret, name)
    if (typeof dir === "string" && dir.length > 0) result.pathHmac = hmacSha256(secret, dir)
  } catch {
    // Never let a missing/unreadable secret affect the tool-call path.
  }
  return result
}

// File path HMAC for file tools (read, write, edit, glob, grep, bash, apply_patch, ls)
async function filePathIdentityMetadata(filePath: unknown) {
  const result: { pathHmac?: string } = {}
  try {
    const secret = await observabilitySecret()
    if (typeof filePath === "string" && filePath.length > 0) result.pathHmac = hmacSha256(secret, filePath)
  } catch {
    // Never let a missing/unreadable secret affect the tool-call path.
  }
  return result
}

// MCP tool HMAC for MCP tools (prefixed with "mcp_")
async function mcpToolIdentityMetadata(toolName: string) {
  const result: { mcpHmac?: string } = {}
  try {
    const secret = await observabilitySecret()
    if (toolName.startsWith("mcp_") && toolName.length > 4) result.mcpHmac = hmacSha256(secret, toolName)
  } catch {
    // Never let a missing/unreadable secret affect the tool-call path.
  }
  return result
}

export namespace SessionProcessor {
  const DOOM_LOOP_THRESHOLD = 2
  const log = Log.create({ service: "session.processor" })

  export type Result = "compact" | "stop" | "continue"

  export type Event = LLM.Event

  export interface Handle {
    readonly message: MessageV2.Assistant
    readonly partFromToolCall: (toolCallID: string) => MessageV2.ToolPart | undefined
    readonly abort: () => Effect.Effect<void>
    readonly process: (streamInput: LLM.StreamInput) => Effect.Effect<Result>
  }

  type Input = {
    assistantMessage: MessageV2.Assistant
    sessionID: SessionID
    model: Provider.Model
  }

  export interface Interface {
    readonly create: (input: Input) => Effect.Effect<Handle>
  }

  /** Per-session tool call telemetry (local models) */
  interface ToolTelemetry {
    calls: number
    success: number
    errors: number
    byTool: Record<string, { calls: number; errors: number }>
  }

  interface ProcessorContext extends Input {
    toolcalls: Record<string, MessageV2.ToolPart>
    telemetry: ToolTelemetry
    adaptiveHintInjected: boolean
    shouldBreak: boolean
    snapshot: string | undefined
    blocked: boolean
    needsCompaction: boolean
    currentText: MessageV2.TextPart | undefined
    reasoningMap: Record<string, MessageV2.ReasoningPart>
    // Open tool.call spans awaiting a terminal event, keyed by toolCallID.
    // Anything still here in cleanup() never reached tool-result/tool-error,
    // i.e. it was aborted mid-flight.
    toolSpans: Record<string, { trace: TraceContext; startedAtMs: number }>
  }

  type StreamEvent = Event

  export class Service extends ServiceMap.Service<Service, Interface>()("@opencode/SessionProcessor") {}

  export const layer: Layer.Layer<
    Service,
    never,
    | Session.Service
    | Config.Service
    | Bus.Service
    | Snapshot.Service
    | Agent.Service
    | LLM.Service
    | Permission.Service
    | Plugin.Service
    | SessionStatus.Service
  > = Layer.effect(
    Service,
    Effect.gen(function* () {
      const session = yield* Session.Service
      const config = yield* Config.Service
      const bus = yield* Bus.Service
      const snapshot = yield* Snapshot.Service
      const agents = yield* Agent.Service
      const llm = yield* LLM.Service
      const permission = yield* Permission.Service
      const plugin = yield* Plugin.Service
      const status = yield* SessionStatus.Service

      const create = Effect.fn("SessionProcessor.create")(function* (input: Input) {
        // Pre-capture snapshot before the LLM stream starts. The AI SDK
        // may execute tools internally before emitting start-step events,
        // so capturing inside the event handler can be too late.
        const initialSnapshot = yield* snapshot.track()
        const ctx: ProcessorContext = {
          assistantMessage: input.assistantMessage,
          sessionID: input.sessionID,
          model: input.model,
          toolcalls: {},
          telemetry: { calls: 0, success: 0, errors: 0, byTool: {} },
          adaptiveHintInjected: false,
          shouldBreak: false,
          snapshot: initialSnapshot,
          blocked: false,
          needsCompaction: false,
          currentText: undefined,
          reasoningMap: {},
          toolSpans: {},
        }
        let aborted = false

        // Resolved once per turn, mirroring session/llm.ts. A single
        // per-turn traceId correlates this turn's tool calls with each
        // other; it is independent from the LLM call's own traceId since
        // that one isn't threaded across the LLM/tool boundary yet.
        const capturePolicy = resolveCapturePolicy((yield* config.get()).experimental?.observability)
        const observability: ObservabilityService | undefined = capturePolicy.enabled
          ? ObservabilityRuntime.service()
          : undefined
        const turnTraceId = observability ? ObservabilityId.create() : undefined

        const parse = (e: unknown) =>
          MessageV2.fromError(e, {
            providerID: input.model.providerID,
            aborted,
          })

        const handleEvent = Effect.fn("SessionProcessor.handleEvent")(function* (value: StreamEvent) {
          switch (value.type) {
            case "start":
              yield* status.set(ctx.sessionID, { type: "busy" })
              return

            case "reasoning-start":
              if (value.id in ctx.reasoningMap) return
              ctx.reasoningMap[value.id] = {
                id: PartID.ascending(),
                messageID: ctx.assistantMessage.id,
                sessionID: ctx.assistantMessage.sessionID,
                type: "reasoning",
                text: "",
                time: { start: Date.now() },
                metadata: value.providerMetadata,
              }
              yield* session.updatePart(ctx.reasoningMap[value.id])
              return

            case "reasoning-delta":
              if (!(value.id in ctx.reasoningMap)) return
              ctx.reasoningMap[value.id].text += value.text
              if (value.providerMetadata) ctx.reasoningMap[value.id].metadata = value.providerMetadata
              yield* session.updatePartDelta({
                sessionID: ctx.reasoningMap[value.id].sessionID,
                messageID: ctx.reasoningMap[value.id].messageID,
                partID: ctx.reasoningMap[value.id].id,
                field: "text",
                delta: value.text,
              })
              return

            case "reasoning-end":
              if (!(value.id in ctx.reasoningMap)) return
              ctx.reasoningMap[value.id].text = ctx.reasoningMap[value.id].text.trimEnd()
              ctx.reasoningMap[value.id].time = { ...ctx.reasoningMap[value.id].time, end: Date.now() }
              if (value.providerMetadata) ctx.reasoningMap[value.id].metadata = value.providerMetadata
              yield* session.updatePart(ctx.reasoningMap[value.id])
              delete ctx.reasoningMap[value.id]
              return

            case "tool-input-start":
              if (ctx.assistantMessage.summary) {
                throw new Error(`Tool call not allowed while generating summary: ${value.toolName}`)
              }
              ctx.toolcalls[value.id] = yield* session.updatePart({
                id: ctx.toolcalls[value.id]?.id ?? PartID.ascending(),
                messageID: ctx.assistantMessage.id,
                sessionID: ctx.assistantMessage.sessionID,
                type: "tool",
                tool: value.toolName,
                callID: value.id,
                state: { status: "pending", input: {}, raw: "" },
              } satisfies MessageV2.ToolPart)
              return

            case "tool-input-delta":
              return

            case "tool-input-end":
              return

            case "tool-call": {
              if (ctx.assistantMessage.summary) {
                throw new Error(`Tool call not allowed while generating summary: ${value.toolName}`)
              }
              const match = ctx.toolcalls[value.toolCallId]
              if (!match) return
              ctx.toolcalls[value.toolCallId] = yield* session.updatePart({
                ...match,
                tool: value.toolName,
                state: { status: "running", input: value.input, time: { start: Date.now() } },
                metadata: value.providerMetadata,
              } satisfies MessageV2.ToolPart)

              if (observability && turnTraceId) {
                const started = startTool({ traceId: turnTraceId, sessionId: ctx.sessionID })
                ctx.toolSpans[value.toolCallId] = { trace: started.trace, startedAtMs: started.event.tsMs }
                const argsClassification = sanitizeText({ text: JSON.stringify(value.input ?? {}) })
                let skillIdentity: { skillHmac?: string; pathHmac?: string } = {}
                let fileIdentity: { pathHmac?: string } = {}
                let mcpIdentity: { mcpHmac?: string } = {}
                if (value.toolName === "skill") {
                  skillIdentity = yield* Effect.promise(() =>
                    skillIdentityMetadata((value.input as any)?.name, undefined),
                  )
                } else if (["read", "write", "edit", "glob", "grep", "bash", "apply_patch", "ls"].includes(value.toolName)) {
                  // File tools: extract filePath from input
                  const input = value.input as Record<string, unknown> | undefined
                  const filePath = input?.filePath ?? input?.path ?? input?.directory
                  fileIdentity = yield* Effect.promise(() => filePathIdentityMetadata(filePath))
                } else if (value.toolName.startsWith("mcp_")) {
                  // MCP tools: HMAC the tool name
                  mcpIdentity = yield* Effect.promise(() => mcpToolIdentityMetadata(value.toolName))
                }
                observability.record(started.trace, {
                  ...started.event,
                  metadata: { toolKind: value.toolName, ...skillIdentity, ...fileIdentity, ...mcpIdentity },
                  originalSizeBytes: argsClassification.originalSizeBytes,
                  payloadTruncated: argsClassification.payloadTruncated,
                  redactionStatus: argsClassification.redactionStatus,
                  localRedacted: { classes: argsClassification.classes },
                })
              }

              // Cross-message tool history. Local 4B models retry failed tool
              // calls in NEW assistant messages (each turn = new message), so a
              // single-message inspection misses identical-input loops. Pull
              // recent tool parts from the whole session instead.
              const recentTools = MessageV2.recentToolParts(
                ctx.assistantMessage.sessionID,
                Math.max(DOOM_LOOP_THRESHOLD, 6),
              )
              const recentParts = recentTools.slice(-DOOM_LOOP_THRESHOLD)

              // Check 1: identical consecutive calls (original doom loop)
              const identicalLoop =
                recentParts.length === DOOM_LOOP_THRESHOLD &&
                recentParts.every(
                  (part) =>
                    part.tool === value.toolName &&
                    part.state.status !== "pending" &&
                    JSON.stringify(part.state.input) === JSON.stringify(value.input),
                )

              // Check 2: repeated failed edits on the same file (catches alternating
              // read→edit(fail) loops). Only blocks subsequent EDIT calls — earlier
              // versions also blocked bash/write/etc. on the same file, which broke
              // recovery flows where the model legitimately switches tool after a
              // string of failed edits (e.g. fall back to write, or run cargo check).
              const recentWindow = recentTools.slice(-6)
              const failedEdits = recentWindow.filter(
                (part) =>
                  part.tool === "edit" &&
                  part.state.status === "error",
              )
              const editFileLoop =
                value.toolName === "edit" &&
                failedEdits.length >= DOOM_LOOP_THRESHOLD &&
                failedEdits.every(
                  (part) =>
                    (part.state.input as any)?.filePath ===
                    (failedEdits[0].state.input as any)?.filePath,
                )

              if (!identicalLoop && !editFileLoop) {
                return
              }

              const loopType = identicalLoop ? "identical args" : "repeated failed edits on same file"

              // Local models: hard stop with recovery text.
              // 4B models cannot reliably handle "explain and ask for help" — they
              // tend to repeat the same call instead. We stop the agentic loop (blocked=true)
              // and emit a short text part so the user understands why the agent stopped.
              if (ctx.model.providerID === "local-llm") {
                log.warn("doom loop detected for local model", { tool: value.toolName, loopType })
                ctx.toolcalls[value.toolCallId] = yield* session.updatePart({
                  ...match,
                  tool: value.toolName,
                  state: {
                    status: "error",
                    input: value.input,
                    error: `Stopped: ${loopType}`,
                    time: { start: Date.now(), end: Date.now() },
                  },
                } satisfies MessageV2.ToolPart)
                // Recovery message visible in the conversation thread.
                yield* session.updatePart({
                  id: PartID.ascending(),
                  messageID: ctx.assistantMessage.id,
                  sessionID: ctx.assistantMessage.sessionID,
                  type: "text",
                  text: `Loop detected (${loopType} on \`${value.toolName}\`). Please tell me how to proceed or suggest an alternative approach.`,
                  time: { start: Date.now(), end: Date.now() },
                } satisfies MessageV2.TextPart)
                // Block the agentic loop — result will be "stop" so the user must re-prompt.
                // Without this, the 4B model continues generating and usually repeats the same call.
                ctx.blocked = true
                return
              }

              const agent = yield* agents.get(ctx.assistantMessage.agent)
              yield* permission.ask({
                permission: "doom_loop",
                patterns: [value.toolName],
                sessionID: ctx.assistantMessage.sessionID,
                metadata: { tool: value.toolName, input: value.input },
                always: [value.toolName],
                ruleset: agent.permission,
              })
              return
            }

            case "tool-result": {
              const match = ctx.toolcalls[value.toolCallId]
              if (!match || match.state.status !== "running") return
              // Telemetry: track success
              ctx.telemetry.calls++
              ctx.telemetry.success++
              const toolName = match.tool
              if (!ctx.telemetry.byTool[toolName]) ctx.telemetry.byTool[toolName] = { calls: 0, errors: 0 }
              ctx.telemetry.byTool[toolName].calls++

              yield* session.updatePart({
                ...match,
                state: {
                  status: "completed",
                  input: value.input ?? match.state.input,
                  output: value.output.output,
                  metadata: value.output.metadata,
                  title: value.output.title,
                  time: { start: match.state.time.start, end: Date.now() },
                  attachments: value.output.attachments,
                },
              })
              delete ctx.toolcalls[value.toolCallId]

              const finishedSpan = ctx.toolSpans[value.toolCallId]
              if (observability && finishedSpan) {
                const terminal = finishTool(finishedSpan.trace, "finished", finishedSpan.startedAtMs)
                const outputClassification = sanitizeText({ text: value.output.output })
                let skillIdentity: { skillHmac?: string; pathHmac?: string } = {}
                let fileIdentity: { pathHmac?: string } = {}
                let mcpIdentity: { mcpHmac?: string } = {}
                if (toolName === "skill") {
                  const outputMetadata = value.output.metadata as { name?: unknown; dir?: unknown } | undefined
                  skillIdentity = yield* Effect.promise(() =>
                    skillIdentityMetadata(outputMetadata?.name, outputMetadata?.dir),
                  )
                } else if (["read", "write", "edit", "glob", "grep", "bash", "apply_patch", "ls"].includes(toolName)) {
                  const input = match.state.input as Record<string, unknown> | undefined
                  const filePath = input?.filePath ?? input?.path ?? input?.directory
                  fileIdentity = yield* Effect.promise(() => filePathIdentityMetadata(filePath))
                } else if (toolName.startsWith("mcp_")) {
                  mcpIdentity = yield* Effect.promise(() => mcpToolIdentityMetadata(toolName))
                }
                observability.record(terminal.context, {
                  ...terminal.event,
                  metadata: {
                    toolKind: toolName,
                    outputFileKind: outputClassification.fileKind,
                    outputMime: outputClassification.mime,
                    ...skillIdentity,
                    ...fileIdentity,
                    ...mcpIdentity,
                  },
                  originalSizeBytes: outputClassification.originalSizeBytes,
                  payloadTruncated: outputClassification.payloadTruncated,
                  redactionStatus: outputClassification.redactionStatus,
                  localRedacted: { classes: outputClassification.classes },
                })
                delete ctx.toolSpans[value.toolCallId]
              }
              return
            }

            case "tool-error": {
              const match = ctx.toolcalls[value.toolCallId]
              const toolName = match?.tool ?? value.toolName

              // Telemetry: track error (even for guard rejections where match is undefined)
              if (toolName) {
                ctx.telemetry.calls++
                ctx.telemetry.errors++
                if (!ctx.telemetry.byTool[toolName]) ctx.telemetry.byTool[toolName] = { calls: 0, errors: 0 }
                ctx.telemetry.byTool[toolName].calls++
                ctx.telemetry.byTool[toolName].errors++
              }

              // Adaptive hint: suggest write over edit when edit fails too often
              let errorMsg = value.error instanceof Error ? value.error.message : String(value.error)
              if (toolName === "edit" && !ctx.adaptiveHintInjected) {
                const editStats = ctx.telemetry.byTool["edit"]
                const writeStats = ctx.telemetry.byTool["write"]
                if (editStats && editStats.calls >= 4) {
                  const editSuccessRate = (editStats.calls - editStats.errors) / editStats.calls
                  const writeSuccessRate = writeStats
                    ? (writeStats.calls - writeStats.errors) / Math.max(writeStats.calls, 1)
                    : 0.5
                  if (editSuccessRate < 0.5 && (writeSuccessRate > editSuccessRate || (!writeStats?.calls && editSuccessRate < 0.3))) {
                    const maxOutputTokens = ProviderTransform.maxOutputTokens(ctx.model)
                    const maxWriteLines = Math.floor(maxOutputTokens / 8)
                    errorMsg += ` Edit success rate is ${Math.round(editSuccessRate * 100)}% this session. Prefer write tool to rewrite entire file for files under ${maxWriteLines} lines.`
                    ctx.adaptiveHintInjected = true
                    log.info("adaptive hint injected", { editSuccessRate, maxWriteLines })
                  }
                }
              }

              if (!match || match.state.status !== "running") return

              yield* session.updatePart({
                ...match,
                state: {
                  status: "error",
                  input: value.input ?? match.state.input,
                  error: errorMsg,
                  time: { start: match.state.time.start, end: Date.now() },
                },
              })
              if (value.error instanceof Permission.RejectedError || value.error instanceof Question.RejectedError) {
                ctx.blocked = ctx.shouldBreak
              }
              delete ctx.toolcalls[value.toolCallId]

              const failedSpan = ctx.toolSpans[value.toolCallId]
              if (observability && failedSpan) {
                const terminal = finishTool(failedSpan.trace, "failed", failedSpan.startedAtMs)
                const errorKind = (value.error instanceof Error ? value.error.name : typeof value.error).slice(0, 128)
                let skillIdentity: { skillHmac?: string; pathHmac?: string } = {}
                let fileIdentity: { pathHmac?: string } = {}
                let mcpIdentity: { mcpHmac?: string } = {}
                if (toolName === "skill") {
                  const requestedName = (value.input as any)?.name ?? (match.state.input as any)?.name
                  skillIdentity = yield* Effect.promise(() => skillIdentityMetadata(requestedName, undefined))
                } else if (["read", "write", "edit", "glob", "grep", "bash", "apply_patch", "ls"].includes(toolName)) {
                  const input = match?.state.input as Record<string, unknown> | undefined
                  const filePath = input?.filePath ?? input?.path ?? input?.directory
                  fileIdentity = yield* Effect.promise(() => filePathIdentityMetadata(filePath))
                } else if (toolName.startsWith("mcp_")) {
                  mcpIdentity = yield* Effect.promise(() => mcpToolIdentityMetadata(toolName))
                }
                observability.record(terminal.context, {
                  ...terminal.event,
                  metadata: { toolKind: toolName, errorKind, ...skillIdentity, ...fileIdentity, ...mcpIdentity },
                })
                delete ctx.toolSpans[value.toolCallId]
              }
              return
            }

            case "error":
              throw value.error

            case "start-step":
              if (!ctx.snapshot) ctx.snapshot = yield* snapshot.track()
              yield* session.updatePart({
                id: PartID.ascending(),
                messageID: ctx.assistantMessage.id,
                sessionID: ctx.sessionID,
                snapshot: ctx.snapshot,
                type: "step-start",
              })
              return

            case "finish-step": {
              const usage = Session.getUsage({
                model: ctx.model,
                usage: value.usage,
                metadata: value.providerMetadata,
              })
              ctx.assistantMessage.finish = value.finishReason
              ctx.assistantMessage.cost += usage.cost
              ctx.assistantMessage.tokens = usage.tokens
              yield* session.updatePart({
                id: PartID.ascending(),
                reason: value.finishReason,
                snapshot: yield* snapshot.track(),
                messageID: ctx.assistantMessage.id,
                sessionID: ctx.assistantMessage.sessionID,
                type: "step-finish",
                tokens: usage.tokens,
                cost: usage.cost,
              })
              yield* session.updateMessage(ctx.assistantMessage)
              if (ctx.snapshot) {
                const patch = yield* snapshot.patch(ctx.snapshot)
                if (patch.files.length) {
                  yield* session.updatePart({
                    id: PartID.ascending(),
                    messageID: ctx.assistantMessage.id,
                    sessionID: ctx.sessionID,
                    type: "patch",
                    hash: patch.hash,
                    files: patch.files,
                  })
                }
                ctx.snapshot = undefined
              }
              SessionSummary.summarize({
                sessionID: ctx.sessionID,
                messageID: ctx.assistantMessage.parentID,
              })
              if (
                !ctx.assistantMessage.summary &&
                isOverflow({ cfg: yield* config.get(), tokens: usage.tokens, model: ctx.model })
              ) {
                ctx.needsCompaction = true
              }
              return
            }

            case "text-start":
              ctx.currentText = {
                id: PartID.ascending(),
                messageID: ctx.assistantMessage.id,
                sessionID: ctx.assistantMessage.sessionID,
                type: "text",
                text: "",
                time: { start: Date.now() },
                metadata: value.providerMetadata,
              }
              yield* session.updatePart(ctx.currentText)
              return

            case "text-delta":
              if (!ctx.currentText) return
              ctx.currentText.text += value.text
              if (value.providerMetadata) ctx.currentText.metadata = value.providerMetadata
              yield* session.updatePartDelta({
                sessionID: ctx.currentText.sessionID,
                messageID: ctx.currentText.messageID,
                partID: ctx.currentText.id,
                field: "text",
                delta: value.text,
              })
              return

            case "text-end":
              if (!ctx.currentText) return
              ctx.currentText.text = ctx.currentText.text.trimEnd()
              ctx.currentText.text = (yield* plugin.trigger(
                "experimental.text.complete",
                {
                  sessionID: ctx.sessionID,
                  messageID: ctx.assistantMessage.id,
                  partID: ctx.currentText.id,
                },
                { text: ctx.currentText.text },
              )).text
              ctx.currentText.time = { start: Date.now(), end: Date.now() }
              if (value.providerMetadata) ctx.currentText.metadata = value.providerMetadata
              yield* session.updatePart(ctx.currentText)
              ctx.currentText = undefined
              return

            case "finish":
              return

            default:
              log.info("unhandled", { ...value })
              return
          }
        })

        const cleanup = Effect.fn("SessionProcessor.cleanup")(function* () {
          if (ctx.snapshot) {
            const patch = yield* snapshot.patch(ctx.snapshot)
            if (patch.files.length) {
              yield* session.updatePart({
                id: PartID.ascending(),
                messageID: ctx.assistantMessage.id,
                sessionID: ctx.sessionID,
                type: "patch",
                hash: patch.hash,
                files: patch.files,
              })
            }
            ctx.snapshot = undefined
          }

          if (ctx.currentText) {
            const end = Date.now()
            ctx.currentText.time = { start: ctx.currentText.time?.start ?? end, end }
            yield* session.updatePart(ctx.currentText)
            ctx.currentText = undefined
          }

          for (const part of Object.values(ctx.reasoningMap)) {
            const end = Date.now()
            yield* session.updatePart({
              ...part,
              time: { start: part.time.start ?? end, end },
            })
          }
          ctx.reasoningMap = {}

          const parts = MessageV2.parts(ctx.assistantMessage.id)
          for (const part of parts) {
            if (part.type !== "tool" || part.state.status === "completed" || part.state.status === "error") continue
            yield* session.updatePart({
              ...part,
              state: {
                ...part.state,
                status: "error",
                error: "Tool execution aborted",
                time: { start: Date.now(), end: Date.now() },
              },
            })
          }

          // Any span still open here never reached tool-result/tool-error —
          // the turn ended (success, halt, or abort) while it was in flight.
          if (observability) {
            for (const span of Object.values(ctx.toolSpans)) {
              const terminal = finishTool(span.trace, "aborted", span.startedAtMs)
              observability.record(terminal.context, terminal.event)
            }
            ctx.toolSpans = {}
          }

          ctx.assistantMessage.time.completed = Date.now()
          yield* session.updateMessage(ctx.assistantMessage)

          // Log tool telemetry for local models
          if (ctx.telemetry.calls > 0 && ctx.model.providerID === "local-llm") {
            const rate = Math.round((ctx.telemetry.success / ctx.telemetry.calls) * 100)
            log.info("tool telemetry", {
              calls: ctx.telemetry.calls,
              success: ctx.telemetry.success,
              errors: ctx.telemetry.errors,
              successRate: `${rate}%`,
              byTool: ctx.telemetry.byTool,
            })
          }
        })

        const halt = Effect.fn("SessionProcessor.halt")(function* (e: unknown) {
          log.error("process", { error: e, stack: e instanceof Error ? e.stack : undefined })
          const error = parse(e)
          if (MessageV2.ContextOverflowError.isInstance(error)) {
            ctx.needsCompaction = true
            yield* bus.publish(Session.Event.Error, { sessionID: ctx.sessionID, error })
            return
          }
          ctx.assistantMessage.error = error
          yield* bus.publish(Session.Event.Error, {
            sessionID: ctx.assistantMessage.sessionID,
            error: ctx.assistantMessage.error,
          })
          yield* status.set(ctx.sessionID, { type: "idle" })
        })

        const abort = Effect.fn("SessionProcessor.abort")(() =>
          Effect.gen(function* () {
            if (!ctx.assistantMessage.error) {
              yield* halt(new DOMException("Aborted", "AbortError"))
            }
            if (!ctx.assistantMessage.time.completed) {
              yield* cleanup()
              return
            }
            yield* session.updateMessage(ctx.assistantMessage)
          }),
        )

        const process = Effect.fn("SessionProcessor.process")(function* (streamInput: LLM.StreamInput) {
          log.info("process")
          ctx.needsCompaction = false
          ctx.shouldBreak = (yield* config.get()).experimental?.continue_loop_on_deny !== true

          return yield* Effect.gen(function* () {
            yield* Effect.gen(function* () {
              ctx.currentText = undefined
              ctx.reasoningMap = {}
              const stream = llm.stream(streamInput)

              yield* stream.pipe(
                Stream.tap((event) => handleEvent(event)),
                Stream.takeUntil(() => ctx.needsCompaction),
                Stream.runDrain,
              )
            }).pipe(
              Effect.onInterrupt(() => Effect.sync(() => void (aborted = true))),
              Effect.catchCauseIf(
                (cause) => !Cause.hasInterruptsOnly(cause),
                (cause) => Effect.fail(Cause.squash(cause)),
              ),
              Effect.retry(
                SessionRetry.policy({
                  parse,
                  set: (info) =>
                    status.set(ctx.sessionID, {
                      type: "retry",
                      attempt: info.attempt,
                      message: info.message,
                      next: info.next,
                    }),
                }),
              ),
              Effect.catch(halt),
              Effect.ensuring(cleanup()),
            )

            if (aborted && !ctx.assistantMessage.error) {
              yield* abort()
            }
            if (ctx.needsCompaction) return "compact"
            if (ctx.blocked || ctx.assistantMessage.error || aborted) return "stop"
            return "continue"
          }).pipe(Effect.onInterrupt(() => abort().pipe(Effect.asVoid)))
        })

        return {
          get message() {
            return ctx.assistantMessage
          },
          partFromToolCall(toolCallID: string) {
            return ctx.toolcalls[toolCallID]
          },
          abort,
          process,
        } satisfies Handle
      })

      return Service.of({ create })
    }),
  )

  export const defaultLayer = Layer.unwrap(
    Effect.sync(() =>
      layer.pipe(
        Layer.provide(Session.defaultLayer),
        Layer.provide(Snapshot.defaultLayer),
        Layer.provide(Agent.defaultLayer),
        Layer.provide(LLM.defaultLayer),
        Layer.provide(Permission.defaultLayer),
        Layer.provide(Plugin.defaultLayer),
        Layer.provide(SessionStatus.layer.pipe(Layer.provide(Bus.layer))),
        Layer.provide(Bus.layer),
        Layer.provide(Config.defaultLayer),
      ),
    ),
  )
}
