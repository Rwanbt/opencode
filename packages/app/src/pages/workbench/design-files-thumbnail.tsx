/* SPDX-License-Identifier: MIT */

import { Match, Show, Switch, createEffect, createSignal, onCleanup, type JSX } from "solid-js"
import { createStore } from "solid-js/store"
import { useWorkspaceWorkbench } from "@/context/workbench/provider"
import { ArtifactPreview } from "@/pages/workbench/artifact-preview"
import {
  collectRelativeAssetTargets,
  decodeWorkspaceFile,
  inlineRelativeAssets,
  isRenderable,
} from "@/pages/workbench/design-files-preview"
import { firstTextLines, type ThumbnailPreview } from "@/pages/workbench/design-files-thumbnail-model"
import { createThumbnailQueue } from "@/pages/workbench/design-files-thumbnail-queue"
import type { ViewportId } from "@unifia/artifact-render"

/**
 * Phase 7.2 — file-list thumbnails.
 *
 * One hidden `ArtifactPreview` (`ThumbnailHost`, mounted once by
 * `DesignFilesTab`) renders each requested file in turn, low-zoom and
 * off-screen, and captures it through the same `unifia:snapshot` bridge
 * the toolbar's screenshot button already uses. Requests are funneled
 * through a single `SequentialQueue` (`design-files-thumbnail-model.ts`)
 * so a 50-file list never mounts more than one generation at a time.
 *
 * `ArtifactPreview`'s `ref` callback (and so `onSnapshotReady`) only fires
 * once, at iframe creation — but its native `onLoad` (Phase 7.2 addition,
 * `onFrameLoad`) re-fires on every `srcdoc` change. That's the exact
 * per-job "content has actually loaded, the bridge's message listener is
 * attached" signal a hidden, reused iframe needs before it's safe to call
 * `requestSnapshot()` — calling it right after `onSnapshotReady` instead
 * would race the srcdoc's own load.
 *
 * The mobile viewport preset (390×844) is deliberately used instead of
 * the desktop default: `ArtifactPreview`'s on-screen zoom is a CSS
 * transform on a wrapper *around* the iframe, so it shrinks the display
 * only — the iframe itself, and so the rasterized capture, is always
 * full-viewport-preset size. Using the smallest preset keeps that capture
 * (and the per-file rasterization cost the queue pays one at a time)
 * cheap; the resulting PNG is then displayed shrunk via CSS in the row.
 */

const THUMBNAIL_VIEWPORT: ViewportId = "mobile"
const THUMBNAIL_ZOOM = 25
/**
 * Belt-and-braces on top of `ArtifactPreview`'s own `SNAPSHOT_TIMEOUT_MS`
 * (5s, for a bridge that loaded but never answers) — this covers the case
 * where the iframe never fires `load` at all.
 */
const THUMBNAIL_RENDER_TIMEOUT_MS = 8_000

type ThumbnailJob = {
  source: string
  resolve: (dataUrl: string) => void
  reject: (error: Error) => void
}

export type ThumbnailController = {
  get: (path: string) => ThumbnailPreview | undefined
  /** No-op if `path` is already cached or a generation for it is already queued. */
  request: (path: string) => void
  /** Consumed only by `ThumbnailHost` — not meant for row components. */
  job: () => ThumbnailJob | undefined
  registerSnapshot: (request: (() => Promise<{ dataUrl: string; w: number; h: number }>) | undefined) => void
  notifyFrameLoad: () => void
}

