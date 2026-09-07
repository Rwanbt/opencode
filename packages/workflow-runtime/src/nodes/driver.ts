/* SPDX-License-Identifier: MIT */
/* Copyright (c) 2026 Unifia contributors */

/**
 * Phase 1 execution driver � turns `readyForDispatch` into real
 * dispatches. This is NOT a second execution model: every mutation
 * flows through the certified substrate (`GraphRuntimeEngine`,
 * `NativeAttemptAuthority`, durable history) with the run token, so
 * fencing, journaling, idempotence and recovery behave exactly as
 * proven. The driver only decides WHAT to run and in which order.
 *
 * Loop: advance -> dispatch every ready executable node (resolve
 * `$node` -> execute -> complete/fail + FailurePolicy) -> repeat
 * until quiescent (only external nodes pending) or terminal.
 * The caller (port) converges the run terminal boundary afterwards
 * via its certified resume path.
 *
 * Deferred by design (documented, not silent): backoffMs sleeps
 * (retries are immediate), in-flight fetch abort on cancel (cancel
 * is checked before each dispatch), deep `$node` inside non-string
 * config leaves (top-level strings only... see resolveConfig).
 */
import type { FailurePolicy, WorkflowDefinition } from "@unifia/contracts"
import type { AuthorityToken } from "../authority.js"
import { AuthorityError } from "../authority.js"
import type { GraphRuntimeEngine } from "../graph-runtime.js"
import type { NativeAttemptAuthority } from "../native-attempts.js"
import type { NativeDurableHistoryAuthority } from "../native-history.js"
import { evaluateNodeRefs, type CompletedOutputs } from "./env.js"
import { executeHttpRequest, parseHttpConfig } from "./http-executor.js"
import { executeTransform, parseTransformConfig } from "./transform-executor.js"
import { DefaultSecretRedactor, type SecretRedactor } from "../native-attempts.js"
import { NodeExecutionError, NODE_OUTPUT_MAX_BYTES, redactNodeData } from "./io.js"
import { NodeRegistry } from "./registry.js"

export const DRIVER_MAX_DISPATCHES = 1000

export type NodeDispatchRecord = {
  readonly nodeId: string
  readonly family: string
  readonly attemptId: string | null
  readonly status: "completed" | "failed" | "ignored" | "external"
  readonly durationMs: number
}

export type DriveReport = {
  readonly dispatched: readonly NodeDispatchRecord[]
  readonly terminal: boolean
}

export type DriverOptions = {
  readonly fetchImpl?: typeof fetch
  readonly maxDispatches?: number
  readonly redactor?: SecretRedactor
  readonly now?: () => number
}

function isTerminalStatus(status: string): boolean {
  return status === "completed" || status === "failed" || status === "cancelled" ||
    status === "cancelled_with_active_effect" || status === "cancelled_with_unknown_external_state"
}

function readCompletedOutputs(engine: GraphRuntimeEngine, runId: string, nodeIds: readonly string[]): { outputs: Map<string, unknown>; completed: Set<string> } {
  const outputs = new Map<string, unknown>()
  const completed = new Set<string>()
  for (const nodeId of nodeIds) {
    const state = engine.nodeState(runId, nodeId)
    if (state && state.status === "COMPLETED" && state.outputJson) {
      try {
        outputs.set(nodeId, JSON.parse(state.outputJson) as unknown)
        completed.add(nodeId)
      } catch {
        // Corrupt output JSON cannot happen via completeNode (it writes
        // JSON.stringify); a foreign writer would surface here as a
        // typed error instead of silently poisoning `$node`.
        throw new NodeExecutionError("NODE_TYPE_MISMATCH", `stored output is not JSON for node: ${nodeId}`, false)
      }
    }
  }
  return { outputs, completed }
}

function resolveConfigDeep(value: unknown, ctx: { outputs: CompletedOutputs; known: readonly string[]; completed: ReadonlySet<string> }): unknown {
  if (typeof value === "string") {
    if (!value.includes("$node")) return value
    return evaluateNodeRefs(value, ctx.outputs, ctx.known, ctx.completed)
  }
  if (Array.isArray(value)) return value.map((item) => resolveConfigDeep(item, ctx))
  if (value !== null && typeof value === "object") {
    const out: Record<string, unknown> = {}
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) out[key] = resolveConfigDeep(item, ctx)
    return out
  }
  return value
}

