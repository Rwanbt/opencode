/* SPDX-License-Identifier: MIT */
/* Copyright (c) 2026 Unifia contributors */

/**
 * Phase 1 execution driver - turns node states into real dispatches.
 * This is NOT a second execution model: every mutation flows through
 * the certified substrate (`GraphRuntimeEngine`, `NativeAttemptAuthority`,
 * durable history) with the run token, so fencing, journaling,
 * idempotence and recovery behave exactly as proven. The driver only
 * decides WHAT to run and in which order.
 *
 * Recovery is driven ENTIRELY by durable facts (effect rows +
 * attempts), never by in-memory counters, so every branch below
 * converges after restart:
 * - no effect row (http) / RUNNING transform: first dispatch.
 * - SUCCEEDED effect + non-terminal node: heal by completing with the
 *   stored result (crash between outcome and completion).
 * - FAILED effect + banked retry auth: resume the authorized retry
 *   (budget derived from durable attempt rows).
 * - FAILED effect, no auth: converge terminal (failNode).
 * - UNKNOWN effect: quiesce (reconcile-only exit).
 * - PENDING effect: open attempts become UNKNOWN (crash ambiguity),
 *   then quiesce.
 *
 * Deferred by design (documented, not silent): backoffMs sleeps
 * (retries are immediate), in-flight fetch abort on cancel (cancelled
 * runs break the loop before each dispatch).
 */
import type { FailurePolicy, WorkflowDefinition } from "@unifia/contracts"
import type { AuthorityToken } from "../authority.js"
import { AuthorityError } from "../authority.js"
import type { GraphRuntimeEngine } from "../graph-runtime.js"
import type { NativeAttemptAuthority } from "../native-attempts.js"
import type { NativeDurableHistoryAuthority } from "../native-history.js"
import { collectConfigNodeRefs, evaluateNodeRefs, type CompletedOutputs } from "./env.js"
import { executeHttpRequest, parseHttpConfig } from "./http-executor.js"
import { executeTransform, parseTransformConfig } from "./transform-executor.js"
import { DefaultSecretRedactor, type SecretRedactor } from "../native-attempts.js"
import { NodeExecutionError, NODE_OUTPUT_MAX_BYTES, redactNodeData } from "./io.js"
import { NodeRegistry, type NodeExecutorKind } from "./registry.js"

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
  /**
   * Capability gate hook (production path wires the P3 gate). Called once
   * per executable node before any dispatch; must throw on denial.
   * Absent = test/embedding scope (documented).
   */
  readonly authorize?: (capabilities: readonly string[], resource: string) => Promise<void>
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

/** Latest attempt id for a node, if any attempt was ever minted (durable). */
function latestAttemptId(attempts: NativeAttemptAuthority, runId: string, nodeId: string): string | null {
  const rows = attempts.inspectAttempts(runId, nodeId)
  return rows.length === 0 ? null : rows[rows.length - 1]!.attemptId
}

/**
 * Heal a graph node whose effect already reached SUCCEEDED (crash between
 * the outcome record and the graph completion). Completes with the stored
 * result so the run converges without redispatching a confirmed effect.
 */
function healCompletedNode(
  engine: GraphRuntimeEngine,
  attempts: NativeAttemptAuthority,
  runId: string,
  token: AuthorityToken,
  nodeId: string,
): void {
  const effect = attempts.inspectEffect(runId, `node:${nodeId}`)
  let output: unknown = { json: null }
  if (effect?.resultJson) {
    try {
      output = JSON.parse(effect.resultJson) as unknown
    } catch {
      output = { json: null }
    }
  }
  engine.completeNode(runId, token, nodeId, output)
}

