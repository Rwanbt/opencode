export type ViewerLayoutPlatform = "desktop" | "mobile-webview" | "web"
export type ViewerLayoutStrategy = "native" | "measured"

const VIRTUALIZE_BYTES = 500_000
const VIRTUALIZE_LINES = 10_000
const MAX_CONSECUTIVE_LAYOUT_PASSES = 8
const LAYOUT_COOLDOWN_MS = 250

export function countViewerLines(value: string) {
  if (!value) return 1
  let count = 1
  for (let index = 0; index < value.length; index += 1) {
    if (value.charCodeAt(index) === 10) count += 1
  }
  if (value.charCodeAt(value.length - 1) === 10) count -= 1
  return Math.max(1, count)
}
export function shouldVirtualizeViewer(input: { bytes: number; lineCount: number }) {
  return input.bytes >= VIRTUALIZE_BYTES || input.lineCount >= VIRTUALIZE_LINES
}

export interface ViewerLayoutPass {
  strategy: ViewerLayoutStrategy
  pass: number
  gutters: number
  rows: number
  writes: number
  durationMs: number
}

export interface ViewerLayoutOptions {
  strategy: ViewerLayoutStrategy
  onPass?: (result: ViewerLayoutPass) => void
  onStable?: (result: ViewerLayoutPass) => void
}

export function getViewerLayoutStrategy(input: {
  platform: ViewerLayoutPlatform
  isVirtual: boolean
  lineCount: number
  supportsSubgrid: boolean
}): ViewerLayoutStrategy {
  if (input.isVirtual) return "native"
  if (input.platform === "mobile-webview") return "measured"
  return input.supportsSubgrid ? "native" : "measured"
}

const now = () => (typeof performance === "undefined" ? Date.now() : performance.now())

// WHY: Android WebView advertises subgrid support but can collapse Pierre's
// implicit tracks. One inherited line-height read plus row scroll heights
// avoids an expensive getComputedStyle call for every line.
export function getSynchronizedGridRows(gutter: HTMLElement, content: HTMLElement) {
  const gutterRows = Array.from(gutter.children) as HTMLElement[]
  const contentRows = Array.from(content.children) as HTMLElement[]
  if (gutterRows.length === 0 || gutterRows.length !== contentRows.length) return

  const lineHeight = Number.parseFloat(getComputedStyle(contentRows[0]).lineHeight)
  const minimumHeight = Number.isFinite(lineHeight) ? lineHeight : 1
  return gutterRows
    .map((row, index) => `${Math.max(1, Math.ceil(Math.max(contentRows[index].scrollHeight, row.scrollHeight, minimumHeight)))}px`)
    .join(" ")
}

function collectGutters(root: ShadowRoot, scopes?: readonly Element[]) {
  if (!scopes?.length) return Array.from(root.querySelectorAll<HTMLElement>("[data-gutter]"))

  const gutters = new Set<HTMLElement>()
  for (const scope of scopes) {
    const countBefore = gutters.size
    if (scope.matches("[data-gutter]")) gutters.add(scope as HTMLElement)
    for (const gutter of scope.querySelectorAll<HTMLElement>("[data-gutter]")) gutters.add(gutter)
    if (gutters.size > countBefore) continue

    let owner = scope.parentElement
    while (owner) {
      const sibling = Array.from(owner.children).find((child) => child.matches("[data-gutter]"))
      if (sibling) {
        gutters.add(sibling as HTMLElement)
        break
      }
      owner = owner.parentElement
    }
  }
  return [...gutters]
}

export function fixSubgridLineRowCollapse(
  root: ShadowRoot,
  options?: { scopes?: readonly Element[]; cache?: WeakMap<HTMLElement, string> },
) {
  const cache = options?.cache
  let rows = 0
  let writes = 0
  const gutters = collectGutters(root, options?.scopes)

  for (const gutter of gutters) {
    const content = Array.from(gutter.parentElement?.children ?? []).find(
      (child) => child !== gutter && child.matches("[data-content]"),
    ) as HTMLElement | undefined
    if (!content) continue

    const synchronized = getSynchronizedGridRows(gutter, content)
    if (!synchronized) continue
    rows += gutter.children.length
    if (cache?.get(gutter) === synchronized && gutter.style.gridTemplateRows === synchronized && content.style.gridTemplateRows === synchronized) {
      continue
    }

    gutter.style.gridTemplateRows = synchronized
    content.style.gridTemplateRows = synchronized
    cache?.set(gutter, synchronized)
    writes += 2
  }

  return { gutters: gutters.length, rows, writes }
}

const requestFrame = (callback: FrameRequestCallback): number =>
  typeof requestAnimationFrame === "undefined"
    ? (globalThis.setTimeout(() => callback(now()), 0) as unknown as number)
    : requestAnimationFrame(callback)

