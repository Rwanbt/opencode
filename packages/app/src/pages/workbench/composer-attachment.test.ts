/* SPDX-License-Identifier: MIT */

import { describe, expect, test } from "bun:test"
import {
  addComposerAttachment,
  buildAttachmentPath,
  buildAttachmentReferences,
  markComposerAttachmentFailed,
  markComposerAttachmentUploaded,
  removeComposerAttachment,
  sanitizeAttachmentFilename,
  type ComposerAttachment,
} from "@/pages/workbench/composer-attachment"

function attachment(overrides: Partial<ComposerAttachment> = {}): ComposerAttachment {
  return { id: "a-1", name: "photo.png", status: "uploading", ...overrides }
}

describe("addComposerAttachment", () => {
  test("appends a new entry", () => {
    expect(addComposerAttachment([], attachment())).toEqual([attachment()])
  })
})

describe("markComposerAttachmentUploaded", () => {
  test("sets status to uploaded and stores the path", () => {
    const list = [attachment({ id: "a-1" })]
    const next = markComposerAttachmentUploaded(list, "a-1", "attachments/1-photo.png")
    expect(next).toEqual([{ id: "a-1", name: "photo.png", status: "uploaded", path: "attachments/1-photo.png", error: undefined }])
  })

  test("no-op (same reference) on an unknown id", () => {
    const list = [attachment({ id: "a-1" })]
    expect(markComposerAttachmentUploaded(list, "missing", "x")).toBe(list)
  })

  test("clears a previous error when a retry succeeds", () => {
    const list = [attachment({ id: "a-1", status: "error", error: "network down" })]
    const next = markComposerAttachmentUploaded(list, "a-1", "attachments/1-photo.png")
    expect(next[0]?.error).toBeUndefined()
    expect(next[0]?.status).toBe("uploaded")
  })
})

describe("markComposerAttachmentFailed", () => {
  test("sets status to error and stores the message", () => {
    const list = [attachment({ id: "a-1" })]
    const next = markComposerAttachmentFailed(list, "a-1", "network down")
    expect(next).toEqual([{ id: "a-1", name: "photo.png", status: "error", error: "network down" }])
  })

  test("no-op (same reference) on an unknown id", () => {
    const list = [attachment({ id: "a-1" })]
    expect(markComposerAttachmentFailed(list, "missing", "x")).toBe(list)
  })

  test("two concurrent uploads fail independently", () => {
    const list = [attachment({ id: "a-1" }), attachment({ id: "a-2", name: "b.png" })]
    const next = markComposerAttachmentFailed(markComposerAttachmentFailed(list, "a-1", "e1"), "a-2", "e2")
    expect(next.map((a) => a.error)).toEqual(["e1", "e2"])
  })
})

describe("removeComposerAttachment", () => {
  test("drops the targeted entry", () => {
    const list = [attachment({ id: "a-1" }), attachment({ id: "a-2" })]
    expect(removeComposerAttachment(list, "a-1")).toEqual([attachment({ id: "a-2" })])
  })

  test("no-op (same reference) on an unknown id", () => {
    const list = [attachment({ id: "a-1" })]
    expect(removeComposerAttachment(list, "missing")).toBe(list)
  })
})

describe("buildAttachmentReferences", () => {
  test("empty list produces an empty string", () => {
    expect(buildAttachmentReferences([])).toBe("")
  })

  test("an uploading-only attachment is excluded (no path yet)", () => {
    expect(buildAttachmentReferences([attachment({ status: "uploading" })])).toBe("")
  })

  test("a failed attachment is excluded", () => {
    expect(buildAttachmentReferences([attachment({ status: "error", error: "x" })])).toBe("")
  })

  test("an uploaded attachment is referenced by its path", () => {
    const text = buildAttachmentReferences([attachment({ status: "uploaded", path: "attachments/1-photo.png" })])
    expect(text).toContain("attachments/1-photo.png")
  })

  test("multiple uploaded attachments are all referenced, one per line", () => {
    const text = buildAttachmentReferences([
      attachment({ id: "a-1", status: "uploaded", path: "attachments/1-a.png" }),
      attachment({ id: "a-2", status: "uploaded", path: "attachments/2-b.png" }),
    ])
    expect(text).toContain("attachments/1-a.png")
    expect(text).toContain("attachments/2-b.png")
  })
})

describe("sanitizeAttachmentFilename", () => {
  test("keeps a simple safe filename as-is", () => {
    expect(sanitizeAttachmentFilename("photo.png")).toBe("photo.png")
  })

  test("strips path separators to just the basename", () => {
    expect(sanitizeAttachmentFilename("../../etc/passwd")).toBe("passwd")
  })

  test("replaces unsafe characters with underscores", () => {
    expect(sanitizeAttachmentFilename("my photo (final)!.png")).toBe("my_photo__final__.png")
  })

  test("falls back to a generic name when nothing safe remains", () => {
    expect(sanitizeAttachmentFilename("///")).toBe("file")
  })
})

describe("buildAttachmentPath", () => {
  test("namespaces under attachments/ with a timestamp prefix", () => {
    expect(buildAttachmentPath("photo.png", 1700000000000)).toBe("attachments/1700000000000-photo.png")
  })

  test("two different timestamps for the same filename produce different paths", () => {
    const a = buildAttachmentPath("photo.png", 1)
    const b = buildAttachmentPath("photo.png", 2)
    expect(a).not.toBe(b)
  })
})
