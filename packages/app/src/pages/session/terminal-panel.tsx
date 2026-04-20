import { For, Show, createEffect, createMemo, createSignal, on, onCleanup, onMount } from "solid-js"
import { createStore } from "solid-js/store"
import { makeEventListener } from "@solid-primitives/event-listener"
import { createMediaQuery } from "@solid-primitives/media"
import { Tabs } from "@opencode-ai/ui/tabs"
import { ResizeHandle } from "@opencode-ai/ui/resize-handle"
import { IconButton } from "@opencode-ai/ui/icon-button"
import { TooltipKeybind } from "@opencode-ai/ui/tooltip"
import { DragDropProvider, DragDropSensors, DragOverlay, SortableProvider, closestCenter } from "@thisbeyond/solid-dnd"
import type { DragEvent } from "@thisbeyond/solid-dnd"
import { ConstrainDragYAxis, getDraggableId } from "@/utils/solid-dnd"

import { SortableTerminalTab } from "@/components/session"
import { Terminal } from "@/components/terminal"
import { useCommand } from "@/context/command"
import { useLanguage } from "@/context/language"
import { usePlatform } from "@/context/platform"
import { useLayout } from "@/context/layout"
import { useTerminal } from "@/context/terminal"
import { terminalTabLabel } from "@/pages/session/terminal-label"
import { createSizing, focusTerminalById } from "@/pages/session/helpers"
import { getTerminalHandoff, setTerminalHandoff } from "@/pages/session/handoff"
import { useSessionLayout } from "@/pages/session/session-layout"
import { terminalProbe } from "@/testing/terminal"

function focusTerminalTextarea(id: string) {
  const wrapper = document.getElementById(`terminal-wrapper-${id}`)
  const textarea = wrapper?.querySelector("textarea")
  if (textarea && document.activeElement !== textarea) textarea.focus()
}

