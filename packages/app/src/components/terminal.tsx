import { withAlpha } from "@opencode-ai/ui/theme/color"
import { useTheme } from "@opencode-ai/ui/theme/context"
import { resolveThemeVariant } from "@opencode-ai/ui/theme/resolve"
import type { HexColor } from "@opencode-ai/ui/theme/types"
import { showToast } from "@opencode-ai/ui/toast"
import type { FitAddon, Ghostty, Terminal as Term } from "ghostty-web"
import ghosttyWasmUrl from "ghostty-web/ghostty-vt.wasm?url"
import { type ComponentProps, createEffect, createMemo, onCleanup, onMount, splitProps } from "solid-js"
import { SerializeAddon } from "@/addons/serialize"
import { matchKeybind, parseKeybind } from "@/context/command"
import { useLanguage } from "@/context/language"
import { usePlatform } from "@/context/platform"
import { useSDK } from "@/context/sdk"
import { useServer } from "@/context/server"
import { monoFontFamily, useSettings } from "@/context/settings"
import { useTerminal, type LocalPTY } from "@/context/terminal"
import { terminalAttr, terminalProbe } from "@/testing/terminal"
import { disposeIfDisposable, getHoveredLinkText, setOptionIfSupported } from "@/utils/runtime-adapters"
import { terminalWriter } from "@/utils/terminal-writer"

const TOGGLE_TERMINAL_ID = "terminal.toggle"
const DEFAULT_TOGGLE_TERMINAL_KEYBIND = "ctrl+`"
export interface TerminalProps extends ComponentProps<"div"> {
  pty: LocalPTY
  autoFocus?: boolean
  onSubmit?: () => void
  onCleanup?: (pty: Partial<LocalPTY> & { id: string }) => void
  onConnect?: () => void
  onConnectError?: (error: unknown) => void
  onSend?: (fn: ((data: string) => void) | undefined) => void
}

let sharedModule: Promise<typeof import("ghostty-web")> | undefined

const loadGhosttyModule = () => {
  if (sharedModule) return sharedModule
  sharedModule = import("ghostty-web").catch((err) => {
    console.error("[terminal] failed to import ghostty-web module:", err)
    sharedModule = undefined
    throw err
  })
  return sharedModule
}

// Each terminal tab gets its own Ghostty WASM instance (own linear memory).
// A single shared instance across tabs meant a later tab's WASM memory
// growth (memory.grow(), e.g. opening a 2nd/3rd terminal) detached the
// ArrayBuffer views an earlier tab's renderer was still reading cells
// from, corrupting its on-screen glyphs into garbage (observed: random
// CJK/tofu characters appearing in an already-open tab right after
// opening a new one). The JS module import above is still shared/cached —
// only the WASM instantiation (real memory) is isolated per terminal.
const loadGhostty = async () => {
  const mod = await loadGhosttyModule()
  console.info("[terminal] loading ghostty-web WASM instance, wasm url:", ghosttyWasmUrl)
  let ghostty: Ghostty | undefined
  try {
    ghostty = await mod.Ghostty.load(ghosttyWasmUrl)
    console.info("[terminal] ghostty WASM loaded successfully")
  } catch (err) {
    console.warn("[terminal] Ghostty WASM unavailable, using canvas renderer:", err)
  }
  return { mod, ghostty }
}

// A brand-new terminal spawns its shell at exactly the size measured by the
// one `fit.fit()` call preceding `pty.create()` — and, by design, never
// resizes again afterward (see the lazy-create comment further below: a
// follow-up SIGWINCH after the first prompt re-triggers mksh's readline
// pad-erase redisplay glitch). That design is only safe if the one
// pre-spawn measurement is correct. On this Android WebView the container's
// layout (flex sizing, `--vvh`/visualViewport-driven CSS vars, keyboard-
// adjacent geometry) is often not yet settled the instant this component
// mounts, so a synchronous `getBoundingClientRect()` right after `t.open()`
// can catch a transient, too-small size — the shell then spawns too narrow
// and, since no correction ever follows, stays that way for its entire
// life (observed: prompt permanently truncated by readline's horizontal-
// scroll indicator). Wait for the container's measured size to stop
// changing across consecutive ResizeObserver callbacks before treating it
// as final. Bounded by `maxWaitMs` so a container that genuinely never
// settles (or a browser that never fires a stabilizing callback) doesn't
// block the terminal from opening at all.
const waitForStableContainerSize = (container: HTMLElement, maxWaitMs = 400, requiredStableTicks = 2) =>
  new Promise<void>((resolve) => {
    if (typeof ResizeObserver === "undefined") {
      resolve()
      return
    }
    let settled = false
    let lastWidth = -1
    let lastHeight = -1
    let stableTicks = 0
    const finish = () => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      ro.disconnect()
      resolve()
    }
    const timer = setTimeout(finish, maxWaitMs)
    const ro = new ResizeObserver(() => {
      const rect = container.getBoundingClientRect()
      // Mobile layout can briefly settle at a near-zero height during
      // initial reflow (keyboard/safe-area/address-bar animations) before
      // reaching its final size. Two identical ticks at e.g. 1px would
      // otherwise look "stable" and let fit.fit() compute rows=1 — the PTY
      // then spawns bash with LINES=1, which crashes readline's redisplay
      // the moment any command produces scrollable output. Require a
      // plausible minimum before trusting a measurement as final.
      if (
        rect.width >= 100 &&
        rect.height >= 100 &&
        rect.width === lastWidth &&
        rect.height === lastHeight
      ) {
        stableTicks += 1
        if (stableTicks >= requiredStableTicks) finish()
      } else {
        stableTicks = 0
        lastWidth = rect.width
        lastHeight = rect.height
      }
    })
    ro.observe(container)
  })

type TerminalColors = {
  background: string
  foreground: string
  cursor: string
  cursorAccent: string
  selectionBackground: string
  selectionForeground: string
  black: string
  red: string
  green: string
  yellow: string
  blue: string
  magenta: string
  cyan: string
  white: string
  brightBlack: string
  brightRed: string
  brightGreen: string
  brightYellow: string
  brightBlue: string
  brightMagenta: string
  brightCyan: string
  brightWhite: string
}

