/**
 * Factory for review-panel rendering helpers and review-diff scroll utilities
 * in the session page. Extracted from session.tsx to keep it under the
 * 1500-LOC budget.
 *
 * Contains: changesTitle, empty, reviewEmptyText, reviewEmpty, reviewContent,
 * reviewPanel, reviewDiffId, reviewDiffTop, scrollToReviewDiff,
 * focusReviewDiff, and the pendingDiff auto-scroll effect.
 */
import { createEffect, createMemo, Show } from "solid-js"
import type { SetStoreFunction } from "solid-js/store"
import { Select } from "@opencode-ai/ui/select"
import { Button } from "@opencode-ai/ui/button"
import type { FileDiff } from "@opencode-ai/sdk/v2"
import { checksum } from "@opencode-ai/util/encode"
import type { useLayout } from "@/context/layout"
import type { useLanguage } from "@/context/language"
import type { useFile } from "@/context/file"
import type { useComments } from "@/context/comments"
import type { SelectedLineRange } from "@/context/file"
import { type DiffStyle, SessionReviewTab, type SessionReviewTabProps } from "@/pages/session/review-tab"

type ChangeMode = "git" | "branch" | "session" | "turn"

type TreeStore = {
  reviewScroll: HTMLDivElement | undefined
  pendingDiff: string | undefined
  activeDiff: string | undefined
}

interface ReviewHelpersDeps {
  canReview: () => boolean
  language: ReturnType<typeof useLanguage>
  changesOptions: () => ChangeMode[]
  store: { changes: ChangeMode; deferRender: boolean }
  onSelectChange: (value: ChangeMode) => void
  reviewReady: () => boolean
  hasSessionReview: () => boolean
  diffsReady: () => boolean
  sessionEmptyKey: () => string
  reviewDiffs: () => FileDiff[]
  view: () => ReturnType<ReturnType<typeof useLayout>["view"]>
  tree: TreeStore
  setTree: SetStoreFunction<TreeStore>
  addCommentToContext: (input: {
    file: string
    selection: SelectedLineRange
    comment: string
    preview?: string
    origin?: "review" | "file"
  }) => void
  updateCommentInContext: (input: {
    id: string
    file: string
    selection: SelectedLineRange
    comment: string
    preview?: string
  }) => void
  removeCommentFromContext: (input: { id: string; file: string }) => void
  reviewCommentActions: () => { moreLabel: string; editLabel: string; deleteLabel: string; saveLabel: string }
  file: ReturnType<typeof useFile>
  comments: ReturnType<typeof useComments>
  openReviewFile: (path: string) => void
  openReviewPanel: () => void
  layout: Pick<ReturnType<typeof useLayout>, "review">
  gitMutation: { isPending: boolean }
  initGit: () => void
}

