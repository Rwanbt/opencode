/* SPDX-License-Identifier: MIT */
/* Copyright (c) 2026 Unifia contributors */

/**
 * M3-TEST — crash matrix integration tests (Plan V2.3.1 §201).
 *
 * 10 positions per plan §201, each a moment the orchestrator may
 * crash mid-execution. The contract per position is an invariant:
 * "if a crash happens here, the post-recovery state must satisfy P".
 * The runtime enforces P; the schema encodes the data structures
 * the runtime uses to detect P; this test asserts those structures
 * parse, the family-specific parsers accept the opaque config, and
 * the static graph validator agrees the workflow is well-formed.
 *
 * This is **not** an end-to-end crash test (the kernel is blocked
 * on ADR-000 per M3 plan §2.2). It is a property test on the
 * schemas. The runtime half stays uncovered, on purpose, and is
 * not claimed as passing.
 */
import { describe, expect, test } from "bun:test"
import {
  WorkflowDefinitionSchema,
  NodeSchema,
  parseEffectNodeConfig,
  parseEffectNodeConfigWithReconciliation,
  parseRetryPolicy,
  parseWaitConfig,
  parseCompensationBinding,
  resolveWaitDurationMs,
  type WorkflowDefinition,
  type Node,
  type Edge,
} from "../src/workflow-ir.ts"
import { validateWorkflowGraph } from "../src/workflow-graph.ts"

/* ------------------------------------------------------------------ */
/* Fixtures                                                            */
/* ------------------------------------------------------------------ */

const SCOPE = { organizationId: "org-crash-matrix", workspaceId: "ws-crash-matrix" }

function buildDefinition(
  nodes: readonly Node[],
  edges: readonly Edge[],
): WorkflowDefinition {
  return {
    definitionId: "def-crash-matrix",
    ownershipScope: SCOPE,
    displayName: "crash matrix fixture",
    nodes,
    edges,
    concurrency: { kind: "none" },
    defaultFailurePolicy: { kind: "propagate" },
    defaultTimeoutMs: 60_000,
    createdAt: 1_700_000_000_000,
    updatedAt: 1_700_000_000_000,
  }
}

const trigger = (id = "n-trigger"): Node => ({ id, family: "trigger.manual", config: {} })
const httpNode = (id: string, config: Record<string, unknown> = {}): Node => ({
  id,
  family: "tool.http",
  config,
})
const waitNode = (id: string, config: Record<string, unknown>): Node => ({
  id,
  family: "wait",
  config,
})
const approvalNode = (id: string, config: Record<string, unknown> = {}): Node => ({
  id,
  family: "human.approval",
  config,
})
const edge = (from: string, to: string, kind: Edge["kind"] = "flow"): Edge => ({
  from,
  to,
  kind,
})

/** Parse at the IR level and run the static graph validator. */
function assertStaticContract(definition: WorkflowDefinition): void {
  const parsed = WorkflowDefinitionSchema.parse(definition)
  expect(parsed.nodes.length).toBeGreaterThan(0)
  const result = validateWorkflowGraph(parsed)
  expect(result.errors).toEqual([])
}

/* ------------------------------------------------------------------ */
/* Position 1 — before durable transition                              */
/* Invariant: post-recovery state equals pre-run state. The IR       */
/* encodes this as "effect node has no `transitionedAt` field".       */
/* ------------------------------------------------------------------ */

describe("crash matrix — position 1: before durable transition", () => {
  test("P1: bare effect (no transitionedAt) parses + validates", () => {
    const definition = buildDefinition(
      [trigger(), httpNode("n-call", { method: "POST" })],
      [edge("n-trigger", "n-call")],
    )
    assertStaticContract(definition)
    const callNode = definition.nodes.find((n) => n.id === "n-call")
    expect(callNode).toBeDefined()
    expect((callNode as Node).config).not.toHaveProperty("transitionedAt")
  })

  test("P1: pre-transition NodeSchema accepts effect node with empty config", () => {
    const result = NodeSchema.safeParse({
      id: "n-pre",
      family: "tool.http",
      config: {},
    })
    expect(result.success).toBe(true)
  })
})