export async function driveToQuiescence(args: {
  engine: GraphRuntimeEngine
  attempts: NativeAttemptAuthority
  history: Pick<NativeDurableHistoryAuthority, "getRun">
  definition: WorkflowDefinition
  token: AuthorityToken
  registry: NodeRegistry
  options?: DriverOptions
}): Promise<DriveReport> {
  const { engine, attempts, history, definition, token, registry } = args
  const runId = token.workflowRunId
  const fetchImpl = args.options?.fetchImpl ?? fetch
  const now = args.options?.now ?? Date.now
  const maxDispatches = args.options?.maxDispatches ?? DRIVER_MAX_DISPATCHES
  const redactor = args.options?.redactor ?? new DefaultSecretRedactor()
  const nodeIds = definition.nodes.map((node) => node.id)
  const byId = new Map(definition.nodes.map((node) => [node.id, node]))
  const dispatched: NodeDispatchRecord[] = []
  const retryUsed = new Map<string, number>()
  let totalDispatches = 0

  for (;;) {
    const run = await history.getRun(runId)
    if (!run || isTerminalStatus(run.status)) return { dispatched, terminal: true }
    // advance() progresses decisions and enters newly-ready nodes, but it
    // surfaces a node as readyForDispatch ONLY on entry (undefined/PENDING
    // -> RUNNING). A node entered by start() or a previous pass is already
    // RUNNING, so dispatchables are derived from node states, not the
    // ready list. Predecessors were met at entry (monotonic terminal states).
    engine.advance(runId, token, { input: {} })
    const todo: string[] = []
    for (const node of definition.nodes) {
      if (node.family !== "tool.http" && node.family !== "tool.transform") continue
      const state = engine.nodeState(runId, node.id)
      if (!state || state.status !== "RUNNING") continue
      if (node.family === "tool.http") {
        // Already dispatched (any outcome incl. in-flight): reconcile-only,
        // never blind redispatch. The effect row is the dispatched marker:
        // SUCCEEDED blocks (terminal), FAILED needs authorizeRetry (explicit
        // retry path, not the drive loop), UNKNOWN needs reconcile.
        const prior = attempts.inspectEffect(runId, `node:${node.id}`)
        if (prior) continue
      }
      todo.push(node.id)
    }
    // Only external nodes (approval/wait/triggers) remain: quiescent by design.
    if (todo.length === 0) return { dispatched, terminal: false }
    for (const nodeId of todo) {
      if (++totalDispatches > maxDispatches) {
        throw new NodeExecutionError("DRIVER_BUDGET_EXCEEDED", `driver dispatch budget exceeded (${maxDispatches})`, false)
      }
      const startedAt = now()
      const record = await dispatchNode({ engine, attempts, definition, token, nodeId, byId, fetchImpl, now, redactor, retryUsed, registry })
      dispatched.push({ ...record, durationMs: now() - startedAt })
    }
  }
}

