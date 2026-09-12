/* SPDX-License-Identifier: MIT */

import { Show, type JSX, createMemo, createSignal, onCleanup, onMount } from "solid-js"
import { createStore } from "solid-js/store"
import { Persist, persisted } from "@/utils/persist"
import { useLanguage } from "@/context/language"
import { useMode } from "@/context/mode"
import {
  DEFAULT_CHAT_WIDTH,
  KEYBOARD_STEP,
  MAX_CHAT_WIDTH,
  MIN_CHAT_WIDTH,
  clampChatWidth,
  clampChatWidthForViewport,
} from "@/pages/workbench/design-split-clamp"
import {
  pickMobileSurface,
  resolveLayout,
  type Surface,
} from "@/pages/workbench/design-responsive"
import { DesignSurfaceSwitcher } from "@/pages/workbench/design-surface-switcher"

export {
  clampChatWidth,
  DEFAULT_CHAT_WIDTH,
  KEYBOARD_STEP,
  MAX_CHAT_WIDTH,
  MIN_CHAT_WIDTH,
}

export function DesignSplit(props: { chat: JSX.Element; workspace: JSX.Element }): JSX.Element {
  const language = useLanguage()
  const directory = useMode().directory
  const t = language.t
  const [preferences, setPreferences] = persisted(
    Persist.workspace(directory() ?? "", "design-split.v1"),
    createStore<{ chatWidth: number; mobileSurface: Surface }>({ chatWidth: DEFAULT_CHAT_WIDTH, mobileSurface: "assistant" }),
  )
  // WHY unused setter: `focused` is read for the workspace-focus layout
  // (grid collapse, chat hidden) but nothing calls the setter yet — no UI
  // trigger toggles focus mode. Kept as a stub so the layout branch stays
  // exercised; see the spawned task for wiring a real trigger.
  const [focused, _setFocused] = createSignal(false)
  const [resizing, setResizing] = createSignal(false)
  // V06 — track the current viewport width. Read once on mount, then
  // resize. The split is a small island inside the workbench shell; a
  // window-level listener is fine here (no perf cost, no leak across
  // worktree changes because `onCleanup` removes it).
  const [viewport, setViewport] = createSignal(typeof window === "undefined" ? 1440 : window.innerWidth)
  onMount(() => {
    const onResize = (): void => {
      setViewport(window.innerWidth)
    }
    window.addEventListener("resize", onResize)
    onCleanup(() => window.removeEventListener("resize", onResize))
  })
  const layout = createMemo(() => resolveLayout(viewport(), preferences.chatWidth))
  // V06 — when the user picks a surface on mobile, persist it. The
  // model reads the same key on the next mobile mount and restores
  // the choice. On non-mobile viewports the choice is kept but
  // ignored.
  const setMobileSurface = (surface: Surface): void => setPreferences("mobileSurface", surface)
  const currentMobileSurface = (): Surface => pickMobileSurface(preferences.mobileSurface, viewport())

  function startResize(event: PointerEvent): void {
    if (event.button !== 0) return
    event.preventDefault()
    if (!layout().resizable) return
    setResizing(true)
    const startX = event.clientX
    const startWidth = clampChatWidthForViewport(preferences.chatWidth, viewport())
    function onMove(e: PointerEvent): void {
      const next = clampChatWidthForViewport(startWidth + (e.clientX - startX), viewport())
      setPreferences("chatWidth", next)
    }
    function onUp(): void {
      setResizing(false)
      window.removeEventListener("pointermove", onMove)
      window.removeEventListener("pointerup", onUp)
    }
    window.addEventListener("pointermove", onMove)
    window.addEventListener("pointerup", onUp)
  }
  onCleanup(() => {
    document.body.style.userSelect = ""
  })

  function onKey(event: KeyboardEvent): void {
    if (!layout().resizable) return
    if (event.key === "ArrowLeft") {
      event.preventDefault()
      setPreferences("chatWidth", clampChatWidthForViewport(preferences.chatWidth - KEYBOARD_STEP, viewport()))
    } else if (event.key === "ArrowRight") {
      event.preventDefault()
      setPreferences("chatWidth", clampChatWidthForViewport(preferences.chatWidth + KEYBOARD_STEP, viewport()))
    } else if (event.key === "Home") {
      event.preventDefault()
      setPreferences("chatWidth", DEFAULT_CHAT_WIDTH)
    }
  }

  const gridTemplate = createMemo(() => {
    if (focused()) return "minmax(0, 1fr)"
    if (layout().kind === "mobile") return "minmax(0, 1fr)"
    if (layout().kind === "tablet") {
      return `${layout().chatWidth}px 8px minmax(0, 1fr)`
    }
    return `var(--design-chat-width, ${DEFAULT_CHAT_WIDTH}px) 8px minmax(0, 1fr)`
  })

  // V06 — the safe-area padding keeps the iOS notch and the Android
  // gesture bar from clipping the tablist and the splitter. The CSS
  // env() function is the only way to do this without measuring the
  // device; supported on every modern engine that runs the webview.
  const safeAreaStyle = {
    "padding-top": "env(safe-area-inset-top, 0px)",
    "padding-bottom": "env(safe-area-inset-bottom, 0px)",
    "padding-left": "env(safe-area-inset-left, 0px)",
    "padding-right": "env(safe-area-inset-right, 0px)",
  }

  return (
    <div
      class="grid size-full [&.is-resizing_iframe]:pointer-events-none"
      classList={{ "is-resizing": resizing() }}
      style={{
        "grid-template-columns": gridTemplate(),
        "--design-chat-width": `${clampChatWidthForViewport(preferences.chatWidth, viewport())}px`,
        ...safeAreaStyle,
      }}
      data-design-split-focused={focused() ? "true" : "false"}
      data-design-split-kind={layout().kind}
    >
      <Show when={layout().kind === "mobile"}>
        <div class="flex h-full min-w-0 flex-col overflow-hidden" data-design-split-mobile>
          <DesignSurfaceSwitcher surface={currentMobileSurface()} onChange={setMobileSurface} />
          <Show
            when={currentMobileSurface() === "assistant"}
            fallback={
              <div class="flex h-full min-w-0 flex-col overflow-hidden" data-design-split-atelier>
                {props.workspace}
              </div>
            }
          >
            <div class="flex h-full min-w-0 flex-col overflow-hidden" data-design-split-assistant>
              {props.chat}
            </div>
          </Show>
        </div>
      </Show>
      <Show when={layout().kind !== "mobile"}>
        <div class="flex h-full min-w-0 flex-col overflow-hidden" hidden={focused()} data-design-split-chat>
          {props.chat}
        </div>
        <Show when={!focused() && layout().resizable}>
          <div
            role="separator"
            aria-orientation="vertical"
            aria-label={t("design.split.handle")}
            aria-valuenow={clampChatWidthForViewport(preferences.chatWidth, viewport())}
            aria-valuemin={MIN_CHAT_WIDTH}
            aria-valuemax={MAX_CHAT_WIDTH}
            tabindex="0"
            class="w-2 cursor-col-resize select-none bg-border-base hover:bg-border-focus focus:bg-border-focus focus:outline-none"
            data-design-split-handle
            onPointerDown={startResize}
            onKeyDown={onKey}
          />
        </Show>
        <div class="flex h-full min-w-0 flex-col overflow-hidden" data-design-split-workspace>
          {props.workspace}
        </div>
      </Show>
    </div>
  )
}
