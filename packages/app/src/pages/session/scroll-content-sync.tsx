// Content scroll sync extracted from file-tabs.tsx (PLAN-EDITEUR-IDE-DEFINITIF Phase 4.1).
//
// WHY extracted: `createScrollSync` is a self-contained side-effect factory
// that takes the per-tab view state (scroll position map keyed by tab) and
// returns the three handlers ViewerPanel + the parent effect chain need
// (setViewport / handleScroll / queueRestore). It has no overlap with the
// editor / LSP / comments responsibilities — it just orchestrates
// requestAnimationFrame + a `view().scroll(tab)` read/write round-trip.
//
// The handle shape (ScrollSyncHandle) is defined in viewer-panel.tsx because
// the consumer owns the contract; this module only matches it.

import { createEffect, createSignal, onCleanup } from "solid-js"
import { makeEventListener } from "@solid-primitives/event-listener"

type ScrollPos = { x: number; y: number }

interface ScrollSyncInput {
  tab: () => string
  view: () => { scroll: (tab: string) => ScrollPos | undefined; setScroll: (tab: string, pos: ScrollPos) => void }
}

export interface ScrollSyncHandle {
  setViewport: (el: HTMLDivElement) => void
  handleScroll: (event: Event & { currentTarget: HTMLDivElement }) => void
  queueRestore: () => void
}

export function createScrollSync(input: ScrollSyncInput): ScrollSyncHandle {
  let scroll: HTMLDivElement | undefined
  let scrollFrame: number | undefined
  let restoreFrame: number | undefined
  let pending: ScrollPos | undefined
  const [code, setCode] = createSignal<HTMLElement[]>([])

  const getCode = () => {
    const el = scroll
    if (!el) return []

    const host = el.querySelector("diffs-container")
    if (!(host instanceof HTMLElement)) return []

    const root = host.shadowRoot
    if (!root) return []

    return Array.from(root.querySelectorAll("[data-code]")).filter(
      (node): node is HTMLElement => node instanceof HTMLElement && node.clientWidth > 0,
    )
  }

  const save = (next: ScrollPos) => {
    pending = next
    if (scrollFrame !== undefined) return

    scrollFrame = requestAnimationFrame(() => {
      scrollFrame = undefined

      const out = pending
      pending = undefined
      if (!out) return

      input.view().setScroll(input.tab(), out)
    })
  }

  const onCodeScroll = (event: Event) => {
    const el = scroll
    if (!el) return

    const target = event.currentTarget
    if (!(target instanceof HTMLElement)) return

    save({
      x: target.scrollLeft,
      y: el.scrollTop,
    })
  }

  const sync = () => {
    const next = getCode()
    const current = code()
    if (next.length === current.length && next.every((el, i) => el === current[i])) return
    setCode(next)
  }

  const restore = () => {
    const el = scroll
    if (!el) return

    const pos = input.view().scroll(input.tab())
    if (!pos) return

    sync()

    if (code().length > 0) {
      for (const item of code()) {
        if (item.scrollLeft !== pos.x) item.scrollLeft = pos.x
      }
    }

    if (el.scrollTop !== pos.y) el.scrollTop = pos.y
    if (code().length > 0) return
    if (el.scrollLeft !== pos.x) el.scrollLeft = pos.x
  }

  const queueRestore = () => {
    if (restoreFrame !== undefined) return

    restoreFrame = requestAnimationFrame(() => {
      restoreFrame = undefined
      restore()
    })
  }

  const handleScroll = (event: Event & { currentTarget: HTMLDivElement }) => {
    if (code().length === 0) sync()

    save({
      x: code()[0]?.scrollLeft ?? event.currentTarget.scrollLeft,
      y: event.currentTarget.scrollTop,
    })
  }

  createEffect(() => {
    for (const item of code()) makeEventListener(item, "scroll", onCodeScroll)
  })

  const setViewport = (el: HTMLDivElement) => {
    scroll = el
    restore()
  }

  onCleanup(() => {
    if (scrollFrame !== undefined) cancelAnimationFrame(scrollFrame)
    if (restoreFrame !== undefined) cancelAnimationFrame(restoreFrame)
  })

  return {
    handleScroll,
    queueRestore,
    setViewport,
  }
}