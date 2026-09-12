/**
 * multi-model/model-invoker.ts — TEAM-B03
 *
 * Unified model invocation layer: InvocationRequest → InvocationResult,
 * with cancellation (AbortSignal), configurable timeout, optional retry,
 * and streaming support.
 *
 * This module never talks to a provider directly — callers inject a
 * `ModelExecutor` (and optionally a `ModelStreamExecutor`) that performs the
 * actual network call. ModelInvoker owns only the invocation *contract*:
 * timing, cancellation wiring, retry/backoff, and error normalization into
 * B01's ModelInvocationError taxonomy. This keeps the module network-free
 * and deterministically testable with fake executors.
 *
 * Availability: this module optionally consumes B02's
 * `discoverAvailableProviders` to verify a requested model is reachable
 * before invoking it. The check is opt-in (`availabilityCheck`); when
 * enabled with `explicitParticipants` it never touches real providers,
 * env vars, credential files, or CLI subprocesses — it takes discovery's
 * own explicit short-circuit branch (see provider-discovery.ts), which is
 * what keeps this module's tests network-free too.
 *
 * Hard constraints (B03 scope manifest):
 *   - Never imports packages/unifia/src/team/** (frozen).
 *   - Never imports packages/unifia/src/collective/** (frozen).
 *   - Never imports packages/unifia/src/model-intelligence/** (frozen).
 *   - Consumes InvocationRequest/InvocationResult/TokenUsage/FinishReason/
 *     ModelInvocationError from ./types (B01) — never redefined here.
 *   - Consumes discoverAvailableProviders from ./provider-discovery (B02)
 *     — never modified, never re-implemented.
 */

import { Effect } from "effect"
import { errorMessage } from "../util/error"
import {
  ModelInvocationError,
  type FinishReason,
  type InvocationRequest,
  type InvocationResult,
  type ModelInvocationErrorData,
  type ModelRef,
  type TokenUsage,
} from "./types"
import { discoverAvailableProviders, type ExplicitParticipant } from "./provider-discovery"

// ---------------------------------------------------------------------------
// Executor contracts (injected — this module never calls a real provider)
// ---------------------------------------------------------------------------

export interface ExecutorResult<Output = unknown> {
  readonly output: Output
  readonly usage: TokenUsage
  readonly finishReason: FinishReason
  readonly providerRequestId?: string
}

export type ModelExecutor<Input = unknown, Output = unknown> = (
  request: InvocationRequest<Input>,
  signal: AbortSignal,
) => Promise<ExecutorResult<Output>>

export interface StreamChunk<Output = unknown> {
  readonly delta: Output
  readonly usage?: Partial<TokenUsage>
}

export type ModelStreamExecutor<Input = unknown, Output = unknown> = (
  request: InvocationRequest<Input>,
  signal: AbortSignal,
) => AsyncIterable<StreamChunk<Output>>

/** Reduces accumulated stream chunks into the final executor-shaped result. */
export type StreamAggregator<Output = unknown> = (chunks: ReadonlyArray<StreamChunk<Output>>) => ExecutorResult<Output>

// ---------------------------------------------------------------------------
// Retry policy
// ---------------------------------------------------------------------------

export interface RetryPolicy {
  /** Total attempts including the first (>=1). 1 = no retry. */
  readonly maxAttempts: number
  readonly baseDelayMs?: number
  readonly maxDelayMs?: number
  readonly backoffFactor?: number
  readonly isRetryable?: (error: unknown) => boolean
}

const DEFAULT_RETRY_BASE_DELAY_MS = 200
const DEFAULT_RETRY_MAX_DELAY_MS = 5_000
const DEFAULT_RETRY_BACKOFF_FACTOR = 2

/**
 * Error codes considered transient by default (worth retrying without an
 * explicit opt-in). E_CANCELLED is deliberately excluded — a caller-driven
 * cancellation must never be retried.
 */
const RETRYABLE_CODES = new Set<ModelInvocationErrorData["code"]>(["E_TIMEOUT", "E_RATE_LIMIT", "E_UNAVAILABLE"])

function defaultIsRetryable(error: unknown): boolean {
  if (!(error instanceof ModelInvocationError)) return false
  return RETRYABLE_CODES.has(error.data.code)
}

type ResolvedRetryPolicy = {
  maxAttempts: number
  baseDelayMs: number
  maxDelayMs: number
  backoffFactor: number
  isRetryable: (error: unknown) => boolean
}

function resolveRetryPolicy(policy: RetryPolicy | undefined): ResolvedRetryPolicy {
  return {
    maxAttempts: Math.max(1, policy?.maxAttempts ?? 1),
    baseDelayMs: policy?.baseDelayMs ?? DEFAULT_RETRY_BASE_DELAY_MS,
    maxDelayMs: policy?.maxDelayMs ?? DEFAULT_RETRY_MAX_DELAY_MS,
    backoffFactor: policy?.backoffFactor ?? DEFAULT_RETRY_BACKOFF_FACTOR,
    isRetryable: policy?.isRetryable ?? defaultIsRetryable,
  }
}