const DEFAULT_TERMINAL_COLORS: Record<"light" | "dark", TerminalColors> = {
  light: {
    background: "#fcfcfc",
    foreground: "#211e1e",
    cursor: "#211e1e",
    cursorAccent: "#fcfcfc",
    selectionBackground: withAlpha("#211e1e", 0.2),
    selectionForeground: "#211e1e",
    black: "#000000",
    red: "#cd3131",
    green: "#00bc7c",
    yellow: "#c09b00",
    blue: "#2472c8",
    magenta: "#bc3fbc",
    cyan: "#0fa8cd",
    white: "#555555",
    brightBlack: "#666666",
    brightRed: "#e45649",
    brightGreen: "#50a14f",
    brightYellow: "#c18401",
    brightBlue: "#4078f2",
    brightMagenta: "#a626a4",
    brightCyan: "#0184bc",
    brightWhite: "#211e1e",
  },
  dark: {
    background: "#191515",
    foreground: "#d4d4d4",
    cursor: "#d4d4d4",
    cursorAccent: "#191515",
    selectionBackground: withAlpha("#d4d4d4", 0.25),
    selectionForeground: "#ffffff",
    black: "#1e1e1e",
    red: "#f44747",
    green: "#6a9955",
    yellow: "#d7ba7d",
    blue: "#569cd6",
    magenta: "#c586c0",
    cyan: "#4ec9b0",
    white: "#d4d4d4",
    brightBlack: "#808080",
    brightRed: "#f14c4c",
    brightGreen: "#73c991",
    brightYellow: "#e2c08d",
    brightBlue: "#6cb6ff",
    brightMagenta: "#d670d6",
    brightCyan: "#29b8db",
    brightWhite: "#ffffff",
  },
}

const debugTerminal = (...values: unknown[]) => {
  if (!import.meta.env.DEV) return
  console.debug("[terminal]", ...values)
}

const errorName = (err: unknown) => {
  if (!err || typeof err !== "object") return
  if (!("name" in err)) return
  const errorName = err.name
  return typeof errorName === "string" ? errorName : undefined
}

