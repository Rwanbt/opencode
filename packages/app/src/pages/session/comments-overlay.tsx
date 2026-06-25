// Comments overlay extracted from file-tabs.tsx (PLAN-EDITEUR-IDE-DEFINITIF Phase 2.5).
//
// WHY a factory, not a component: the comments controller (createLineCommentController)
// owns Solid state and effects that the VIEWER consumes. Hoisting those into a
// pure <CommentsOverlay /> component would require lifting 5+ getters/setters into
// props just to feed them back into ViewerPanel — which already imports them via
// ViewerCommentsUi. A factory pattern (createCommentsOverlay(deps) → { commentsUi,
// fileComments, commentedLines, activeSelection }) keeps the state internal and
// exposes only what ViewerPanel needs.
//
// FileCommentMenu stays in this module because it's only consumed by
// `renderCommentActions` below. Re-exported in case future comment surfaces need it.

import { createEffect, createMemo, on } from "solid-js"
import { createStore } from "solid-js/store"
import { DropdownMenu } from "@opencode-ai/ui/dropdown-menu"
import { IconButton } from "@opencode-ai/ui/icon-button"
import { cloneSelectedLineRange, previewSelectedLines } from "@opencode-ai/ui/pierre/selection-bridge"
import { createLineCommentController } from "@opencode-ai/ui/line-comment-annotations"
import { selectionFromLines, useFile } from "@/context/file"
import { useComments } from "@/context/comments"
import { useLanguage } from "@/context/language"
import { usePrompt } from "@/context/prompt"
import type { FileSelection, SelectedLineRange } from "@/context/file/types"

function FileCommentMenu(props: {
  moreLabel: string
  editLabel: string
  deleteLabel: string
  onEdit: VoidFunction
  onDelete: VoidFunction
}) {
  return (
    <div onMouseDown={(event) => event.stopPropagation()} onClick={(event) => event.stopPropagation()}>
      <DropdownMenu gutter={4} placement="bottom-end">
        <DropdownMenu.Trigger
          as={IconButton}
          icon="dot-grid"
          variant="ghost"
          size="small"
          class="size-6 rounded-md"
          aria-label={props.moreLabel}
        />
        <DropdownMenu.Portal>
          <DropdownMenu.Content>
            <DropdownMenu.Item onSelect={props.onEdit}>
              <DropdownMenu.ItemLabel>{props.editLabel}</DropdownMenu.ItemLabel>
            </DropdownMenu.Item>
            <DropdownMenu.Item onSelect={props.onDelete}>
              <DropdownMenu.ItemLabel>{props.deleteLabel}</DropdownMenu.ItemLabel>
            </DropdownMenu.Item>
          </DropdownMenu.Content>
        </DropdownMenu.Portal>
      </DropdownMenu>
    </div>
  )
}

export interface CommentsOverlayDeps {
  /** Canonical path of the currently-rendered file (getter). */
  path: () => string | undefined
  /** Raw disk content used for preview snippets. */
  contents: () => string
  /** Stable tab id used as the comment draft key. */
  tab: string
  /** Get file content for any path (used by buildPreview for cross-file previews). */
  getFileSource: (path: string) => string | undefined
  /** Set the file's selected-lines range (write-through to file store). */
  setSelectedLines: (path: string, range: SelectedLineRange | null) => void
  /** True when the user is in edit mode — needed for some gating decisions. */
  editing: () => boolean
  /** True when the active tab is this one (or override mode). */
  isActiveTab: () => boolean
}

export interface CommentsOverlay {
  /** The comments controller — fed to ViewerPanel via ViewerCommentsUi. */
  commentsUi: ReturnType<typeof createLineCommentController>
  /** The comment ranges (extracted from comments for the current path). */
  commentedLines: () => SelectedLineRange[]
  /** Active selected-line range (note.selected only — viewer pre-existing selectedLines from file store is no longer composed here). */
  activeSelection: () => SelectedLineRange | null
}