function backoffDelayMs(attempt: number, policy: ResolvedRetryPolicy): number {
  const raw = policy.baseDelayMs * Math.pow(policy.backoffFactor, attempt - 1)
  return Math.min(raw, policy.maxDelayMs)
}

// ---------------------------------------------------------------------------
// Abortable delay (used for retry backoff — a cancel during backoff must
// stop retrying immediately rather than sleeping it out)
// ---------------------------------------------------------------------------

class AbortedDelayError extends Error {
  constructor() {
    super("delay aborted")
    this.name = "AbortedDelayError"
  }
}

function delay(ms: number, signal?: AbortSignal): Promise<void> {
  if (ms <= 0) return Promise.resolve()
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new AbortedDelayError())
      return
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort)
      resolve()
    }, ms)
    function onAbort() {
      clearTimeout(timer)
      reject(new AbortedDelayError())
    }
    signal?.addEventListener("abort", onAbort, { once: true })
  })
}

// ---------------------------------------------------------------------------
// Public option shapes
// ---------------------------------------------------------------------------

export interface InvokeOptions {
  readonly signal?: AbortSignal
  readonly timeoutMs?: number
  readonly retry?: RetryPolicy
}

export interface AvailabilityCheckOptions {
  readonly enabled: boolean
  readonly explicitParticipants?: ExplicitParticipant[]
}

export interface ModelInvokerConfig<Input = unknown, Output = unknown> {
  readonly executor: ModelExecutor<Input, Output>
  readonly streamExecutor?: ModelStreamExecutor<Input, Output>
  readonly defaultTimeoutMs?: number
  readonly defaultRetry?: RetryPolicy
  readonly availabilityCheck?: AvailabilityCheckOptions
}

export interface ModelInvoker<Input = unknown, Output = unknown> {
  invoke(request: InvocationRequest<Input>, options?: InvokeOptions): Promise<InvocationResult<Output>>
  invokeStream(
    request: InvocationRequest<Input>,
    aggregate: StreamAggregator<Output>,
    options?: InvokeOptions,
  ): AsyncGenerator<StreamChunk<Output>, InvocationResult<Output>, void>
}

// ---------------------------------------------------------------------------
// Cancellation/timeout wiring (per attempt)
// ---------------------------------------------------------------------------

interface AttemptAbort {
  readonly controller: AbortController
  timedOut: boolean
  readonly cleanup: () => void
}

function setupAttemptAbort(externalSignal: AbortSignal | undefined, timeoutMs: number | undefined): AttemptAbort {
  const controller = new AbortController()
  const cleanups: Array<() => void> = []
  const state: AttemptAbort = {
    controller,
    timedOut: false,
    cleanup: () => {
      for (const fn of cleanups) fn()
    },
  }

  if (externalSignal) {
    if (externalSignal.aborted) {
      controller.abort(externalSignal.reason)
    } else {
      const onExternalAbort = () => controller.abort(externalSignal.reason)
      externalSignal.addEventListener("abort", onExternalAbort, { once: true })
      cleanups.push(() => externalSignal.removeEventListener("abort", onExternalAbort))
    }
  }

  if (timeoutMs !== undefined && !controller.signal.aborted) {
    const timer = setTimeout(() => {
      state.timedOut = true
      controller.abort(new Error("invocation timeout"))
    }, timeoutMs)
    cleanups.push(() => clearTimeout(timer))
  }

  return state
}

function normalizeInvocationError(
  err: unknown,
  model: ModelRef,
  timedOut: boolean,
  externalSignal: AbortSignal | undefined,
): InstanceType<typeof ModelInvocationError> {
  if (err instanceof ModelInvocationError) return err
  if (timedOut) {
    return new ModelInvocationError({
      code: "E_TIMEOUT",
      message: "invocation timed out",
      model,
      issue: errorMessage(err),
    })
  }
  if (externalSignal?.aborted) {
    return new ModelInvocationError({
      code: "E_CANCELLED",
      message: "invocation cancelled by caller",
      model,
      issue: errorMessage(err),
    })
  }
  return new ModelInvocationError({
    code: "E_INTERNAL",
    message: "executor threw an unexpected error",
    model,
    issue: errorMessage(err),
  })
}

// ---------------------------------------------------------------------------
// Availability check (opt-in, consumes B02 discoverAvailableProviders)
// ---------------------------------------------------------------------------

async function checkAvailability(model: ModelRef, options: AvailabilityCheckOptions | undefined): Promise<void> {
  if (!options?.enabled) return

  const exit = await Effect.runPromiseExit(discoverAvailableProviders(options.explicitParticipants))
  if (exit._tag === "Failure") {
    throw new ModelInvocationError({
      code: "E_UNAVAILABLE",
      message: "provider discovery failed while checking model availability",
      model,
    })
  }

  const found = exit.value.providers.some(
    (p) => p.model.providerID === model.providerID && p.model.modelID === model.modelID,
  )
  if (!found) {
    throw new ModelInvocationError({
      code: "E_UNAVAILABLE",
      message: `model ${model.providerID}:${model.modelID} not present in discovered providers`,
      model,
    })
  }
}