/* ------------------------------------------------------------------ */
/* Position 2 — after durable transition                               */
/* Invariant: replay re-derives the same decision. The IR encodes    */
/* the post-transition shape as opaque extra fields on the effect    */
/* node's `config` (the schema is permissive on the runtime side).    */
/* ------------------------------------------------------------------ */

describe("crash matrix — position 2: after durable transition", () => {
  test("P2: effect with runtime-written transitionedAt + effectKey still parses at IR level", () => {
    const definition = buildDefinition(
      [
        trigger(),
        httpNode("n-call", {
          method: "POST",
          transitionedAt: 1_700_000_000_500,
          effectKey: "sha256:abcd",
        }),
      ],
      [edge("n-trigger", "n-call")],
    )
    assertStaticContract(definition)
    const parsed = WorkflowDefinitionSchema.parse(definition)
    const callNode = parsed.nodes.find((n) => n.id === "n-call")
    expect(callNode).toBeDefined()
    expect((callNode as Node).config.transitionedAt).toBe(1_700_000_000_500)
  })

  test("P2: replay reproduces the same IR after re-parse (deterministic shape)", () => {
    const postTransition = {
      method: "POST",
      transitionedAt: 1_700_000_000_500,
      effectKey: "sha256:abcd",
    }
    const a = buildDefinition(
      [trigger(), httpNode("n-call", postTransition)],
      [edge("n-trigger", "n-call")],
    )
    const b = buildDefinition(
      [trigger(), httpNode("n-call", { ...postTransition })],
      [edge("n-trigger", "n-call")],
    )
    expect(WorkflowDefinitionSchema.parse(a).nodes).toEqual(
      WorkflowDefinitionSchema.parse(b).nodes,
    )
  })
})

/* ------------------------------------------------------------------ */
/* Position 3 — before side effect                                     */
/* Invariant: the effect may be re-sent with the same idempotency   */
/* key. The IR encodes this as `EffectNodeConfig` with PROVIDER key. */
/* ------------------------------------------------------------------ */

describe("crash matrix — position 3: before side effect", () => {
  test("P3: PROVIDER-keyed effect config parses; re-send shape is valid", () => {
    const effectConfig = { idempotency: "PROVIDER", idempotencyKey: "stripe-charge-abc-123" }
    const parsedEffect = parseEffectNodeConfig(effectConfig)
    expect(parsedEffect.idempotency).toBe("PROVIDER")
    expect(parsedEffect.idempotencyKey).toBe("stripe-charge-abc-123")

    const definition = buildDefinition(
      [
        trigger(),
        httpNode("n-charge", {
          method: "POST",
          url: "https://api.stripe.com/v1/charges",
          ...effectConfig,
        }),
      ],
      [edge("n-trigger", "n-charge")],
    )
    assertStaticContract(definition)
  })

  test("P3: BUSINESS-keyed effect has no key; re-send relies on natural idempotence", () => {
    const parsedEffect = parseEffectNodeConfig({ idempotency: "BUSINESS" })
    expect(parsedEffect.idempotency).toBe("BUSINESS")
    expect(parsedEffect.idempotencyKey).toBeUndefined()
  })
})

/* ------------------------------------------------------------------ */
/* Position 4 — during side effect                                     */
/* Invariant: real-world outcome is unknown; runtime marks it        */
/* `UNKNOWN_EXTERNAL_STATE`. The IR encodes the action to take as    */
/* `UnknownExternalStateAction` via `EffectNodeConfigWith...`.       */
/* ------------------------------------------------------------------ */

describe("crash matrix — position 4: during side effect", () => {
  test("P4: BUSINESS + RECONCILE_REPLAY is allowed (the effect is safe to replay)", () => {
    const config = {
      effect: { idempotency: "BUSINESS" },
      reconciliation: {
        probeExpression: "GET /v1/orders/${id}",
        expectedResult: "present" as const,
        failOn: "any_mismatch" as const,
      },
      onUnknown: "RECONCILE_REPLAY" as const,
    }
    const parsed = parseEffectNodeConfigWithReconciliation(config)
    expect(parsed.effect.idempotency).toBe("BUSINESS")
    expect(parsed.onUnknown).toBe("RECONCILE_REPLAY")

    const definition = buildDefinition(
      [
        trigger(),
        httpNode("n-order", {
          method: "POST",
          url: "https://api.example.com/orders",
          effect: config.effect,
          reconciliation: config.reconciliation,
          onUnknown: config.onUnknown,
        }),
      ],
      [edge("n-trigger", "n-order")],
    )
    assertStaticContract(definition)
  })

  test("P4: NONE + RECONCILE_PROBE is allowed (read-only probe on a non-idempotent effect)", () => {
    const config = {
      effect: { idempotency: "NONE" },
      reconciliation: {
        probeExpression: "GET /v1/foo",
        expectedResult: "absent" as const,
        failOn: "unexpected_present" as const,
      },
      onUnknown: "RECONCILE_PROBE" as const,
    }
    const parsed = parseEffectNodeConfigWithReconciliation(config)
    expect(parsed.effect.idempotency).toBe("NONE")
    expect(parsed.onUnknown).toBe("RECONCILE_PROBE")
  })
})

