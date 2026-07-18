import { markViewerTiming } from "@opencode-ai/util/viewer-timing"

type ReadyWatcher = {
  observer?: MutationObserver
  token: number
  frame?: number
  disposed?: boolean
}

export function createReadyWatcher(): ReadyWatcher {
  return { token: 0 }
}

// Disconnects the observer for the CURRENT watch cycle. Used internally by
// notifyShadowReady between/within cycles (e.g. right before setting up a
// fresh MutationObserver, or once "ready" is detected and the observer is no
// longer needed) — deliberately does NOT bump `token` or cancel a pending
// settle-frame RAF, so it can run mid-cycle without invalidating the very
// callback it's about to trigger.
export function clearReadyWatcher(state: ReadyWatcher) {
  state.observer?.disconnect()
  state.observer = undefined
}

// FORK (PLAN-READONLY-VIEWER-REACTIVITY C3): true disposal, for the owning
// component's teardown — no further notifyShadowReady call will ever follow
// for this watcher. `clearReadyWatcher` alone was not enough: it never
// bumped `token`, so a settle-frame RAF chain already in flight (scheduled
// by notifyShadowReady's runReady/step, between "ready detected" and
// settleFrames elapsing) would still run to completion and call `onReady()`
// on a torn-down component — re-installing MutationObserver/ResizeObserver
// watchers that then leak (their own cleanup already ran and won't run
// again) and firing `onRendered` late enough to undo an already-settled
// remount's scroll position. This cancels the pending frame outright,
// bumps the token so any callback that already fired before cancellation
// took effect finds itself stale, and marks the watcher disposed. Idempotent
// — safe to call more than once, or on a watcher that was never armed.
export function disposeReadyWatcher(state: ReadyWatcher) {
  clearReadyWatcher(state)
  if (state.frame !== undefined) {
    cancelAnimationFrame(state.frame)
    state.frame = undefined
  }
  state.token += 1
  state.disposed = true
}

export function getViewerHost(container: HTMLElement | undefined) {
  if (!container) return
  const host = container.querySelector("diffs-container")
  if (!(host instanceof HTMLElement)) return
  return host
}

export function getViewerRoot(container: HTMLElement | undefined) {
  return getViewerHost(container)?.shadowRoot ?? undefined
}

export function applyViewerScheme(host: HTMLElement | undefined) {
  if (!host) return
  if (typeof document === "undefined") return

  const scheme = document.documentElement.dataset.colorScheme
  if (scheme === "dark" || scheme === "light") {
    host.dataset.colorScheme = scheme
    return
  }

  host.removeAttribute("data-color-scheme")
}

export function observeViewerScheme(getHost: () => HTMLElement | undefined) {
  if (typeof document === "undefined") return () => {}

  applyViewerScheme(getHost())
  if (typeof MutationObserver === "undefined") return () => {}

  const root = document.documentElement
  const monitor = new MutationObserver(() => applyViewerScheme(getHost()))
  monitor.observe(root, { attributes: true, attributeFilter: ["data-color-scheme"] })
  return () => monitor.disconnect()
}

export function repairViewerTokenStyles(root: ShadowRoot | undefined) {
  if (!root) return

  for (const span of root.querySelectorAll<HTMLElement>("[data-line] span[style]")) {
    const raw = span.getAttribute("style")
    if (!raw || span.style.cssText === raw) continue
    span.style.cssText = raw
  }
}

export function watchViewerTokenStyles(root: ShadowRoot | undefined) {
  if (!root || typeof MutationObserver === "undefined") return () => {}

  repairViewerTokenStyles(root)
  const observer = new MutationObserver(() => repairViewerTokenStyles(root))
  observer.observe(root, { childList: true, subtree: true })
  return () => observer.disconnect()
}
export function notifyShadowReady(opts: {
  state: ReadyWatcher
  container: HTMLElement
  getRoot: () => ShadowRoot | undefined
  isReady: (root: ShadowRoot) => boolean
  onReady: () => void
  settleFrames?: number
}) {
  // FORK (C3): a disposed watcher belongs to a torn-down component — never
  // start new work on it. Structurally this shouldn't happen (Solid stops
  // re-running a disposed component's effects), but it's a cheap guard
  // against a future caller misusing the API across a remount boundary.
  if (opts.state.disposed) return

  clearReadyWatcher(opts.state)
  opts.state.token += 1

  const token = opts.state.token
  const settle = Math.max(0, opts.settleFrames ?? 0)

  const runReady = () => {
    const step = (left: number) => {
      opts.state.frame = undefined
      if (token !== opts.state.token) return
      if (left <= 0) {
        opts.onReady()
        return
      }
      opts.state.frame = requestAnimationFrame(() => step(left - 1))
    }

    opts.state.frame = requestAnimationFrame(() => step(settle))
  }

  const observeRoot = (root: ShadowRoot) => {
    if (opts.isReady(root)) {
      runReady()
      return
    }

    if (typeof MutationObserver === "undefined") return

    clearReadyWatcher(opts.state)
    opts.state.observer = new MutationObserver(() => {
      if (token !== opts.state.token) return
      if (!opts.isReady(root)) return

      clearReadyWatcher(opts.state)
      runReady()
    })
    opts.state.observer.observe(root, { childList: true, subtree: true })
  }

  const root = opts.getRoot()
  if (!root) {
    if (typeof MutationObserver === "undefined") return

    opts.state.observer = new MutationObserver(() => {
      if (token !== opts.state.token) return

      const next = opts.getRoot()
      if (!next) return

      observeRoot(next)
    })
    opts.state.observer.observe(opts.container, { childList: true, subtree: true })
    return
  }

  observeRoot(root)
}

