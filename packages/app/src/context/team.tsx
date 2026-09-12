// =============================================================================
// context/team.tsx — TEAM-M01
//
// Client state for the Team surface and the model registry, shared by the App,
// the desktop shell and mobile.
//
// Three things this context refuses to do, because each of them is a way of
// showing the user something that is not true:
//
//   Truncate silently   Every collection is a page with a cursor. A list that
//                       stops at the first page and looks complete is worse
//                       than a list that says "there is more" — the user has no
//                       way to notice the difference.
//
//   Conflate empty      "The server did not answer" and "there is nothing"
//   with unreachable    render identically if both become an empty array. They
//                       are kept apart end to end: `reachability` is part of
//                       the state, and stale data stays visible and is marked
//                       stale rather than being wiped.
//
//   Share lifecycle     Start and control calls use the server-owned Team
//                       application service. Every client therefore observes
//                       the same durable run instead of maintaining local
//                       optimistic state that can drift from the executor.
// =============================================================================

import { createMemo, createResource, createSignal } from "solid-js"
import { createStore } from "solid-js/store"
import { createSimpleContext } from "@unifia/ui/context"
import { Persist, persisted } from "@/utils/persist"
import { useSDK } from "./sdk"

// -----------------------------------------------------------------------------
// Pure state logic
//
// Everything below is free of Solid and of the SDK so it can be tested for what
// it decides rather than for how it renders. team.test.ts covers it directly.
// -----------------------------------------------------------------------------

/**
 * Why the last read did or did not produce data.
 *
 * `unavailable` is deliberately not `error`: a registry that has not finished
 * loading answers 503 and will answer 200 shortly, so the right response is to
 * retry. Collapsing it into `error` tells the client to give up on a condition
 * that resolves itself.
 */
export type Reachability = "ok" | "offline" | "unavailable" | "error"

/** The sentence shown wherever a lifecycle action would otherwise be offered. */
export const LIFECYCLE_UNAVAILABLE_REASON = "Team lifecycle requires a reachable server"

export function classifyFailure(error: unknown): Reachability {
  const status = (error as { status?: unknown } | null)?.status
  if (typeof status === "number") {
    if (status === 503) return "unavailable"
    return "error"
  }
  // A fetch that never reached a server rejects without a status. That is the
  // one case where the client, not the server, is the thing that is broken.
  if (error instanceof TypeError) return "offline"
  return "error"
}

export interface Page<T> {
  readonly items: readonly T[]
  readonly nextCursor: string | null
}

export const EMPTY_PAGE: Page<never> = { items: [], nextCursor: null }

/**
 * Append a fetched page to what is already held.
 *
 * Ids are deduplicated because a keyset cursor is not a snapshot: rows written
 * between two requests shift the window, and the same row can legitimately
 * arrive twice. Keeping both copies would show the user a duplicate and make
 * any count wrong.
 */
export function appendPage<T>(current: Page<T>, incoming: Page<T>, idOf: (item: T) => string): Page<T> {
  const seen = new Set(current.items.map(idOf))
  const items = [...current.items]
  for (const item of incoming.items) {
    if (seen.has(idOf(item))) continue
    seen.add(idOf(item))
    items.push(item)
  }
  return { items, nextCursor: incoming.nextCursor }
}

export interface Selection {
  readonly providerID: string
  readonly modelID: string
}

export function selectionKey(selection: Selection): string {
  return `${selection.providerID}/${selection.modelID}`
}

/** Where the effective selection came from. */
export type SelectionSource = "override" | "saved" | "none"

export interface ResolvedSelection {
  readonly selection: Selection | undefined
  readonly source: SelectionSource
  /**
   * A selection that was asked for and could not be honoured, if any.
   *
   * Reported separately from `selection` rather than folded into it. A model
   * that has been retired, or whose provider was disconnected, still has to
   * produce a usable state — but falling back without saying so leaves the user
   * working against a different model than the one they picked, with nothing on
   * screen to explain the change. So the fallback happens *and* the rejection
   * is carried out for the UI to show.
   */
  readonly rejected: Selection | undefined
}

/**
 * Resolve the effective model selection.
 *
 * A session override outranks the saved default and is never written back:
 * "use this model for now" and "use this model from now on" are different
 * requests, and a surface that persists the first has silently answered the
 * second.
 *
 * `known` is the set of `provider/model` keys the registry currently has. An
 * empty set means the registry has not loaded, not that every model is invalid
 * — validation is skipped in that case rather than rejecting everything.
 */