/* ------------------------------------------------------------------ */
/* Position 5 — after remote success before acknowledgement            */
/* Invariant: replay re-derives and re-sends; the provider's         */
/* idempotency layer de-dupes. The contract guarantees both the       */
/* PROVIDER-keyed idempotency config AND the runtime's                */
/* `transitionedAt`-shaped write parse on the same opaque record.    */
/* ------------------------------------------------------------------ */

describe("crash matrix — position 5: after remote success before acknowledgement", () => {
  test("P5: PROVIDER-keyed effect with a runtime-written success marker still parses", () => {
    const effectConfig = {
      idempotency: "PROVIDER",
      idempotencyKey: "sendgrid-send-msg-42",
    }
    const parsedEffect = parseEffectNodeConfig(effectConfig)
    expect(parsedEffect.idempotency).toBe("PROVIDER")

    // The post-success shape the runtime writes: the effect
    // config plus `successAt` (the acknowledgement the runtime
    // has not yet committed). The IR keeps `config` opaque, so
    // the runtime is free to add keys.
    const definition = buildDefinition(
      [
        trigger(),
        httpNode("n-send", {
          method: "POST",
          url: "https://api.sendgrid.com/v3/mail/send",
          ...effectConfig,
          successAt: 1_700_000_001_000,
          providerMessageId: "msg-42",
        }),
      ],
      [edge("n-trigger", "n-send")],
    )
    assertStaticContract(definition)

    // The family-specific config (sans the runtime fields)
    // still parses independently — the contract keeps both
    // parse surfaces independent.
    const opaque = (definition.nodes[1] as Node).config
    const { successAt: _sa, providerMessageId: _pmid, ...effectOnly } = opaque
    expect(() => parseEffectNodeConfig(effectOnly)).not.toThrow()
  })
})

/* ------------------------------------------------------------------ */
/* Position 6 — during approval                                        */
/* Invariant: the approval is recoverable. A `human.approval` node  */
/* carries the same opaque effect config shape as `tool.http`         */
/* (BUSINESS-class effect: human clicks are the side effect).         */
/* ------------------------------------------------------------------ */

describe("crash matrix — position 6: during approval", () => {
  test("P6: human.approval with BUSINESS-keyed effect + on-failure fallback edge", () => {
    const effectConfig = parseEffectNodeConfig({ idempotency: "BUSINESS" })
    expect(effectConfig.idempotency).toBe("BUSINESS")

    const definition = buildDefinition(
      [
        trigger(),
        approvalNode("n-approve", { approver: "ops@example.com", ...effectConfig }),
        httpNode("n-deploy", { method: "POST" }),
        httpNode("n-reject", { method: "POST" }),
      ],
      [
        edge("n-trigger", "n-approve"),
        edge("n-approve", "n-deploy", "flow"),
        edge("n-approve", "n-reject", "on-failure"),
      ],
    )
    assertStaticContract(definition)
  })
})

/* ------------------------------------------------------------------ */
/* Position 7 — during timer                                           */
/* Invariant: the timer is rescheduled from the durable log. The IR  */
/* encodes the wait as `WaitConfig`; the runtime's scheduler uses    */
/* `resolveWaitDurationMs` to compute the fire time.                  */
/* ------------------------------------------------------------------ */

