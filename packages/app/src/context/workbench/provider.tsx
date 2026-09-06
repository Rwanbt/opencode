/* SPDX-License-Identifier: MIT */

import { createSimpleContext } from "@unifia/ui/context"
import { SURFACE_LEASE_CAPABILITIES, WorkbenchEventDispatcher, createWorkbenchTaskIdentity, WorkbenchLifecycle, type WorkbenchConnection, type WorkbenchLifecyclePhase, type WorkbenchTaskIdentity } from "@unifia/workbench-shell"
import { useQueryClient } from "@tanstack/solid-query"
import { createMemo, createSignal, onCleanup, type ParentProps } from "solid-js"
import { useLanguage } from "@/context/language"
import { usePlatform } from "@/context/platform"
import { decideEventRetry } from "./event-retry"
import { createCoalescedInvalidate } from "./query-invalidation"

let activeEventStreams = 0

// DA-UI-01 — frozen empty set used as the fallback before the
// `connection` signal resolves. Sharing one reference across calls
// means the rail's `grants.has("workflow.run")` returns `false` with
// a stable identity, and any code wrapping it in a memo can memoize
// safely without false invalidation on each render.
const EMPTY_GRANTS: ReadonlySet<string> = new Set<string>()

export function getWorkbenchListenerCount(): number {
  return activeEventStreams
}

/** Delay before reconnecting after the stream closes cleanly (not an error, so decideEventRetry's backoff does not apply). */
const EVENT_RECONNECT_DELAY_MS = 1_000

// V03 — UI state machine derived from the lifecycle phase. Distinct from
// `WorkbenchLifecyclePhase` (which describes an *attempt* inside the
// lifecycle) and from `loading` (which is a transient flag). `unsupported`
// is a *terminal* state: the bridge is absent from this runtime, no
// attempt can ever succeed, the UI must not offer a retry. `retrying` is
// a *transient* lock: an explicit `retryConnection` is in flight, the UI
// must not allow a second click while it runs.
export type WorkbenchUiPhase = "unsupported" | "connecting" | "ready" | "failed" | "retrying"