const useTerminalUiBindings = (input: {
  container: HTMLDivElement
  term: Term
  cleanups: VoidFunction[]
  handlePointerDown: (e: PointerEvent) => void
  handleLinkClick: (event: MouseEvent) => void
}) => {
  const handleCopy = (event: ClipboardEvent) => {
    const selection = input.term.getSelection()
    if (!selection) return

    const clipboard = event.clipboardData
    if (!clipboard) return

    event.preventDefault()
    clipboard.setData("text/plain", selection)
  }

  const handlePaste = (event: ClipboardEvent) => {
    const clipboard = event.clipboardData
    const text = clipboard?.getData("text/plain") ?? clipboard?.getData("text") ?? ""
    if (!text) return

    event.preventDefault()
    event.stopPropagation()
    input.term.paste(text)
  }

  const handleTextareaFocus = () => {
    input.term.options.cursorBlink = true
  }
  const handleTextareaBlur = () => {
    input.term.options.cursorBlink = false
  }

  input.container.addEventListener("copy", handleCopy, true)
  input.cleanups.push(() => input.container.removeEventListener("copy", handleCopy, true))

  input.container.addEventListener("paste", handlePaste, true)
  input.cleanups.push(() => input.container.removeEventListener("paste", handlePaste, true))

  input.container.addEventListener("pointerdown", input.handlePointerDown)
  input.cleanups.push(() => input.container.removeEventListener("pointerdown", input.handlePointerDown))

  // --- mobile touch: drag-to-scroll (pointermove swipe detection) ---
  // We do NOT intercept touchend or pointerup — Ghostty's internal
  // `canvas.addEventListener("touchend", …)` handler is allowed to fire
  // (it calls `textarea.focus()` which is the ONLY reliable way to attach
  // the Android softkeyboard IME to the hidden textarea). Tap therefore
  // behaves exactly as on HEAD (opens keyboard), and we only add a new
  // pointermove-driven swipe gesture that scrolls the scrollback in place.
  const MOBILE_SWIPE_THRESHOLD_PX = 8

  type TouchMode = "pending" | "swipe"
  let currentTouch: { id: number; x: number; y: number; mode: TouchMode; scrollApplied: number } | null = null
  // Chromium fires `pointerup` before `touchend` for the same gesture
  // (confirmed on-device: ~0.2ms apart, consistently pointerup-first across
  // every touch sequence captured). `onTouchEndOrCancel` used to null
  // `currentTouch` on pointerup, so by the time `blockTouchEndIfSwipe` ran
  // on the later touchend, `currentTouch?.mode` always read as `undefined`
  // — the swipe check never matched and scrolling always opened the
  // keyboard. Capture the verdict before nulling so touchend can still see it.
  let lastGestureWasSwipe = false

  const mobileCharHeight = () => {
    const rows = input.term.rows || 24
    return Math.max(8, input.container.clientHeight / rows)
  }

  // Ghostty registers `canvas.addEventListener("mousedown", () => …focus())`
  // unconditionally (no button check) — meant for desktop mouse clicks, but
  // Chromium also synthesizes a compatibility `mousedown` from an unhandled
  // touch sequence for legacy web compat. `preventDefault` on `touchstart` is
  // the standard way to suppress that synthesis; kept as defense in depth,
  // though it turned out NOT to be the actual cause of scroll reopening the
  // keyboard (see below).
  //
  // Root cause, confirmed on-device: dismissing the keyboard (back button /
  // tap outside) never actually calls `.blur()` on the hidden textarea — it
  // only hides the IME UI. `document.activeElement` stays the textarea
  // (verified: `vvHeight` back to full/no-keyboard while `activeElement` is
  // still the terminal's textarea). Android's InputMethodManager can then
  // re-show the keyboard on the NEXT touch of that still-focused view
  // entirely at the platform level — independent of touchend, mousedown, or
  // any `preventDefault()`, which is why blocking those JS events alone never
  // stopped it. Blurring on every touchstart removes DOM focus before that
  // native reshow can act; Ghostty's own touchend handler still calls
  // `.focus()` for a genuine tap (mode never reaches "swipe"), so tap-to-open
  // is unaffected — only scrolling now stays blurred throughout.
  const suppressSyntheticMouseEvents = (e: TouchEvent) => {
    e.preventDefault()
    input.term.textarea?.blur()
  }
  const touchStartOptions: AddEventListenerOptions = { capture: true, passive: false }
  input.container.addEventListener("touchstart", suppressSyntheticMouseEvents, touchStartOptions)
  input.cleanups.push(() =>
    input.container.removeEventListener("touchstart", suppressSyntheticMouseEvents, touchStartOptions),
  )

  const onTouchDownCapture = (e: PointerEvent) => {
    if (e.pointerType !== "touch" || currentTouch) return
    currentTouch = { id: e.pointerId, x: e.clientX, y: e.clientY, mode: "pending", scrollApplied: 0 }
  }

  const onTouchMoveCapture = (e: PointerEvent) => {
    if (!currentTouch || e.pointerId !== currentTouch.id) return
    const dy = e.clientY - currentTouch.y

    if (currentTouch.mode === "pending") {
      if (Math.hypot(e.clientX - currentTouch.x, dy) < MOBILE_SWIPE_THRESHOLD_PX) return
      currentTouch.mode = "swipe"
    }

    // Swipe mode: consume the event so the surrounding app scroller does
    // not also pan. ghostty clamps scrollLines at the buffer edges.
    e.preventDefault()
    e.stopPropagation()
    // Drag-down = walking back in history = scroll UP (negative delta).
    const targetRowsFromStart = Math.round(-dy / mobileCharHeight())
    const delta = targetRowsFromStart - currentTouch.scrollApplied
    if (delta === 0) return
    input.term.scrollLines(delta)
    currentTouch.scrollApplied = targetRowsFromStart
  }

  const onTouchEndOrCancel = (e: PointerEvent) => {
    if (!currentTouch || e.pointerId !== currentTouch.id) return
    lastGestureWasSwipe = currentTouch.mode === "swipe"
    currentTouch = null
    // DO NOT preventDefault/stopPropagation here — Ghostty's native
    // touchend handler on the canvas must still fire so the IME attaches
    // correctly to the textarea. This is the lesson from the 2026-04-23
    // regression where blocking touchend left the softkeyboard visually
    // open but keystrokes never reached the textarea.
  }

  const touchCaptureOptions: AddEventListenerOptions = { capture: true }
  const touchMoveOptions: AddEventListenerOptions = { capture: true, passive: false }
  input.container.addEventListener("pointerdown", onTouchDownCapture, touchCaptureOptions)
  input.container.addEventListener("pointermove", onTouchMoveCapture, touchMoveOptions)
  input.container.addEventListener("pointerup", onTouchEndOrCancel, touchCaptureOptions)
  input.container.addEventListener("pointercancel", onTouchEndOrCancel, touchCaptureOptions)
  input.cleanups.push(() => {
    input.container.removeEventListener("pointerdown", onTouchDownCapture, touchCaptureOptions)
    input.container.removeEventListener("pointermove", onTouchMoveCapture, touchMoveOptions)
    input.container.removeEventListener("pointerup", onTouchEndOrCancel, touchCaptureOptions)
    input.container.removeEventListener("pointercancel", onTouchEndOrCancel, touchCaptureOptions)
  })

  // Prevent Ghostty's `canvas.addEventListener("touchend", g.focus())` ONLY
  // when the gesture was a swipe — so scrolling never toggles the
  // softkeyboard state. For taps (mode stays "pending"), we let touchend
  // bubble to the canvas so Ghostty attaches the Android IME normally.
  // This conditional block is safe where the v3.2 attempt (unconditional
  // stopImmediatePropagation on touchend) was not. Reads `lastGestureWasSwipe`
  // (captured synchronously in onTouchEndOrCancel's pointerup/pointercancel
  // handler) rather than `currentTouch?.mode`, which is always already null
  // by the time this touchend handler runs.
  //
  // Also blocks while `currentTouch` is still non-null (another pointer is
  // still actively tracked): confirmed on-device that Android reports a
  // second, ~4ms-lived pointer (its own distinct pointerId) partway through
  // a real one-finger scroll. `onTouchDownCapture` already ignores that
  // second pointerdown (`if (... || currentTouch) return`), so its matching
  // pointerup never reaches `onTouchEndOrCancel` either (pointerId mismatch)
  // and `lastGestureWasSwipe` is never updated for it — leaving this touchend
  // to fall through on a stale value from whatever gesture came before.
  // Any touchend arriving while a swipe is still in progress is spurious by
  // definition (a real tap-to-focus never overlaps another active touch).
  const blockTouchEndIfSwipe = (e: TouchEvent) => {
    if (lastGestureWasSwipe || currentTouch) {
      e.stopPropagation()
    }
  }
  const touchBlockerOptions: AddEventListenerOptions = { capture: true, passive: true }
  input.container.addEventListener("touchend", blockTouchEndIfSwipe, touchBlockerOptions)
  input.container.addEventListener("touchcancel", blockTouchEndIfSwipe, touchBlockerOptions)
  input.cleanups.push(() => {
    input.container.removeEventListener("touchend", blockTouchEndIfSwipe, touchBlockerOptions)
    input.container.removeEventListener("touchcancel", blockTouchEndIfSwipe, touchBlockerOptions)
  })

  input.container.addEventListener("click", input.handleLinkClick, {
    capture: true,
  })
  input.cleanups.push(() =>
    input.container.removeEventListener("click", input.handleLinkClick, {
      capture: true,
    }),
  )

  input.term.textarea?.addEventListener("focus", handleTextareaFocus)
  input.term.textarea?.addEventListener("blur", handleTextareaBlur)
  input.cleanups.push(() => input.term.textarea?.removeEventListener("focus", handleTextareaFocus))
  input.cleanups.push(() => input.term.textarea?.removeEventListener("blur", handleTextareaBlur))
}

