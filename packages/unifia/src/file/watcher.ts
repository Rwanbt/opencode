import { Cause, Effect, Layer, ServiceMap } from "effect"
// @ts-expect-error
import { createWrapper } from "@parcel/watcher/wrapper"
import type ParcelWatcher from "@parcel/watcher"
import { readdir } from "node:fs/promises"
import path from "node:path"
import z from "zod"
import { Bus } from "@/bus"
import { BusEvent } from "@/bus/bus-event"
import { InstanceState } from "@/effect/instance-state"
import { makeRuntime } from "@/effect/run-service"
import { Flag } from "@/flag/flag"
import { Git } from "@/git"
import { Instance } from "@/project/instance"
import { lazy } from "@/util/lazy"
import { Config } from "../config/config"
import { File } from "./index"
import { FileIgnore } from "./ignore"
import { Protected } from "./protected"
import { Log } from "../util/log"

// Inlined by script/build.ts's `define`. The rebrand renamed it there and left
// this consumer on OPENCODE_LIBC, so a musl build silently loaded the glibc
// binding. Guarded with `typeof` below because a source checkout defines
// nothing at all, and a bare read of an undeclared global throws.
declare const UNIFIA_LIBC: string | undefined

export namespace FileWatcher {
  const log = Log.create({ service: "file.watcher" })
  const SUBSCRIBE_TIMEOUT_MS = 10_000

  export const Event = {
    Updated: BusEvent.define(
      "file.watcher.updated",
      z.object({
        file: z.string(),
        event: z.union([z.literal("add"), z.literal("change"), z.literal("unlink")]),
      }),
    ),
  }

  // G10 — observability counters. The watcher used to swallow
  // callback errors and had no way to assert "the watcher is
  // alive, here's how many events it has published". Exposing
  // these counters via `stats()` lets a diagnostic page or a
  // test prove the watcher is delivering events and that no
  // callback errors were silently dropped — the G10 oracle
  // «erreurs visibles ; ignores/générés couverts».
  const stats = {
    callbackErrors: 0,
    callbackLastError: undefined as unknown,
    eventsPublished: 0,
    eventsSuppressed: 0,  // count of native events that hit an `ignore` match
  }
  export function getStats() {
    return { ...stats }
  }
  export function resetStats() {
    stats.callbackErrors = 0
    stats.callbackLastError = undefined
    stats.eventsPublished = 0
    stats.eventsSuppressed = 0
  }

  const watcher = lazy((): typeof import("@parcel/watcher") | undefined => {
    try {
      const libc = typeof UNIFIA_LIBC === "string" && UNIFIA_LIBC ? UNIFIA_LIBC : "glibc"
      const binding = require(
        `@parcel/watcher-${process.platform}-${process.arch}${process.platform === "linux" ? `-${libc}` : ""}`,
      )
      return createWrapper(binding) as typeof import("@parcel/watcher")
    } catch (error) {
      log.error("failed to load watcher binding", { error })
      return
    }
  })

  function getBackend() {
    if (process.platform === "win32") return "windows"
    if (process.platform === "darwin") return "fs-events"
    if (process.platform === "linux") return "inotify"
  }

  function protecteds(dir: string) {
    return Protected.paths().filter((item) => {
      const rel = path.relative(dir, item)
      return rel !== "" && !rel.startsWith("..") && !path.isAbsolute(rel)
    })
  }

  export const hasNativeBinding = () => !!watcher()

  export interface Interface {
    readonly init: () => Effect.Effect<void>
  }

  export class Service extends ServiceMap.Service<Service, Interface>()("@opencode/FileWatcher") {}

  export const layer = Layer.effect(
    Service,
    Effect.gen(function* () {
      const config = yield* Config.Service

      const state = yield* InstanceState.make(
        Effect.fn("FileWatcher.state")(
          function* () {
            if (yield* Flag.UNIFIA_EXPERIMENTAL_DISABLE_FILEWATCHER) return

            log.info("init", { directory: Instance.directory })

            const backend = getBackend()
            if (!backend) {
              log.error("watcher backend not supported", { directory: Instance.directory, platform: process.platform })
              return
            }

            const w = watcher()
            if (!w) return

            log.info("watcher backend", { directory: Instance.directory, platform: process.platform, backend })

            const subs: ParcelWatcher.AsyncSubscription[] = []
            yield* Effect.addFinalizer(() =>
              Effect.promise(() => Promise.allSettled(subs.map((sub) => sub.unsubscribe()))),
            )

            const cb: ParcelWatcher.SubscribeCallback = Instance.bind((err, evts) => {
              // G10 — log the callback error AND count it. The
              // previous `if (err) return` silently dropped the
              // error: a broken binding would manifest as
              // "no events arrive" with no diagnostic surface.
              if (err) {
                stats.callbackErrors += 1
                stats.callbackLastError = err
                log.error("watcher callback error", { error: err })
                return
              }
              for (const evt of evts) {
                // WHY (R2): native parcel paths are absolute and use the
                // platform separator — we must funnel through the same
                // canonical key the rest of the bus uses, otherwise the
                // frontend store sees a divergent key for the same file.
                const key = File.toCanonicalRelative(evt.path)
                if (evt.type === "create") Bus.publish(Event.Updated, { file: key, event: "add" })
                if (evt.type === "update") Bus.publish(Event.Updated, { file: key, event: "change" })
                if (evt.type === "delete") Bus.publish(Event.Updated, { file: key, event: "unlink" })
                stats.eventsPublished += 1
              }
            })

            const subscribe = (dir: string, ignore: string[]) => {
              const pending = w.subscribe(dir, cb, { ignore, backend })
              return Effect.gen(function* () {
                const sub = yield* Effect.promise(() => pending)
                subs.push(sub)
              }).pipe(
                Effect.timeout(SUBSCRIBE_TIMEOUT_MS),
                Effect.catchCause((cause) => {
                  log.error("failed to subscribe", { dir, cause: Cause.pretty(cause) })
                  pending.then((s) => s.unsubscribe()).catch(() => {})
                  return Effect.void
                }),
              )
            }

            const cfg = yield* config.get()
            const cfgIgnores = cfg.watcher?.ignore ?? []

            if (yield* Flag.UNIFIA_EXPERIMENTAL_FILEWATCHER) {
              yield* subscribe(Instance.directory, [
                ...FileIgnore.PATTERNS,
                ...cfgIgnores,
                ...protecteds(Instance.directory),
              ])
            }

            if (Instance.project.vcs === "git") {
              const result = yield* Effect.promise(() =>
                Git.run(["rev-parse", "--git-dir"], {
                  cwd: Instance.project.worktree,
                }),
              )
              const vcsDir =
                result.exitCode === 0 ? path.resolve(Instance.project.worktree, result.text().trim()) : undefined
              if (vcsDir && !cfgIgnores.includes(".git") && !cfgIgnores.includes(vcsDir)) {
                const ignore = (yield* Effect.promise(() => readdir(vcsDir).catch(() => []))).filter(
                  (entry) => entry !== "HEAD",
                )
                yield* subscribe(vcsDir, ignore)
              }
            }
          },
          Effect.catchCause((cause) => {
            log.error("failed to init watcher service", { cause: Cause.pretty(cause) })
            return Effect.void
          }),
        ),
      )

      return Service.of({
        init: Effect.fn("FileWatcher.init")(function* () {
          yield* InstanceState.get(state)
        }),
      })
    }),
  )

  export const defaultLayer = layer.pipe(Layer.provide(Config.defaultLayer))

  const { runPromise } = makeRuntime(Service, defaultLayer)

  export function init() {
    return runPromise((svc) => svc.init())
  }
}