// ---------------------------------------------------------------------------
// Dynamic line-row alignment shared by desktop and Android WebView
// FORK (PLAN-READONLY-VIEWER-REACTIVITY Phase 4): moved here from
// components/file.tsx — same rationale as the watchers above (Shadow DOM
// upkeep, no Solid dependency), and importing file.tsx directly for tests
// pulls in @pierre/diffs' worker chunk, which bun's test runner can't
// resolve (`?worker&url` is a Vite-only import form) — this module has no
// such dependency and is directly testable.
// ---------------------------------------------------------------------------

// WHY: @pierre/diffs lays out [data-gutter]/[data-content] with
// `grid-template-rows: subgrid`, inheriting row tracks from their
// [data-code] parent — which never declares explicit tracks and relies on
// implicit row generation. On Android WebView (Chrome Mobile, confirmed on
// Chrome 149 despite `CSS.supports('grid-template-rows', 'subgrid')`
// reporting true), that combination collapses to a single implicit row
// instead of one per line: every [data-line] renders at the same position
// and only the last one paints. Verified live via DevTools — giving each
// container its own explicit `repeat(N, auto)` track list (bypassing the
// subgrid inheritance) fixes it immediately. The pixel tracks below preserve
// cross-column row-height matching for wrapped rows on every viewer platform.
export function getSynchronizedGridRows(gutter: HTMLElement, content: HTMLElement) {
  const gutterRows = Array.from(gutter.children) as HTMLElement[]
  const contentRows = Array.from(content.children) as HTMLElement[]
  if (gutterRows.length === 0 || gutterRows.length !== contentRows.length) return

  return gutterRows
    .map((row, index) => {
      const contentRow = contentRows[index]
      const lineHeight = Number.parseFloat(getComputedStyle(contentRow).lineHeight)
      const contentHeight = contentRow.scrollHeight
      const gutterHeight = row.scrollHeight
      const minimumHeight = Number.isFinite(lineHeight) ? lineHeight : 1
      return `${Math.max(1, Math.ceil(Math.max(contentHeight, gutterHeight, minimumHeight)))}px`
    })
    .join(" ")
}

// WHY: Android WebView reports support for CSS subgrid but does not preserve
// the shared row tracks used by Pierre. Independent `auto` tracks align normal
// lines but drift as soon as a wrapped content row becomes taller than its
// number cell. Measuring both columns and applying the same pixel tracks keeps
// every number aligned with its corresponding content row.
export function fixSubgridLineRowCollapse(root: ShadowRoot) {
  for (const gutter of root.querySelectorAll<HTMLElement>("[data-gutter]")) {
    const parent = gutter.parentElement
    const content = Array.from(parent?.children ?? []).find(
      (child) => child !== gutter && child.matches("[data-content]"),
    ) as HTMLElement | undefined
    if (!content) continue

    const previousGutterRows = gutter.style.gridTemplateRows
    const previousContentRows = content.style.gridTemplateRows
    gutter.style.gridTemplateRows = "none"
    content.style.gridTemplateRows = "none"

    const rows = getSynchronizedGridRows(gutter, content)
    if (!rows) {
      gutter.style.gridTemplateRows = previousGutterRows
      content.style.gridTemplateRows = previousContentRows
      continue
    }

    gutter.style.gridTemplateRows = rows
    content.style.gridTemplateRows = rows
  }
}

// WHY a persistent observer instead of a one-shot fix in onReady:
// @pierre/diffs can re-render its shadow DOM more than once per file open
// (e.g. once the file's initial DOM is inserted, and again as reactive
// props/derived state settle a tick or two later) — each re-render rebuilds
// the [data-gutter]/[data-content] children and wipes any inline style
// applied earlier. A fix applied only in onReady only "sticks" if that
// happened to be the LAST render, which is unreliable on a genuinely fresh
// (first) open — confirmed live: a fresh open left both containers on
// `subgrid` with the one-shot version, while a reopen (second mount) picked
// up the fix fine. Watching the shadow root and re-applying on every
// mutation removes that timing dependency entirely.
export function watchViewerLineRows(root: ShadowRoot | undefined): () => void {
  if (!root || typeof MutationObserver === "undefined") return () => {}

  let frame = 0
  const schedule = () => {
    if (frame !== 0) return
    frame = requestAnimationFrame(() => {
      frame = 0
      // FORK (PLAN-READONLY-VIEWER-REACTIVITY Phase 0): no path tag available
      // at this scope (root is a bare ShadowRoot) — acceptable, this function
      // only ever runs for the single currently-mounted viewer instance.
      markViewerTiming("layout-fix-start")
      fixSubgridLineRowCollapse(root)
      markViewerTiming("layout-fix-end")
    })
  }

  const mutationObserver = new MutationObserver(schedule)
  mutationObserver.observe(root, { childList: true, subtree: true })

  const resizeObserver = typeof ResizeObserver === "undefined" ? undefined : new ResizeObserver(schedule)
  if (resizeObserver && root.host instanceof HTMLElement) resizeObserver.observe(root.host)

  schedule()
  return () => {
    mutationObserver.disconnect()
    resizeObserver?.disconnect()
    if (frame !== 0) cancelAnimationFrame(frame)
  }
}