describe("crash matrix — position 7: during timer", () => {
  test("P7: wait node with ms-unit WaitConfig parses + resolves to the same duration", () => {
    const waitConfig = parseWaitConfig({ duration: 30_000, unit: "ms" })
    expect(waitConfig.unit).toBe("ms")
    expect(waitConfig.jitterRatio).toBe(0.1)
    expect(resolveWaitDurationMs(waitConfig)).toBe(30_000)

    const definition = buildDefinition(
      [
        trigger(),
        httpNode("n-call", { method: "POST" }),
        waitNode("n-wait", { duration: 30_000, unit: "ms" }),
        httpNode("n-call-2", { method: "POST" }),
      ],
      [
        edge("n-trigger", "n-call"),
        edge("n-call", "n-wait"),
        edge("n-wait", "n-call-2"),
      ],
    )
    assertStaticContract(definition)
  })

  test("P7: wait node with min-unit WaitConfig parses + resolves to ms", () => {
    const waitConfig = parseWaitConfig({ duration: 5, unit: "min" })
    expect(resolveWaitDurationMs(waitConfig)).toBe(5 * 60_000)

    const definition = buildDefinition(
      [
        trigger(),
        waitNode("n-wait", { duration: 5, unit: "min" }),
        httpNode("n-after", { method: "POST" }),
      ],
      [edge("n-trigger", "n-wait"), edge("n-wait", "n-after")],
    )
    assertStaticContract(definition)
  })
})

/* ------------------------------------------------------------------ */
/* Position 8 — during retry                                           */
/* Invariant: the retry counter is persisted; the resumed run picks  */
/* up at the next attempt without double-counting. Cross-reference:  */
/* a retry timer is a `wait` shape at the runtime level.             */
/* ------------------------------------------------------------------ */

describe("crash matrix — position 8: during retry", () => {
  test("P8: effect with RetryPolicy (exponential + jitter) parses", () => {
    const retry = parseRetryPolicy({
      kind: "exponential",
      maxAttempts: 5,
      backoffMs: 500,
      jitterRatio: 0.5,
    })
    expect(retry.kind).toBe("exponential")
    expect(retry.maxAttempts).toBe(5)

    const definition = buildDefinition(
      [
        trigger(),
        httpNode("n-call", {
          method: "POST",
          idempotency: "PROVIDER",
          idempotencyKey: "retry-key-1",
          retry,
        }),
      ],
      [edge("n-trigger", "n-call")],
    )
    assertStaticContract(definition)
  })

  test("P8: retry-with-wait cross-reference — WaitConfig + RetryPolicy both parse", () => {
    // A retry delay between attempts is `wait`-shaped at the
    // runtime level. The contract is independent: a node can
    // carry both a `RetryPolicy` (governing the backoff) and
    // a `WaitConfig` (governing an explicit wait before the
    // effect fires). They are validated separately, both
    // accepted on the same opaque `config` record.
    const retry = parseRetryPolicy({
      kind: "decorrelated-jitter",
      maxAttempts: 3,
      backoffMs: 100,
      maxBackoffMs: 5_000,
    })
    const wait = parseWaitConfig({ duration: 2, unit: "s" })
    expect(retry.maxBackoffMs).toBe(5_000)
    expect(wait.unit).toBe("s")

    const definition = buildDefinition(
      [
        trigger(),
        waitNode("n-wait", { duration: 2, unit: "s" }),
        httpNode("n-call", { method: "POST", retry }),
      ],
      [edge("n-trigger", "n-wait"), edge("n-wait", "n-call")],
    )
    assertStaticContract(definition)
  })
})

/* ------------------------------------------------------------------ */
/* Position 9 — during cancellation                                    */
/* Invariant: the cancellation state is persisted; the resumed run  */
/* continues the cleanup. Cross-reference: cancellation triggers a  */
/* Saga — `CompensationBinding` pairs forward + compensation nodes. */
/* ------------------------------------------------------------------ */