function TerminalMobileToolbar(props: {
  activeId: () => string | undefined
  sendBytes: (id: string, data: string) => void
}) {
  const [ctrlActive, setCtrlActive] = createSignal(false)
  const [altActive, setAltActive] = createSignal(false)

  function emit(data: string) {
    const id = props.activeId()
    if (!id) return
    props.sendBytes(id, data)
    focusTerminalTextarea(id)
  }

  function sendKey(bytes: string) {
    let out = bytes
    if (altActive()) {
      out = "\x1b" + out
      setAltActive(false)
    }
    emit(out)
  }

  function sendChar(ch: string) {
    if (ctrlActive()) {
      const upper = ch.toUpperCase()
      const code = upper.charCodeAt(0)
      if (code >= 0x40 && code <= 0x5f) {
        let byte = String.fromCharCode(code - 0x40)
        if (altActive()) {
          byte = "\x1b" + byte
          setAltActive(false)
        }
        emit(byte)
        setCtrlActive(false)
        return
      }
      setCtrlActive(false)
    }
    sendKey(ch)
  }

  const btnBase = "shrink-0 px-3 h-8 rounded-md text-13-medium border"
  const btnNormal = "bg-surface-base text-text-base border-border-base active:bg-surface-base-active"
  const btnActive = "bg-text-strong text-background-base border-text-strong"

  const keys: { label: string; action: () => void }[] = [
    { label: "Esc", action: () => sendKey("\x1b") },
    { label: "Tab", action: () => sendKey("\t") },
    { label: "↑", action: () => sendKey("\x1b[A") },
    { label: "↓", action: () => sendKey("\x1b[B") },
    { label: "→", action: () => sendKey("\x1b[C") },
    { label: "←", action: () => sendKey("\x1b[D") },
    { label: "Home", action: () => sendKey("\x1b[H") },
    { label: "End", action: () => sendKey("\x1b[F") },
    { label: "PgUp", action: () => sendKey("\x1b[5~") },
    { label: "PgDn", action: () => sendKey("\x1b[6~") },
    { label: "Del", action: () => sendKey("\x1b[3~") },
    { label: "F1", action: () => sendKey("\x1bOP") },
    { label: "F2", action: () => sendKey("\x1bOQ") },
    { label: "F3", action: () => sendKey("\x1bOR") },
    { label: "F4", action: () => sendKey("\x1bOS") },
    { label: "F5", action: () => sendKey("\x1b[15~") },
    { label: "F6", action: () => sendKey("\x1b[17~") },
    { label: "F7", action: () => sendKey("\x1b[18~") },
    { label: "F8", action: () => sendKey("\x1b[19~") },
    { label: "F9", action: () => sendKey("\x1b[20~") },
    { label: "F10", action: () => sendKey("\x1b[21~") },
    { label: "F11", action: () => sendKey("\x1b[23~") },
    { label: "F12", action: () => sendKey("\x1b[24~") },
    { label: ":", action: () => sendChar(":") },
    { label: "|", action: () => sendChar("|") },
    { label: "/", action: () => sendChar("/") },
    { label: "~", action: () => sendChar("~") },
  ]

  return (
    <div
      data-component="terminal-mobile-toolbar"
      class="flex items-center gap-1 px-2 py-1 border-b border-border-weaker-base bg-background-stronger overflow-x-auto"
      style={{ "-webkit-overflow-scrolling": "touch", "scrollbar-width": "none" }}
    >
      <button
        type="button"
        class={btnBase}
        classList={{
          [btnActive]: ctrlActive(),
          [btnNormal]: !ctrlActive(),
        }}
        onPointerDown={(e) => {
          e.preventDefault()
          setCtrlActive(!ctrlActive())
        }}
      >
        Ctrl
      </button>
      <button
        type="button"
        class={btnBase}
        classList={{
          [btnActive]: altActive(),
          [btnNormal]: !altActive(),
        }}
        onPointerDown={(e) => {
          e.preventDefault()
          setAltActive(!altActive())
        }}
      >
        Alt
      </button>
      <For each={keys}>
        {(k) => (
          <button
            type="button"
            class={`${btnBase} ${btnNormal}`}
            onPointerDown={(e) => {
              e.preventDefault()
              k.action()
            }}
          >
            {k.label}
          </button>
        )}
      </For>
    </div>
  )
}