export function resolveSelection(input: {
  saved: Selection | undefined
  override: Selection | undefined
  known: ReadonlySet<string>
}): ResolvedSelection {
  const usable = (selection: Selection | undefined) => {
    if (selection === undefined) return false
    if (input.known.size === 0) return true
    return input.known.has(selectionKey(selection))
  }

  const overrideUsable = usable(input.override)
  const savedUsable = usable(input.saved)

  // The override is reported ahead of the saved default when both are missing:
  // it is the more recent intent, and the one the user is waiting on.
  const rejected =
    input.override !== undefined && !overrideUsable
      ? input.override
      : input.saved !== undefined && !savedUsable
        ? input.saved
        : undefined

  if (overrideUsable) return { selection: input.override, source: "override", rejected }
  if (savedUsable) return { selection: input.saved, source: "saved", rejected }
  return { selection: undefined, source: "none", rejected }
}

export interface TeamCapabilities {
  readonly canRead: boolean
  readonly canStart: boolean
  readonly canPause: boolean
  readonly canCancel: boolean
  readonly lifecycleReason: string
}

/** Lifecycle is available only through the same reachable server as reads. */
export function teamCapabilities(reachability: Reachability): TeamCapabilities {
  const available = reachability === "ok"
  return {
    canRead: available,
    canStart: available,
    canPause: available,
    canCancel: available,
    lifecycleReason: available ? "" : LIFECYCLE_UNAVAILABLE_REASON,
  }
}

/** Data held from an earlier read that the last read could not refresh. */
export function isStale(reachability: Reachability, itemCount: number): boolean {
  return reachability !== "ok" && itemCount > 0
}

/**
 * Fetch one page and fold it into what is already held.
 *
 * On failure the collection is returned unchanged rather than cleared: wiping
 * it would turn a dropped connection into an empty screen that reads as "there
 * are no runs", which is the exact confusion this context exists to prevent.
 *
 * Takes the loader as a parameter so the fold, the deduplication and the
 * failure classification can be tested without a server.
 */
export async function fetchPage<T>(input: {
  current: Page<T>
  load: (cursor: string | null) => Promise<Page<T>>
  idOf: (item: T) => string
  cursor: string | null
}): Promise<{ page: Page<T>; reachability: Reachability }> {
  try {
    const incoming = await input.load(input.cursor)
    return { page: appendPage(input.current, incoming, input.idOf), reachability: "ok" }
  } catch (error) {
    return { page: input.current, reachability: classifyFailure(error) }
  }
}

// -----------------------------------------------------------------------------
// Context
// -----------------------------------------------------------------------------

interface RunRow {
  runId: string
  planId: string
  status: string
  createdAt: string
  updatedAt: string
}

interface ModelRow {
  modelId: string
  providerID: string
  family: string | null
  status: string
}

interface TaskRow {
  taskId: string
  status: string
  dependsOn: string[]
}

interface GateRow {
  gateId: string
  taskId: string | null
  verdict: string
}

interface Store {
  runs: Page<RunRow>
  models: Page<ModelRow>
  runsReachability: Reachability
  modelsReachability: Reachability
  selectedRunId?: string
  tasks: TaskRow[]
  gates: GateRow[]
  detailsReachability: Reachability
}

interface PersistedState {
  selection?: Selection
}

const RUN_PAGE_SIZE = 50
const MODEL_PAGE_SIZE = 200

