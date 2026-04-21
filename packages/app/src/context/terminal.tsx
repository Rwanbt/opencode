import { createStore, produce } from "solid-js/store"
import { createSimpleContext } from "@opencode-ai/ui/context"
import { batch, createEffect, createMemo, createRoot, createSignal, on, onCleanup } from "solid-js"
import { useParams } from "@solidjs/router"
import { useSDK } from "./sdk"
import type { Platform } from "./platform"
import { defaultTitle, titleNumber } from "./terminal-title"
import { Persist, persisted, removePersisted } from "@/utils/persist"
import { showToast } from "@opencode-ai/ui/toast"

export type LocalPTY = {
  id: string
  title: string
  titleNumber: number
  rows?: number
  cols?: number
  buffer?: string
  scrollY?: number
  cursor?: number
  // Lazy-create flag. True between the moment the user opens a terminal tab
  // and the moment the Terminal component has mounted, measured its
  // container, and called sdk.client.pty.create(). During this window no
  // backend session exists yet — the shell is spawned at the exact final
  // grid dimensions so no SIGWINCH/readline-pad is ever needed. The sweep
  // and persist/migrate paths must skip pending entries.
  _pending?: boolean
}

// Client-side PTY id generator. Must produce a string matching the server's
// `pty_...` prefix validation (see Identifier.schema in opencode/src/id/id.ts).
// Format mimics ascending ids (timestamp prefix + random suffix) so the
// server's ordering assumptions still hold when the id reaches the backend.
function generateClientPtyId(): string {
  const ts = Date.now().toString(36)
  const rand =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? (crypto as { randomUUID: () => string }).randomUUID().replace(/-/g, "")
      : Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2)
  return `pty_${ts}${rand}`.slice(0, 30)
}

const WORKSPACE_KEY = "__workspace__"
const MAX_TERMINAL_SESSIONS = 20

// Monospace char metrics matching the defaults in terminal.tsx
// (fontSize: 14, DejaVu Sans Mono / JetBrains Mono ≈ 0.6em advance).
const CHAR_ADVANCE_PX = 8.4
const LINE_HEIGHT_PX = 17
// Terminal container uses ~40% of viewport height on mobile split layout,
// full height on desktop. Conservative estimate halfway between the two
// so the pre-spawn prompt lands in dimensions close to the final fit.
const HEIGHT_FACTOR = 0.6
const WIDTH_PADDING_PX = 32

/**
 * Estimate the terminal grid size from the current viewport so we can
 * spawn the shell at its (approximate) final dimensions. This avoids the
 * 80x24 → target resize storm that drops the first prompt on mobile (mksh
 * does not re-emit its prompt after SIGWINCH). The fit() pass in
 * terminal.tsx still runs once the container is mounted and snaps to the
 * exact grid; this just ensures the initial mismatch is small enough
 * that the shell keeps its prompt.
 */
