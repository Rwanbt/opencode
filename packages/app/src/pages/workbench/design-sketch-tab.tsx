/* SPDX-License-Identifier: MIT */

import { onCleanup, onMount, type JSX } from "solid-js"

const READY = "unifia:sketch-ready"
const LOAD = "unifia:sketch-load"
const CHANGE = "unifia:sketch-change"
const PREFIX = "unifia-design-sketch:v1:"

/**
 * A corrupt entry used to throw out of the message handler, leaving the tab
 * with an empty canvas and no way back: the bad value stayed in localStorage,
 * so every reopen threw again. Dropping it here trades one lost sketch for a
 * tab that recovers on its own.
 */
function readSnapshot(key: string): unknown {
  const raw = localStorage.getItem(key)
  if (!raw) return undefined
  try {
    return JSON.parse(raw)
  } catch {
    localStorage.removeItem(key)
    return undefined
  }
}

export function DesignSketchTab(props: { id: string }): JSX.Element {
  let frame!: HTMLIFrameElement
  const key = `${PREFIX}${props.id}`
  const receive = (event: MessageEvent) => {
    if (event.source !== frame.contentWindow || event.data?.type !== READY) return
    frame.contentWindow?.postMessage({ type: LOAD, snapshot: readSnapshot(key) }, "*")
  }
  const persist = (event: MessageEvent) => {
    if (event.source !== frame.contentWindow || event.data?.type !== CHANGE) return
    localStorage.setItem(key, JSON.stringify(event.data.snapshot))
  }
  onMount(() => { window.addEventListener("message", receive); window.addEventListener("message", persist) })
  onCleanup(() => { window.removeEventListener("message", receive); window.removeEventListener("message", persist) })
  return <div class="flex h-full min-h-0 flex-col" data-design-sketch>
    <iframe ref={frame} class="min-h-0 flex-1 border-0" title="Croquis Excalidraw" src="/design-sketch/index.html" data-design-sketch-frame />
  </div>
}
