import type { Terminal as Term } from "ghostty-web"

export const useTerminalUiBindings = (input: {
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

  // Ghostty's own `scrollLines` clamps at the buffer's live bottom (viewportY
  // 0) — dragging further has no effect, so the last prompt is stuck at the
  // bottom edge of the panel even when the on-screen keyboard covers most of
  // it. Fake "scrolling past the end" by translating the (already fully
  // rendered) canvas upward via CSS once the real scrollback is exhausted —
  // `getCanvasOffset()`/hit-testing inside ghostty-web reads
  // `canvas.getBoundingClientRect()`, which already reflects a CSS
  // transform, so tap/selection coordinates stay correct while overscrolled.
  const MAX_OVERSCROLL_FACTOR = 0.5
  let overscrollPx = 0
  const canvasEl = input.container.querySelector("canvas")

  const applyOverscroll = () => {
    if (!canvasEl) return
    canvasEl.style.transform = overscrollPx > 0 ? `translateY(-${overscrollPx}px)` : ""
  }

  // Overscroll is deliberately persistent — it must survive both incoming
  // shell output and the user's own typing, since the whole point is keeping
  // the last prompt visible above the on-screen keyboard while working. It
  // only changes via the drag-to-unwind path in onTouchMoveCapture below.
  //
  // The keyboard opening/closing still resizes `container` (via the
  // --vv-top/--vvh compensation), which re-fits the terminal grid. Since
  // `overscrollPx` is stored as an absolute pixel amount computed against
  // `container`'s height at drag time, if the keyboard then shrinks that
  // container, the same absolute offset becomes disproportionately large
  // relative to the new (smaller) height. Re-clamp it live so it never
  // exceeds MAX_OVERSCROLL_FACTOR of whatever the container's current height
  // is — this is the only thing that adjusts the offset outside a drag.
  const clampOverscrollToContainer = () => {
    const maxOverscrollPx = input.container.clientHeight * MAX_OVERSCROLL_FACTOR
    if (overscrollPx <= maxOverscrollPx) return
    overscrollPx = Math.max(0, maxOverscrollPx)
    applyOverscroll()
  }
  if (typeof ResizeObserver !== "undefined") {
    const overscrollResizeObserver = new ResizeObserver(clampOverscrollToContainer)
    overscrollResizeObserver.observe(input.container)
    input.cleanups.push(() => overscrollResizeObserver.disconnect())
  }

  // --- mobile touch: long-press to select text ---
  // Ghostty's own SelectionManager (selection-manager.ts) is entirely
  // mouse-event driven (mousedown/mousemove/mouseup/click on its canvas) —
  // it has no touch support and no public "select from pixel A to pixel B"
  // API (pixel<->cell conversion is private). Rather than duplicating that
  // already-tested logic (drag threshold, auto-scroll at edges, backwards-
  // selection swap, clipboard copy), a long-press dispatches real synthetic
  // MouseEvents at the same canvas element SelectionManager already listens
  // on, driving its existing state machine exactly as a real mouse would.
  const LONG_PRESS_MS = 500
  let longPressTimer: ReturnType<typeof setTimeout> | undefined
  // Tracks whether the finger moved at all while mode was "selecting", so
  // touchend knows whether to finalize (dispatch a synthetic mouseup) or
  // leave a long-press-only word selection untouched — see the dedicated
  // comment on that branch below for why finalizing an unmoved selection
  // would destroy it instead of keeping it.
  let selectionMoved = false
  let lastSelectingPoint: { x: number; y: number } | null = null

  const disarmLongPressTimer = () => {
    if (longPressTimer === undefined) return
    clearTimeout(longPressTimer)
    longPressTimer = undefined
  }
  input.cleanups.push(disarmLongPressTimer)

  const dispatchCanvasMouseEvent = (type: string, clientX: number, clientY: number, detail = 0) => {
    if (!canvasEl) return
    canvasEl.dispatchEvent(
      new MouseEvent(type, {
        clientX,
        clientY,
        button: 0,
        buttons: type === "mouseup" ? 0 : 1,
        bubbles: true,
        cancelable: true,
        detail,
      }),
    )
  }

  const beginSelection = (x: number, y: number) => {
    dispatchCanvasMouseEvent("mousedown", x, y)
    // Snap the long-press's initial grab to word granularity (matches
    // Android's native long-press-to-select) by replaying it as a
    // double-click through SelectionManager's own tested word-boundary
    // logic (getWordAtCell) — cheaper and safer than duplicating that
    // private method, which also needs screen-buffer rows Term doesn't
    // expose publicly (only getScrollbackLine/getScrollbackLength are).
    dispatchCanvasMouseEvent("click", x, y, 2)
  }

  type TouchMode = "pending" | "swipe" | "selecting"
  let currentTouch: { id: number; x: number; y: number; mode: TouchMode; scrollApplied: number } | null = null
  // Chromium fires `pointerup` before `touchend` for the same gesture
  // (confirmed on-device: ~0.2ms apart, consistently pointerup-first across
  // every touch sequence captured). `onTouchEndOrCancel` used to null
  // `currentTouch` on pointerup, so by the time `blockTouchEndIfGestureConsumed`
  // ran on the later touchend, `currentTouch?.mode` always read as `undefined`
  // — the swipe check never matched and scrolling always opened the
  // keyboard. Capture the verdict before nulling so touchend can still see it.
  // Covers both "swipe" and "selecting": releasing a text selection must
  // block Ghostty's native touchend->focus() exactly like a scroll release
  // does, or finishing a long-press-drag selection would reopen the
  // keyboard the same way scrolling used to.
  let lastGestureConsumedTouchEnd = false

  // Safety net: if a real pointerup/pointercancel is ever missed for the
  // tracked pointer (observed as a risk, not directly reproduced: Android can
  // drop a touch sequence without delivering either event to the WebView
  // when the view hierarchy resizes mid-touch, e.g. the keyboard showing or
  // hiding during a drag), `currentTouch` would otherwise stay non-null
  // forever. Combined with `blockTouchEndIfSwipe`'s `|| currentTouch` guard
  // below, a stuck `currentTouch` permanently stops Ghostty's own touchend
  // handler from ever firing again for this terminal instance — the tab
  // would look like it silently stopped accepting taps/keyboard focus, with
  // no way to recover short of creating a new tab. Auto-clear it if no
  // pointer activity refreshes this watchdog for a second; a real gesture
  // always finishes (or keeps moving) well within that window.
  const STUCK_TOUCH_TIMEOUT_MS = 1000
  let stuckTouchTimer: ReturnType<typeof setTimeout> | undefined
  const armStuckTouchWatchdog = () => {
    if (stuckTouchTimer !== undefined) clearTimeout(stuckTouchTimer)
    stuckTouchTimer = setTimeout(() => {
      stuckTouchTimer = undefined
      if (!currentTouch) return
      // A stuck "selecting" gesture that had moved left SelectionManager's
      // own isSelecting flag permanently true (no real mouseup ever arrives
      // to clear it) — finalize it the same way a normal release would
      // instead of abandoning it silently.
      if (currentTouch.mode === "selecting" && selectionMoved && lastSelectingPoint) {
        dispatchCanvasMouseEvent("mouseup", lastSelectingPoint.x, lastSelectingPoint.y)
      }
      lastGestureConsumedTouchEnd = currentTouch.mode !== "pending"
      currentTouch = null
    }, STUCK_TOUCH_TIMEOUT_MS)
  }
  const disarmStuckTouchWatchdog = () => {
    if (stuckTouchTimer === undefined) return
    clearTimeout(stuckTouchTimer)
    stuckTouchTimer = undefined
  }
  input.cleanups.push(disarmStuckTouchWatchdog)

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
    // A fresh touch inside the terminal is an explicit replacement of the
    // previous selection, including a long-press on another word.
    if (input.term.getSelection().length > 0) input.term.clearSelection()
    currentTouch = { id: e.pointerId, x: e.clientX, y: e.clientY, mode: "pending", scrollApplied: 0 }
    selectionMoved = false
    lastSelectingPoint = null
    armStuckTouchWatchdog()

    const pointerId = e.pointerId
    const x = e.clientX
    const y = e.clientY
    disarmLongPressTimer()
    longPressTimer = setTimeout(() => {
      longPressTimer = undefined
      // Only promote if the same touch is still down and hasn't already
      // been classified as a scroll (see the >=threshold branch below,
      // which disarms this timer the moment it fires).
      if (!currentTouch || currentTouch.id !== pointerId || currentTouch.mode !== "pending") return
      currentTouch.mode = "selecting"
      lastSelectingPoint = { x, y }
      beginSelection(x, y)
    }, LONG_PRESS_MS)
  }

  const onTouchMoveCapture = (e: PointerEvent) => {
    if (!currentTouch || e.pointerId !== currentTouch.id) return
    armStuckTouchWatchdog()

    if (currentTouch.mode === "selecting") {
      // Consume the event so the surrounding scroller never also pans
      // while extending a text selection.
      e.preventDefault()
      e.stopPropagation()
      selectionMoved = true
      lastSelectingPoint = { x: e.clientX, y: e.clientY }
      dispatchCanvasMouseEvent("mousemove", e.clientX, e.clientY)
      return
    }

    const dy = e.clientY - currentTouch.y

    if (currentTouch.mode === "pending") {
      if (Math.hypot(e.clientX - currentTouch.x, dy) < MOBILE_SWIPE_THRESHOLD_PX) return
      disarmLongPressTimer()
      currentTouch.mode = "swipe"
    }

    // Swipe mode: consume the event so the surrounding app scroller does
    // not also pan. ghostty clamps scrollLines at the buffer edges.
    e.preventDefault()
    e.stopPropagation()
    // Drag-down = walking back in history = scroll UP (negative delta).
    const targetRowsFromStart = Math.round(-dy / mobileCharHeight())
    const totalDelta = targetRowsFromStart - currentTouch.scrollApplied
    currentTouch.scrollApplied = targetRowsFromStart
    if (totalDelta === 0) return

    const charHeight = mobileCharHeight()
    let delta = totalDelta
    if (delta < 0 && overscrollPx > 0) {
      // Dragging back toward history: unwind the fake overscroll first so
      // the gesture feels continuous instead of jumping straight into real
      // scrollback while the canvas is still shifted up.
      const rowsToUnwind = Math.min(-delta, overscrollPx / charHeight)
      overscrollPx = Math.max(0, overscrollPx - rowsToUnwind * charHeight)
      delta += rowsToUnwind
      applyOverscroll()
    }
    if (delta === 0) return

    const beforeY = input.term.getViewportY()
    input.term.scrollLines(delta)
    if (delta > 0 && input.term.getViewportY() === 0) {
      // Requested more "toward the bottom" scroll than the real buffer had
      // left (already at viewportY 0) — the leftover becomes overscroll.
      const unusedRows = delta - (beforeY - input.term.getViewportY())
      if (unusedRows > 0) {
        const maxOverscrollPx = input.container.clientHeight * MAX_OVERSCROLL_FACTOR
        overscrollPx = Math.min(maxOverscrollPx, overscrollPx + unusedRows * charHeight)
        applyOverscroll()
      }
    }
  }

  const onTouchEndOrCancel = (e: PointerEvent) => {
    if (!currentTouch || e.pointerId !== currentTouch.id) return
    disarmStuckTouchWatchdog()
    disarmLongPressTimer()
    if (currentTouch.mode === "selecting") {
      // Only finalize (synthetic mouseup) if the finger actually moved.
      // SelectionManager's own mouseup handler clears the selection when
      // `dragThresholdMet` was never set — dispatching mouseup for a
      // long-press that never dragged would destroy the word selection
      // `beginSelection` just made instead of leaving it in place, which is
      // the expected "long-press alone selects+copies a word" behavior.
      if (selectionMoved) dispatchCanvasMouseEvent("mouseup", e.clientX, e.clientY)
    }
    if (currentTouch.mode === "pending" && input.term.getSelection().length > 0) {
      input.term.clearSelection()
    }
    lastGestureConsumedTouchEnd = currentTouch.mode !== "pending"
    currentTouch = null
    lastSelectingPoint = null
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
  // when the gesture was a swipe or a text selection — so neither scrolling
  // nor releasing a long-press selection ever toggles the softkeyboard
  // state. For taps (mode stays "pending"), we let touchend bubble to the
  // canvas so Ghostty attaches the Android IME normally. This conditional
  // block is safe where the v3.2 attempt (unconditional
  // stopImmediatePropagation on touchend) was not. Reads
  // `lastGestureConsumedTouchEnd` (captured synchronously in
  // onTouchEndOrCancel's pointerup/pointercancel handler) rather than
  // `currentTouch?.mode`, which is always already null by the time this
  // touchend handler runs.
  //
  // Also blocks while `currentTouch` is still non-null (another pointer is
  // still actively tracked): confirmed on-device that Android reports a
  // second, ~4ms-lived pointer (its own distinct pointerId) partway through
  // a real one-finger scroll. `onTouchDownCapture` already ignores that
  // second pointerdown (`if (... || currentTouch) return`), so its matching
  // pointerup never reaches `onTouchEndOrCancel` either (pointerId mismatch)
  // and `lastGestureConsumedTouchEnd` is never updated for it — leaving this
  // touchend to fall through on a stale value from whatever gesture came
  // before. Any touchend arriving while a swipe/selection is still in
  // progress is spurious by definition (a real tap-to-focus never overlaps
  // another active touch).
  const blockTouchEndIfGestureConsumed = (e: TouchEvent) => {
    if (lastGestureConsumedTouchEnd || currentTouch) {
      e.stopPropagation()
    }
  }
  const touchBlockerOptions: AddEventListenerOptions = { capture: true, passive: true }
  input.container.addEventListener("touchend", blockTouchEndIfGestureConsumed, touchBlockerOptions)
  input.container.addEventListener("touchcancel", blockTouchEndIfGestureConsumed, touchBlockerOptions)
  input.cleanups.push(() => {
    input.container.removeEventListener("touchend", blockTouchEndIfGestureConsumed, touchBlockerOptions)
    input.container.removeEventListener("touchcancel", blockTouchEndIfGestureConsumed, touchBlockerOptions)
  })

  // Synthetic selection mousedown events make Ghostty believe the last
  // mousedown started inside the canvas forever on touch-only devices. Clear
  // on pointerdown instead of waiting for click: touchstart.preventDefault()
  // and UI event handlers can suppress the later click entirely. Capture is
  // safe here because the mobile toolbar is explicitly excluded, so Copier
  // still reads the selection before anything can clear it.
  const clearSelectionOnOutsidePointerDown = (e: PointerEvent) => {
    const target = e.target
    if (!(target instanceof Element)) return
    if (target.closest('[data-component="terminal-mobile-toolbar"]')) return
    if (input.container.contains(target)) return
    if (input.term.getSelection().length > 0) input.term.clearSelection()
  }
  document.addEventListener("pointerdown", clearSelectionOnOutsidePointerDown, true)
  input.cleanups.push(() => document.removeEventListener("pointerdown", clearSelectionOnOutsidePointerDown, true))

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