function estimateTerminalSize(fallback?: { cols?: number; rows?: number }) {
  if (typeof window === "undefined") {
    return { cols: fallback?.cols ?? 80, rows: fallback?.rows ?? 24 }
  }
  const vw = Math.max(200, window.innerWidth ?? 800)
  const vh = Math.max(200, window.innerHeight ?? 600)
  const cols = Math.max(40, Math.min(200, Math.floor((vw - WIDTH_PADDING_PX) / CHAR_ADVANCE_PX)))
  const rows = Math.max(12, Math.min(80, Math.floor((vh * HEIGHT_FACTOR) / LINE_HEIGHT_PX)))
  return { cols, rows }
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function text(value: unknown) {
  return typeof value === "string" ? value : undefined
}

function num(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined
}

function numberFromTitle(title: string) {
  return titleNumber(title, MAX_TERMINAL_SESSIONS)
}

function pty(value: unknown): LocalPTY | undefined {
  if (!record(value)) return

  const id = text(value.id)
  if (!id) return

  // Drop entries that were still pending at persist time — they have no
  // backend session to reconnect to, so keeping them only confuses sweep.
  if (value._pending === true) return

  const title = text(value.title) ?? ""
  const number = num(value.titleNumber)
  const rows = num(value.rows)
  const cols = num(value.cols)
  const buffer = text(value.buffer)
  const scrollY = num(value.scrollY)
  const cursor = num(value.cursor)

  return {
    id,
    title,
    titleNumber: number && number > 0 ? number : (numberFromTitle(title) ?? 0),
    ...(rows !== undefined ? { rows } : {}),
    ...(cols !== undefined ? { cols } : {}),
    ...(buffer !== undefined ? { buffer } : {}),
    ...(scrollY !== undefined ? { scrollY } : {}),
    ...(cursor !== undefined ? { cursor } : {}),
  }
}

export function migrateTerminalState(value: unknown) {
  if (!record(value)) return value

  const seen = new Set<string>()
  const all = (Array.isArray(value.all) ? value.all : []).flatMap((item) => {
    const next = pty(item)
    if (!next || seen.has(next.id)) return []
    seen.add(next.id)
    return [next]
  })

  const active = text(value.active)

  return {
    active: active && seen.has(active) ? active : all[0]?.id,
    all,
  }
}

export function getWorkspaceTerminalCacheKey(dir: string) {
  return `${dir}:${WORKSPACE_KEY}`
}

export function getLegacyTerminalStorageKeys(dir: string, legacySessionID?: string) {
  if (!legacySessionID) return [`${dir}/terminal.v1`]
  return [`${dir}/terminal/${legacySessionID}.v1`, `${dir}/terminal.v1`]
}

type TerminalSession = ReturnType<typeof createWorkspaceTerminalSession>

type TerminalCacheEntry = {
  value: TerminalSession
  dispose: VoidFunction
}

const caches = new Set<Map<string, TerminalCacheEntry>>()

const trimTerminal = (pty: LocalPTY) => {
  if (!pty.buffer && pty.cursor === undefined && pty.scrollY === undefined) return pty
  return {
    ...pty,
    buffer: undefined,
    cursor: undefined,
    scrollY: undefined,
  }
}

export function clearWorkspaceTerminals(dir: string, sessionIDs?: string[], platform?: Platform) {
  const key = getWorkspaceTerminalCacheKey(dir)
  for (const cache of caches) {
    const entry = cache.get(key)
    entry?.value.clear()
  }

  removePersisted(Persist.workspace(dir, "terminal"), platform)

  const legacy = new Set(getLegacyTerminalStorageKeys(dir))
  for (const id of sessionIDs ?? []) {
    for (const key of getLegacyTerminalStorageKeys(dir, id)) {
      legacy.add(key)
    }
  }
  for (const key of legacy) {
    removePersisted({ key }, platform)
  }
}

function createWorkspaceTerminalSession(sdk: ReturnType<typeof useSDK>, dir: string, legacySessionID?: string) {
  const legacy = getLegacyTerminalStorageKeys(dir, legacySessionID)

  const [store, setStore, _, ready] = persisted(
    {
      ...Persist.workspace(dir, "terminal", legacy),
      migrate: migrateTerminalState,
    },
    createStore<{
      active?: string
      all: LocalPTY[]
    }>({
      all: [],
    }),
  )

  // Tracks whether the stale-PTY sweep (below) has finished.
  // UI should wait for this before auto-closing or auto-creating terminals.
  const [sweepDone, setSweepDone] = createSignal(false)

  const pickNextTerminalNumber = () => {
    const existingTitleNumbers = new Set(
      store.all.flatMap((pty) => {
        const direct = Number.isFinite(pty.titleNumber) && pty.titleNumber > 0 ? pty.titleNumber : undefined
        if (direct !== undefined) return [direct]
        const parsed = numberFromTitle(pty.title)
        if (parsed === undefined) return []
        return [parsed]
      }),
    )

    return (
      Array.from({ length: existingTitleNumbers.size + 1 }, (_, index) => index + 1).find(
        (number) => !existingTitleNumbers.has(number),
      ) ?? 1
    )
  }

  const removeExited = (id: string) => {
    const all = store.all
    const index = all.findIndex((x) => x.id === id)
    if (index === -1) return
    const active = store.active === id ? (index === 0 ? all[1]?.id : all[0]?.id) : store.active
    batch(() => {
      setStore("active", active)
      setStore(
        "all",
        produce((draft) => {
          draft.splice(index, 1)
        }),
      )
    })
  }

  const unsub = sdk.event.on("pty.exited", (event: { properties: { id: string } }) => {
    removeExited(event.properties.id)
  })
  onCleanup(unsub)

  // Sweep stale PTY sessions left over from a previous sidecar lifecycle.
  // The CLI sidecar is spawned fresh on every app launch with a new port and
  // password, so any persisted PTY IDs from a previous run no longer exist in
  // the server's memory and must be removed before the Terminal component
  // tries to reconnect their WebSockets.
  void (async () => {
    try {
      if (ready.promise) await ready.promise
    } catch {
      setSweepDone(true)
      return
    }
    // Drop any persisted pending entries — they had no backend session when
    // persistence ran (the Terminal component never completed the lazy
    // pty.create call), so nothing to reconnect to. Also saves us from
    // querying the server with ids it has never seen.
    const pendingIds = new Set(store.all.filter((pty) => pty._pending).map((pty) => pty.id))
    if (pendingIds.size > 0) {
      batch(() => {
        setStore(
          "all",
          produce((draft) => {
            for (let i = draft.length - 1; i >= 0; i--) {
              if (pendingIds.has(draft[i].id)) draft.splice(i, 1)
            }
          }),
        )
        if (store.active && pendingIds.has(store.active)) {
          setStore("active", store.all[0]?.id)
        }
      })
    }
    const ids = store.all.map((pty) => pty.id)
    if (ids.length === 0) {
      setSweepDone(true)
      return
    }
    // Only remove sessions the server explicitly reports as gone. Any other
    // failure (network error, auth not yet ready, server still booting)
    // must NOT mark the PTY dead — otherwise a sweep racing the sidecar
    // health check would wipe every still-valid session.
    const statuses = await Promise.all(
      ids.map((id) =>
        sdk.client.pty
          .get({ ptyID: id })
          .then(() => "alive" as const)
          .catch((err: unknown) => {
            const name =
              err && typeof err === "object" && "name" in err && typeof err.name === "string"
                ? err.name
                : undefined
            return name === "NotFoundError" ? ("gone" as const) : ("unknown" as const)
          }),
      ),
    )
    const dead = new Set(ids.filter((_, index) => statuses[index] === "gone"))
    if (dead.size === 0) {
      setSweepDone(true)
      return
    }
    batch(() => {
      setStore(
        "all",
        produce((draft) => {
          for (let index = draft.length - 1; index >= 0; index--) {
            if (dead.has(draft[index].id)) draft.splice(index, 1)
          }
        }),
      )
      if (store.active && dead.has(store.active)) {
        setStore("active", store.all[0]?.id)
      }
    })
    setSweepDone(true)
  })()

  const update = (client: ReturnType<typeof useSDK>["client"], pty: Partial<LocalPTY> & { id: string }) => {
    const index = store.all.findIndex((x) => x.id === pty.id)
    const previous = index >= 0 ? store.all[index] : undefined
    if (index >= 0) {
      setStore("all", index, (item) => ({ ...item, ...pty }))
    }
    client.pty
      .update({
        ptyID: pty.id,
        title: pty.title,
        size: pty.cols && pty.rows ? { rows: pty.rows, cols: pty.cols } : undefined,
      })
      .catch((error: unknown) => {
        if (previous) {
          const currentIndex = store.all.findIndex((item) => item.id === pty.id)
          if (currentIndex >= 0) setStore("all", currentIndex, previous)
        }
        console.error("Failed to update terminal", error)
      })
  }

  const clone = async (client: ReturnType<typeof useSDK>["client"], id: string) => {
    const index = store.all.findIndex((x) => x.id === id)
    const pty = store.all[index]
    if (!pty) return
    const estimated = estimateTerminalSize({ cols: pty.cols, rows: pty.rows })
    const next = await client.pty
      .create({
        title: pty.title,
        cols: estimated.cols,
        rows: estimated.rows,
      })
      .catch((error: unknown) => {
        console.error("Failed to clone terminal", error)
        return undefined
      })
    if (!next?.data) return

    const active = store.active === pty.id

    batch(() => {
      setStore("all", index, {
        id: next.data.id,
        title: next.data.title ?? pty.title,
        titleNumber: pty.titleNumber,
        buffer: undefined,
        cursor: undefined,
        scrollY: undefined,
        rows: undefined,
        cols: undefined,
      })
      if (active) {
        setStore("active", next.data.id)
      }
    })
  }

  return {
    ready,
    sweepDone,
    all: createMemo(() => store.all),
    active: createMemo(() => store.active),
    clear() {
      batch(() => {
        setStore("active", undefined)
        setStore("all", [])
      })
    },
    new() {
      const nextNumber = pickNextTerminalNumber()
      // Lazy-create: no backend call here. The Terminal component mounts on
      // this _pending entry, measures its container with fit.fit(), and calls
      // sdk.client.pty.create() with the *exact* grid dims. The shell spawns
      // at its final size so no initial resize/SIGWINCH is needed.
      const id = generateClientPtyId()
      const pending: LocalPTY = {
        id,
        title: defaultTitle(nextNumber),
        titleNumber: nextNumber,
        _pending: true,
      }
      batch(() => {
        setStore("all", store.all.length, pending)
        setStore("active", id)
      })
    },
    finalizePending(id: string) {
      const index = store.all.findIndex((x) => x.id === id)
      if (index === -1) return
      if (!store.all[index]?._pending) return
      setStore("all", index, (pty) => ({ ...pty, _pending: undefined }))
    },
    failPending(id: string) {
      const index = store.all.findIndex((x) => x.id === id)
      if (index === -1) return
      if (!store.all[index]?._pending) return
      batch(() => {
        if (store.active === id) {
          const fallback = index > 0 ? store.all[index - 1]?.id : store.all[1]?.id
          setStore("active", fallback)
        }
        setStore(
          "all",
          produce((draft) => {
            draft.splice(index, 1)
          }),
        )
      })
    },
    update(pty: Partial<LocalPTY> & { id: string }) {
      update(sdk.client, pty)
    },
    trim(id: string) {
      const index = store.all.findIndex((x) => x.id === id)
      if (index === -1) return
      setStore("all", index, (pty) => trimTerminal(pty))
    },
    trimAll() {
      setStore("all", (all) => {
        const next = all.map(trimTerminal)
        if (next.every((pty, index) => pty === all[index])) return all
        return next
      })
    },
    async clone(id: string) {
      await clone(sdk.client, id)
    },
    bind() {
      const client = sdk.client
      return {
        trim(id: string) {
          const index = store.all.findIndex((x) => x.id === id)
          if (index === -1) return
          setStore("all", index, (pty) => trimTerminal(pty))
        },
        update(pty: Partial<LocalPTY> & { id: string }) {
          update(client, pty)
        },
        async clone(id: string) {
          await clone(client, id)
        },
      }
    },
    open(id: string) {
      setStore("active", id)
    },
    next() {
      const index = store.all.findIndex((x) => x.id === store.active)
      if (index === -1) return
      const nextIndex = (index + 1) % store.all.length
      setStore("active", store.all[nextIndex]?.id)
    },
    previous() {
      const index = store.all.findIndex((x) => x.id === store.active)
      if (index === -1) return
      const prevIndex = index === 0 ? store.all.length - 1 : index - 1
      setStore("active", store.all[prevIndex]?.id)
    },
    async close(id: string) {
      const index = store.all.findIndex((f) => f.id === id)
      if (index !== -1) {
        batch(() => {
          if (store.active === id) {
            const next = index > 0 ? store.all[index - 1]?.id : store.all[1]?.id
            setStore("active", next)
          }
          setStore(
            "all",
            produce((all) => {
              all.splice(index, 1)
            }),
          )
        })
      }

      await sdk.client.pty.remove({ ptyID: id }).catch((error: unknown) => {
        console.error("Failed to close terminal", error)
      })
    },
    move(id: string, to: number) {
      const index = store.all.findIndex((f) => f.id === id)
      if (index === -1) return
      setStore(
        "all",
        produce((all) => {
          all.splice(to, 0, all.splice(index, 1)[0])
        }),
      )
    },
  }
}

export const { use: useTerminal, provider: TerminalProvider } = createSimpleContext({
  name: "Terminal",
  gate: false,
  init: () => {
    const sdk = useSDK()
    const params = useParams()
    const cache = new Map<string, TerminalCacheEntry>()

    caches.add(cache)
    onCleanup(() => caches.delete(cache))

    const disposeAll = () => {
      for (const entry of cache.values()) {
        entry.dispose()
      }
      cache.clear()
    }

    onCleanup(disposeAll)

    const prune = () => {
      while (cache.size > MAX_TERMINAL_SESSIONS) {
        const first = cache.keys().next().value
        if (!first) return
        const entry = cache.get(first)
        entry?.dispose()
        cache.delete(first)
      }
    }

    const loadWorkspace = (dir: string, legacySessionID?: string) => {
      // Terminals are workspace-scoped so tabs persist while switching sessions in the same directory.
      const key = getWorkspaceTerminalCacheKey(dir)
      const existing = cache.get(key)
      if (existing) {
        cache.delete(key)
        cache.set(key, existing)
        return existing.value
      }

      const entry = createRoot((dispose) => ({
        value: createWorkspaceTerminalSession(sdk, dir, legacySessionID),
        dispose,
      }))

      cache.set(key, entry)
      prune()
      return entry.value
    }

    const workspace = createMemo(() => loadWorkspace(params.dir!, params.id))

    createEffect(
      on(
        () => ({ dir: params.dir, id: params.id }),
        (next, prev) => {
          if (!prev?.dir) return
          if (next.dir === prev.dir && next.id === prev.id) return
          if (next.dir === prev.dir && next.id) return
          loadWorkspace(prev.dir, prev.id).trimAll()
        },
        { defer: true },
      ),
    )

    return {
      ready: () => workspace().ready(),
      sweepDone: () => workspace().sweepDone(),
      all: () => workspace().all(),
      active: () => workspace().active(),
      new: () => workspace().new(),
      finalizePending: (id: string) => workspace().finalizePending(id),
      failPending: (id: string) => workspace().failPending(id),
      update: (pty: Partial<LocalPTY> & { id: string }) => workspace().update(pty),
      trim: (id: string) => workspace().trim(id),
      trimAll: () => workspace().trimAll(),
      clone: (id: string) => workspace().clone(id),
      bind: () => workspace(),
      open: (id: string) => workspace().open(id),
      close: (id: string) => workspace().close(id),
      move: (id: string, to: number) => workspace().move(id, to),
      next: () => workspace().next(),
      previous: () => workspace().previous(),
    }
  },
})
