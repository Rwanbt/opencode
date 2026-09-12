import { GlobalBus } from "@/bus/global"
import { disposeInstance } from "@/effect/instance-registry"
import { Filesystem } from "@/util/filesystem"
import { iife } from "@/util/iife"
import { Log } from "@/util/log"
import { Context } from "../util/context"
import { Project } from "./project"
import { State } from "./state"
import { InstanceDiagnostics } from "./instance-diagnostics"

export interface InstanceContext {
  directory: string
  worktree: string
  project: Project.Info
}

const context = Context.create<InstanceContext>("instance")
const cache = new Map<string, Promise<InstanceContext>>()
const leaseCounts = new Map<string, number>()
const activeCounts = new Map<string, number>()
const pendingDisposals = new Set<string>()
const bootstrapLevels = new Map<string, "light" | "full">()
const promotions = new Map<string, Promise<void>>()
/** Last time each directory was handed to `provide`, for LRU eviction. */
const lastUsed = new Map<string, number>()

/**
 * How many project instances stay resident.
 *
 * WHY a cap exists at all: an instance is not a cache entry, it is a running
 * subsystem — file watchers, LSP clients, plugin state. `provide` is reached by
 * ANY request carrying a `?directory=`, including read-only ones, so merely
 * listing recent projects used to leave a full instance resident forever. Four
 * projects were observed live after a cold start, none of them opened by the
 * user.
 *
 * Four is chosen to cover the common "a few workspace tabs" case without being
 * unbounded; `UNIFIA_MAX_INSTANCES` overrides it for anyone who genuinely works
 * across more, and 0 disables eviction entirely.
 */
const DEFAULT_MAX_INSTANCES = 4

function maxInstances(): number {
  const raw = process.env["UNIFIA_MAX_INSTANCES"]
  if (raw === undefined) return DEFAULT_MAX_INSTANCES
  const parsed = Number.parseInt(raw, 10)
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : DEFAULT_MAX_INSTANCES
}

/**
 * Drops the least-recently-used instances until the cache fits the cap.
 *
 * Leased directories are never evicted: a lease means someone is mid-flight on
 * that instance, and disposing it underneath them would tear down watchers and
 * LSP clients a live caller still holds. If every resident instance is leased
 * the cache is allowed to exceed the cap rather than break a caller — the cap
 * is a memory target, not an invariant worth corrupting state for.
 */
async function evictLeastRecentlyUsed(keep: string): Promise<void> {
  const cap = maxInstances()
  if (cap === 0) return
  const candidates = [...cache.keys()]
    .filter(
      (directory) =>
        directory !== keep &&
        (leaseCounts.get(directory) ?? 0) === 0 &&
        (activeCounts.get(directory) ?? 0) === 0,
    )
    .sort((a, b) => (lastUsed.get(a) ?? 0) - (lastUsed.get(b) ?? 0))
  while (cache.size > cap && candidates.length > 0) {
    const victim = candidates.shift()
    if (!victim) break
    Log.Default.info("evicting least-recently-used instance", { directory: victim, resident: cache.size, cap })
    await Instance.disposeDirectory(victim)
  }
}

async function releaseActive(directory: string): Promise<void> {
  const active = (activeCounts.get(directory) ?? 0) - 1
  if (active > 0) {
    activeCounts.set(directory, active)
    return
  }
  activeCounts.delete(directory)
  if (pendingDisposals.has(directory) && (leaseCounts.get(directory) ?? 0) === 0) {
    pendingDisposals.delete(directory)
    await Instance.disposeDirectory(directory)
  }
}

const disposal = {
  all: undefined as Promise<void> | undefined,
}

function emit(directory: string) {
  GlobalBus.emit("event", {
    directory,
    payload: {
      type: "server.instance.disposed",
      properties: {
        directory,
      },
    },
  })
}

function boot(input: { directory: string; init?: () => Promise<any>; project?: Project.Info; worktree?: string }) {
  return iife(async () => {
    const ctx =
      input.project && input.worktree
        ? {
            directory: input.directory,
            worktree: input.worktree,
            project: input.project,
          }
        : await Project.fromDirectory(input.directory).then(({ project, sandbox }) => ({
            directory: input.directory,
            worktree: sandbox,
            project,
          }))
    await context.provide(ctx, async () => {
      await input.init?.()
    })
    return ctx
  })
}

function track(directory: string, next: Promise<InstanceContext>) {
  const task = next.catch((error) => {
    if (cache.get(directory) === task) {
      cache.delete(directory)
      lastUsed.delete(directory)
    }
    throw error
  })
  cache.set(directory, task)
  return task
}

