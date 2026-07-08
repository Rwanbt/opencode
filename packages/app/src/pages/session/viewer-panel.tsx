// Viewer panel extracted from file-tabs.tsx (PLAN-EDITEUR-IDE-DEFINITIF Phase 2.5).
//
// WHY extracted: the read-mode block (ScrollView + Switch + renderFile) is
// the second of two cohesive responsibilities. Splitting it away leaves
// file-tabs.tsx as a thin orchestrator.
//
// The component is NOT self-contained — it depends on the parent for:
// - `scrollSync` (created in file-tabs.tsx via createScrollSync, shared
//   with the comments-related effects above),
// - `commentsUi` (line-comment controller from createLineCommentController),
// - `search` handle registration (registered against the file component).
//
// The viewer uses getters everywhere so Solid tracks fine-grained store
// mutations — when the file store updates content via produce(), the
// `source()` getter returns the new string and Dynamic re-evaluates.

import { Match, Switch } from "solid-js"
import { Dynamic } from "solid-js/web"
import { ScrollView } from "@opencode-ai/ui/scroll-view"
import { useFileComponent } from "@opencode-ai/ui/context/file"
import { useLanguage } from "@/context/language"
import { showToast } from "@opencode-ai/ui/toast"
import type { FileSearchHandle } from "@opencode-ai/ui/file"
import type { FileState } from "@/context/file/types"
import type { SelectedLineRange } from "@/context/file/types"

/** Minimal interface for the scroll-sync object — only what the viewer needs. */
export interface ScrollSyncHandle {
  setViewport: (el: HTMLDivElement) => void
  handleScroll: (event: Event & { currentTarget: HTMLDivElement }) => void
  queueRestore: () => void
}

/** Minimal interface for the comments controller — what the file component consumes. */
export interface ViewerCommentsUi {
  annotations: () => unknown
  renderAnnotation: unknown
  renderHoverUtility: unknown
  onLineSelected: (range: SelectedLineRange | null) => void
  onLineNumberSelectionEnd: unknown
  onLineSelectionEnd: (range: SelectedLineRange | null) => void
}

export interface ViewerSearchHandle {
  register: (handle: FileSearchHandle | null) => void
}

export interface ViewerPanelProps {
  /** Canonical path of the file currently rendered (getter). */
  path: () => string | undefined
  /** Read-mode state (loaded / loading / error). */
  state: () => FileState | undefined
  /** Raw disk content for the file component. */
  contents: () => string
  /** Scroll-sync handle from createScrollSync (shared with the parent's effects). */
  scrollSync: ScrollSyncHandle
  /** Line-comment controller (from createLineCommentController). */
  commentsUi: ViewerCommentsUi
  /** Search handle registration (used by the file component's onRendered). */
  search: ViewerSearchHandle
  /** Active selected-line range (note.selected ?? selectedLines). */
  activeSelection: () => SelectedLineRange | null
  /** Lines that have comments attached. */
  commentedLines: () => SelectedLineRange[]
}

export function ViewerPanel(props: ViewerPanelProps) {
  const fileComponent = useFileComponent()
  const language = useLanguage()

  // WHY: source is a getter (() => string), not a value, so the JSX reads
  // it inside each render — when the store mutates .content via produce,
  // source() returns the new string and Solid re-evaluates the `contents`
  // expression in the Dynamic's file prop, which triggers a re-render of
  // the file component. A plain string value would be captured at first
  // render and never refresh.
  const renderFile = (source: () => string) => (
    <div class="relative overflow-hidden pb-40">
      <Dynamic
        component={fileComponent}
        mode="text"
        file={{
          name: props.path() ?? "",
          contents: source(),
          cacheKey: source().length,
        }}
        enableLineSelection
        enableHoverUtility
        selectedLines={props.activeSelection()}
        commentedLines={props.commentedLines()}
        onRendered={() => {
          props.scrollSync.queueRestore()
        }}
        annotations={props.commentsUi.annotations()}
        renderAnnotation={props.commentsUi.renderAnnotation}
        renderHoverUtility={props.commentsUi.renderHoverUtility}
        onLineSelected={(range: SelectedLineRange | null) => {
          props.commentsUi.onLineSelected(range)
        }}
        onLineNumberSelectionEnd={props.commentsUi.onLineNumberSelectionEnd}
        onLineSelectionEnd={(range: SelectedLineRange | null) => {
          props.commentsUi.onLineSelectionEnd(range)
        }}
        search={props.search}
        class="select-text"
        media={{
          mode: "auto",
          path: props.path(),
          current: props.state()?.content,
          onLoad: props.scrollSync.queueRestore,
          onError: (args: { kind: "image" | "audio" | "svg" }) => {
            if (args.kind !== "svg") return
            showToast({
              variant: "error",
              title: language.t("toast.file.loadFailed.title"),
            })
          },
        }}
      />
    </div>
  )

  return (
    <ScrollView
      class="h-full"
      viewportRef={props.scrollSync.setViewport}
      onScroll={props.scrollSync.handleScroll as any}
    >
      <Switch>
        <Match when={props.state()?.loaded}>{renderFile(() => props.contents())}</Match>
        <Match when={props.state()?.loading}>
          <div class="px-6 py-4 text-text-weak">{language.t("common.loading")}...</div>
        </Match>
        <Match when={props.state()?.error}>
          {(err) => <div class="px-6 py-4 text-text-weak">{err()}</div>}
        </Match>
      </Switch>
    </ScrollView>
  )
}