import { describe, expect, test } from "bun:test"

// Reproduces the preflightCheck guard logic for "read before edit".
// Tests that writing a file then editing it is allowed (the fix introduced in
// commit after bench 4/20: hasWrite bypasses the read requirement).

type Part = {
  type: string
  tool?: string
  state?: { status: string; input?: Record<string, unknown> }
}
type Message = { parts: Part[] }

function preflightCheck(
  toolId: string,
  args: Record<string, unknown>,
  isLocalLLM: boolean,
  messages: Message[],
): string | undefined {
  if (!isLocalLLM) return

  if (toolId === "edit" && args.filePath) {
    if (args.oldString !== undefined && (!args.oldString || !(args.oldString as string).trim())) {
      return "oldString cannot be empty."
    }

    const hasRead = messages.some((m) =>
      m.parts.some(
        (p) =>
          p.type === "tool" &&
          p.tool === "read" &&
          p.state?.status === "completed" &&
          p.state?.input?.filePath === args.filePath,
      ),
    )
    const hasWrite = messages.some((m) =>
      m.parts.some(
        (p) =>
          p.type === "tool" &&
          p.tool === "write" &&
          p.state?.status === "completed" &&
          p.state?.input?.filePath === args.filePath,
      ),
    )
    if (!hasRead && !hasWrite) {
      return "You must read this file before editing it: " + args.filePath
    }
  }
}

const filePath = "src/lib.rs"

describe("preflight read-before-edit guard", () => {
  test("blocks edit with no prior read or write", () => {
    const result = preflightCheck("edit", { filePath, oldString: "foo" }, true, [])
    expect(result).toContain("You must read this file before editing it")
  })

  test("allows edit after read", () => {
    const messages: Message[] = [
      {
        parts: [
          {
            type: "tool",
            tool: "read",
            state: { status: "completed", input: { filePath } },
          },
        ],
      },
    ]
    expect(preflightCheck("edit", { filePath, oldString: "foo" }, true, messages)).toBeUndefined()
  })

  test("allows edit after write (the fix)", () => {
    const messages: Message[] = [
      {
        parts: [
          {
            type: "tool",
            tool: "write",
            state: { status: "completed", input: { filePath, content: "hello" } },
          },
        ],
      },
    ]
    expect(preflightCheck("edit", { filePath, oldString: "foo" }, true, messages)).toBeUndefined()
  })

  test("blocks edit if write was on a different file", () => {
    const messages: Message[] = [
      {
        parts: [
          {
            type: "tool",
            tool: "write",
            state: { status: "completed", input: { filePath: "src/other.rs", content: "hello" } },
          },
        ],
      },
    ]
    expect(preflightCheck("edit", { filePath, oldString: "foo" }, true, messages)).toContain(
      "You must read this file before editing it",
    )
  })

  test("blocks edit if write failed (status error)", () => {
    const messages: Message[] = [
      {
        parts: [
          {
            type: "tool",
            tool: "write",
            state: { status: "error", input: { filePath } },
          },
        ],
      },
    ]
    expect(preflightCheck("edit", { filePath, oldString: "foo" }, true, messages)).toContain(
      "You must read this file before editing it",
    )
  })

  test("no guard for non-local-llm model", () => {
    expect(preflightCheck("edit", { filePath, oldString: "foo" }, false, [])).toBeUndefined()
  })
})