describe("crash matrix — position 9: during cancellation", () => {
  test("P9: saga binding parses + forward+compensation nodes resolve in the graph", () => {
    const binding = parseCompensationBinding({
      forwardNode: "n-charge",
      compensationNode: "n-refund",
      description: "refund the Stripe charge",
    })
    expect(binding.forwardNode).toBe("n-charge")
    expect(binding.compensationNode).toBe("n-refund")

    const definition = buildDefinition(
      [
        trigger(),
        httpNode("n-charge", {
          method: "POST",
          idempotency: "PROVIDER",
          idempotencyKey: "ch-1",
        }),
        httpNode("n-send", { method: "POST", idempotency: "BUSINESS" }),
        httpNode("n-refund", {
          method: "POST",
          idempotency: "PROVIDER",
          idempotencyKey: "rf-1",
        }),
      ],
      [edge("n-trigger", "n-charge"), edge("n-charge", "n-send")],
    )
    assertStaticContract(definition)
    const allIds = new Set(definition.nodes.map((n) => n.id))
    expect(allIds.has(binding.forwardNode)).toBe(true)
    expect(allIds.has(binding.compensationNode)).toBe(true)
  })

  test("P9: cascading saga (3 forward + 3 compensation) — bindings + on-failure edges parse", () => {
    const bindings = [
      parseCompensationBinding({ forwardNode: "n-a", compensationNode: "n-a-comp" }),
      parseCompensationBinding({ forwardNode: "n-b", compensationNode: "n-b-comp" }),
      parseCompensationBinding({ forwardNode: "n-c", compensationNode: "n-c-comp" }),
    ]
    expect(bindings).toHaveLength(3)

    // In a Saga, the compensation node is reached via the
    // forward's failure path (`on-failure` edge). Wiring the
    // compensation nodes through `on-failure` keeps the static
    // graph well-formed while the runtime uses the binding to
    // pick the *order* (reverse of execution) of compensations.
    const definition = buildDefinition(
      [
        trigger(),
        httpNode("n-a", { method: "POST" }),
        httpNode("n-b", { method: "POST" }),
        httpNode("n-c", { method: "POST" }),
        httpNode("n-a-comp", { method: "POST" }),
        httpNode("n-b-comp", { method: "POST" }),
        httpNode("n-c-comp", { method: "POST" }),
      ],
      [
        edge("n-trigger", "n-a"),
        edge("n-a", "n-b"),
        edge("n-b", "n-c"),
        edge("n-a", "n-a-comp", "on-failure"),
        edge("n-b", "n-b-comp", "on-failure"),
        edge("n-c", "n-c-comp", "on-failure"),
      ],
    )
    assertStaticContract(definition)
  })
})

/* ------------------------------------------------------------------ */
/* Position 10 — during shutdown                                       */
/* Invariant: all in-flight state is durably persisted. The          */
/* schema-level encoding: a workflow with a `wait` in flight AND a   */
/* side effect dispatched parses as a single IR document. On         */
/* recovery, the runtime walks the durable log and resumes both.     */
/* ------------------------------------------------------------------ */

describe("crash matrix — position 10: during shutdown", () => {
  test("P10: in-flight wait + in-flight effect (both mid-execution) parse as a single IR", () => {
    const waitConfig = parseWaitConfig({ duration: 60, unit: "s" })
    const effectConfig = parseEffectNodeConfig({
      idempotency: "PROVIDER",
      idempotencyKey: "shutdown-key-1",
    })
    const retry = parseRetryPolicy({ kind: "fixed", maxAttempts: 3, backoffMs: 1_000 })

    expect(waitConfig.unit).toBe("s")
    expect(effectConfig.idempotency).toBe("PROVIDER")
    expect(retry.kind).toBe("fixed")

    const definition = buildDefinition(
      [
        trigger(),
        waitNode("n-wait", { duration: 60, unit: "s" }),
        httpNode("n-effect", {
          method: "POST",
          ...effectConfig,
          retry,
        }),
      ],
      [edge("n-trigger", "n-wait"), edge("n-wait", "n-effect")],
    )
    assertStaticContract(definition)
  })

  test("P10: shutdown with in-flight approval + wait (longest in-flight path)", () => {
    const definition = buildDefinition(
      [
        trigger(),
        approvalNode("n-approve", { idempotency: "BUSINESS" }),
        waitNode("n-wait", { duration: 10, unit: "min" }),
        httpNode("n-final", {
          method: "POST",
          idempotency: "PROVIDER",
          idempotencyKey: "final-1",
        }),
      ],
      [
        edge("n-trigger", "n-approve"),
        edge("n-approve", "n-wait"),
        edge("n-wait", "n-final"),
      ],
    )
    assertStaticContract(definition)
  })
})