const { use, provider: WorkbenchContextProvider } = createSimpleContext({
  name: "WorkspaceWorkbench",
  init: (props: { workspacePath: string; codeSessionId?: string }) => {
    const platform = usePlatform()
    const queryClient = useQueryClient()
    const language = useLanguage()
    const t = language.t
    const lifecycle = new WorkbenchLifecycle()
    const [connection, setConnection] = createSignal<WorkbenchConnection>()
    const [phase, setPhase] = createSignal<WorkbenchLifecyclePhase>("initializing")
    const [error, setError] = createSignal<unknown>()
    // V03 — `unsupported` is fixed at init: the platform either exposes a
    // native bridge or it does not. Reading it once here keeps the
    // UI-phase derivation stable for the lifetime of the provider and
    // prevents the loop the audit caught (each `ensureConnected` call
    // re-set `failed`, the banner flipped back to "Reconnecter", the user
    // clicked it, the loop restarted). The `unsupported` and
    // `bridgeError` accessors are functions so the UI-phase derivation
    // keeps a uniform call shape (`x()` instead of `x ?? x()`).
    const bridgeUnavailable = !platform.workbench
    const bridgeErrorValue: Error | undefined = bridgeUnavailable ? new Error(t("workbench.errors.bridgeUnavailable")) : undefined
    const unsupported = (): boolean => bridgeUnavailable
    const bridgeError = (): Error | undefined => bridgeErrorValue
    const [retrying, setRetrying] = createSignal(false)
    let pending: Promise<WorkbenchConnection> | undefined
    let providerGeneration = 0
    let eventsAbort = new AbortController()
    let eventsTask: Promise<void> | undefined
    // E14: one coalescer per provider instance. The window (50 ms by
    // default) collapses bursts of identical events into a single
    // invalidation batch, satisfying the E14 oracle
    // « 100 événements identiques produisent un fetch utile ».
    const coalesced = createCoalescedInvalidate(queryClient)
    const [identity, setIdentity] = createSignal<WorkbenchTaskIdentity>(createWorkbenchTaskIdentity({ codeSessionId: props.codeSessionId, workbenchSessionId: crypto.randomUUID() }))

    const unsubscribe = lifecycle.subscribe((state) => {
      setPhase(state.phase)
      if (state.error !== undefined) setError(state.error)
    })

    const startEvents = (value: WorkbenchConnection) => {
      if (eventsTask) return
      const dispatcher = new WorkbenchEventDispatcher()
      activeEventStreams += 1
      eventsTask = (async () => {
        let attempt = 0
        while (!eventsAbort.signal.aborted) {
          try {
            for await (const event of value.client.events(value.workspaceId, dispatcher, eventsAbort.signal)) {
              if (event.workspaceId !== value.workspaceId) continue
              attempt = 0
              // E12 + E14: invalidation is scoped by `event.resource`
              // (E12) AND batched within a 50 ms window (E14). The
              // mapping is pure and unit-tested in
              // query-invalidation.test.ts; this call site is
              // intentionally a single line so the side-effecting
              // path cannot drift.
              coalesced.enqueue(value, event)
            }
            attempt = 0
          } catch (reason) {
            if (eventsAbort.signal.aborted) return
            console.warn(t("workbench.errors.eventStreamDisconnected"), reason)
            attempt += 1
            const decision = decideEventRetry(attempt, reason)
            if (decision.action === "stop") {
              setError(reason)
              return
            }
            if (eventsAbort.signal.aborted) return
            await new Promise((resolve) => setTimeout(resolve, decision.delayMs))
            continue
          }
          if (eventsAbort.signal.aborted) return
          await new Promise((resolve) => setTimeout(resolve, EVENT_RECONNECT_DELAY_MS))
        }
      })().finally(() => {
        activeEventStreams = Math.max(0, activeEventStreams - 1)
        eventsTask = undefined
      })
    }

    const ensureConnected = (): Promise<WorkbenchConnection> => {
      const current = connection()
      if (current) return Promise.resolve(current)
      if (pending) return pending
      // V03 — terminal state. The bridge does not exist in this runtime.
      // Returning the cached error is cheap and idempotent: no phase
      // churn, no console churn, no UI flicker. Callers that did not
      // check `unsupported()` first still get a meaningful rejection.
      if (unsupported()) {
        return Promise.reject(bridgeError() ?? new Error(t("workbench.errors.bridgeUnavailable")))
      }
      setError(undefined)
      const attemptGeneration = providerGeneration
      pending = lifecycle.connect(props.workspacePath, async ({ signal, setPhase: updatePhase, acquire }) => {
        updatePhase("initializing")
        if (signal.aborted) throw signal.reason
        updatePhase("opening")
        const value = await platform.workbench!.connect({ workspacePath: props.workspacePath, capabilities: SURFACE_LEASE_CAPABILITIES })
        acquire(value.revoke)
        if (signal.aborted || attemptGeneration !== providerGeneration) throw signal.reason ?? new Error("Workbench connection became stale")
        setIdentity(createWorkbenchTaskIdentity({ codeSessionId: props.codeSessionId, workbenchSessionId: crypto.randomUUID() }))
        updatePhase("handshaking")
        setConnection(value)
        startEvents(value)
        return value
      })
      const currentPending = pending
      void currentPending.catch((reason) => { setError(reason) }).finally(() => {
        if (pending === currentPending) pending = undefined
      })
      return currentPending
    }

    const retryConnection = async (): Promise<void> => {
      // V03 — idempotent: an `unsupported` runtime has no bridge to
      // retry, and a second concurrent click must not start a second
      // lifecycle call while the first is still rolling back.
      if (unsupported() || retrying()) return
      setRetrying(true)
      try {
        eventsAbort.abort()
        await eventsTask?.catch(() => undefined)
        eventsAbort = new AbortController()
        await lifecycle.retry(props.workspacePath)
        setConnection(undefined)
        setError(undefined)
        setPhase("initializing")
        // Resetting the lifecycle only makes a later caller eligible to
        // connect again. A failed surface effect has no reactive dependency
        // change to trigger itself, so the explicit retry must start the new
        // attempt here.
        await ensureConnected().catch(() => undefined)
      } finally {
        setRetrying(false)
      }
    }

    onCleanup(() => {
      providerGeneration += 1
      unsubscribe()
      eventsAbort.abort()
      coalesced.stop()
      void lifecycle.shutdown()
    })

    const loading = () => pending !== undefined || ["initializing", "opening", "issuing", "handshaking", "rolling_back"].includes(phase())

    // V03 — single source of truth for the banner. Order matters:
    // `unsupported` wins over `retrying` (terminal beats transient), and
    // `retrying` wins over `connecting` (a manual retry overrides the
    // generic loading spinner). `connection().instanceId` is the only
    // way to reach `ready`; an attempt in flight (with or without
    // error) collapses to `connecting` or `failed`.
    const uiPhase = (): WorkbenchUiPhase => {
      if (unsupported()) return "unsupported"
      if (retrying()) return "retrying"
      if (connection()?.instanceId) return "ready"
      if (error()) return "failed"
      return "connecting"
    }
    // `bridgeError()` is the copyable reason exposed on `unsupported`;
    // `error()` covers the `failed` path. They are kept separate so the
    // banner can render the correct one for each UI phase. The reason
    // coming back from the lifecycle is `unknown`, so we normalise it
    // to `Error | undefined` instead of leaking the raw value.
    const detail = (): Error | undefined => {
      if (uiPhase() === "unsupported") return bridgeError()
      const reason = error()
      if (reason === undefined || reason === null) return undefined
      if (reason instanceof Error) return reason
      return new Error(String(reason))
    }
    return {
      connection,
      phase,
      loading,
      error,
      identity,
      uiPhase,
      detail,
      // DA-UI-01 — the rail (and any other capability-gated affordance)
      // reads from this set rather than re-querying the server. The set
      // is rebuilt only when the underlying `connection` signal changes,
      // so an in-place rotation that doesn't change `instanceId` keeps
      // the same Set reference and the rail doesn't flicker.
      grants: createMemo<ReadonlySet<string>>(() => connection()?.grants ?? EMPTY_GRANTS),
      beginOperation: () => setIdentity({ ...identity(), operationId: crypto.randomUUID() }),
      ensureConnected,
      retryConnection,
    }
  },
})

export const WorkspaceWorkbenchProvider = (props: ParentProps<{ workspacePath: string; codeSessionId?: string }>) => (
  <WorkbenchContextProvider workspacePath={props.workspacePath} codeSessionId={props.codeSessionId}>{props.children}</WorkbenchContextProvider>
)

export const useWorkspaceWorkbench = use