/** Definition version pinned at first dispatch (deterministic replay). */
function pinnedDefinitionVersion(engine: GraphRuntimeEngine, runId: string, nodeId: string): string | undefined {
  const events = engine.inspectEvents(runId)
  for (let i = events.length - 1; i >= 0; i--) {
    const event = events[i]!
    if (event.nodeId === nodeId && event.kind === "NODE_DISPATCH_INTENT" && event.detailJson) {
      try {
        const detail = JSON.parse(event.detailJson) as { definitionVersion?: unknown }
        if (typeof detail.definitionVersion === "string") return detail.definitionVersion
      } catch {
        return undefined
      }
    }
  }
  return undefined
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
  const maxDispatches = args.options?.maxDispatches ?? DRIVER_MAX_DISPATCHES
  const redactor = args.options?.redactor ?? new DefaultSecretRedactor()
  const byId = new Map(definition.nodes.map((node) => [node.id, node]))
  const dispatched: NodeDispatchRecord[] = []
  let totalDispatches = 0

  // Publish-time validation: every `$node` id referenced by any executable
  // node config must exist in the definition. Fail-closed before dispatch.
  for (const node of definition.nodes) {
    if (node.family !== "tool.http" && node.family !== "tool.transform") continue
    for (const refId of collectConfigNodeRefs(node.config as Record<string, unknown>)) {
      if (!byId.has(refId)) {
        throw new NodeExecutionError("NODE_UNKNOWN_REFERENCE", `node ${node.id} references unknown node id: ${refId}`, false)
      }
    }
  }
  // Capability gate: every executable node type declares what it needs.
  // Checked once per node before ANY dispatch (fail-closed whole run).
  if (args.options?.authorize) {
    for (const node of definition.nodes) {
      if (node.family !== "tool.http" && node.family !== "tool.transform") continue
      let capabilities: readonly string[] = []
      try {
        capabilities = registry.get(node.family).capabilities
      } catch {
        continue
      }
      if (capabilities.length > 0) await args.options.authorize(capabilities, `workflow:${runId}:node:${node.id}`)
    }
  }

  for (;;) {
    const run = await history.getRun(runId)
    if (!run || isTerminalStatus(run.status)) return { dispatched, terminal: true }
    // advance() progresses decisions and enters newly-ready nodes, but it
    // surfaces a node as readyForDispatch ONLY on entry (undefined/PENDING
    // -> RUNNING). Dispatchables are derived from node states below.
    engine.advance(runId, token, { input: {} })
    const todo: { nodeId: string }[] = []
    for (const node of definition.nodes) {
      if (node.family !== "tool.http" && node.family !== "tool.transform") continue
      const state = engine.nodeState(runId, node.id)
      if (!state || state.status === "COMPLETED" || state.status === "FAILED" || state.status === "SKIPPED") continue
      if (node.family === "tool.transform") {
        todo.push({ nodeId: node.id })
        continue
      }
      const effect = attempts.inspectEffect(runId, `node:${node.id}`)
      if (!effect) {
        todo.push({ nodeId: node.id })
        continue
      }
      if (effect.status === "SUCCEEDED") {
        healCompletedNode(engine, attempts, runId, token, node.id)
        dispatched.push({ nodeId: node.id, family: node.family, attemptId: latestAttemptId(attempts, runId, node.id), status: "completed" as const, durationMs: 0 })
        continue
      }
      if (effect.status === "FAILED") {
        if (attempts.hasRetryAuthorization(runId, `node:${node.id}`)) {
          todo.push({ nodeId: node.id })
        } else {
          engine.failNode(runId, token, node.id, "effect failed without retry authorization")
          dispatched.push({ nodeId: node.id, family: node.family, attemptId: latestAttemptId(attempts, runId, node.id), status: "failed" as const, durationMs: 0 })
        }
        continue
      }
      if (effect.status === "UNKNOWN_EXTERNAL_STATE") continue
      const open = attempts.inspectAttempts(runId, node.id).filter((attempt) => attempt.outcome === null)
      for (const attempt of open) {
        try {
          attempts.recordAttemptOutcome(token, node.id, attempt.attemptId, "UNKNOWN_EXTERNAL_STATE", { result: { error: "recovered open attempt after restart" } })
        } catch {
          // Best effort: a concurrently-closed attempt races here; the next
          // pass re-reads durable facts and converges.
        }
      }
    }
    // Only external nodes (approval/wait/triggers) remain: quiescent by design.
    if (todo.length === 0) return { dispatched, terminal: false }
    for (const item of todo) {
      if (++totalDispatches > maxDispatches) {
        throw new NodeExecutionError("DRIVER_BUDGET_EXCEEDED", `driver dispatch budget exceeded (${maxDispatches})`, false)
      }
      const startedAt = Date.now()
      const record = await dispatchNode({ engine, attempts, definition, token, nodeId: item.nodeId, byId, fetchImpl, redactor, registry })
      dispatched.push({ ...record, durationMs: Date.now() - startedAt })
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
  redactor: SecretRedactor
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

  let executor: NodeExecutorKind
  try {
    // Runs pin the exact definition version at first dispatch (deterministic
    // replay across registry upgrades); resumed dispatches reuse the pin.
    executor = args.registry.get(node.family, pinnedDefinitionVersion(engine, runId, nodeId)).executor
  } catch {
    return failWith(`unknown node family: ${node.family}`, "NODE_CONFIG_INVALID")
  }
  if (executor === "external") return { nodeId, family: node.family, attemptId: null, status: "external" }
  if (executor === "internal") return failWith(`engine-internal node surfaced for dispatch: ${node.family}`, "NODE_CONFIG_INVALID")
  try {
    if (executor === "transform") {
      // Transform configs carry RAW expression strings: the executor evaluates
      // each field itself. Pre-resolving here would evaluate twice (and reject
      // non-string results as invalid config).
      const output = executeTransform(parseTransformConfig(node.config as Record<string, unknown>), outputs, known, completed)
      const data = { json: output, meta: { attemptId: null as string | null, durationMs: 0, bytes: 0 } }
      const bytes = new TextEncoder().encode(JSON.stringify(data)).length
      if (bytes > NODE_OUTPUT_MAX_BYTES) {
        return failWith(`transform output exceeds ${NODE_OUTPUT_MAX_BYTES} bytes`, "NODE_OUTPUT_TOO_LARGE")
      }
      data.meta = { ...data.meta, bytes }
      engine.journalNodeEvent(runId, token, nodeId, "NODE_DISPATCH_INTENT", { family: node.family, attemptId: null, input: redactNodeData(node.config, args.redactor) })
      engine.completeNode(runId, token, nodeId, data)
      return { nodeId, family: node.family, attemptId: null, status: "completed" }
    }
    if (executor === "http") {
      const resolved = resolveConfigDeep(node.config as Record<string, unknown>, { outputs, known, completed }) as Record<string, unknown>
      const timeoutMs = (resolved["timeoutMs"] as number | undefined) ?? node.timeoutMs ?? definition.defaultTimeoutMs
      const httpConfig = parseHttpConfig({ ...resolved, timeoutMs })
      const effectKey = `node:${nodeId}`
      const maxAttempts = policy.kind === "retry" ? (policy.maxAttempts ?? 1) : 0
      const definitionVersion = args.registry.get(node.family).version
      // Retry budget is durable: attempts minted so far minus the initial one,
      // re-read every iteration so restarts resume the same budget.
      const usedBefore = (): number => Math.max(0, attempts.inspectAttempts(runId, nodeId).length - 1)
      // Retry budget is durable: attempts minted so far minus the initial one.
      // The loop re-reads it every iteration, so budget survives restarts.
      for (;;) {
        const used = Math.max(0, attempts.inspectAttempts(runId, nodeId).length - 1)
        const attempt = attempts.allocateAttempt(token, nodeId, effectKey)
        args.engine.journalNodeEvent(runId, token, nodeId, "NODE_DISPATCH_INTENT", {
          family: node.family,
          attemptId: attempt.attemptId,
          definitionVersion,
          input: redactNodeData(resolved, args.redactor),
        })
        try {
          const { data, durationMs } = await executeHttpRequest(httpConfig, args.fetchImpl, Date.now())
          const payload = { json: data.body, meta: { attemptId: attempt.attemptId, durationMs, bytes: 0, status: data.status, finalUrl: data.finalUrl } }
          const bytes = new TextEncoder().encode(JSON.stringify(payload)).length
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
          const message = error instanceof Error ? error.message : String(error)
          const outcomeUnknown = error instanceof NodeExecutionError &&
            (error.code === "HTTP_TIMEOUT" || (error.code === "HTTP_NETWORK_ERROR" && !error.retryable))
          if (outcomeUnknown) {
            // Crash-equivalent uncertainty while an attempt is open: the
            // provider may have committed. Record UNKNOWN (reconcile-only
            // exit, never a blind retry), then converge the graph node. Even
            // `ignore` completes the node with null � the graph moves on,
            // the effect stays truthfully UNKNOWN.
            try {
              args.attempts.recordAttemptOutcome(token, nodeId, attempt.attemptId, "UNKNOWN_EXTERNAL_STATE", { result: { error: message } })
            } catch {
              // Best effort: the attempt row may already carry an outcome.
            }
            if (policy.kind === "ignore") {
              engine.completeNode(runId, token, nodeId, { json: null, meta: { attemptId: attempt.attemptId, durationMs: 0, bytes: 0 } })
              return { nodeId, family: node.family, attemptId: attempt.attemptId, status: "ignored" }
            }
            return failWith(error, "NODE_EXECUTOR_ERROR")
          }
          const retryable = error instanceof NodeExecutionError ? error.retryable : false
          if (policy.kind === "retry" && retryable && usedBefore() < maxAttempts) {
            args.attempts.recordAttemptOutcome(token, nodeId, attempt.attemptId, "FAILED", { result: { error: message } })
            args.attempts.authorizeRetry(token, effectKey)
            continue
          }
          if (policy.kind === "ignore") {
            // Known failure ignored: terminate the attempt as FAILED first so
            // the graph and the effect machine never disagree (no PENDING orphan).
            try {
              args.attempts.recordAttemptOutcome(token, nodeId, attempt.attemptId, "FAILED", { result: { error: message, ignored: true } })
            } catch {
              // Best effort, never masks the failure.
            }
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
