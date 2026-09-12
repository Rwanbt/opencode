/* SPDX-License-Identifier: MIT */

import { For, Show, type JSX, createMemo } from "solid-js"
import { useLanguage } from "@/context/language"
import {
  DEFAULT_VIEWPORT,
  DEFAULT_ZOOM,
  VIEWPORT_PRESETS,
  ZOOM_PRESETS,
  findViewport,
  type ViewportId,
} from "@unifia/artifact-render"

/**
 * P16 — Barre d'outils au-dessus de l'aperçu d'artefact.
 *
 * Trois modes mutuellement exclusifs :
 * - "preview" : l'iframe `ArtifactPreview` (comportement P11/P12)
 * - "source"  : texte brut de l'artefact, dans le même esprit que la
 *               section `data-code-artifact-viewer` du mode Code
 *               (session.tsx ligne 909) — un simple `<pre>` readonly,
 *               PAS un nouveau visualiseur (spec P16 §« Spécification
 *               exacte » alinéa "l'onglet Source").
 *
 * Sélecteur de viewport + zoom (multiplicateur 50/75/100/125/150/200).
 * Les changements sont remontés au parent via les callbacks `onViewport`
 * et `onZoom` ; le parent passe ensuite `viewport` et `zoom` à
 * `ArtifactPreview` qui les consomme pour wrapper l'iframe dans un
 * container aux bonnes dimensions (transform: scale).
 */

export type DesignToolbarMode = "preview" | "source"

export type DesignToolbarSnapshotState =
  | { kind: "idle" }
  | { kind: "capturing" }
  | { kind: "ready"; dataUrl: string; w: number; h: number }
  | { kind: "error"; error: string }

