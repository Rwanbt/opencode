// FORK (PLAN-READONLY-VIEWER-REACTIVITY Phase 0): lightweight, flag-gated
// timing instrumentation for the save → read-only-viewer pipeline.
//
// WHY a shared, framework-agnostic module: the pipeline being measured spans
// packages/app (editor-panel.tsx, editor/store.ts, file-tabs.tsx) AND
// packages/ui (components/file.tsx, pierre/file-runtime.ts) — a plain module
// in @opencode-ai/util is importable from both without creating a dependency
// from packages/ui back onto packages/app.
//
// WHY flag-gated, not always-on: this must not be noisy in production (see
// the plan's "Critères de réussite"). Off by default everywhere, including
// dev builds — opt in explicitly with enableViewerTiming(), or by setting
// localStorage["opencode:debug:viewer-timing"] = "1" before reload (works on
// a real desktop or Android build, not just a dev server, since Phase 0's
// whole point is measuring real save→viewer-ready latency on both
// platforms).
//
// KNOWN GAP: there is no "worker-result" mark. Pierre's tokenization worker
// lives entirely inside the vendored @pierre/diffs dependency — instrumenting
// it would mean patching node_modules, which Phase 6/C4 explicitly rules out
// (unversioned, silently reverted on the next `bun install`). The
// notify-shadow-ready-start/end pair below is the closest honest proxy: it
// spans worker tokenization + DOM population + Pierre reporting its shadow
// DOM ready, as one block, from our own code.

export type ViewerTimingEvent =
  | "save-start"
  | "save-noop"
  | "save-write-start"
  | "save-write-end"
  | "write-complete"
  | "store-mirror"
  | "refresh-sdk-start"
  | "refresh-sdk-complete"
  | "refresh-metadata-start"
  | "refresh-metadata-end"
  | "refresh-metadata-error"
  | "refresh-seed"
  | "editing-false"
  | "viewer-mount-start"
  | "viewer-render-start"
  | "viewer-render-end"
  | "notify-shadow-ready-start"
  | "notify-shadow-ready-end"
  | "layout-fix-start"
  | "layout-fix-end"
  | "layout-ready"
  | "viewer-stable"
  | "viewer-ready"

export interface ViewerTimingMark {
  event: ViewerTimingEvent
  path?: string
  at: number
  detail?: Record<string, unknown>
}

const STORAGE_KEY = "opencode:debug:viewer-timing"
const MAX_MARKS = 1000

let cachedEnabled: boolean | undefined
const marks: ViewerTimingMark[] = []

function readFlag(): boolean {
  try {
    if (typeof localStorage === "undefined") return false
    return localStorage.getItem(STORAGE_KEY) === "1"
  } catch {
    // Some embedders (e.g. certain WebView configurations) throw on
    // localStorage access instead of returning undefined — never let
    // instrumentation itself break the app.
    return false
  }
}

export function isViewerTimingEnabled(): boolean {
  if (cachedEnabled === undefined) cachedEnabled = readFlag()
  return cachedEnabled
}

export function enableViewerTiming() {
  cachedEnabled = true
  try {
    localStorage?.setItem(STORAGE_KEY, "1")
  } catch {
    // no-op — see readFlag()
  }
}

export function disableViewerTiming() {
  cachedEnabled = false
  marks.length = 0
  try {
    localStorage?.removeItem(STORAGE_KEY)
  } catch {
    // no-op — see readFlag()
  }
}

const now = () => (typeof performance !== "undefined" ? performance.now() : Date.now())

/** Records a timing mark. A single boolean check when disabled — negligible
 * cost on the hot save/render path even if a call site forgets to guard. */
export function markViewerTiming(
  event: ViewerTimingEvent,
  opts?: { path?: string; detail?: Record<string, unknown> },
) {
  if (!isViewerTimingEnabled()) return
  const mark: ViewerTimingMark = { event, path: opts?.path, at: now(), detail: opts?.detail }
  marks.push(mark)
  if (marks.length > MAX_MARKS) marks.shift()
  // eslint-disable-next-line no-console -- intentional: this IS the debug output the flag exists for.
  console.debug(`[viewer-timing] ${event}`, opts?.path ?? "", mark.at.toFixed(1), opts?.detail ?? "")
}

export function getViewerTimingMarks(): readonly ViewerTimingMark[] {
  return marks
}

export function clearViewerTimingMarks() {
  marks.length = 0
}

/**
 * Latency (ms) between the first `fromEvent` mark and the next `toEvent`
 * mark that follows it (optionally scoped to one path). Undefined if either
 * side is missing — e.g. instrumentation was off, or the flow never reached
 * that stage (a conflict/error save never fires "editing-false").
 */
export function viewerTimingLatency(
  fromEvent: ViewerTimingEvent,
  toEvent: ViewerTimingEvent,
  path?: string,
): number | undefined {
  const scoped = path ? marks.filter((mark) => mark.path === path) : marks
  const from = scoped.find((mark) => mark.event === fromEvent)
  if (!from) return undefined
  const to = scoped.find((mark) => mark.event === toEvent && mark.at >= from.at)
  if (!to) return undefined
  return to.at - from.at
}

/**
 * Prints the two latencies Phase 0 exists to compare: the SDK round-trip
 * cost (cause C1) versus the Pierre remount cost. Call from the devtools
 * console (or a debug button) after a save while instrumentation is on.
 */
export function logViewerTimingSummary(path?: string) {
  const roundTrip = viewerTimingLatency("refresh-sdk-start", "refresh-sdk-complete", path)
  const saveToSeed = viewerTimingLatency("save-start", "refresh-seed", path)
  const seedToEditingFalse = viewerTimingLatency("refresh-seed", "editing-false", path)
  const render = viewerTimingLatency("viewer-render-start", "viewer-render-end", path)
  const shadowReady = viewerTimingLatency("editing-false", "notify-shadow-ready-end", path)
  const shadowToLayout = viewerTimingLatency("notify-shadow-ready-end", "layout-ready", path)
  const layoutToStable = viewerTimingLatency("layout-ready", "viewer-stable", path)
  const remount = viewerTimingLatency("editing-false", "viewer-ready", path)
  const saveToStable = viewerTimingLatency("save-start", "viewer-stable", path)
  const total = viewerTimingLatency("save-start", "viewer-ready", path)
  // eslint-disable-next-line no-console -- summary output, not a stray log.
  console.table({
    "refresh-sdk round-trip (legacy C1)": roundTrip,
    "save-start -> seed": saveToSeed,
    "seed -> editing-false": seedToEditingFalse,
    "viewer render() scheduling": render,
    "editing-false -> shadow-ready": shadowReady,
    "shadow-ready -> layout-ready": shadowToLayout,
    "layout-ready -> viewer-stable": layoutToStable,
    "editing-false -> viewer-ready": remount,
    "save-start -> viewer-stable": saveToStable,
    "save-start -> viewer-ready (total)": total,
  })
}
