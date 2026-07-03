import { afterEach, describe, expect, test } from "bun:test"
import path from "path"
import fs from "fs/promises"
import { tmpdir } from "../fixture/fixture"
import { Instance } from "../../src/project/instance"
import { ToolRegistry } from "../../src/tool/registry"
import { Agent } from "../../src/agent/agent"
import { Permission } from "../../src/permission"
import { ProviderID, ModelID } from "../../src/provider/schema"

afterEach(async () => {
  await Instance.disposeAll()
})

// Instance.provide starts the full OpenCode server — too slow on Windows CI (>5 min per test).
// Covered by Linux. Skip on Windows CI.
const skipOnWindowsCI = process.env.CI === "true" && process.platform === "win32"

describe.skipIf(skipOnWindowsCI)("tool.registry", () => {
  test(
    "loads tools from .opencode/tool (singular)",
    async () => {
      await using tmp = await tmpdir({
        init: async (dir) => {
          const opencodeDir = path.join(dir, ".opencode")
          await fs.mkdir(opencodeDir, { recursive: true })

          const toolDir = path.join(opencodeDir, "tool")
          await fs.mkdir(toolDir, { recursive: true })

          await Bun.write(
            path.join(toolDir, "hello.ts"),
            [
              "export default {",
              "  description: 'hello tool',",
              "  args: {},",
              "  execute: async () => {",
              "    return 'hello world'",
              "  },",
              "}",
              "",
            ].join("\n"),
          )
        },
      })

      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const ids = await ToolRegistry.ids()
          expect(ids).toContain("hello")
        },
      })
    },
    300_000,
  )

  test(
    "loads tools from .opencode/tools (plural)",
    async () => {
      await using tmp = await tmpdir({
        init: async (dir) => {
          const opencodeDir = path.join(dir, ".opencode")
          await fs.mkdir(opencodeDir, { recursive: true })

          const toolsDir = path.join(opencodeDir, "tools")
          await fs.mkdir(toolsDir, { recursive: true })

          await Bun.write(
            path.join(toolsDir, "hello.ts"),
            [
              "export default {",
              "  description: 'hello tool',",
              "  args: {},",
              "  execute: async () => {",
              "    return 'hello world'",
              "  },",
              "}",
              "",
            ].join("\n"),
          )
        },
      })

      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const ids = await ToolRegistry.ids()
          expect(ids).toContain("hello")
        },
      })
    },
    300_000,
  )

  test(
    "loads tools with external dependencies without crashing",
    async () => {
      await using tmp = await tmpdir({
        init: async (dir) => {
          const opencodeDir = path.join(dir, ".opencode")
          await fs.mkdir(opencodeDir, { recursive: true })

          const toolsDir = path.join(opencodeDir, "tools")
          await fs.mkdir(toolsDir, { recursive: true })

          await Bun.write(
            path.join(opencodeDir, "package.json"),
            JSON.stringify({
              name: "custom-tools",
              dependencies: {
                "@opencode-ai/plugin": "^0.0.0",
                cowsay: "^1.6.0",
              },
            }),
          )

          await Bun.write(
            path.join(toolsDir, "cowsay.ts"),
            [
              "import { say } from 'cowsay'",
              "export default {",
              "  description: 'tool that imports cowsay at top level',",
              "  args: { text: { type: 'string' } },",
              "  execute: async ({ text }: { text: string }) => {",
              "    return say({ text })",
              "  },",
              "}",
              "",
            ].join("\n"),
          )
        },
      })

      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const ids = await ToolRegistry.ids()
          expect(ids).toContain("cowsay")
        },
      })
    },
    300_000,
  )

  test(
    "local-llm + chat agent: bash/edit/write excluded, websearch off by default",
    async () => {
      await using tmp = await tmpdir()
      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const chat = await Agent.get("chat")
          expect(chat).toBeDefined()
          const tools = await ToolRegistry.tools(
            { providerID: ProviderID.make("local-llm"), modelID: ModelID.make("test-model") },
            chat,
            chat!.permission,
          )
          const ids = tools.map((t) => t.id)
          expect(ids).not.toContain("bash")
          expect(ids).not.toContain("edit")
          expect(ids).not.toContain("write")
          expect(ids).not.toContain("todowrite")
          // Web search is off by default (matches the composer's `webSearch: false`
          // persisted default) — it's controlled by the session-level toggle,
          // never baked permanently into the chat agent's own permission.
          expect(ids).not.toContain("websearch")
        },
      })
    },
    300_000,
  )

  test(
    "local-llm + chat agent: websearch toggle (session.permission override) still works",
    async () => {
      await using tmp = await tmpdir()
      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const chat = await Agent.get("chat")
          expect(chat).toBeDefined()
          // Mirrors session/prompt.ts::prompt() converting the composer's
          // `tools: { websearch: true }` into a session-level permission rule
          // merged AFTER the agent's own permission — this is the real toggle path.
          const mergedWithToggleOn = Permission.merge(chat!.permission, [
            { permission: "websearch", pattern: "*", action: "allow" },
          ])
          const tools = await ToolRegistry.tools(
            { providerID: ProviderID.make("local-llm"), modelID: ModelID.make("test-model") },
            chat,
            mergedWithToggleOn,
          )
          const ids = tools.map((t) => t.id)
          expect(ids).toContain("websearch")
          // Still no coding tools, even with web search toggled on.
          expect(ids).not.toContain("bash")
          expect(ids).not.toContain("edit")
        },
      })
    },
    300_000,
  )

  test(
    "local-llm + build agent: full local toolset unaffected",
    async () => {
      await using tmp = await tmpdir()
      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const build = await Agent.get("build")
          expect(build).toBeDefined()
          const tools = await ToolRegistry.tools(
            { providerID: ProviderID.make("local-llm"), modelID: ModelID.make("test-model") },
            build,
            build!.permission,
          )
          const ids = tools.map((t) => t.id)
          expect(ids).toContain("bash")
          expect(ids).toContain("edit")
          expect(ids).toContain("write")
          expect(ids).toContain("read")
          expect(ids).toContain("glob")
          expect(ids).toContain("grep")
          expect(ids).toContain("todowrite")
          // websearch/webfetch still require explicit session opt-in even for build
          expect(ids).not.toContain("websearch")
        },
      })
    },
    300_000,
  )

  test(
    "local-llm + plan agent: edit not wildcard-denied, stays available",
    async () => {
      await using tmp = await tmpdir()
      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const plan = await Agent.get("plan")
          expect(plan).toBeDefined()
          const tools = await ToolRegistry.tools(
            { providerID: ProviderID.make("local-llm"), modelID: ModelID.make("test-model") },
            plan,
            plan!.permission,
          )
          const ids = tools.map((t) => t.id)
          // plan only denies edit on specific paths (not "*"), so Permission.disabled()
          // correctly does not treat it as fully disabled — schema stays available.
          expect(ids).toContain("edit")
          expect(ids).toContain("bash")
        },
      })
    },
    300_000,
  )
})