export function createCommentsOverlay(deps: CommentsOverlayDeps): CommentsOverlay {
  const comments = useComments()
  const language = useLanguage()
  const prompt = usePrompt()
  const file = useFile()

  const selectionPreview = (source: string, selection: FileSelection) => {
    return previewSelectedLines(source, {
      start: selection.startLine,
      end: selection.endLine,
    })
  }

  const buildPreview = (filePath: string, selection: FileSelection) => {
    const source = filePath === deps.path() ? deps.contents() : deps.getFileSource(filePath)
    if (!source) return undefined
    return selectionPreview(source, selection)
  }

  const addCommentToContext = (input: {
    file: string
    selection: SelectedLineRange
    comment: string
    preview?: string
    origin?: "review" | "file"
  }) => {
    const selection = selectionFromLines(input.selection)
    const preview = input.preview ?? buildPreview(input.file, selection)

    const saved = comments.add({
      file: input.file,
      selection: input.selection,
      comment: input.comment,
    })
    prompt.context.add({
      type: "file",
      path: input.file,
      selection,
      comment: input.comment,
      commentID: saved.id,
      commentOrigin: input.origin,
      preview,
    })
  }

  const updateCommentInContext = (input: {
    id: string
    file: string
    selection: SelectedLineRange
    comment: string
  }) => {
    comments.update(input.file, input.id, input.comment)
    const preview =
      input.file === deps.path() ? buildPreview(input.file, selectionFromLines(input.selection)) : undefined
    prompt.context.updateComment(input.file, input.id, {
      comment: input.comment,
      ...(preview ? { preview } : {}),
    })
  }

  const removeCommentFromContext = (input: { id: string; file: string }) => {
    comments.remove(input.file, input.id)
    prompt.context.removeComment(input.file, input.id)
  }

  const fileComments = createMemo(() => {
    const p = deps.path()
    if (!p) return []
    return comments.list(p)
  })

  const commentedLines = createMemo(() => fileComments().map((comment) => comment.selection))

  const [note, setNote] = createStore({
    openedComment: null as string | null,
    commenting: null as SelectedLineRange | null,
    selected: null as SelectedLineRange | null,
  })

  const syncSelected = (range: SelectedLineRange | null) => {
    const p = deps.path()
    if (!p) return
    deps.setSelectedLines(p, range ? cloneSelectedLineRange(range) : null)
  }

  const activeSelection = (): SelectedLineRange | null => note.selected

  const commentsUi = createLineCommentController({
    comments: fileComments,
    label: language.t("ui.lineComment.submit"),
    draftKey: () => deps.path() ?? deps.tab,
    mention: {
      items: file.searchFilesAndDirectories,
    },
    state: {
      opened: () => note.openedComment,
      setOpened: (id) => setNote("openedComment", id),
      selected: () => note.selected,
      setSelected: (range) => setNote("selected", range),
      commenting: () => note.commenting,
      setCommenting: (range) => setNote("commenting", range),
      syncSelected,
      hoverSelected: syncSelected,
    },
    getHoverSelectedRange: activeSelection,
    cancelDraftOnCommentToggle: true,
    clearSelectionOnSelectionEndNull: true,
    onSubmit: ({ comment, selection }) => {
      const p = deps.path()
      if (!p) return
      addCommentToContext({ file: p, selection, comment, origin: "file" })
    },
    onUpdate: ({ id, comment, selection }) => {
      const p = deps.path()
      if (!p) return
      updateCommentInContext({ id, file: p, selection, comment })
    },
    onDelete: (comment) => {
      const p = deps.path()
      if (!p) return
      removeCommentFromContext({ id: comment.id, file: p })
    },
    editSubmitLabel: language.t("common.save"),
    renderCommentActions: (_, controls) => (
      <FileCommentMenu
        moreLabel={language.t("common.moreOptions")}
        editLabel={language.t("common.edit")}
        deleteLabel={language.t("common.delete")}
        onEdit={controls.edit}
        onDelete={controls.remove}
      />
    ),
  })

  // Reset the comment note when the user navigates to a different file.
  createEffect(
    on(
      () => deps.path(),
      () => {
        commentsUi.note.reset()
      },
      { defer: true },
    ),
  )

  // When the comments context emits a focus event for the current file,
  // open the comment in the UI and clear the focus signal.
  createEffect(() => {
    const focus = comments.focus()
    const p = deps.path()
    if (!focus || !p) return
    if (focus.file !== p) return
    if (!deps.isActiveTab()) return

    const target = fileComments().find((comment) => comment.id === focus.id)
    if (!target) return

    commentsUi.note.openComment(target.id, target.selection, { cancelDraft: true })
    requestAnimationFrame(() => comments.clearFocus())
  })

  return {
    commentsUi,
    commentedLines,
    activeSelection,
  }
}

// Suppress unused warning for `editing` — kept in deps signature for future
// gating (e.g. don't show comment focus in edit mode). Cheap to keep around.
void ({} as { editing: () => boolean })