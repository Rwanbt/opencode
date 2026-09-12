/* SPDX-License-Identifier: MIT */

import { createSignal, type Accessor } from "solid-js"

/**
 * F11 — extracted responsibility: the Design surface's snapshot
 * state machine.
 *
 * BEFORE: `design-surface.tsx` (852 LOC) inlined four coupled
 * pieces — the snapshot signal (`{ kind: "idle" | "capturing" |
 * "ready" | "error" }`), the `requestSnapshot` action that drives it,
 * the `copySnapshot` action that ships the result to the clipboard,
 * and the `capture` slot the iframe plugs itself into via
 * `onSnapshotReady`. The four belong together; the surface file
 * did not need to know that.
 *
 * AFTER: this module owns the state machine and the two actions.
 * The surface calls `createDesignSnapshot()` once, hands the
 * returned `setCapture` to the iframe, and renders the toolbar
 * with `snapshot()` / `copyState()`. The state machine is
 * reactive (Solid signals) and unit-testable in isolation — the
 * F11 test asserts the four transitions and the "capture not
 * mounted" error path.
 *
 * WHY a callback slot instead of a direct `iframeRef`: the snapshot
 * capture happens inside an iframe (postMessage same-origin is
 * impossible from the host), and the only stable contract between
 * the iframe and the host is "the iframe calls
 * `onSnapshotReady(captureFn)` once it mounts". The state machine
 * must therefore be passive: a slot the iframe fills, an action
 * the toolbar triggers.
 */

export type DesignSnapshot =
  | { kind: "idle" }
  | { kind: "capturing" }
  | { kind: "ready"; dataUrl: string; w: number; h: number }
  | { kind: "error"; error: string }

export type CopyState = "idle" | "copying" | "copied" | "error"

export type DesignSnapshotController = {
  /** Current snapshot state. Read by the toolbar to render. */
  snapshot: Accessor<DesignSnapshot>
  /** Trigger a capture. No-op if already capturing or if no iframe is mounted. */
  requestSnapshot(): void
  /** Iframe-side: register the capture function once mounted. */
  setCapture(capture: (() => Promise<{ dataUrl: string; w: number; h: number }>) | undefined): void
  /** Copy the most recent ready snapshot to the clipboard. */
  copySnapshot(): Promise<void>
  /** Current clipboard copy state. */
  copyState: Accessor<CopyState>
  /** Time (ms) before `copyState: copied` returns to `idle`. */
  readonly copyResetMs: number
}

export type CreateDesignSnapshotOptions = {
  /** Injectable clipboard writer for the test environment. */
  writeClipboard?: (blob: Blob) => Promise<void>
  /** Injectable blob factory so the test does not need a real `fetch(dataUrl)`. */
  blobFromDataUrl?: (dataUrl: string) => Promise<Blob>
  /** setTimeout override for the copy-state auto-reset. */
  setTimeoutFn?: (cb: () => void, ms: number) => unknown
  clearTimeoutFn?: (handle: unknown) => void
}

export function createDesignSnapshot(options: CreateDesignSnapshotOptions = {}): DesignSnapshotController {
  const writeClipboard = options.writeClipboard ?? ((blob: Blob) => navigator.clipboard.write([new ClipboardItem({ [blob.type]: blob })]))
  const blobFromDataUrl = options.blobFromDataUrl ?? ((dataUrl: string) => fetch(dataUrl).then((r) => r.blob()))
  const setT = options.setTimeoutFn ?? ((cb, ms) => setTimeout(cb, ms))
  const clearT = options.clearTimeoutFn ?? ((h) => clearTimeout(h as ReturnType<typeof setTimeout>))

  const [snapshot, setSnapshot] = createSignal<DesignSnapshot>({ kind: "idle" })
  const [copyState, setCopyState] = createSignal<CopyState>("idle")
  let capture: (() => Promise<{ dataUrl: string; w: number; h: number }>) | undefined
  let copyResetHandle: unknown

  return {
    snapshot,
    requestSnapshot: () => {
      if (snapshot().kind === "capturing") return
      if (!capture) {
        setSnapshot({ kind: "error", error: "preview-not-mounted" })
        return
      }
      setSnapshot({ kind: "capturing" })
      void capture()
        .then((result) => setSnapshot({ kind: "ready", dataUrl: result.dataUrl, w: result.w, h: result.h }))
        .catch((error: unknown) => setSnapshot({ kind: "error", error: error instanceof Error ? error.message : "snapshot-failed" }))
    },
    setCapture: (next) => { capture = next },
    copyState,
    copySnapshot: async () => {
      const current = snapshot()
      if (current.kind !== "ready" || copyState() === "copying") return
      setCopyState("copying")
      try {
        const blob = await blobFromDataUrl(current.dataUrl)
        await writeClipboard(blob)
        setCopyState("copied")
        if (copyResetHandle !== undefined) clearT(copyResetHandle)
        copyResetHandle = setT(() => { setCopyState("idle"); copyResetHandle = undefined }, 2_000)
      } catch {
        setCopyState("error")
      }
    },
    get copyResetMs() { return 2_000 },
  }
}