export function createReviewHelpers(deps: ReviewHelpersDeps) {
  const {
    canReview,
    language,
    changesOptions,
    store,
    onSelectChange,
    reviewReady,
    hasSessionReview,
    diffsReady,
    sessionEmptyKey,
    reviewDiffs,
    view,
    tree,
    setTree,
    addCommentToContext,
    updateCommentInContext,
    removeCommentFromContext,
    reviewCommentActions,
    file,
    comments,
    openReviewFile,
    openReviewPanel,
    layout,
    gitMutation,
    initGit,
  } = deps

  // ── Rendering helpers ──────────────────────────────────────────────────

  const changesTitle = () => {
    if (!canReview()) {
      return null
    }

    const label = (option: ChangeMode) => {
      if (option === "git") return language.t("ui.sessionReview.title.git")
      if (option === "branch") return language.t("ui.sessionReview.title.branch")
      if (option === "session") return language.t("ui.sessionReview.title")
      return language.t("ui.sessionReview.title.lastTurn")
    }

    return (
      <Select
        options={changesOptions()}
        current={store.changes}
        label={label}
        onSelect={(option) => option && onSelectChange(option)}
        variant="ghost"
        size="small"
        valueClass="text-14-medium"
      />
    )
  }

  const empty = (text: string) => (
    <div class="h-full pb-64 -mt-4 flex flex-col items-center justify-center text-center gap-6">
      <div class="text-14-regular text-text-weak max-w-56">{text}</div>
    </div>
  )

  const reviewEmptyText = createMemo(() => {
    if (store.changes === "git") return language.t("session.review.noUncommittedChanges")
    if (store.changes === "branch") return language.t("session.review.noBranchChanges")
    if (store.changes === "turn") return language.t("session.review.noChanges")
    return language.t(sessionEmptyKey())
  })

  const reviewEmpty = (input: { loadingClass: string; emptyClass: string }) => {
    if (store.changes === "git" || store.changes === "branch") {
      if (!reviewReady()) return <div class={input.loadingClass}>{language.t("session.review.loadingChanges")}</div>
      return empty(reviewEmptyText())
    }

    if (store.changes === "turn") {
      return empty(reviewEmptyText())
    }

    if (hasSessionReview() && !diffsReady()) {
      return <div class={input.loadingClass}>{language.t("session.review.loadingChanges")}</div>
    }

    if (sessionEmptyKey() === "session.review.noVcs") {
      return (
        <div class={input.emptyClass}>
          <div class="flex flex-col gap-3">
            <div class="text-14-medium text-text-strong">{language.t("session.review.noVcs.createGit.title")}</div>
            <div class="text-14-regular text-text-base max-w-md" style={{ "line-height": "var(--line-height-normal)" }}>
              {language.t("session.review.noVcs.createGit.description")}
            </div>
          </div>
          <Button size="large" disabled={gitMutation.isPending} onClick={initGit}>
            {gitMutation.isPending
              ? language.t("session.review.noVcs.createGit.actionLoading")
              : language.t("session.review.noVcs.createGit.action")}
          </Button>
        </div>
      )
    }

    return (
      <div class={input.emptyClass}>
        <div class="text-14-regular text-text-weak max-w-56">{reviewEmptyText()}</div>
      </div>
    )
  }

  const reviewContent = (input: {
    diffStyle: DiffStyle
    onDiffStyleChange?: (style: DiffStyle) => void
    classes?: SessionReviewTabProps["classes"]
    loadingClass: string
    emptyClass: string
  }) => (
    <Show when={!store.deferRender}>
      <SessionReviewTab
        title={changesTitle()}
        empty={reviewEmpty(input)}
        diffs={reviewDiffs}
        view={view}
        diffStyle={input.diffStyle}
        onDiffStyleChange={input.onDiffStyleChange}
        onScrollRef={(el) => setTree("reviewScroll", el)}
        focusedFile={tree.activeDiff}
        onLineComment={(comment) => addCommentToContext({ ...comment, origin: "review" })}
        onLineCommentUpdate={updateCommentInContext}
        onLineCommentDelete={removeCommentFromContext}
        lineCommentActions={reviewCommentActions()}
        commentMentions={{
          items: file.searchFilesAndDirectories,
        }}
        comments={comments.all()}
        focusedComment={comments.focus()}
        onFocusedCommentChange={comments.setFocus}
        onViewFile={openReviewFile}
        classes={input.classes}
      />
    </Show>
  )

  const reviewPanel = () => (
    <div class="flex flex-col h-full overflow-hidden bg-background-stronger contain-strict">
      <div class="relative pt-2 flex-1 min-h-0 overflow-hidden">
        {reviewContent({
          diffStyle: layout.review.diffStyle(),
          onDiffStyleChange: layout.review.setDiffStyle,
          loadingClass: "px-6 py-4 text-text-weak",
          emptyClass: "h-full pb-64 -mt-4 flex flex-col items-center justify-center text-center gap-6",
        })}
      </div>
    </div>
  )

  // ── Review diff scroll utilities ───────────────────────────────────────

  const reviewDiffId = (path: string) => {
    const sum = checksum(path)
    if (!sum) return
    return `session-review-diff-${sum}`
  }

  const reviewDiffTop = (path: string) => {
    const root = tree.reviewScroll
    if (!root) return

    const id = reviewDiffId(path)
    if (!id) return

    const el = document.getElementById(id)
    if (!(el instanceof HTMLElement)) return
    if (!root.contains(el)) return

    const a = el.getBoundingClientRect()
    const b = root.getBoundingClientRect()
    return a.top - b.top + root.scrollTop
  }

  const scrollToReviewDiff = (path: string) => {
    const root = tree.reviewScroll
    if (!root) return false

    const top = reviewDiffTop(path)
    if (top === undefined) return false

    view().setScroll("review", { x: root.scrollLeft, y: top })
    root.scrollTo({ top, behavior: "auto" })
    return true
  }

  const focusReviewDiff = (path: string) => {
    openReviewPanel()
    view().review.openPath(path)
    setTree({ activeDiff: path, pendingDiff: path })
  }

  // Auto-scroll to a pending diff when the review panel is ready.
  createEffect(() => {
    const pending = tree.pendingDiff
    if (!pending) return
    if (!tree.reviewScroll) return
    if (!reviewReady()) return

    const attempt = (count: number) => {
      if (tree.pendingDiff !== pending) return
      if (count > 60) {
        setTree("pendingDiff", undefined)
        return
      }

      const root = tree.reviewScroll
      if (!root) {
        requestAnimationFrame(() => attempt(count + 1))
        return
      }

      if (!scrollToReviewDiff(pending)) {
        requestAnimationFrame(() => attempt(count + 1))
        return
      }

      const top = reviewDiffTop(pending)
      if (top === undefined) {
        requestAnimationFrame(() => attempt(count + 1))
        return
      }

      if (Math.abs(root.scrollTop - top) <= 1) {
        setTree("pendingDiff", undefined)
        return
      }

      requestAnimationFrame(() => attempt(count + 1))
    }

    requestAnimationFrame(() => attempt(0))
  })

  return {
    changesTitle,
    reviewEmpty,
    reviewEmptyText,
    reviewContent,
    reviewPanel,
    reviewDiffId,
    reviewDiffTop,
    scrollToReviewDiff,
    focusReviewDiff,
  }
}
