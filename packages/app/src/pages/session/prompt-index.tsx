/* SPDX-License-Identifier: MIT */

// A3-01 prompt index (v110 "prompt graduation ticks", INTERACTIONS.md
// §Chat). Ported from the maquette's v45 iteration (the last of four:
// v39/v43/v44/v45) behind Unifia-v110-module-043 -- same contract (one
// tick per visible user prompt, hover/focus reveal, click scrolls the
// target to ~28% of the viewport, active tick tracks the last prompt
// whose top has crossed the vertical center), reimplemented on Solid
// reactivity instead of a MutationObserver rebuilding DOM nodes by
// hand: `props.messages` is already the reactive, already-filtered
// (revert-aware) source the demo's observer existed only to fake.
//
// Simplification versus the maquette, noted rather than silently
// dropped: reveal triggers on hovering/focusing the index itself and
// on scrolling the thread, not on cursor proximity to the scrollbar
// edge specifically. The behavioral contract (hidden by default,
// appears during interaction, click still navigates) is preserved.

import { For, Show, createMemo, createSignal, onCleanup, onMount } from "solid-js"
import { Tooltip } from "@unifia/ui/tooltip"
import type { UserMessage, TextPart } from "@/types/sdk-shim"
import { useSync } from "@/context/sync"
import { useLanguage } from "@/context/language"

function firstPhrase(text: string): string {
  const clean = text.replace(/\s+/g, " ").trim()
  const match = clean.match(/^(.{1,140}?[.!?](?:\s|$)|.{1,100})/)
  return (match?.[1] ?? clean).trim()
}

export function PromptIndex(props: { messages: () => UserMessage[]; scrollEl: () => HTMLElement | undefined }) {
  const sync = useSync()
  const language = useLanguage()
  const [active, setActive] = createSignal(-1)
  const [visible, setVisible] = createSignal(false)
  let hideTimer: ReturnType<typeof setTimeout> | undefined

  const ticks = createMemo(() =>
    props.messages().map((message) => {
      const parts = sync.data.part[message.id] ?? []
      const textPart = parts.find((p): p is TextPart => p.type === "text" && !p.synthetic)
      return { id: message.id, preview: firstPhrase(textPart?.text ?? "") }
    }),
  )

  const targetEl = (id: string) => props.scrollEl()?.querySelector<HTMLElement>(`[data-message-id="${id}"]`)

  const updateActive = () => {
    const root = props.scrollEl()
    if (!root) return
    const center = root.getBoundingClientRect().top + root.clientHeight / 2
    let best = 0
    ticks().forEach((tick, i) => {
      const el = targetEl(tick.id)
      if (el && el.getBoundingClientRect().top <= center) best = i
    })
    setActive(best)
  }

  const show = () => {
    clearTimeout(hideTimer)
    setVisible(true)
  }
  const hideLater = (ms = 300) => {
    clearTimeout(hideTimer)
    hideTimer = setTimeout(() => setVisible(false), ms)
  }

  onMount(() => {
    const root = props.scrollEl()
    if (!root) return
    const onScroll = () => {
      updateActive()
      show()
      hideLater(420)
    }
    root.addEventListener("scroll", onScroll, { passive: true })
    updateActive()
    onCleanup(() => root.removeEventListener("scroll", onScroll))
  })

  const goTo = (index: number) => {
    const root = props.scrollEl()
    const tick = ticks()[index]
    if (!root || !tick) return
    const el = targetEl(tick.id)
    if (!el) return
    const rootTop = root.getBoundingClientRect().top
    const elTop = el.getBoundingClientRect().top
    const target = Math.max(
      0,
      Math.min(root.scrollHeight - root.clientHeight, root.scrollTop + (elTop - rootTop) - root.clientHeight * 0.28),
    )
    setActive(index)
    root.scrollTo({ top: target, behavior: "smooth" })
  }

  return (
    <Show when={ticks().length > 1}>
      <nav
        data-v110="prompt-index"
        data-component="prompt-index"
        aria-label={language.t("session.promptIndex.label")}
        classList={{ "prompt-index": true, visible: visible() }}
        onPointerEnter={show}
        onPointerLeave={() => hideLater(300)}
        onFocusIn={show}
        onFocusOut={() => hideLater(300)}
      >
        <For each={ticks()}>
          {(tick, i) => (
            <Tooltip value={tick.preview} placement="left" gutter={8}>
              <button
                type="button"
                class="prompt-index-tick"
                classList={{ active: i() === active() }}
                aria-label={tick.preview}
                onClick={() => goTo(i())}
              >
                <span class="prompt-index-tick-line" />
              </button>
            </Tooltip>
          )}
        </For>
      </nav>
    </Show>
  )
}
