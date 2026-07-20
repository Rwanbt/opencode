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

// ---------------------------------------------------------------------------
// Annotation re-apply tracking
// FORK (CORRECTIF F2, 2026-07-19): extracted from components/file.tsx's
// useAnnotationRerender so the identity-tracking guard is unit-testable
// without pulling in @pierre/diffs (see the line-row helpers above for the
// same rationale). renderViewer() always creates a fresh render target
// initialized with lineAnnotations:[] on every content re-render — reference
// equality on the annotations array alone is only a valid "nothing to do"
// signal for the SAME target. A re-render that swaps in a new instance while
// the annotations array reference stays stable (the common case: a memoized
// prop) must still re-apply, or the new instance keeps its empty seed and any
// existing line comments disappear.
// ---------------------------------------------------------------------------

export type AnnotationApplyTarget<A> = {
  setLineAnnotations: (annotations: A[]) => void
  rerender: () => void
}

export function createAnnotationApplyTracker<T extends AnnotationApplyTarget<A>, A>() {
  let lastTarget: T | undefined
  let lastApplied: A[] | undefined
  return {
    // Returns true if a re-apply happened (useful for tests/assertions).
    apply(target: T | undefined, annotations: A[]): boolean {
      if (!target) return false
      const targetChanged = target !== lastTarget
      const annotationsChanged = annotations !== lastApplied
      if (!targetChanged && !annotationsChanged) return false
      // A fresh target already starts with no annotations. Avoid a redundant
      // rerender for the stable empty array, while still recording the target
      // so a later non-empty annotation change is applied normally.
      if (targetChanged && annotations.length === 0) {
        lastTarget = target
        lastApplied = annotations
        return false
      }
      target.setLineAnnotations(annotations)
      target.rerender()
      lastTarget = target
      lastApplied = annotations
      return true
    },
  }
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

function repairTokenStyleSpan(span: HTMLElement) {
  const raw = span.getAttribute("style")
  if (!raw || span.style.cssText === raw) return
  span.style.cssText = raw
}

export function repairViewerTokenStyles(root: ShadowRoot | undefined) {
  if (!root) return

  for (const span of root.querySelectorAll<HTMLElement>("[data-line] span[style]")) {
    repairTokenStyleSpan(span)
  }
}

// FORK (PLAN-READONLY-VIEWER-REACTIVITY Phase 5 / C8): repairs only the
// subtree of nodes a mutation actually added, instead of re-scanning the
// whole Shadow DOM. `[data-line] span[style]` requires a `[data-line]`
// ancestor, so `matches()` (which walks the full ancestor chain, not just
// the immediate parent) still correctly filters out styled spans elsewhere
// (e.g. the search bar) — same selector, same semantics, scoped to one
// added node's subtree instead of the whole root.
function repairTokenStylesIn(node: Node) {
  if (!(node instanceof Element)) return
  if (node.matches("[data-line] span[style]")) repairTokenStyleSpan(node as HTMLElement)
  for (const span of node.querySelectorAll<HTMLElement>("[data-line] span[style]")) {
    repairTokenStyleSpan(span)
  }
}

export function watchViewerTokenStyles(root: ShadowRoot | undefined) {
  if (!root || typeof MutationObserver === "undefined") return () => {}

  // Full scan only once, at installation — every mutation after this only
  // repairs the nodes that mutation actually added (queued, coalesced into
  // one requestAnimationFrame instead of one full re-scan per mutation
  // batch).
  repairViewerTokenStyles(root)

  let frame = 0
  const pending = new Set<Node>()

  const flush = () => {
    frame = 0
    const nodes = Array.from(pending)
    pending.clear()
    for (const node of nodes) repairTokenStylesIn(node)
  }

  const observer = new MutationObserver((records) => {
    for (const record of records) {
      for (const node of record.addedNodes) pending.add(node)
    }
    if (pending.size === 0) return
    if (frame !== 0) return
    frame = requestAnimationFrame(flush)
  })
  observer.observe(root, { childList: true, subtree: true })

  return () => {
    observer.disconnect()
    if (frame !== 0) cancelAnimationFrame(frame)
    frame = 0
    pending.clear()
  }
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
  // FORK (CORRECTIF F4, 2026-07-19): a superseding cycle must cancel the
  // previous cycle's pending settle/check RAF, not just bump the token.
  // clearReadyWatcher() deliberately leaves state.frame alone (see its own
  // comment) — but leaving a stale RAF alive here lets it occupy
  // state.frame right as the new cycle's MutationObserver callback checks
  // `state.frame !== undefined` to decide whether to schedule checkReady.
  // If exactly one mutation arrives before the stale RAF fires, that check
  // is swallowed and the new cycle never becomes ready. Mirrors
  // disposeReadyWatcher's frame cancellation.
  if (opts.state.frame !== undefined) {
    cancelAnimationFrame(opts.state.frame)
    opts.state.frame = undefined
  }
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
      // FORK (CORRECTIF F6, 2026-07-19): when getRoot() finds no root yet,
      // notifyShadowReady installs a MutationObserver on opts.container to
      // wait for the shadow root to appear (state.observer, below). If that
      // root shows up already ready, this branch must disconnect that
      // observer before running — otherwise later container mutations
      // re-trigger observeRoot -> runReady -> onReady repeatedly (duplicate
      // scroll/watcher restoration). The not-ready branch below already does
      // this via clearReadyWatcher(); this branch must be symmetric.
      clearReadyWatcher(opts.state)
      runReady()
      return
    }

    if (typeof MutationObserver === "undefined") return

    clearReadyWatcher(opts.state)
    // FORK (PLAN-READONLY-VIEWER-REACTIVITY Phase 5 / C8): opts.isReady()
    // typically does a full `querySelectorAll("[data-line]").length >=
    // lineCount()` scan (see file.tsx's notify()) — cheap once, but Pierre
    // can insert lines across several mutation batches while still not
    // ready. Coalescing the check into one requestAnimationFrame per batch
    // of mutations (instead of one full scan per mutation callback) cuts
    // scan count without changing when "ready" fires. Reuses opts.state.frame
    // — it's never concurrently in use with the settle-frame chain below,
    // since that only starts once isReady() has already returned true — so
    // disposeReadyWatcher's existing frame cancellation covers this too.
    const checkReady = () => {
      opts.state.frame = undefined
      if (token !== opts.state.token) return
      if (!opts.isReady(root)) return

      clearReadyWatcher(opts.state)
      runReady()
    }
    opts.state.observer = new MutationObserver(() => {
      if (token !== opts.state.token) return
      if (opts.state.frame !== undefined) return
      opts.state.frame = requestAnimationFrame(checkReady)
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

export {
  countViewerLines,
  fixSubgridLineRowCollapse,
  getSynchronizedGridRows,
  getViewerLayoutStrategy,
  shouldVirtualizeViewer,
  watchViewerLineRows,
} from "./viewer-layout"
export type { ViewerLayoutPass, ViewerLayoutPlatform, ViewerLayoutStrategy } from "./viewer-layout"