export const Instance = {
  async provide<R>(input: { directory: string; init?: () => Promise<any>; initKind?: "light" | "full"; fn: () => R; owner?: string; reason?: string }): Promise<R> {
    const directory = Filesystem.resolve(input.directory)
    let existing = cache.get(directory)
    if (!existing) {
      Log.Default.info("creating instance", { directory })
      // C10: record owner/reason for this instance. Defaults are explicit so
      // the oracle "chaque instance a un owner/reason" is always satisfied,
      // even for call sites that haven't been updated yet (C11+ will narrow
      // them down with meaningful values).
      InstanceDiagnostics.record(directory, input.owner ?? "unknown", input.reason ?? "unspecified")
      existing = track(
        directory,
        boot({
          directory,
          init: input.init,
        }),
      )
      bootstrapLevels.set(directory, input.initKind ?? "full")
    }
    activeCounts.set(directory, (activeCounts.get(directory) ?? 0) + 1)
    lastUsed.set(directory, Date.now())
    let ctx: InstanceContext
    try {
      ctx = await existing
    } catch (error) {
      await releaseActive(directory)
      throw error
    }
    if (input.initKind === "full" && bootstrapLevels.get(directory) === "light") {
      let promotion = promotions.get(directory)
      if (!promotion) {
        promotion = context.provide(ctx, async () => {
          await input.init?.()
          bootstrapLevels.set(directory, "full")
        })
        promotions.set(directory, promotion)
        void promotion.then(
          () => { promotions.delete(directory) },
          () => { promotions.delete(directory) },
        )
      }
      try {
        await promotion
      } catch (error) {
        await releaseActive(directory)
        throw error
      }
    }
    // Evicting after the instance is resolved keeps the just-requested
    // directory out of the candidate set and means a cold start never pays for
    // a teardown before it has served anything.
    await evictLeastRecentlyUsed(directory)
    try {
      return await context.provide(ctx, async () => input.fn())
    } finally {
      await releaseActive(directory)
    }
  },
  /** Directories with a resident instance, for tests and diagnostics. */
  residentDirectories(): string[] {
    return [...cache.keys()]
  },
  get current() {
    return context.use()
  },
  get directory() {
    return context.use().directory
  },
  get worktree() {
    return context.use().worktree
  },
  get project() {
    return context.use().project
  },
  /**
   * Check if a path is within the project boundary.
   * Returns true if path is inside Instance.directory OR Instance.worktree.
   * Paths within the worktree but outside the working directory should not trigger external_directory permission.
   */
  containsPath(filepath: string) {
    if (Filesystem.contains(Instance.directory, filepath)) return true
    const wt = Instance.worktree
    // Non-git projects set worktree to "/" which would match ANY absolute path.
    // On Windows "/" resolves to the drive root (e.g. "D:\"), so also check for
    // single-character or drive-root patterns.
    if (wt === "/" || wt === "\\" || /^[A-Z]:[/\\]?$/i.test(wt)) return false
    return Filesystem.contains(wt, filepath)
  },
  /**
   * Captures the current instance ALS context and returns a wrapper that
   * restores it when called. Use this for callbacks that fire outside the
   * instance async context (native addons, event emitters, timers, etc.).
   */
  bind<F extends (...args: any[]) => any>(fn: F): F {
    const ctx = context.use()
    return ((...args: any[]) => context.provide(ctx, () => fn(...args))) as F
  },
  /**
   * Run a synchronous function within the given instance context ALS.
   * Use this to bridge from Effect (where InstanceRef carries context)
   * back to sync code that reads Instance.directory from ALS.
   */
  restore<R>(ctx: InstanceContext, fn: () => R): R {
    return context.provide(ctx, fn)
  },
  state<S>(init: () => S, dispose?: (state: Awaited<S>) => Promise<void>): () => S {
    return State.create(() => Instance.directory, init, dispose)
  },
  async reload(input: { directory: string; init?: () => Promise<any>; project?: Project.Info; worktree?: string }) {
    const directory = Filesystem.resolve(input.directory)
    Log.Default.info("reloading instance", { directory })
    await Promise.all([State.dispose(directory), disposeInstance(directory)])
    cache.delete(directory)
    const next = track(directory, boot({ ...input, directory }))
    emit(directory)
    return await next
  },
  async dispose() {
    const directory = Instance.directory
    Log.Default.info("disposing instance", { directory })
    await Promise.all([State.dispose(directory), disposeInstance(directory)])
    cache.delete(directory)
    lastUsed.delete(directory)
    bootstrapLevels.delete(directory)
    promotions.delete(directory)
    // C10: drop the diagnostic record so the next `provide` on the same
    // directory gets a fresh `createdAt` and re-records its owner/reason.
    InstanceDiagnostics.clear(directory)
    emit(directory)
  },
  async disposeDirectory(input: string) {
    const directory = Filesystem.resolve(input)
    if ((activeCounts.get(directory) ?? 0) > 0) {
      pendingDisposals.add(directory)
      return
    }
    const existing = cache.get(directory)
    if (!existing) return

    const ctx = await existing
    if (cache.get(directory) !== existing) return

    await context.provide(ctx, async () => {
      await Instance.dispose()
    })
  },

  // C12: lease/refcount for shared server-side consumers. Each call increments
  // the per-directory refcount and returns a handle. Calling `release()` on the
  // handle decrements the refcount; the last `release()` triggers a single
  // `disposeDirectory` so disposal is idempotent (never called twice for the
  // same directory while a single instance was alive). The per-handle `released`
  // flag makes the handle itself idempotent — releasing twice is a no-op.
  lease(directory: string): { release: () => Promise<void> } {
    const dir = Filesystem.resolve(directory)
    leaseCounts.set(dir, (leaseCounts.get(dir) ?? 0) + 1)
    let released = false
    return {
      release: async () => {
        if (released) return
        released = true
        const c = leaseCounts.get(dir) ?? 0
        if (c <= 1) {
          leaseCounts.delete(dir)
          if ((activeCounts.get(dir) ?? 0) > 0) pendingDisposals.add(dir)
          else await Instance.disposeDirectory(dir)
        } else {
          leaseCounts.set(dir, c - 1)
        }
      },
    }
  },
  async disposeAll() {
    if (disposal.all) return disposal.all

    disposal.all = iife(async () => {
      Log.Default.info("disposing all instances")
      const entries = [...cache.entries()]
      for (const [key, value] of entries) {
        if (cache.get(key) !== value) continue

        const ctx = await value.catch((error) => {
          Log.Default.warn("instance dispose failed", { key, error })
          return undefined
        })

        if (!ctx) {
          if (cache.get(key) === value) cache.delete(key)
          continue
        }

        if (cache.get(key) !== value) continue

        await context.provide(ctx, async () => {
          await Instance.dispose()
        })
      }
    }).finally(() => {
      disposal.all = undefined
    })

    return disposal.all
  },
}