export function TerminalPanel() {
  const delays = [120, 240]
  const layout = useLayout()
  const terminal = useTerminal()
  const language = useLanguage()
  const command = useCommand()
  const platform = usePlatform()
  const { params, view } = useSessionLayout()
  const isMobile = () => platform.platform === "mobile"

  const opened = createMemo(() => view().terminal.opened())
  const size = createSizing()
  const height = createMemo(() => layout.terminal.height())
  const close = () => view().terminal.close()
  let root: HTMLDivElement | undefined
  const sendHandles = new Map<string, (data: string) => void>()

  const [store, setStore] = createStore({
    autoCreated: false,
    activeDraggable: undefined as string | undefined,
    view: typeof window === "undefined" ? 1000 : (window.visualViewport?.height ?? window.innerHeight),
  })

  const max = () => store.view * 0.6
  const pane = () => Math.min(height(), max())

  onMount(() => {
    if (typeof window === "undefined") return

    const sync = () => setStore("view", window.visualViewport?.height ?? window.innerHeight)
    const port = window.visualViewport

    sync()
    makeEventListener(window, "resize", sync)
    if (port) makeEventListener(port, "resize", sync)
  })

  createEffect(() => {
    if (!opened()) {
      setStore("autoCreated", false)
      return
    }

    // Wait for the stale-PTY sweep to finish before deciding there are "no terminals".
    // During sweep, old sessions are being checked and removed — creating a new
    // terminal before that completes would race with the sweep.
    if (!terminal.ready() || !terminal.sweepDone() || terminal.all().length !== 0 || store.autoCreated) return
    terminal.new()
    setStore("autoCreated", true)
  })

  createEffect(
    on(
      () => terminal.all().length,
      (count, prevCount) => {
        if (prevCount === undefined || prevCount <= 0 || count !== 0) return
        if (!opened()) return
        // Don't auto-close while the stale-PTY sweep is still running —
        // the sweep removes old sessions which would trigger this effect
        // and cause the panel to flash-close at startup.
        if (!terminal.sweepDone()) return
        close()
      },
    ),
  )

  const focus = (id: string) => {
    const probe = terminalProbe(id)
    probe.focus(delays.length + 1)
    focusTerminalById(id)

    const frame = requestAnimationFrame(() => {
      probe.step()
      if (!opened()) return
      if (terminal.active() !== id) return
      focusTerminalById(id)
    })

    const timers = delays.map((ms) =>
      window.setTimeout(() => {
        probe.step()
        if (!opened()) return
        if (terminal.active() !== id) return
        focusTerminalById(id)
      }, ms),
    )

    return () => {
      probe.focus(0)
      cancelAnimationFrame(frame)
      for (const timer of timers) clearTimeout(timer)
    }
  }

  createEffect(
    on(
      () => [opened(), terminal.active()] as const,
      ([next, id]) => {
        if (!next || !id) return
        if (isMobile()) return
        const stop = focus(id)
        onCleanup(stop)
      },
    ),
  )

  createEffect(() => {
    if (opened()) return
    const active = document.activeElement
    if (!(active instanceof HTMLElement)) return
    if (!root?.contains(active)) return
    active.blur()
  })

  createEffect(() => {
    const dir = params.dir
    if (!dir) return
    if (!terminal.ready()) return
    language.locale()

    setTerminalHandoff(
      dir,
      terminal.all().map((pty) =>
        terminalTabLabel({
          title: pty.title,
          titleNumber: pty.titleNumber,
          t: language.t as (key: string, vars?: Record<string, string | number | boolean>) => string,
        }),
      ),
    )
  })

  const handoff = createMemo(() => {
    const dir = params.dir
    if (!dir) return []
    return getTerminalHandoff(dir) ?? []
  })

  const all = terminal.all
  const ids = createMemo(() => all().map((pty) => pty.id))

  const handleTerminalDragStart = (event: unknown) => {
    const id = getDraggableId(event)
    if (!id) return
    setStore("activeDraggable", id)
  }

  const handleTerminalDragOver = (event: DragEvent) => {
    const { draggable, droppable } = event
    if (!draggable || !droppable) return

    const terminals = terminal.all()
    const fromIndex = terminals.findIndex((t) => t.id === draggable.id.toString())
    const toIndex = terminals.findIndex((t) => t.id === droppable.id.toString())
    if (fromIndex !== -1 && toIndex !== -1 && fromIndex !== toIndex) {
      terminal.move(draggable.id.toString(), toIndex)
    }
  }

  const handleTerminalDragEnd = () => {
    setStore("activeDraggable", undefined)

    const activeId = terminal.active()
    if (!activeId) return
    requestAnimationFrame(() => {
      if (terminal.active() !== activeId) return
      focusTerminalById(activeId)
    })
  }

  return (
    <div
      ref={root}
      id="terminal-panel"
      role="region"
      aria-label={language.t("terminal.title")}
      aria-hidden={!opened()}
      inert={!opened()}
      class="relative w-full shrink-0 overflow-hidden bg-background-stronger"
      classList={{
        "border-t border-border-weak-base": opened(),
        "transition-[height] duration-200 ease-[cubic-bezier(0.22,1,0.36,1)] will-change-[height] motion-reduce:transition-none":
          !size.active(),
      }}
      style={{ height: opened() ? `${pane()}px` : "0px" }}
    >
      <div
        class="absolute inset-x-0 top-0 flex flex-col"
        classList={{
          "pointer-events-none": !opened(),
        }}
        style={{ height: `${pane()}px` }}
      >
        <div class="hidden md:block" onPointerDown={() => size.start()}>
          <ResizeHandle
            direction="vertical"
            size={pane()}
            min={100}
            max={max()}
            collapseThreshold={50}
            onResize={(next) => {
              size.touch()
              layout.terminal.resize(next)
            }}
            onCollapse={close}
          />
        </div>
        <Show
          when={terminal.ready()}
          fallback={
            <div class="flex flex-col h-full pointer-events-none">
              <div class="h-10 flex items-center gap-2 px-2 border-b border-border-weaker-base bg-background-stronger overflow-hidden">
                <For each={handoff()}>
                  {(title) => (
                    <div class="px-2 py-1 rounded-md bg-surface-base text-14-regular text-text-weak truncate max-w-40">
                      {title}
                    </div>
                  )}
                </For>
                <div class="flex-1" />
                <div class="text-text-weak pr-2">
                  {language.t("common.loading")}
                  {language.t("common.loading.ellipsis")}
                </div>
              </div>
              <div class="flex-1 flex items-center justify-center text-text-weak">{language.t("terminal.loading")}</div>
            </div>
          }
        >
          <DragDropProvider
            onDragStart={handleTerminalDragStart}
            onDragEnd={handleTerminalDragEnd}
            onDragOver={handleTerminalDragOver}
            collisionDetector={closestCenter}
          >
            <DragDropSensors />
            <ConstrainDragYAxis />
            <div class="flex flex-col h-full">
              <Tabs
                variant="alt"
                value={terminal.active()}
                onChange={(id) => terminal.open(id)}
                class="!h-auto !flex-none"
              >
                <Tabs.List class="h-10 border-b border-border-weaker-base">
                  <SortableProvider ids={ids()}>
                    <For each={all()}>{(pty) => <SortableTerminalTab terminal={pty} onClose={close} />}</For>
                  </SortableProvider>
                  <div class="h-full flex items-center justify-center">
                    <TooltipKeybind
                      title={language.t("command.terminal.new")}
                      keybind={command.keybind("terminal.new")}
                      class="flex items-center"
                    >
                      <IconButton
                        icon="plus-small"
                        variant="ghost"
                        iconSize="large"
                        onClick={terminal.new}
                        aria-label={language.t("command.terminal.new")}
                      />
                    </TooltipKeybind>
                  </div>
                </Tabs.List>
              </Tabs>
              <Show when={isMobile()}>
                <TerminalMobileToolbar
                  activeId={() => terminal.active()}
                  sendBytes={(id, data) => sendHandles.get(id)?.(data)}
                />
              </Show>
              <div class="flex-1 min-h-0 relative">
                {(() => {
                  const ops = terminal.bind()
                  return (
                    <For each={all()}>
                      {(pty) => (
                        <div
                          id={`terminal-wrapper-${pty.id}`}
                          class="absolute inset-0"
                          style={{
                            visibility: terminal.active() === pty.id ? "visible" : "hidden",
                            "z-index": terminal.active() === pty.id ? 1 : 0,
                          }}
                        >
                          <Terminal
                            pty={pty}
                            autoFocus={opened() && !isMobile() && terminal.active() === pty.id}
                            onConnect={() => ops.trim(pty.id)}
                            onCleanup={ops.update}
                            onConnectError={() => ops.clone(pty.id)}
                            onSend={(fn) => { if (fn) sendHandles.set(pty.id, fn); else sendHandles.delete(pty.id) }}
                          />
                        </div>
                      )}
                    </For>
                  )
                })()}
              </div>
            </div>
            <DragOverlay>
              <Show when={store.activeDraggable} keyed>
                {(id) => (
                  <Show when={all().find((pty) => pty.id === id)}>
                    {(t) => (
                      <div class="relative p-1 h-10 flex items-center bg-background-stronger text-14-regular">
                        {terminalTabLabel({
                          title: t().title,
                          titleNumber: t().titleNumber,
                          t: language.t as (key: string, vars?: Record<string, string | number | boolean>) => string,
                        })}
                      </div>
                    )}
                  </Show>
                )}
              </Show>
            </DragOverlay>
          </DragDropProvider>
        </Show>
      </div>
    </div>
  )
}