async function dispatchNode(args: {
  engine: GraphRuntimeEngine
  attempts: NativeAttemptAuthority
  definition: WorkflowDefinition
  token: AuthorityToken
  nodeId: string
  byId: ReadonlyMap<string, WorkflowDefinition["nodes"][number]>
  fetchImpl: typeof fetch
  now: () => number
  redactor: SecretRedactor
  retryUsed: Map<string, number>
  registry: NodeRegistry
}): Promise<Omit<NodeDispatchRecord, "durationMs">> {
  const { engine, attempts, definition, token, nodeId } = args
  const runId = token.workflowRunId
  const node = args.byId.get(nodeId)!
  const { outputs, completed } = readCompletedOutputs(engine, runId, definition.nodes.map((n) => n.id))
  const known = definition.nodes.map((n) => n.id)
  const policy = node.failurePolicy ?? definition.defaultFailurePolicy ?? { kind: "propagate" as const }

  const failWith = (error: unknown, fallbackCode: "NODE_CONFIG_INVALID" | "NODE_OUTPUT_TOO_LARGE" | "NODE_EXECUTOR_ERROR"): Omit<NodeDispatchRecord, "durationMs"> => {
    const reason = error instanceof NodeExecutionError ? `[${error.code}] ${error.message}` : `[${fallbackCode}] ${error instanceof Error ? error.message : String(error)}`
    engine.failNode(runId, token, nodeId, reason)
    return { nodeId, family: node.family, attemptId: null, status: "failed" }
  }
  const fail = (reason: string): Omit<NodeDispatchRecord, "durationMs"> => {
    engine.failNode(runId, token, nodeId, reason)
    return { nodeId, family: node.family, attemptId: null, status: "failed" }
  }

  let executor: "http" | "transform" | "external"
  try {
    executor = args.registry.get(node.family).executor
  } catch {
    return failWith(`unknown node family: ${node.family}`, "NODE_CONFIG_INVALID")
  }
  if (executor === "external") return { nodeId, family: node.family, attemptId: null, status: "external" }
  try {
    if (executor === "transform") {
      // Transform configs carry RAW expression strings: the executor evaluates
      // each field itself. Pre-resolving here would evaluate twice (and reject
      // non-string results as invalid config).
      const output = executeTransform(parseTransformConfig(node.config as Record<string, unknown>), outputs, known, completed)
      const data = { json: output, meta: { attemptId: null as string | null, durationMs: 0, bytes: 0 } }
      const bytes = JSON.stringify(data).length
      if (bytes > NODE_OUTPUT_MAX_BYTES) {
        return failWith(`transform output exceeds ${NODE_OUTPUT_MAX_BYTES} bytes`, "NODE_OUTPUT_TOO_LARGE")
      }
      data.meta = { ...data.meta, bytes }
      engine.journalNodeEvent(runId, token, nodeId, "NODE_DISPATCHED", { family: node.family, attemptId: null, input: redactNodeData(node.config, args.redactor) })
      engine.completeNode(runId, token, nodeId, data)
      return { nodeId, family: node.family, attemptId: null, status: "completed" }
    }
    if (executor === "http") {
      const resolved = resolveConfigDeep(node.config as Record<string, unknown>, { outputs, known, completed }) as Record<string, unknown>
      const timeoutMs = (resolved["timeoutMs"] as number | undefined) ?? (node.timeoutMs || undefined) ?? (definition.defaultTimeoutMs || undefined)
      const httpConfig = parseHttpConfig({ ...resolved, timeoutMs })
      const effectKey = `node:${nodeId}`
      const maxAttempts = policy.kind === "retry" ? (policy.maxAttempts ?? 1) : 0
      let used = args.retryUsed.get(nodeId) ?? 0
      for (;;) {
        const attempt = args.attempts.allocateAttempt(token, nodeId, effectKey)
        args.engine.journalNodeEvent(runId, token, nodeId, "NODE_DISPATCHED", {
          family: node.family,
          attemptId: attempt.attemptId,
          input: redactNodeData(resolved, args.redactor),
        })
        const startedAt = Date.now()
        try {
          const { data, durationMs } = await executeHttpRequest(httpConfig, args.fetchImpl, startedAt)
          const payload = { json: data.body, meta: { attemptId: attempt.attemptId, durationMs, bytes: 0, status: data.status, finalUrl: data.finalUrl } }
          const bytes = JSON.stringify(payload).length
          if (bytes > NODE_OUTPUT_MAX_BYTES) {
            // The side effect DID happen: record it truthfully, then fail
            // the node without storing (no partial facts, no silent retry �
            // SUCCEEDED is terminal so a retry is impossible by construction).
            args.attempts.recordAttemptOutcome(token, nodeId, attempt.attemptId, "SUCCEEDED", { result: { status: data.status, bytes, truncated: true } })
            return failWith(`node output exceeds ${NODE_OUTPUT_MAX_BYTES} bytes`, "NODE_OUTPUT_TOO_LARGE")
          }
          payload.meta = { ...payload.meta, bytes }
          args.attempts.recordAttemptOutcome(token, nodeId, attempt.attemptId, "SUCCEEDED", { result: payload })
          engine.completeNode(runId, token, nodeId, payload)
          return { nodeId, family: node.family, attemptId: attempt.attemptId, status: "completed" }
        } catch (error) {
          if (error instanceof AuthorityError) throw error
          const retryable = error instanceof NodeExecutionError ? error.retryable : false
          const message = error instanceof Error ? error.message : String(error)
          if (policy.kind === "retry" && retryable && used < maxAttempts) {
            used += 1
            args.retryUsed.set(nodeId, used)
            args.attempts.recordAttemptOutcome(token, nodeId, attempt.attemptId, "FAILED", { result: { error: message } })
            args.attempts.authorizeRetry(token, effectKey)
            continue
          }
          if (policy.kind === "ignore") {
            engine.completeNode(runId, token, nodeId, { json: null, meta: { attemptId: attempt.attemptId, durationMs: 0, bytes: 0 } })
            return { nodeId, family: node.family, attemptId: attempt.attemptId, status: "ignored" }
          }
          try {
            args.attempts.recordAttemptOutcome(token, nodeId, attempt.attemptId, "FAILED", { result: { error: message } })
          } catch {
            // Best effort: the attempt may already be terminal if the
            // executor recorded its own outcome (never masks the failure).
          }
          return failWith(error, "NODE_EXECUTOR_ERROR")
        }
      }
    }
    return failWith(`unsupported executor for node family: ${node.family}`, "NODE_CONFIG_INVALID")
  } catch (error) {
    // Fences always propagate; everything else becomes a typed node
    // failure so a run can never hang on an unexpected throw.
    if (error instanceof AuthorityError) throw error
    return failWith(error, "NODE_EXECUTOR_ERROR")
  }
}