const persistTerminal = (input: {
  term: Term | undefined
  addon: SerializeAddon | undefined
  cursor: number
  id: string
  onCleanup?: (pty: Partial<LocalPTY> & { id: string }) => void
}) => {
  if (!input.addon || !input.onCleanup || !input.term) return
  const buffer = (() => {
    try {
      return input.addon.serialize()
    } catch {
      debugTerminal("failed to serialize terminal buffer")
      return ""
    }
  })()

  input.onCleanup({
    id: input.id,
    buffer,
    cursor: input.cursor,
    rows: input.term.rows,
    cols: input.term.cols,
    scrollY: input.term.getViewportY(),
  })
}

export const Terminal = (props: TerminalProps) => {
  const platform = usePlatform()
  const sdk = useSDK()
  const terminalCtx = useTerminal()
  const settings = useSettings()
  const theme = useTheme()
  const language = useLanguage()
  const server = useServer()
  const directory = sdk.directory
  const client = sdk.client
  // Read credentials reactively from the current server connection — if the
  // sidecar is restarted (e.g. when remote access is toggled) we must pick
  // up the fresh url/password instead of a stale snapshot taken at mount.
  const currentAuth = () => {
    const http = server.current?.http
    if (!http) return undefined
    return {
      url: http.url,
      username: http.username ?? "opencode",
      password: http.password ?? "",
    }
  }
  const MAX_CONNECT_TRIES = 5
  const addDebug = (msg: string) => {
    // Always log (was gated on import.meta.env.DEV). v5 diagnostic build:
    // we need these checkpoints visible in production DevTools (F12) to
    // trace where the terminal mount fails when the pane is empty. Revert
    // the unconditional log once the terminal regression is resolved.
    console.info("[terminal-debug]", msg)
  }
  let container!: HTMLDivElement
  const [local, others] = splitProps(props, ["pty", "class", "classList", "autoFocus", "onConnect", "onConnectError", "onSend"])
  const id = local.pty.id
  const probe = terminalProbe(id)
  const restore = typeof local.pty.buffer === "string" ? local.pty.buffer : ""
  const restoreSize =
    restore &&
    typeof local.pty.cols === "number" &&
    Number.isSafeInteger(local.pty.cols) &&
    local.pty.cols > 0 &&
    typeof local.pty.rows === "number" &&
    Number.isSafeInteger(local.pty.rows) &&
    local.pty.rows > 0
      ? { cols: local.pty.cols, rows: local.pty.rows }
      : undefined
  const scrollY = typeof local.pty.scrollY === "number" ? local.pty.scrollY : undefined
  let ws: WebSocket | undefined
  let term: Term | undefined
  let _ghostty: Ghostty
  let serializeAddon: SerializeAddon
  let fitAddon: FitAddon
  let handleResize: () => void
  let fitFrame: number | undefined
  let sizeTimer: ReturnType<typeof setTimeout> | undefined
  let pendingSize: { cols: number; rows: number } | undefined
  let lastSize: { cols: number; rows: number } | undefined
  let disposed = false
  const cleanups: VoidFunction[] = []
  const start =
    typeof local.pty.cursor === "number" && Number.isSafeInteger(local.pty.cursor) ? local.pty.cursor : undefined
  let cursor = start ?? 0
  let seek = start !== undefined ? start : restore ? -1 : 0
  let output: ReturnType<typeof terminalWriter> | undefined
  let drop: VoidFunction | undefined
  let reconn: ReturnType<typeof setTimeout> | undefined
  let tries = 0

  const cleanup = () => {
    if (!cleanups.length) return
    const fns = cleanups.splice(0).reverse()
    for (const fn of fns) {
      try {
        fn()
      } catch (err) {
        debugTerminal("cleanup failed", err)
      }
    }
  }

  const pushSize = (cols: number, rows: number) => {
    return client.pty
      .update({
        ptyID: id,
        size: { cols, rows },
      })
      .catch((err) => {
        debugTerminal("failed to sync terminal size", err)
      })
  }

  const getTerminalColors = (): TerminalColors => {
    const mode = theme.mode() === "dark" ? "dark" : "light"
    const fallback = DEFAULT_TERMINAL_COLORS[mode]
    const currentTheme = theme.themes()[theme.themeId()]
    if (!currentTheme) return fallback
    const variant = mode === "dark" ? currentTheme.dark : currentTheme.light
    if (!variant?.seeds && !variant?.palette) return fallback
    const resolved = resolveThemeVariant(variant, mode === "dark")
    const text = resolved["text-stronger"] ?? fallback.foreground
    const background = resolved["background-stronger"] ?? fallback.background
    const alpha = mode === "dark" ? 0.25 : 0.2
    const base = text.startsWith("#") ? (text as HexColor) : (fallback.foreground as HexColor)
    const selectionBackground = withAlpha(base, alpha)
    return {
      ...fallback,
      background,
      foreground: text,
      cursor: text,
      cursorAccent: background,
      selectionBackground,
    }
  }

  const terminalColors = createMemo(getTerminalColors)

  const scheduleFit = () => {
    if (disposed) return
    if (!fitAddon) return
    if (fitFrame !== undefined) return

    fitFrame = requestAnimationFrame(() => {
      fitFrame = undefined
      if (disposed) return
      fitAddon.fit()
    })
  }

  const scheduleSize = (cols: number, rows: number) => {
    if (disposed) return
    if (lastSize?.cols === cols && lastSize?.rows === rows) return

    pendingSize = { cols, rows }

    if (!lastSize) {
      lastSize = pendingSize
      void pushSize(cols, rows)
      return
    }

    if (sizeTimer !== undefined) return
    sizeTimer = setTimeout(() => {
      sizeTimer = undefined
      const next = pendingSize
      if (!next) return
      pendingSize = undefined
      if (disposed) return
      if (lastSize?.cols === next.cols && lastSize?.rows === next.rows) return
      lastSize = next
      void pushSize(next.cols, next.rows)
    }, 100)
  }

  createEffect(() => {
    const colors = terminalColors()
    if (!term) return
    setOptionIfSupported(term, "theme", colors)
  })

  createEffect(() => {
    const font = monoFontFamily(settings.appearance.font())
    if (!term) return
    setOptionIfSupported(term, "fontFamily", font)
    scheduleFit()
  })

  let zoom = platform.webviewZoom?.()
  createEffect(() => {
    const next = platform.webviewZoom?.()
    if (next === undefined) return
    if (next === zoom) return
    zoom = next
    scheduleFit()
  })

  const focusTerminal = () => {
    const t = term
    if (!t) return
    t.focus()
    t.textarea?.focus()
    setTimeout(() => t.textarea?.focus(), 0)
  }
  const handlePointerDown = (e: PointerEvent) => {
    const activeElement = document.activeElement
    if (activeElement instanceof HTMLElement && activeElement !== container && !container.contains(activeElement)) {
      activeElement.blur()
    }
    // Root cause of "scroll reopens the keyboard" (confirmed on-device):
    // this fired unconditionally on every pointerdown, calling
    // `t.textarea?.focus()` before the swipe-vs-tap gesture below had any
    // chance to classify the touch — refocusing the (possibly just-blurred)
    // textarea instantly re-arms Android's native keyboard-on-focused-touch
    // behavior regardless of whether the gesture turns out to be a scroll.
    // Ghostty's own touchend handler already focuses the terminal correctly
    // for a genuine tap (gated by `blockTouchEndIfSwipe` below), so touch
    // pointers skip this eager focus entirely; non-touch pointers (mouse)
    // keep the original immediate focus-on-click behavior.
    if (e.pointerType === "touch") return
    focusTerminal()
  }

  const handleLinkClick = (event: MouseEvent) => {
    if (!event.shiftKey && !event.ctrlKey && !event.metaKey) return
    if (event.altKey) return
    if (event.button !== 0) return

    const t = term
    if (!t) return

    const text = getHoveredLinkText(t)
    if (!text) return

    event.preventDefault()
    event.stopImmediatePropagation()
    platform.openLink(text)
  }

  onMount(() => {
    probe.init()
    cleanups.push(() => probe.drop())

    const run = async () => {
      addDebug("run() started")
      let loaded: Awaited<ReturnType<typeof loadGhostty>>
      try {
        loaded = await loadGhostty()
      } catch (err) {
        addDebug(`FATAL loadGhostty: ${err instanceof Error ? err.message : String(err)}`)
        throw err
      }
      if (disposed) return

      const mod = loaded.mod
      const g = loaded.ghostty
      addDebug(`ghostty WASM: ${g ? "loaded OK" : "UNDEFINED"}`)

      if (!g) {
        addDebug("FATAL: ghostty-vt.wasm failed to load")
        throw new Error("[terminal] ghostty-vt.wasm failed to load — cannot render terminal")
      }

      let t: Term
      try {
        t = new mod.Terminal({
          cursorBlink: true,
          cursorStyle: "bar",
          cols: restoreSize?.cols,
          rows: restoreSize?.rows,
          fontSize: 14,
          fontFamily: monoFontFamily(settings.appearance.font()),
          allowTransparency: false,
          convertEol: false,
          theme: terminalColors(),
          scrollback: 10_000,
          ...(g ? { ghostty: g } : {}),
        })
        addDebug("Terminal instance created OK")
      } catch (err) {
        addDebug(`FATAL new Terminal(): ${err instanceof Error ? err.message : String(err)}`)
        throw err
      }
      cleanups.push(() => t.dispose())
      if (disposed) {
        cleanup()
        return
      }
      if (g) _ghostty = g
      term = t
      output = terminalWriter((data, done) =>
        t.write(data, () => {
          probe.render(data)
          probe.settle()
          done?.()
        }),
      )

      t.attachCustomKeyEventHandler((event) => {
        const key = event.key.toLowerCase()

        if (event.ctrlKey && event.shiftKey && !event.metaKey && key === "c") {
          document.execCommand("copy")
          return true
        }

        // allow for toggle terminal keybinds in parent
        const config = settings.keybinds.get(TOGGLE_TERMINAL_ID) ?? DEFAULT_TOGGLE_TERMINAL_KEYBIND
        const keybinds = parseKeybind(config)

        return matchKeybind(keybinds, event)
      })

      const fit = new mod.FitAddon()
      const serializer = new SerializeAddon()
      cleanups.push(() => disposeIfDisposable(fit))
      t.loadAddon(serializer)
      t.loadAddon(fit)
      fitAddon = fit
      serializeAddon = serializer

      try {
        t.open(container)
        const rect = container.getBoundingClientRect()
        addDebug(`t.open() OK — container: ${Math.round(rect.width)}x${Math.round(rect.height)} inDOM:${document.contains(container)}`)
      } catch (err) {
        addDebug(`FATAL t.open(): ${err instanceof Error ? err.message : String(err)}`)
        throw err
      }
      useTerminalUiBindings({
        container,
        term: t,
        cleanups,
        handlePointerDown,
        handleLinkClick,
      })

      if (local.autoFocus !== false) focusTerminal()

      if (typeof document !== "undefined" && document.fonts) {
        // The very first `fit.fit()` below measures cell width using
        // whatever font is currently active. If the monospace font hasn't
        // finished loading yet, that measurement (and, for a brand-new PTY,
        // the exact spawn size — see the lazy-create comment below) is
        // wrong. A later correction then forces a real SIGWINCH, which is
        // exactly the readline redraw glitch this code is trying to avoid:
        // the shell briefly redraws its prompt at the wrong column count,
        // showing it truncated and stripped of its color codes. Waiting
        // here (bounded so a slow/stuck font never blocks the terminal)
        // makes the first measurement correct instead of self-correcting.
        await Promise.race([
          document.fonts.ready,
          new Promise<void>((resolve) => setTimeout(resolve, 200)),
        ])
        document.fonts.ready.then(scheduleFit)
      }

      const onResize = t.onResize((size) => {
        scheduleSize(size.cols, size.rows)
      })
      cleanups.push(() => disposeIfDisposable(onResize))
      const onData = t.onData((data) => {
        if (ws?.readyState === WebSocket.OPEN) ws.send(data)
      })
      cleanups.push(() => disposeIfDisposable(onData))
      const onKey = t.onKey((key) => {
        if (key.key === "Enter") {
          props.onSubmit?.()
        }
      })
      cleanups.push(() => disposeIfDisposable(onKey))

      const startResize = (opts?: { skipFixedDelayRefits?: boolean }) => {
        fit.observeResize()
        handleResize = scheduleFit
        window.addEventListener("resize", handleResize)
        cleanups.push(() => window.removeEventListener("resize", handleResize))

        // Android portrait bug: at mount time, the container dimensions
        // reported by getBoundingClientRect() can be stale — the viewport is
        // still settling (soft keyboard animation, safe-area inset, address
        // bar collapse). This leaves the terminal initialised with too-small
        // cols/rows, the cursor lands outside the visible area, and the
        // first prompt is invisible until the user types (which triggers a
        // SIGWINCH → correct repaint).
        //
        // Two guards:
        //   1. ResizeObserver on the container — catches every dimension
        //      change, including post-mount viewport settling and keyboard
        //      toggle. `fit.observeResize()` already watches the terminal
        //      internal element but not the outer container we control.
        //   2. A few delayed refits covering the window where the viewport
        //      stabilizes (50ms / 200ms / 500ms). Cheap, idempotent — EXCEPT
        //      for a lazy-created terminal (`skipFixedDelayRefits`): its
        //      pre-spawn measurement is already settled (see
        //      `waitForStableContainerSize` above), and the shell prints its
        //      first prompt within single-digit milliseconds — well before
        //      these timers fire. By then the server's `firstOutputAt` is
        //      already set, so ANY of these timers computing even a
        //      one-column difference (subpixel/rounding jitter) pushes a
        //      resize the server treats as a genuine mid-session one
        //      (its own pre-first-output hold window, see
        //      `pty/index.ts::applyResize`, no longer applies) — a real
        //      SIGWINCH lands right after the prompt is already drawn,
        //      which is exactly the readline pad-erase redisplay glitch
        //      this whole mechanism exists to avoid. Skip them here; a
        //      lazy-created terminal only needs to react to genuine later
        //      events (ResizeObserver, orientationchange), not a blind
        //      just-in-case re-measure.
        if (typeof ResizeObserver !== "undefined") {
          const ro = new ResizeObserver(() => scheduleFit())
          ro.observe(container)
          cleanups.push(() => ro.disconnect())
        }
        const refreshTimers: ReturnType<typeof setTimeout>[] = []
        for (const delay of opts?.skipFixedDelayRefits ? [] : [50, 200, 500]) {
          refreshTimers.push(
            setTimeout(() => {
              if (disposed) return
              try {
                fit.fit()
                // After `fit.fit()` only the renderer is reshaped — the
                // Rust-side PTY stays on whatever dims we sent last time.
                // Force-push the current cols/rows so the shell gets a
                // SIGWINCH with real dims and re-emits the prompt.
                // `scheduleSize` is idempotent via `lastSize` guard.
                scheduleSize(t.cols, t.rows)
                // Force a full repaint so the first prompt (already received
                // from the PTY) becomes visible even if the terminal
                // internals think the screen is unchanged. `refresh` is an
                // xterm.js-compatible method not guaranteed on ghostty-web,
                // hence the optional chain.
                const refresh = (t as unknown as { refresh?: (s: number, e: number) => void }).refresh
                refresh?.call(t, 0, Math.max(0, t.rows - 1))
              } catch {
                // ignore — disposed or not yet fully open
              }
            }, delay),
          )
        }
        cleanups.push(() => {
          for (const timer of refreshTimers) clearTimeout(timer)
        })

        // `orientationchange` fires before the viewport resizes on Android;
        // chain a post-event refit so the PTY is notified once the new
        // dimensions settle.
        const handleOrientation = () => {
          setTimeout(() => {
            if (disposed) return
            try {
              fit.fit()
              scheduleSize(t.cols, t.rows)
            } catch { /* ignore */ }
          }, 200)
        }
        window.addEventListener("orientationchange", handleOrientation)
        cleanups.push(() => window.removeEventListener("orientationchange", handleOrientation))
      }

      const write = (data: string) =>
        new Promise<void>((resolve) => {
          if (!output) {
            resolve()
            return
          }
          output.push(data)
          output.flush(resolve)
        })

      if (restore && restoreSize) {
        await write(restore)
        fit.fit()
        scheduleSize(t.cols, t.rows)
        if (scrollY !== undefined) t.scrollToLine(scrollY)
        startResize()
      } else {
        // FitAddon.proposeDimensions() (ghostty-web source) measures
        // `t.element` — the element ghostty-web creates *inside* our
        // `container` — via clientWidth/clientHeight, NOT `container`
        // itself. Its sizing can settle on a different schedule than the
        // outer container we control, so that's the element to wait on.
        const wasLazyCreate = local.pty._pending
        if (wasLazyCreate) await waitForStableContainerSize(t.element ?? container)
        fit.fit()
        if (wasLazyCreate) {
          // Lazy-create: backend has no session for this id yet. Call
          // pty.create with the *exact* grid dims measured above — now that
          // waitForStableContainerSize() above has confirmed the container
          // isn't still mid-layout. The shell spawns at final size so no
          // SIGWINCH is ever emitted and mksh's readline pad-erase
          // redisplay never fires — fixes the portrait first-prompt bug at
          // its root.
          // FORK (P5 investigation, 2026-07-09): dump the EXACT measurement
          // feeding pty.create(). PTY-Server native logs show all sessions
          // are spawned with cols=36 rows=1 (bash LINES=1), but the visible
          // container is ~43 cols x ~7 rows. Suspect: waitForStableContainerSize
          // returned early on a transient 1-row stable state. Capture before/after
          // waitForStableContainerSize + the actual t.cols/t.rows + container +
          // t.element rect to identify the race.
          {
            const contRect = container.getBoundingClientRect()
            const elemRect = (t.element ?? container).getBoundingClientRect()
            console.log(
              "[term-investigation] lazy-create measurement",
              JSON.stringify({
                id,
                tCols: t.cols,
                tRows: t.rows,
                containerRect: { w: Math.round(contRect.width), h: Math.round(contRect.height) },
                tElementRect: { w: Math.round(elemRect.width), h: Math.round(elemRect.height) },
                tColsExpected: Math.floor(elemRect.width / 8.4),
                tRowsExpected: Math.floor(elemRect.height / 17),
              }),
            )
          }
          // FORK (P1, 2026-07-09): SDK default `throwOnError:false` returns
          // errors via `res.error` instead of throwing. The previous try/catch
          // was unreachable on HTTP errors, so a failed lazy-create left
          // the pending entry in the store forever. Read `res.error` explicitly.
          const createRes = await client.pty.create({
            id,
            title: local.pty.title,
            cols: t.cols,
            rows: t.rows,
            // FORK: ADR-0005 task runner — run a specific command instead of
            // the default shell when set via terminal.newWithCommand().
            ...(local.pty.command ? { command: local.pty.command } : {}),
          })
          if (createRes.error) {
            // FORK (P5 investigation, 2026-07-09): trace lazy-create failure
            // (Site 4 from P1). If this fires alongside failPending in the
            // context, lazy-create is rejecting a tab — but it should NOT be
            // the active tab if the device is past the welcome screen.
            console.log(
              "[term-investigation] lazy-create pty.create failed",
              JSON.stringify({
                id,
                title: local.pty.title,
                cols: t.cols,
                rows: t.rows,
                isPending: local.pty._pending,
                errorName: (createRes.error as { name?: string })?.name,
                errorMessage:
                  createRes.error instanceof Error ? createRes.error.message : String(createRes.error),
              }),
            )
            addDebug(`pty.create failed: ${createRes.error instanceof Error ? createRes.error.message : String(createRes.error)}`)
            terminalCtx.failPending(id)
            throw createRes.error
          }
          // Pre-seed lastSize so the immediate scheduleSize below (and the
          // ones from WS open / ResizeObserver if dims are still identical)
          // are no-ops and never trigger a PUT /pty/:id.
          lastSize = { cols: t.cols, rows: t.rows }
          terminalCtx.finalizePending(id)
        }
        scheduleSize(t.cols, t.rows)
        if (restore) {
          await write(restore)
          if (scrollY !== undefined) t.scrollToLine(scrollY)
        }
        startResize({ skipFixedDelayRefits: wasLazyCreate })
      }

      const once = { value: false }
      const decoder = new TextDecoder()

      const fail = (err: unknown) => {
        if (disposed) return
        if (once.value) return
        once.value = true
        // FORK (P5 investigation, 2026-07-09): WS path. If this fires for the
        // T2 id when the user presses Enter, the bug is on the frontend side
        // (WS dropped, retry exhausted), not the backend killing bash.
        console.log(
          "[term-investigation] terminal fail() (WS retry exhausted or auth failed)",
          JSON.stringify({
            id,
            errMessage: err instanceof Error ? err.message : String(err),
          }),
        )
        local.onConnectError?.(err)
      }

      // FORK (P1, 2026-07-09): SDK default `throwOnError:false` returns
      // `{data: undefined, error: {name, ...}}` for non-2xx instead of
      // throwing. Reading `res.error` is the only way to detect NotFoundError
      // here. The previous `.then/.catch` chain was unreachable on HTTP
      // errors, so `gone()` always returned false and `retry()` consumed
      // all 5 attempts before falling back to clone().
      const gone = async () => {
        const res = await client.pty.get({ ptyID: id })
        if (res.error && (res.error as { name?: string }).name === "NotFoundError") return true
        if (res.error) debugTerminal("failed to inspect terminal session", res.error)
        return false
      }

      const retry = (err: unknown) => {
        if (disposed) return
        if (reconn !== undefined) return

        if (tries >= MAX_CONNECT_TRIES) {
          fail(err)
          return
        }

        const ms = Math.min(250 * 2 ** Math.min(tries, 4), 4_000)
        reconn = setTimeout(async () => {
          reconn = undefined
          if (disposed) return
          if (await gone()) {
            if (disposed) return
            fail(err)
            return
          }
          if (disposed) return
          tries += 1
          open()
        }, ms)
      }

      const open = () => {
        if (disposed) return
        drop?.()

        const auth = currentAuth()
        if (!auth || !auth.url || !auth.password) {
          addDebug(`WS auth missing: url=${!!auth?.url} pass=${!!auth?.password}`)
          fail(new Error(language.t("terminal.connectionLost.abnormalClose", { code: 401 })))
          return
        }

        // Synchronous WebSocket construction + listener attachment.
        // Sprint 4-6 tried to route this through createAuthenticatedWebSocket
        // (async ticket fetch with legacy fallback) but the async boundary
        // between `new WebSocket()` and the `.then()` that wires handlers lets
        // the `open` event fire first on fast loopback — `handleOpen` never
        // runs, terminal stays silent. Back to the e22886176 pattern: open +
        // attach in the same microtask, auth via `?authorization=Basic` query
        // string (Chromium/WebView2 drops URL userinfo + can't set the
        // Authorization header on WS upgrades, so query param is the only
        // browser-reachable legacy auth). The server-side ticket endpoint and
        // middleware (Sprints 4-6) stay wired for the next WS client migration.
        const basicToken = btoa(`${auth.username}:${auth.password}`)
        const next = new URL(auth.url + `/pty/${id}/connect`)
        next.searchParams.set("directory", directory)
        next.searchParams.set("cursor", String(seek))
        next.searchParams.set("authorization", `Basic ${basicToken}`)
        next.protocol = next.protocol === "https:" ? "wss:" : "ws:"

        const redactedParams = next.searchParams.toString().replace(/authorization=[^&]+/, "authorization=REDACTED")
        addDebug(`WS url: ${next.protocol}//${next.hostname}:${next.port}${next.pathname} params=${redactedParams}`)

        const socket = new WebSocket(next)
        socket.binaryType = "arraybuffer"
        ws = socket

        const handleOpen = () => {
          if (disposed) return
          addDebug("WS OPEN")
          tries = 0
          probe.connect()
          local.onConnect?.()
          scheduleSize(t.cols, t.rows)
        }

        let firstMessage = true
        const handleMessage = (event: MessageEvent) => {
          if (disposed) return
          if (firstMessage) {
            firstMessage = false
            const type = event.data instanceof ArrayBuffer ? `binary(${(event.data as ArrayBuffer).byteLength}B)` : `text(${String(event.data).length}ch)`
            addDebug(`WS first msg: ${type}`)
          }
          if (event.data instanceof ArrayBuffer) {
            const bytes = new Uint8Array(event.data)
            if (bytes[0] !== 0) return
            const json = decoder.decode(bytes.subarray(1))
            try {
              const meta = JSON.parse(json) as { cursor?: unknown }
              const nextCursor = meta?.cursor
              if (typeof nextCursor === "number" && Number.isSafeInteger(nextCursor) && nextCursor >= 0) {
                cursor = nextCursor
                seek = nextCursor
              }
            } catch (err) {
              debugTerminal("invalid websocket control frame", err)
            }
            return
          }

          const data = typeof event.data === "string" ? event.data : ""
          if (!data) return
          output?.push(data)
          cursor += data.length
          seek = cursor
        }

        const handleError = (error: Event) => {
          if (disposed) return
          addDebug(`WS ERROR: ${String(error)}`)
        }

        const stop = () => {
          socket.removeEventListener("open", handleOpen)
          socket.removeEventListener("message", handleMessage)
          socket.removeEventListener("error", handleError)
          socket.removeEventListener("close", handleClose)
          if (ws === socket) ws = undefined
          if (drop === stop) drop = undefined
          if (socket.readyState !== WebSocket.CLOSED && socket.readyState !== WebSocket.CLOSING) socket.close(1000)
        }

        const handleClose = (event: CloseEvent) => {
          addDebug(`WS CLOSE code=${event.code} reason=${event.reason || "(none)"}`)
          if (ws === socket) ws = undefined
          if (drop === stop) drop = undefined
          socket.removeEventListener("open", handleOpen)
          socket.removeEventListener("message", handleMessage)
          socket.removeEventListener("error", handleError)
          socket.removeEventListener("close", handleClose)
          if (disposed) return
          if (event.code === 1000) return
          retry(new Error(language.t("terminal.connectionLost.abnormalClose", { code: event.code })))
        }

        drop = stop
        socket.addEventListener("open", handleOpen)
        socket.addEventListener("message", handleMessage)
        socket.addEventListener("error", handleError)
        socket.addEventListener("close", handleClose)
      }

      probe.control({
        disconnect: () => {
          if (!ws) return
          ws.close(4_000, "e2e")
        },
      })

      const sendBytes = (data: string) => {
        if (ws?.readyState === WebSocket.OPEN) ws.send(data)
      }
      local.onSend?.(sendBytes)
      cleanups.push(() => local.onSend?.(undefined))

      // Android suspends WebView JS timers/networking while the app is
      // backgrounded (screen lock, app switch). If the PTY WebSocket dies
      // during that window, the `close` event — and therefore `retry()`'s
      // exponential backoff — often only fires once the page is foregrounded
      // again, and the very first backoff step still takes up to 250ms. A
      // user unlocking their phone and typing immediately lands keystrokes
      // in that gap: `t.onData` only sends when `readyState === OPEN`, so
      // they are silently dropped with no queueing and no visible feedback.
      // Forcing an immediate reconnect check on visibility restore closes
      // that window instead of waiting for backoff. Mirrors the same
      // pattern already used for the SSE stream in global-sdk.tsx.
      const handleVisibility = () => {
        if (disposed) return
        if (document.visibilityState !== "visible") return
        if (ws && ws.readyState === WebSocket.OPEN) return
        if (reconn !== undefined) {
          clearTimeout(reconn)
          reconn = undefined
        }
        open()
      }
      document.addEventListener("visibilitychange", handleVisibility)
      cleanups.push(() => document.removeEventListener("visibilitychange", handleVisibility))

      open()
    }

    void run().catch((err) => {
      const msg = err instanceof Error ? `${err.message}\n${err.stack?.split("\n")[1] ?? ""}` : String(err)
      addDebug(`FATAL run(): ${msg}`)
      if (disposed) return
      showToast({
        variant: "error",
        title: language.t("terminal.connectionLost.title"),
        description: err instanceof Error ? err.message : language.t("terminal.connectionLost.description"),
      })
      // Don't trigger clone/reconnect for WASM loading failures — every new
      // terminal instance would fail the same way, creating an infinite loop.
      const isWasmError = err instanceof Error && err.message.includes("ghostty-vt.wasm")
      if (!isWasmError) local.onConnectError?.(err)
    })
  })

  onCleanup(() => {
    disposed = true
    if (fitFrame !== undefined) cancelAnimationFrame(fitFrame)
    if (sizeTimer !== undefined) clearTimeout(sizeTimer)
    if (reconn !== undefined) clearTimeout(reconn)
    drop?.()
    if (ws && ws.readyState !== WebSocket.CLOSED && ws.readyState !== WebSocket.CLOSING) ws.close(1000)

    const finalize = () => {
      persistTerminal({ term, addon: serializeAddon, cursor, id, onCleanup: props.onCleanup })
      cleanup()
    }

    if (!output) {
      finalize()
      return
    }

    output.flush(finalize)
  })

  return (
    <div
      ref={container}
      data-component="terminal"
      {...{ [terminalAttr]: id }}
      data-prevent-autofocus
      tabIndex={-1}
      style={{ "background-color": terminalColors().background }}
      classList={{
        ...(local.classList ?? {}),
        "select-text": true,
        "size-full px-6 py-3 font-mono relative overflow-hidden touch-none overscroll-contain": true,
        [local.class ?? ""]: !!local.class,
      }}
      {...others}
    />
  )
}
