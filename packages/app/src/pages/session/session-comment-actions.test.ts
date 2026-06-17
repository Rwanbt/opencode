import { describe, expect, test } from "bun:test"
import { createRoot } from "solid-js"
import { previewSelectedLines } from "@opencode-ai/ui/pierre/selection-bridge"
import { createCommentActions } from "./session-comment-actions"
import type { FileSelection } from "@/context/file/types"

// D-08: createCommentActions is a pure factory-with-deps (ADR-0001) extracted
// from session.tsx. We mock the four injected contexts and assert the wiring:
// preview computation, field mapping (selectionFromLines, startLine→start) and
// the exact downstream calls into comments/prompt.context.

interface Calls {
  commentsAdd: unknown[]
  commentsUpdate: unknown[]
  commentsRemove: unknown[]
  contextAdd: Record<string, unknown>[]
  contextUpdateComment: { file: string; id: string; patch: Record<string, unknown> }[]
  contextRemoveComment: { file: string; id: string }[]
}

type Actions = ReturnType<typeof createCommentActions>

/** Run `fn` against fresh actions inside a reactive root (createMemo needs one). */
function withActions<T>(fn: (actions: Actions, calls: Calls) => T, fileContents: Record<string, string> = {}): T {
  return createRoot((dispose) => {
    const calls: Calls = {
      commentsAdd: [],
      commentsUpdate: [],
      commentsRemove: [],
      contextAdd: [],
      contextUpdateComment: [],
      contextRemoveComment: [],
    }
    const deps = {
      file: {
        get: (p: string) => (p in fileContents ? { content: { content: fileContents[p] } } : undefined),
      },
      comments: {
        add: (input: unknown) => {
          calls.commentsAdd.push(input)
          return { id: "cm-1" }
        },
        update: (file: string, id: string, comment: string) => calls.commentsUpdate.push({ file, id, comment }),
        remove: (file: string, id: string) => calls.commentsRemove.push({ file, id }),
      },
      prompt: {
        context: {
          add: (input: Record<string, unknown>) => calls.contextAdd.push(input),
          updateComment: (file: string, id: string, patch: Record<string, unknown>) =>
            calls.contextUpdateComment.push({ file, id, patch }),
          removeComment: (file: string, id: string) => calls.contextRemoveComment.push({ file, id }),
        },
      },
      language: { t: (key: string) => `t:${key}` },
    }
    const actions = createCommentActions(deps as unknown as Parameters<typeof createCommentActions>[0])
    try {
      return fn(actions, calls)
    } finally {
      dispose()
    }
  })
}

const selection = (startLine: number, endLine: number): FileSelection =>
  ({ startLine, endLine, startChar: 0, endChar: 0 }) as FileSelection

describe("selectionPreview", () => {
  test("returns undefined when the file has no cached content", () => {
    withActions((actions) => {
      expect(actions.selectionPreview("missing.ts", selection(1, 2))).toBeUndefined()
    })
  })

  test("returns undefined when the cached content is empty", () => {
    withActions(
      (actions) => {
        expect(actions.selectionPreview("a.ts", selection(1, 2))).toBeUndefined()
      },
      { "a.ts": "" },
    )
  })

  test("maps startLine/endLine onto previewSelectedLines for present content", () => {
    const source = "one\ntwo\nthree\nfour"
    withActions(
      (actions) => {
        expect(actions.selectionPreview("a.ts", selection(2, 3))).toBe(
          previewSelectedLines(source, { start: 2, end: 3 }),
        )
      },
      { "a.ts": source },
    )
  })
})

describe("addCommentToContext", () => {
  test("computes the preview, saves the comment, and mirrors it into prompt context", () => {
    const source = "alpha\nbeta\ngamma"
    withActions(
      (actions, calls) => {
        actions.addCommentToContext({
          file: "a.ts",
          selection: { start: 1, end: 2 },
          comment: "look here",
          origin: "file",
        })

        expect(calls.commentsAdd).toEqual([{ file: "a.ts", selection: { start: 1, end: 2 }, comment: "look here" }])
        expect(calls.contextAdd).toHaveLength(1)
        const added = calls.contextAdd[0]
        expect(added.type).toBe("file")
        expect(added.path).toBe("a.ts")
        expect(added.comment).toBe("look here")
        expect(added.commentID).toBe("cm-1")
        expect(added.commentOrigin).toBe("file")
        // selection is mapped through selectionFromLines (min/max + char bounds).
        expect(added.selection).toEqual({ startLine: 1, endLine: 2, startChar: 0, endChar: 0 })
        expect(added.preview).toBe(previewSelectedLines(source, { start: 1, end: 2 }))
      },
      { "a.ts": source },
    )
  })

  test("prefers an explicit preview over recomputing from content", () => {
    withActions((actions, calls) => {
      actions.addCommentToContext({
        file: "missing.ts",
        selection: { start: 5, end: 1 },
        comment: "c",
        preview: "PROVIDED",
      })
      expect(calls.contextAdd[0].preview).toBe("PROVIDED")
      // reverse range is normalized by selectionFromLines.
      expect(calls.contextAdd[0].selection).toEqual({ startLine: 1, endLine: 5, startChar: 0, endChar: 0 })
    })
  })
})

describe("updateCommentInContext", () => {
  test("updates the stored comment and patches only the comment when no preview is given", () => {
    withActions((actions, calls) => {
      actions.updateCommentInContext({ id: "cm-1", file: "a.ts", selection: { start: 1, end: 2 }, comment: "edited" })
      expect(calls.commentsUpdate).toEqual([{ file: "a.ts", id: "cm-1", comment: "edited" }])
      expect(calls.contextUpdateComment).toHaveLength(1)
      const patch = calls.contextUpdateComment[0].patch
      expect(patch).toEqual({ comment: "edited" })
      expect("preview" in patch).toBe(false)
    })
  })

  test("includes preview in the patch when provided", () => {
    withActions((actions, calls) => {
      actions.updateCommentInContext({
        id: "cm-1",
        file: "a.ts",
        selection: { start: 1, end: 2 },
        comment: "edited",
        preview: "PV",
      })
      expect(calls.contextUpdateComment[0].patch).toEqual({ comment: "edited", preview: "PV" })
    })
  })
})

describe("removeCommentFromContext", () => {
  test("removes the comment from both the store and the prompt context", () => {
    withActions((actions, calls) => {
      actions.removeCommentFromContext({ id: "cm-1", file: "a.ts" })
      expect(calls.commentsRemove).toEqual([{ file: "a.ts", id: "cm-1" }])
      expect(calls.contextRemoveComment).toEqual([{ file: "a.ts", id: "cm-1" }])
    })
  })
})

describe("reviewCommentActions", () => {
  test("exposes the localized action labels", () => {
    withActions((actions) => {
      expect(actions.reviewCommentActions()).toEqual({
        moreLabel: "t:common.moreOptions",
        editLabel: "t:common.edit",
        deleteLabel: "t:common.delete",
        saveLabel: "t:common.save",
      })
    })
  })
})
