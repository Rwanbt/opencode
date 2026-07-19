import { WorkerPoolManager } from "@pierre/diffs/worker"
import ShikiWorkerUrl from "@pierre/diffs/worker/worker.js?worker&url"
import { registerOpenCodeTheme } from "./opencode-theme"

export type WorkerPoolStyle = "unified" | "split"

export function workerFactory(): Worker {
  return new Worker(ShikiWorkerUrl, { type: "module" })
}

// WHY here, not just in context/marked.tsx (where this theme registration
// originated for markdown rendering): WorkerPoolManager resolves themes by
// NAME on the main thread before handing them to the Shiki worker — with no
// fallback if "OpenCode" isn't registered yet. Relying on marked.tsx's
// module import as the only registration point meant opening a file before
// any markdown had rendered left every syntax-highlighting span uncolored
// (confirmed live: tokens present and correctly split, but a single uniform
// foreground, empty class list — the theme lookup silently found nothing).
// registerCustomTheme() just stores a loader in a Map; calling it twice is
// harmless.
registerOpenCodeTheme()

function createPool(lineDiffType: "none" | "word-alt") {
  const pool = new WorkerPoolManager(
    {
      workerFactory,
      // poolSize defaults to 8. More workers = more parallelism but
      // also more memory. Too many can actually slow things down.
      // NOTE: 2 is probably better for OpenCode, as I think 8 might be
      // a bit overkill, especially because Safari has a significantly slower
      // boot up time for workers
      poolSize: 2,
    },
    {
      theme: "OpenCode",
      lineDiffType,
      preferredHighlighter: "shiki-wasm",
    },
  )

  // FORK (CORRECTIF F9, 2026-07-19): initialize() returns a Promise — fire-
  // and-forget here (callers don't await pool readiness, they poll
  // isInitialized()/queue work), but an unhandled async init failure (e.g. a
  // WASM boot error) would otherwise surface as an unhandled rejection.
  pool.initialize().catch(() => {})
  return pool
}

let unified: WorkerPoolManager | undefined
let split: WorkerPoolManager | undefined

export function getWorkerPool(style: WorkerPoolStyle | undefined): WorkerPoolManager | undefined {
  if (typeof window === "undefined") return

  if (style === "split") {
    if (!split) split = createPool("word-alt")
    return split
  }

  if (!unified) unified = createPool("none")
  return unified
}

export function getWorkerPools() {
  return {
    unified: getWorkerPool("unified"),
    split: getWorkerPool("split"),
  }
}