const cancelFrame = (frame: number) => {
  if (typeof cancelAnimationFrame === "undefined") {
    globalThis.clearTimeout(frame)
    return
  }
  cancelAnimationFrame(frame)
}

// WHY: layout observation is bounded to the render-settle window. Desktop
// native subgrid and virtualized large files perform zero line-row scans.
export function watchViewerLineRows(
  root: ShadowRoot | undefined,
  options: ViewerLayoutOptions = { strategy: "measured" },
): () => void {
  if (!root) return () => {}

  const cache = new WeakMap<HTMLElement, string>()
  const pendingScopes = new Set<Element>()
  let pass = 0
  let consecutivePasses = 0
  let mutationVersion = 0
  let frame = 0
  let stableFrame = 0
  let disposed = false
  let stable = false
  let lastResizeWidth: number | undefined
  let lastResizeHeight: number | undefined
  let cooldownTimer: ReturnType<typeof setTimeout> | undefined
  let last: ViewerLayoutPass = {
    strategy: options.strategy,
    pass: 0,
    gutters: 0,
    rows: 0,
    writes: 0,
    durationMs: 0,
  }

  const disconnectAll = () => {
    mutationObserver?.disconnect()
    resizeObserver?.disconnect()
  }

  const settle = () => {
    if (stable || disposed) return
    if (stableFrame !== 0) cancelFrame(stableFrame)
    const expected = mutationVersion
    stableFrame = requestFrame(() => {
      stableFrame = requestFrame(() => {
        stableFrame = 0
        if (disposed || expected !== mutationVersion) return
        stable = true
        consecutivePasses = 0
        mutationObserver?.disconnect()
        options.onStable?.(last)
      })
    })
  }

  const run = () => {
    frame = 0
    if (disposed) return
    const started = now()
    const result =
      options.strategy === "measured"
        ? fixSubgridLineRowCollapse(root, {
            scopes: pendingScopes.size ? [...pendingScopes] : undefined,
            cache,
          })
        : { gutters: 0, rows: 0, writes: 0 }
    pendingScopes.clear()
    pass += 1
    consecutivePasses += 1
    // WHY: sustained churn (e.g. streamed token spans arriving over many
    // frames) shouldn't burn a full rescan every single frame forever, but
    // permanently dropping mutation observation once the cap trips would
    // leave gutter/content rows silently desynced for any content mutation
    // that lands after it. Disconnect to break the hot loop, then reconnect
    // after a bounded cooldown and force one catch-up pass — the watcher
    // always eventually re-syncs instead of going stale for the rest of its
    // lifetime.
    if (consecutivePasses >= MAX_CONSECUTIVE_LAYOUT_PASSES) {
      mutationObserver?.disconnect()
      if (cooldownTimer !== undefined) clearTimeout(cooldownTimer)
      cooldownTimer = globalThis.setTimeout(() => {
        cooldownTimer = undefined
        if (disposed || stable) return
        consecutivePasses = 0
        mutationObserver?.observe(root, { childList: true, subtree: true })
        mutationVersion += 1
        schedule()
      }, LAYOUT_COOLDOWN_MS)
    }
    last = { strategy: options.strategy, pass, ...result, durationMs: now() - started }
    options.onPass?.(last)
    settle()
  }

  const schedule = () => {
    if (frame !== 0 || disposed) return
    frame = requestFrame(run)
  }

  const mutationObserver =
    typeof MutationObserver === "undefined"
      ? undefined
      : new MutationObserver((records) => {
          mutationVersion += 1
          stable = false
          for (const record of records) {
            for (const node of record.addedNodes) {
              if (typeof Element !== "undefined" && node instanceof Element) pendingScopes.add(node)
            }
          }
          schedule()
        })
  mutationObserver?.observe(root, { childList: true, subtree: true })

  const resizeObserver =
    options.strategy === "measured" && typeof ResizeObserver !== "undefined"
      ? new ResizeObserver((entries) => {
          const rect = entries[0]?.contentRect
          if (rect && rect.width === lastResizeWidth && rect.height === lastResizeHeight) return
          if (rect) {
            lastResizeWidth = rect.width
            lastResizeHeight = rect.height
          }
          consecutivePasses = 0
          mutationVersion += 1
          pendingScopes.clear()
          schedule()
        })
      : undefined
  if (resizeObserver && typeof HTMLElement !== "undefined" && root.host instanceof HTMLElement) {
    resizeObserver.observe(root.host)
  }

  schedule()
  return () => {
    disposed = true
    disconnectAll()
    if (frame !== 0) cancelFrame(frame)
    if (stableFrame !== 0) cancelFrame(stableFrame)
    if (cooldownTimer !== undefined) clearTimeout(cooldownTimer)
  }
}