export function DesignToolbar(props: {
  viewport: ViewportId
  zoom: number
  mode: DesignToolbarMode
  hasSource: boolean
  snapshot: DesignToolbarSnapshotState
  onViewport: (id: ViewportId) => void
  onZoom: (zoom: number) => void
  onMode: (mode: DesignToolbarMode) => void
  onSnapshot: () => void
  onExportHtml?: () => void
  onExportPdf?: () => void
  exportState?: { kind: "idle" | "exporting" | "exported" | "error"; error?: string }
  /** Phase 8.3/9.6 — nombre de commentaires ouverts, affiché en badge. */
  commentCount?: number
  commentPanelOpen?: boolean
  onToggleCommentPanel?: () => void
  /** Phase 9.6 — copie l'image dans le presse-papiers en plus du téléchargement. */
  onCopySnapshot?: () => void
  copyState?: "idle" | "copying" | "copied" | "error"
}): JSX.Element {
  const language = useLanguage()
  const t = language.t
  const viewportLabel = createMemo(() => findViewport(props.viewport).label)
  return (
    <div
      class="flex h-9 shrink-0 flex-wrap items-center gap-2 border-b border-border-base bg-background-stronger px-2"
      role="toolbar"
      aria-label={t("workbench.design.toolbar.viewport")}
      data-design-toolbar
      data-design-toolbar-viewport={props.viewport}
      data-design-toolbar-zoom={props.zoom}
      data-design-toolbar-mode={props.mode}
    >
      <div class="flex items-center gap-1" data-design-toolbar-group="viewport">
        <For each={VIEWPORT_PRESETS}>
          {(preset) => (
            <button
              type="button"
              class="flex min-h-11 min-w-11 items-center rounded px-2 text-12-medium transition-colors motion-reduce:transition-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-border-focus"
              classList={{
                "bg-background-base text-text-base": preset.id === props.viewport,
                "text-text-weak hover:bg-background-base": preset.id !== props.viewport,
              }}
              aria-pressed={preset.id === props.viewport}
              data-design-toolbar-viewport-button={preset.id}
              onClick={() => props.onViewport(preset.id)}
              title={preset.label}
            >
              {preset.id}
            </button>
          )}
        </For>
        <span class="text-12-regular text-text-weak" data-design-toolbar-viewport-label>{viewportLabel()}</span>
      </div>
      <div class="mx-1 h-5 w-px bg-border-base" aria-hidden="true" />
      <div class="flex items-center gap-1" data-design-toolbar-group="zoom">
        <For each={ZOOM_PRESETS}>
          {(zoom) => (
            <button
              type="button"
              class="flex min-h-11 min-w-11 items-center rounded px-2 text-12-medium transition-colors motion-reduce:transition-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-border-focus"
              classList={{
                "bg-background-base text-text-base": zoom === props.zoom,
                "text-text-weak hover:bg-background-base": zoom !== props.zoom,
              }}
              aria-pressed={zoom === props.zoom}
              data-design-toolbar-zoom-button={zoom}
              onClick={() => props.onZoom(zoom)}
              title={`${zoom}%`}
            >
              {zoom}%
            </button>
          )}
        </For>
      </div>
      <div class="mx-1 h-5 w-px bg-border-base" aria-hidden="true" />
      <div class="flex items-center gap-1" data-design-toolbar-group="mode">
        <button
          type="button"
          class="flex min-h-11 min-w-11 items-center rounded px-2 text-12-medium transition-colors motion-reduce:transition-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-border-focus"
          classList={{
            "bg-background-base text-text-base": props.mode === "preview",
            "text-text-weak hover:bg-background-base": props.mode !== "preview",
          }}
          aria-pressed={props.mode === "preview"}
          data-design-toolbar-mode-button="preview"
          onClick={() => props.onMode("preview")}
        >
          {t("workbench.design.toolbar.preview")}
        </button>
        <button
          type="button"
          class="flex min-h-11 min-w-11 items-center rounded px-2 text-12-medium transition-colors motion-reduce:transition-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-border-focus"
          classList={{
            "bg-background-base text-text-base": props.mode === "source",
            "text-text-weak hover:bg-background-base": props.mode !== "source",
          }}
          aria-pressed={props.mode === "source"}
          disabled={!props.hasSource}
          data-design-toolbar-mode-button="source"
          onClick={() => props.onMode("source")}
        >
          {t("workbench.design.toolbar.source")}
        </button>
      </div>
      <Show when={props.onToggleCommentPanel}>
        <div class="mx-1 h-5 w-px bg-border-base" aria-hidden="true" />
        <div class="flex items-center gap-1" data-design-toolbar-group="comments">
          <button
            type="button"
            class="flex h-7 items-center gap-1 rounded px-2 text-12-medium transition-colors"
            classList={{
              "bg-background-base text-text-base": props.commentPanelOpen === true,
              "text-text-weak hover:bg-background-base": props.commentPanelOpen !== true,
            }}
            aria-pressed={props.commentPanelOpen === true}
            data-design-toolbar-comments-toggle
            onClick={() => props.onToggleCommentPanel?.()}
            title="Afficher ou masquer le panneau de commentaires"
          >
            Commentaires
            <Show when={(props.commentCount ?? 0) > 0}>
              <span
                class="flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-10-medium text-primary-foreground"
                data-design-toolbar-comments-badge
              >
                {props.commentCount}
              </span>
            </Show>
          </button>
        </div>
      </Show>
      <div class="mx-1 h-5 w-px bg-border-base" aria-hidden="true" />
      <div class="flex items-center gap-1" data-design-toolbar-group="export">
        <button
          type="button"
          class="flex h-7 items-center rounded px-2 text-12-medium transition-colors disabled:opacity-50"
          disabled={!props.onExportHtml || !props.hasSource || (props.exportState?.kind === "exporting")}
          data-design-toolbar-export-html
          data-design-toolbar-export-state={props.exportState?.kind ?? "idle"}
          onClick={() => props.onExportHtml?.()}
          title="Inline CSS, scripts, and images into a single self-contained HTML file"
        >
          {props.exportState?.kind === "exporting" ? "Exporting…" : "Export HTML"}
        </button>
        <button
          type="button"
          class="flex h-7 items-center rounded px-2 text-12-medium transition-colors disabled:opacity-50"
          disabled={!props.onExportPdf || !props.hasSource || (props.exportState?.kind === "exporting")}
          data-design-toolbar-export-pdf
          onClick={() => props.onExportPdf?.()}
          title="Build a PDF from the current page captures"
        >
          Export PDF
        </button>
        <Show when={props.exportState?.kind === "error"}>
          <span data-design-toolbar-export-error class="text-12-regular text-text-danger">{props.exportState?.error ?? "export failed"}</span>
        </Show>
      </div>
      <div class="mx-1 h-5 w-px bg-border-base" aria-hidden="true" />
      <div class="flex items-center gap-1" data-design-toolbar-group="snapshot">
        <button
          type="button"
          class="flex h-7 items-center rounded px-2 text-12-medium transition-colors disabled:opacity-50"
          disabled={props.snapshot.kind === "capturing"}
          data-design-toolbar-snapshot-button
          data-design-toolbar-snapshot-state={props.snapshot.kind}
          onClick={() => props.onSnapshot()}
          title="Envoie un message unifia:snapshot à l'iframe pour obtenir une image PNG du rendu"
        >
          {props.snapshot.kind === "capturing" ? "Capture…" : "Capture PNG"}
        </button>
        <Show when={props.snapshot.kind === "ready"}>
          <a
            href={props.snapshot.kind === "ready" ? props.snapshot.dataUrl : "#"}
            download={`capture-${props.snapshot.kind === "ready" ? `${props.snapshot.w}x${props.snapshot.h}` : ""}.png`}
            class="text-12-regular text-text-weak hover:text-text-base"
            data-design-toolbar-snapshot-download
          >
            {props.snapshot.kind === "ready" ? `télécharger ${props.snapshot.w}×${props.snapshot.h}` : ""}
          </a>
          <Show when={props.onCopySnapshot}>
            <button
              type="button"
              class="rounded px-2 text-12-regular text-text-weak hover:text-text-base disabled:opacity-50"
              disabled={props.copyState === "copying"}
              data-design-toolbar-snapshot-copy
              data-design-toolbar-snapshot-copy-state={props.copyState ?? "idle"}
              onClick={() => props.onCopySnapshot?.()}
              title="Copier l'image dans le presse-papiers"
            >
              {props.copyState === "copying" ? "Copie…" : props.copyState === "copied" ? "Copié !" : "Copier"}
            </button>
          </Show>
        </Show>
        <Show when={props.snapshot.kind === "error"}>
          <span class="text-12-regular text-text-danger" data-design-toolbar-snapshot-error>
            {props.snapshot.kind === "error" ? `échec : ${props.snapshot.error}` : ""}
          </span>
        </Show>
      </div>
    </div>
  )
}

export const DEFAULT_TOOLBAR_MODE: DesignToolbarMode = "preview"
export { DEFAULT_VIEWPORT, DEFAULT_ZOOM }
