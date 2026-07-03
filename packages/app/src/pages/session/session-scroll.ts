/**
 * Factory for session scroll management in the session page.
 * Extracted from session.tsx to keep that file under the 1500-LOC budget.
 *
 * Manages: autoScroll, scroll-state tracking, fill logic, history window,
 * setScrollRef / setContentRef, and related createEffects + ResizeObserver.
 *
 * NOTE: resumeScroll stays in session.tsx because it calls clearMessageHash
 * which comes from useSessionHashScroll (defined later in the component).
 *
 * NOTE: createResizeObserver(promptDock) stays in session.tsx because it
 * accesses dockHeight and calls autoScroll.forceScrollToBottom directly.
 */
import { createEffect, onCleanup, on } from "solid-js"
import { createResizeObserver } from "@solid-primitives/resize-observer"
import { createAutoScroll } from "@opencode-ai/ui/hooks"
import { createSessionHistoryWindow } from "@/pages/session/session-history-window"
import type { useSync } from "@/context/sync"
import type { UserMessage, Message } from "../../types/sdk-shim"

interface ScrollState {
  overflow: boolean
  bottom: boolean
  jump: boolean
}

export interface SessionScrollDeps {
  params: Record<string, string | undefined>
  messagesReady: () => boolean
  messages: () => Message[]
  visibleUserMessages: () => UserMessage[]
  historyMore: () => boolean
  historyLoading: () => boolean
  sync: ReturnType<typeof useSync>
  /** Called to reset the messageId store key when autoScroll returns to bottom */
  onAutoScrollReset: () => void
  /** Returns the current scroll state (for the updateScrollState equality check) */
  getScrollState: () => ScrollState
  /** Updates the scroll state in the parent store */
  setScrollState: (next: ScrollState) => void
  /**
   * Callback invoked whenever the scroller ref changes.
   * The parent stores the ref in its own closure for cursor() / markScrollGesture().
   */
  onScrollerRefChange?: (el: HTMLDivElement | undefined) => void
}

export function createSessionScroll(deps: SessionScrollDeps) {
  const {
    params,
    messagesReady,
    messages,
    visibleUserMessages,
    historyMore,
    historyLoading,
    sync,
    onAutoScrollReset,
    getScrollState,
    setScrollState,
    onScrollerRefChange,
  } = deps

  // ── Internal refs ─────────────────────────────────────────────────────────

  let scroller: HTMLDivElement | undefined
  let contentEl: HTMLDivElement | undefined

  let scrollStateFrame: number | undefined
  let scrollStateTarget: HTMLDivElement | undefined
  let fillFrame: number | undefined

  // ── autoScroll ────────────────────────────────────────────────────────────

  const autoScroll = createAutoScroll({
    working: () => true,
    overflowAnchor: "dynamic",
  })

  // ── Scroll-state helpers ──────────────────────────────────────────────────

  const jumpThreshold = (el: HTMLDivElement) => Math.max(400, el.clientHeight)

  const updateScrollState = (el: HTMLDivElement) => {
    const max = el.scrollHeight - el.clientHeight
    const distance = max - el.scrollTop
    const overflow = max > 1
    const bottom = !overflow || distance <= 2
    const jump = overflow && distance > jumpThreshold(el)

    const cur = getScrollState()
    if (cur.overflow === overflow && cur.bottom === bottom && cur.jump === jump) return
    setScrollState({ overflow, bottom, jump })
  }

  const scheduleScrollState = (el: HTMLDivElement) => {
    scrollStateTarget = el
    if (scrollStateFrame !== undefined) return

    scrollStateFrame = requestAnimationFrame(() => {
      scrollStateFrame = undefined

      const target = scrollStateTarget
      scrollStateTarget = undefined
      if (!target) return

      updateScrollState(target)
    })
  }

  // ── fill (declared as let for mutual recursion with historyWindow) ─────────

  let fill = () => {}

  // ── Ref setters exposed to the component ─────────────────────────────────

  const setScrollRef = (el: HTMLDivElement | undefined) => {
    scroller = el
    onScrollerRefChange?.(el)
    autoScroll.scrollRef(el)
    if (!el) return
    scheduleScrollState(el)
    fill()
  }

  const setContentRef = (el: HTMLDivElement | undefined) => {
    contentEl = el
    autoScroll.contentRef(el)

    const root = scroller
    if (root) scheduleScrollState(root)
  }

  const markUserScroll = () => {
    // scrollMark is managed by the parent; this is a no-op hook for consistency
    // The parent increments its own scrollMark when this is called.
  }

  // ── Resize observer on content ────────────────────────────────────────────

  createResizeObserver(
    () => contentEl,
    () => {
      const el = scroller
      if (el) scheduleScrollState(el)
      fill()
    },
  )

  // ── History window ────────────────────────────────────────────────────────

  const historyWindow = createSessionHistoryWindow({
    sessionID: () => params.id,
    messagesReady,
    loaded: () => messages().length,
    visibleUserMessages,
    historyMore,
    historyLoading,
    loadMore: (sessionID) => sync.session.history.loadMore(sessionID),
    userScrolled: autoScroll.userScrolled,
    scroller: () => scroller,
  })

  // ── Real fill implementation (reassigned after historyWindow is ready) ────

  fill = () => {
    if (fillFrame !== undefined) return

    fillFrame = requestAnimationFrame(() => {
      fillFrame = undefined

      if (!params.id || !messagesReady()) return
      if (autoScroll.userScrolled() || historyLoading()) return

      const el = scroller
      if (!el) return
      if (el.scrollHeight > el.clientHeight + 1) return
      if (historyWindow.turnStart() <= 0 && !historyMore()) return

      void historyWindow.loadAndReveal()
    })
  }

  // ── Effect: reset messageId when user scrolls back to bottom ─────────────

  createEffect(
    on(
      autoScroll.userScrolled,
      (scrolled) => {
        if (scrolled) return
        onAutoScrollReset()
      },
      { defer: true },
    ),
  )

  // ── Effect: trigger fill when history/scroll dependencies change ──────────

  createEffect(
    on(
      () =>
        [
          params.id,
          messagesReady(),
          historyWindow.turnStart(),
          historyMore(),
          historyLoading(),
          autoScroll.userScrolled(),
          visibleUserMessages().length,
        ] as const,
      ([id, ready, start, more, loading, scrolled]) => {
        if (!id || !ready || loading || scrolled) return
        if (start <= 0 && !more) return
        fill()
      },
      { defer: true },
    ),
  )

  // ── Cleanup ───────────────────────────────────────────────────────────────

  onCleanup(() => {
    if (scrollStateFrame !== undefined) cancelAnimationFrame(scrollStateFrame)
    if (fillFrame !== undefined) cancelAnimationFrame(fillFrame)
  })

  return {
    autoScroll,
    scheduleScrollState,
    setScrollRef,
    setContentRef,
    markUserScroll,
    historyWindow,
    fill: () => fill(),
    getScroller: () => scroller,
  }
}
