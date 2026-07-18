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