export function createThumbnailController(): ThumbnailController {
  const workbench = useWorkspaceWorkbench()
  const connection = workbench.connection
  const queue = createThumbnailQueue({ cap: 64 })
  const [cache, setCache] = createStore<Record<string, ThumbnailPreview>>({})
  const requested = new Set<string>()
  const [job, setJob] = createSignal<ThumbnailJob>()
  let snapshotRequest: (() => Promise<{ dataUrl: string; w: number; h: number }>) | undefined

  async function renderToDataUrl(source: string, signal: AbortSignal): Promise<string> {
    return new Promise<string>((resolve, reject) => {
      const abort = () => {
        clearTimeout(timer)
        reject(new DOMException("thumbnail generation cancelled", "AbortError"))
      }
      const timer = setTimeout(() => reject(new Error("thumbnail-timeout")), THUMBNAIL_RENDER_TIMEOUT_MS)
      if (signal.aborted) {
        abort()
        return
      }
      signal.addEventListener("abort", abort, { once: true })
      setJob({
        source,
        resolve: (dataUrl) => {
          clearTimeout(timer)
          signal.removeEventListener("abort", abort)
          resolve(dataUrl)
        },
        reject: (error) => {
          clearTimeout(timer)
          signal.removeEventListener("abort", abort)
          reject(error)
        },
      })
    })
  }

  async function generate(path: string, signal: AbortSignal): Promise<ThumbnailPreview> {
    signal.throwIfAborted()
    const current = connection()
    if (!current) throw new Error("no-connection")
    const read = await current.client.readFiles(current.workspaceId, [path])
    signal.throwIfAborted()
    const file = read.results[0]
    if (!file) throw new Error("file-missing")
    const text = decodeWorkspaceFile(file)
    if (!isRenderable(path)) return { kind: "text", lines: firstTextLines(text) }

    const targets = collectRelativeAssetTargets(text, path)
    const assetPaths = [...new Set(targets.map((target) => target.path))]
    const assetContent = assetPaths.length > 0 ? await current.client.readFiles(current.workspaceId, assetPaths) : { results: [] }
    signal.throwIfAborted()
    const byPath = new Map(assetContent.results.map((asset) => [asset.path, decodeWorkspaceFile(asset)]))
    const rendered = inlineRelativeAssets(text, path, byPath)

    const dataUrl = await renderToDataUrl(rendered, signal)
    return { kind: "image", dataUrl }
  }

  function request(path: string): void {
    if (requested.has(path) || path in cache) return
    requested.add(path)
    queue
      .generate(path, (signal) => generate(path, signal))
      .then((preview) => setCache(path, preview))
      .catch(() => setCache(path, { kind: "error" }))
      .finally(() => setJob(undefined))
  }

  onCleanup(() => queue.cancelAll())

  return {
    get: (path) => cache[path],
    request,
    job,
    registerSnapshot: (next) => {
      snapshotRequest = next
    },
    notifyFrameLoad: () => {
      const current = job()
      if (!current || !snapshotRequest) return
      snapshotRequest().then(
        (result) => current.resolve(result.dataUrl),
        (error) => current.reject(error instanceof Error ? error : new Error(String(error))),
      )
    },
  }
}

/** Mounted once by `DesignFilesTab`; off-screen, real pixel size (needed for a non-empty capture). */
export function ThumbnailHost(props: { controller: ThumbnailController }): JSX.Element {
  return (
    <div
      class="pointer-events-none absolute left-[-9999px] top-0 h-[180px] w-[120px] overflow-hidden opacity-0"
      aria-hidden="true"
      data-design-files-thumbnail-host
    >
      <ArtifactPreview
        artifactId="design-files-thumbnail"
        workspaceId=""
        source={props.controller.job()?.source ?? ""}
        mode="preview"
        viewport={THUMBNAIL_VIEWPORT}
        zoom={THUMBNAIL_ZOOM}
        onSnapshotReady={props.controller.registerSnapshot}
        onFrameLoad={props.controller.notifyFrameLoad}
      />
    </div>
  )
}

/**
 * Deferred per Phase 7.2's porte: generation is requested only once the
 * row actually scrolls into view (`rootMargin: "200px"` starts it a
 * little early so it's usually ready by the time it's fully visible),
 * not for all 50 rows up front.
 */
export function FileThumbnail(props: { path: string; controller: ThumbnailController }): JSX.Element {
  const [visible, setVisible] = createSignal(false)

  function onRef(element: HTMLDivElement): void {
    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries.some((entry) => entry.isIntersecting)) return
        setVisible(true)
        observer.disconnect()
      },
      { rootMargin: "200px" },
    )
    observer.observe(element)
    onCleanup(() => observer.disconnect())
  }

  createEffect(() => {
    if (visible()) props.controller.request(props.path)
  })

  return (
    <div ref={onRef} data-design-files-thumbnail={props.path}>
      <Show when={props.controller.get(props.path)}>
        {(preview) => (
          <Switch>
            <Match when={preview().kind === "image" ? (preview() as { kind: "image"; dataUrl: string }) : undefined}>
              {(image) => (
                <img
                  src={image().dataUrl}
                  alt=""
                  class="mt-1 h-16 w-full rounded border border-border-weak-base object-cover object-top"
                  data-design-files-thumbnail-image
                />
              )}
            </Match>
            <Match when={preview().kind === "text" ? (preview() as { kind: "text"; lines: readonly string[] }) : undefined}>
              {(text) => (
                <p
                  class="mt-1 line-clamp-2 overflow-hidden rounded border border-border-weak-base bg-background-base p-1 font-mono text-11-regular text-text-weak"
                  data-design-files-thumbnail-text
                >
                  {text().lines.join("\n")}
                </p>
              )}
            </Match>
          </Switch>
        )}
      </Show>
    </div>
  )
}