// ---------------------------------------------------------------------------
// Single-attempt execution
// ---------------------------------------------------------------------------

async function runExecutorAttempt<Input, Output>(
  executor: ModelExecutor<Input, Output>,
  request: InvocationRequest<Input>,
  externalSignal: AbortSignal | undefined,
  timeoutMs: number | undefined,
): Promise<InvocationResult<Output>> {
  const abort = setupAttemptAbort(externalSignal, timeoutMs)

  if (abort.controller.signal.aborted) {
    abort.cleanup()
    throw normalizeInvocationError(
      new Error("aborted before invocation started"),
      request.model,
      abort.timedOut,
      externalSignal,
    )
  }

  const started = performance.now()
  try {
    const raw = await executor(request, abort.controller.signal)
    const latencyMs = performance.now() - started
    return {
      requestId: request.requestId,
      model: request.model,
      output: raw.output,
      usage: raw.usage,
      latencyMs,
      finishReason: raw.finishReason,
      ...(raw.providerRequestId !== undefined ? { providerRequestId: raw.providerRequestId } : {}),
    }
  } catch (err) {
    throw normalizeInvocationError(err, request.model, abort.timedOut, externalSignal)
  } finally {
    abort.cleanup()
  }
}

// ---------------------------------------------------------------------------
// invoke() — with retry/backoff
// ---------------------------------------------------------------------------

async function invokeWithRetry<Input, Output>(
  config: ModelInvokerConfig<Input, Output>,
  request: InvocationRequest<Input>,
  options: InvokeOptions,
): Promise<InvocationResult<Output>> {
  await checkAvailability(request.model, config.availabilityCheck)

  const retry = resolveRetryPolicy(options.retry ?? config.defaultRetry)
  const timeoutMs = options.timeoutMs ?? request.options?.timeoutMs ?? config.defaultTimeoutMs

  let attempt = 0
  let lastError: unknown
  while (attempt < retry.maxAttempts) {
    attempt++
    try {
      return await runExecutorAttempt(config.executor, request, options.signal, timeoutMs)
    } catch (err) {
      lastError = err
      const willRetry = attempt < retry.maxAttempts && retry.isRetryable(err)
      if (!willRetry) throw err
      try {
        await delay(backoffDelayMs(attempt, retry), options.signal)
      } catch {
        throw normalizeInvocationError(err, request.model, false, options.signal)
      }
    }
  }
  throw lastError
}

// ---------------------------------------------------------------------------
// invokeStream() — no retry (streaming attempts are not safely replayable
// without provider-specific dedup semantics; out of scope for B03)
// ---------------------------------------------------------------------------

async function* invokeStreamImpl<Input, Output>(
  config: ModelInvokerConfig<Input, Output>,
  request: InvocationRequest<Input>,
  aggregate: StreamAggregator<Output>,
  options: InvokeOptions,
): AsyncGenerator<StreamChunk<Output>, InvocationResult<Output>, void> {
  if (!config.streamExecutor) {
    throw new ModelInvocationError({
      code: "E_UNAVAILABLE",
      message: "this invoker was not configured with a streaming executor",
      model: request.model,
    })
  }

  await checkAvailability(request.model, config.availabilityCheck)

  const timeoutMs = options.timeoutMs ?? request.options?.timeoutMs ?? config.defaultTimeoutMs
  const abort = setupAttemptAbort(options.signal, timeoutMs)
  const started = performance.now()
  const chunks: StreamChunk<Output>[] = []

  try {
    for await (const chunk of config.streamExecutor(request, abort.controller.signal)) {
      chunks.push(chunk)
      yield chunk
    }
  } catch (err) {
    throw normalizeInvocationError(err, request.model, abort.timedOut, options.signal)
  } finally {
    abort.cleanup()
  }

  const executed = aggregate(chunks)
  const latencyMs = performance.now() - started
  return {
    requestId: request.requestId,
    model: request.model,
    output: executed.output,
    usage: executed.usage,
    latencyMs,
    finishReason: executed.finishReason,
    ...(executed.providerRequestId !== undefined ? { providerRequestId: executed.providerRequestId } : {}),
  }
}

// ---------------------------------------------------------------------------
// Public factory
// ---------------------------------------------------------------------------

/**
 * Build a ModelInvoker around an injected executor (and optional streaming
 * executor). See module doc for the availability-check and retry/timeout
 * semantics.
 */
export function createModelInvoker<Input = unknown, Output = unknown>(
  config: ModelInvokerConfig<Input, Output>,
): ModelInvoker<Input, Output> {
  return {
    invoke: (request, options = {}) => invokeWithRetry(config, request, options),
    invokeStream: (request, aggregate, options = {}) => invokeStreamImpl(config, request, aggregate, options),
  }
}
