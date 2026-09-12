/* SPDX-License-Identifier: MIT */

import React, { createElement, useEffect, useState } from "react"
import { createRoot } from "react-dom/client"
import { Excalidraw } from "@excalidraw/excalidraw"
import type { ExcalidrawElement, AppState, BinaryFiles } from "@excalidraw/excalidraw/element/types"

type Snapshot = { elements: readonly ExcalidrawElement[]; appState: Partial<AppState>; files: BinaryFiles }
const READY = "unifia:sketch-ready"
const LOAD = "unifia:sketch-load"
const CHANGE = "unifia:sketch-change"

function Sketch(): React.JSX.Element {
  const [initial, setInitial] = useState<Snapshot | undefined>()
  useEffect(() => {
    const receive = (event: MessageEvent) => {
      if (event.source !== window.parent || event.data?.type !== LOAD) return
      setInitial(event.data.snapshot as Snapshot)
    }
    window.addEventListener("message", receive)
    window.parent.postMessage({ type: READY }, "*")
    return () => window.removeEventListener("message", receive)
  }, [])
  return createElement(Excalidraw, {
    initialData: initial,
    onChange: (elements, appState, files) => window.parent.postMessage({ type: CHANGE, snapshot: { elements, appState: { viewBackgroundColor: appState.viewBackgroundColor }, files } }, "*"),
  })
}

createRoot(document.getElementById("root")!).render(createElement(Sketch))
