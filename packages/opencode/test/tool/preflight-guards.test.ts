import { afterEach, describe, test, expect } from "bun:test"
import path from "path"
import fs from "fs/promises"
import { WriteTool } from "../../src/tool/write"
import { Instance } from "../../src/project/instance"
import { tmpdir } from "../fixture/fixture"
import { SessionID, MessageID } from "../../src/session/schema"

function makeCtx(extra?: Record<string, any>) {
  return {
    sessionID: SessionID.make("ses_test-preflight"),
    messageID: MessageID.make(""),
    callID: "",
    agent: "build",
    abort: AbortSignal.any([]),
    messages: [],
    metadata: () => {},
    ask: async () => {},
    extra,
  }
}

afterEach(async () => {
  await Instance.disposeAll()
})

describe("preflight guards", () => {
  describe("Guard 2 — write on existing file (local-llm)", () => {
    test("allows write to NEW file for local-llm", async () => {
      await using tmp = await tmpdir()
      const filepath = path.join(tmp.path, "newfile.txt")
      const ctx = makeCtx({ model: { providerID: "local-llm" } })

      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const write = await WriteTool.init()
          const result = await write.execute(
            { filePath: filepath, content: "hello" },
            ctx,
          )
          expect(result.output).toContain("Wrote file successfully")
        },
      })
    })

    test("BLOCKS write to EXISTING file for local-llm", async () => {
      await using tmp = await tmpdir()
      const filepath = path.join(tmp.path, "existing.txt")
      await fs.writeFile(filepath, "old content", "utf-8")
      const ctx = makeCtx({ model: { providerID: "local-llm" } })

      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const write = await WriteTool.init()
          await expect(
            write.execute(
              { filePath: filepath, content: "overwrite" },
              ctx,
            ),
          ).rejects.toThrow("File already exists. Read the file first with the read tool, then use edit with a small unique oldString snippet to modify it.")
        },
      })
    })

    test("allows write to EXISTING file for cloud models", async () => {
      await using tmp = await tmpdir()
      const filepath = path.join(tmp.path, "existing.txt")
      await fs.writeFile(filepath, "old content", "utf-8")
      const ctx = makeCtx({ model: { providerID: "anthropic" } })

      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const { FileTime } = await import("../../src/file/time")
          await FileTime.read(ctx.sessionID, filepath)

          const write = await WriteTool.init()
          const result = await write.execute(
            { filePath: filepath, content: "new content" },
            ctx,
          )
          expect(result.output).toContain("Wrote file successfully")
        },
      })
    })

    test("allows write to EXISTING file when no model info (default)", async () => {
      await using tmp = await tmpdir()
      const filepath = path.join(tmp.path, "existing.txt")
      await fs.writeFile(filepath, "old content", "utf-8")
      const ctx = makeCtx()

      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const { FileTime } = await import("../../src/file/time")
          await FileTime.read(ctx.sessionID, filepath)

          const write = await WriteTool.init()
          const result = await write.execute(
            { filePath: filepath, content: "new content" },
            ctx,
          )
          expect(result.output).toContain("Wrote file successfully")
        },
      })
    })

    test("BLOCKS write with relative path to existing file for local-llm", async () => {
      await using tmp = await tmpdir()
      await fs.writeFile(path.join(tmp.path, "relative.txt"), "old", "utf-8")
      const ctx = makeCtx({ model: { providerID: "local-llm" } })

      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const write = await WriteTool.init()
          await expect(
            write.execute(
              { filePath: "relative.txt", content: "overwrite" },
              ctx,
            ),
          ).rejects.toThrow("File already exists. Read the file first with the read tool, then use edit with a small unique oldString snippet to modify it.")
        },
      })
    })
  })
})