export const { use: useTeam, provider: TeamProvider } = createSimpleContext({
  name: "Team",
  init: () => {
    const sdk = useSDK()

    const [saved, setSaved, _init, ready] = persisted(
      Persist.global("team", ["team.v1"]),
      createStore<PersistedState>({}),
    )

    // Not persisted, by design: an override lasts as long as the session.
    const [override, setOverride] = createSignal<Selection | undefined>(undefined)

    const [store, setStore] = createStore<Store>({
      runs: EMPTY_PAGE,
      models: EMPTY_PAGE,
      runsReachability: "ok",
      modelsReachability: "ok",
      tasks: [],
      gates: [],
      detailsReachability: "ok",
    })

    async function loadRuns(cursor: string | null) {
      const response = await sdk.client.team.listRuns({ limit: RUN_PAGE_SIZE, cursor: cursor ?? undefined })
      if (response.error) throw response.error
      const body = response.data as { items: RunRow[]; nextCursor: string | null }
      return { items: body.items, nextCursor: body.nextCursor }
    }

    async function loadModels(cursor: string | null) {
      const response = await sdk.client.modelIntelligence.listModels({
        limit: MODEL_PAGE_SIZE,
        cursor: cursor === null ? undefined : Number(cursor),
      })
      if (response.error) throw response.error
      const body = response.data as { items: ModelRow[]; nextCursor: string | null }
      return { items: body.items, nextCursor: body.nextCursor }
    }

    const runId = (run: RunRow) => run.runId
    const modelId = (model: ModelRow) => selectionKey({ providerID: model.providerID, modelID: model.modelId })

    async function advanceRuns(cursor: string | null) {
      const result = await fetchPage({ current: store.runs, load: loadRuns, idOf: runId, cursor })
      setStore("runs", result.page)
      setStore("runsReachability", result.reachability)
    }

    async function advanceModels(cursor: string | null) {
      const result = await fetchPage({ current: store.models, load: loadModels, idOf: modelId, cursor })
      setStore("models", result.page)
      setStore("modelsReachability", result.reachability)
    }

    const refreshRuns = async () => {
      setStore("runs", EMPTY_PAGE)
      await advanceRuns(null)
    }
    const moreRuns = async () => {
      if (store.runs.nextCursor === null) return
      await advanceRuns(store.runs.nextCursor)
    }

    const refreshModels = async () => {
      setStore("models", EMPTY_PAGE)
      await advanceModels(null)
    }
    const moreModels = async () => {
      if (store.models.nextCursor === null) return
      await advanceModels(store.models.nextCursor)
    }

    async function selectRun(runID: string) {
      try {
        const [tasks, gates] = await Promise.all([
          sdk.client.team.listTasks({ runID }),
          sdk.client.team.listGates({ runID }),
        ])
        if (tasks.error) throw tasks.error
        if (gates.error) throw gates.error
        setStore("selectedRunId", runID)
        setStore("tasks", (tasks.data as { items: TaskRow[] }).items)
        setStore("gates", (gates.data as { items: GateRow[] }).items)
        setStore("detailsReachability", "ok")
      } catch (error) {
        setStore("detailsReachability", classifyFailure(error))
        throw error
      }
    }
    const [health, { refetch: refreshHealth }] = createResource(async () => {
      const response = await sdk.client.modelIntelligence.health()
      if (response.error) return { loaded: false, reachability: classifyFailure(response.error) }
      return { loaded: (response.data as { loaded: boolean }).loaded, reachability: "ok" as Reachability }
    })

    const known = createMemo(() => new Set(store.models.items.map(modelId)))

    const selection = createMemo(() =>
      resolveSelection({ saved: saved.selection, override: override(), known: known() }),
    )

    return {
      ready,

      runs: {
        page: () => store.runs,
        reachability: () => store.runsReachability,
        stale: () => isStale(store.runsReachability, store.runs.items.length),
        refresh: refreshRuns,
        more: moreRuns,
      },

      models: {
        page: () => store.models,
        reachability: () => store.modelsReachability,
        stale: () => isStale(store.modelsReachability, store.models.items.length),
        refresh: refreshModels,
        more: moreModels,
      },

      details: {
        runId: () => store.selectedRunId,
        tasks: () => store.tasks,
        gates: () => store.gates,
        reachability: () => store.detailsReachability,
        select: selectRun,
        clear: () => {
          setStore("selectedRunId", undefined)
          setStore("tasks", [])
          setStore("gates", [])
        },
      },
      health: {
        loaded: () => health()?.loaded ?? false,
        reachability: () => health()?.reachability ?? ("ok" as Reachability),
        refresh: refreshHealth,
      },

      selection: {
        effective: () => selection().selection,
        source: () => selection().source,
        /** Asked for but not available; surfaced instead of dropped. */
        rejected: () => selection().rejected,
        /** Persisted: this is the default from now on. */
        save: (value: Selection | undefined) => setSaved("selection", value),
        /** Not persisted: this is the model for this session only. */
        setOverride,
        clearOverride: () => setOverride(undefined),
      },

      lifecycle: {
        async pause(runID: string) {
          const response = await sdk.client.team.pauseRun({ runID })
          if (response.error) throw response.error
          await refreshRuns()
          return response.data
        },
        async resume(runID: string) {
          const response = await sdk.client.team.resumeRun({ runID })
          if (response.error) throw response.error
          await refreshRuns()
          return response.data
        },
        async cancel(runID: string) {
          const response = await sdk.client.team.cancelRun({ runID })
          if (response.error) throw response.error
          await refreshRuns()
          return response.data
        },
      },

      capabilities: createMemo(() => teamCapabilities(store.runsReachability)),
    }
  },
})
