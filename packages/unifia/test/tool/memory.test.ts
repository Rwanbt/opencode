/* SPDX-License-Identifier: MIT */
/**
 * The agent's memory tools, driven the way the agent drives them.
 *
 * The whole point of this suite is the question no earlier test asked: not
 * *is the knowledge core correct* but *can the agent reach it*. So it goes
 * through `ToolRegistry` for registration and through `execute` for
 * behaviour, rather than importing the service and asserting on it directly
 * — an import proves the module compiles, not that anything calls it.
 */

import { afterEach, describe, expect, test } from "bun:test"
import { existsSync, readFileSync, readdirSync } from "node:fs"
import path from "node:path"
import { tmpdir } from "../fixture/fixture"
import { Instance } from "../../src/project/instance"
import { ToolRegistry } from "../../src/tool/registry"
import { MemoryReadTool, MemorySearchTool, MemoryWriteTool } from "../../src/tool/memory"
import { resetMemoryCache, DEFAULT_MEMORY_DIRECTORY } from "../../src/knowledge/app/memory"
import { SessionID, MessageID } from "../../src/session/schema"
import type { MessageV2 } from "../../src/session/message-v2"
import type { Tool } from "../../src/tool/tool"

afterEach(async () => {
  resetMemoryCache()
  await Instance.disposeAll()
})

// Instance.provide starts the full server; the registry suite skips it on
// Windows CI for the same reason and this suite inherits the constraint.
const skipOnWindowsCI = process.env.CI === "true" && process.platform === "win32"

/**
 * A turn bound for the named provider.
 *
 * The provider is not decoration: it is what the egress guard decides
 * against, so every test that cares about a policy outcome states it here.
 */
function ctxFor(providerID: string) {
  const user = {
    info: {
      role: "user",
      id: MessageID.make("msg_test"),
      model: { providerID, modelID: "test-model" },
    },
    parts: [],
  } as unknown as MessageV2.WithParts
  return {
    sessionID: SessionID.make("ses_test"),
    messageID: MessageID.make("msg_test"),
    callID: "",
    agent: "build",
    abort: AbortSignal.any([]),
    messages: [user],
    metadata: () => {},
    ask: async () => {},
  }
}

const LOCAL = "local-llm"
const REMOTE = "anthropic"

async function run(tool: Tool.Info<any, any>, args: unknown, providerID: string) {
  const def = await tool.init()
  return def.execute(args as never, ctxFor(providerID) as never)
}

describe.skipIf(skipOnWindowsCI)("memory tools — reachability", () => {
  test(
    "are registered, so the agent can call them",
    async () => {
      await using tmp = await tmpdir({})
      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const ids = await ToolRegistry.ids()
          // The defect class this whole branch exists to close: code that is
          // correct, tested, and reachable by nobody.
          expect(ids).toContain("memory_search")
          expect(ids).toContain("memory_read")
          expect(ids).toContain("memory_write")
        },
      })
    },
    300_000,
  )

  test(
    "disappear when the user turns memory off",
    async () => {
      await using tmp = await tmpdir({
        init: async (dir) => {
          await Bun.write(
            path.join(dir, "opencode.json"),
            JSON.stringify({ memory: { enabled: false } }),
          )
        },
      })
      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const ids = await ToolRegistry.ids()
          expect(ids).not.toContain("memory_search")
          expect(ids).not.toContain("memory_write")
        },
      })
    },
    300_000,
  )
})

describe.skipIf(skipOnWindowsCI)("memory tools — recording and recalling", () => {
  test(
    "writes a note, then recalls it",
    async () => {
      await using tmp = await tmpdir({})
      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const written = await run(
            MemoryWriteTool,
            {
              locator: "decisions/why-sqlite.md",
              type: "decision",
              body: "We chose SQLite over Postgres because the workbench must run with no daemon.",
              reason: "records an architectural choice",
            },
            LOCAL,
          )
          expect(written.metadata.applied).toBe(true)

          // On disk, in the vault, as Markdown a human can read without us.
          const vault = path.join(Instance.worktree, DEFAULT_MEMORY_DIRECTORY)
          const file = path.join(vault, "decisions", "why-sqlite.md")
          expect(existsSync(file)).toBe(true)
          const raw = readFileSync(file, "utf8")
          expect(raw).toContain("unifia_type: decision")
          expect(raw).toContain("no daemon")

          const found = await run(MemorySearchTool, { query: "SQLite Postgres" }, LOCAL)
          expect(found.metadata.results).toBeGreaterThan(0)
          expect(found.output).toContain("why-sqlite.md")
        },
      })
    },
    300_000,
  )

  test(
    "creates no vault until something is actually recorded",
    async () => {
      await using tmp = await tmpdir({})
      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const found = await run(MemorySearchTool, { query: "anything" }, LOCAL)
          expect(found.metadata.results).toBe(0)
          // A question must not bring a directory into being.
          expect(existsSync(path.join(Instance.worktree, DEFAULT_MEMORY_DIRECTORY))).toBe(false)
        },
      })
    },
    300_000,
  )

  test(
    "records the egress trail beside the notes",
    async () => {
      await using tmp = await tmpdir({})
      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          await run(
            MemoryWriteTool,
            { locator: "a.md", type: "learning", body: "gamma is visible", reason: "test" },
            LOCAL,
          )
          await run(MemorySearchTool, { query: "gamma" }, LOCAL)
          const log = path.join(
            Instance.worktree,
            DEFAULT_MEMORY_DIRECTORY,
            ".unifia",
            "control-log.jsonl",
          )
          expect(existsSync(log)).toBe(true)
          const first = JSON.parse(readFileSync(log, "utf8").trim().split("\n")[0] ?? "{}")
          expect(String(first.hash)).toMatch(/^[0-9a-f]{64}$/)
          // The trail records the decision, never the content it decided on.
          expect(readFileSync(log, "utf8")).not.toContain("gamma is visible")
        },
      })
    },
    300_000,
  )
})

describe.skipIf(skipOnWindowsCI)("memory tools — the policy is not a suggestion", () => {
  test(
    "withholds a note from a remote model, and says why",
    async () => {
      await using tmp = await tmpdir({})
      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          await run(
            MemoryWriteTool,
            { locator: "secret.md", type: "constraint", body: "delta is private", reason: "test" },
            LOCAL,
          )
          resetMemoryCache()

          const remote = await run(MemorySearchTool, { query: "delta" }, REMOTE)
          expect(remote.metadata.results).toBe(0)
          expect(remote.output).not.toContain("delta is private")
          // An empty answer that hides a policy decision is how sovereignty
          // becomes invisible. The tool names the setting that changes it.
          expect(remote.output).toContain("remote_recall")

          // The same vault, the same query, a local model: served.
          const local = await run(MemorySearchTool, { query: "delta" }, LOCAL)
          expect(local.metadata.results).toBeGreaterThan(0)
        },
      })
    },
    300_000,
  )

  test(
    "keeps a `private` note local even when the user opened remote recall",
    async () => {
      await using tmp = await tmpdir({
        init: async (dir) => {
          await Bun.write(
            path.join(dir, "opencode.json"),
            JSON.stringify({ memory: { remote_recall: true } }),
          )
        },
      })
      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          await run(
            MemoryWriteTool,
            {
              locator: "open.md",
              type: "decision",
              body: "epsilon may travel",
              reason: "test",
            },
            LOCAL,
          )
          await run(
            MemoryWriteTool,
            {
              locator: "closed.md",
              type: "decision",
              body: "epsilon must not travel",
              reason: "test",
              private: true,
            },
            LOCAL,
          )
          resetMemoryCache()

          const remote = await run(MemorySearchTool, { query: "epsilon" }, REMOTE)
          expect(remote.output).toContain("epsilon may travel")
          expect(remote.output).not.toContain("must not travel")
        },
      })
    },
    300_000,
  )

  test(
    "refuses a body carrying a credential",
    async () => {
      await using tmp = await tmpdir({})
      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const write = run(
            MemoryWriteTool,
            {
              locator: "leak.md",
              type: "reference",
              body: 'export AWS_SECRET_ACCESS_KEY="AKIAIOSFODNN7EXAMPLEKEYVALUE0000"',
              reason: "test",
            },
            LOCAL,
          )
          await expect(write).rejects.toThrow()
          const vault = path.join(Instance.worktree, DEFAULT_MEMORY_DIRECTORY)
          expect(existsSync(vault) ? readdirSync(vault).includes("leak.md") : false).toBe(false)
        },
      })
    },
    300_000,
  )
})

describe.skipIf(skipOnWindowsCI)("memory tools — updating an existing note", () => {
  test(
    "hands back the versionHash an update needs, and honours it",
    async () => {
      await using tmp = await tmpdir({})
      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          await run(
            MemoryWriteTool,
            { locator: "note.md", type: "learning", body: "first version", reason: "test" },
            LOCAL,
          )
          const read = await run(MemoryReadTool, { locator: "note.md" }, LOCAL)
          expect(read.metadata.found).toBe(true)
          expect(String(read.metadata.versionHash)).toMatch(/^[0-9a-f]{64}$/)
          expect(read.output).toContain("first version")

          const updated = await run(
            MemoryWriteTool,
            {
              locator: "note.md",
              id: read.output.match(/id: (\S+)/)?.[1],
              expectedVersionHash: read.metadata.versionHash,
              type: "learning",
              body: "second version",
              reason: "test",
            },
            LOCAL,
          )
          expect(updated.metadata.applied).toBe(true)
          const after = await run(MemoryReadTool, { locator: "note.md" }, LOCAL)
          expect(after.output).toContain("second version")
        },
      })
    },
    300_000,
  )

  test(
    "refuses an update whose hash is stale",
    async () => {
      await using tmp = await tmpdir({})
      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          await run(
            MemoryWriteTool,
            { locator: "note.md", type: "learning", body: "original", reason: "test" },
            LOCAL,
          )
          const read = await run(MemoryReadTool, { locator: "note.md" }, LOCAL)
          const id = read.output.match(/id: (\S+)/)?.[1]

          // Compare-and-swap is what keeps two sessions from overwriting each
          // other silently; a stale hash must be a refusal, not a last-write-wins.
          const stale = run(
            MemoryWriteTool,
            {
              locator: "note.md",
              id,
              expectedVersionHash: "0".repeat(64),
              type: "learning",
              body: "clobbered",
              reason: "test",
            },
            LOCAL,
          )
          await expect(stale).rejects.toThrow()
          const after = await run(MemoryReadTool, { locator: "note.md" }, LOCAL)
          expect(after.output).toContain("original")
        },
      })
    },
    300_000,
  )

  test(
    "requires the hash rather than silently creating a second note",
    async () => {
      await using tmp = await tmpdir({})
      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const write = run(
            MemoryWriteTool,
            {
              locator: "note.md",
              id: "0190d2c0-7b00-7000-8000-000000000001",
              type: "learning",
              body: "x",
              reason: "test",
            },
            LOCAL,
          )
          await expect(write).rejects.toThrow(/expectedVersionHash/)
        },
      })
    },
    300_000,
  )

  test(
    "refuses a locator that is not a Markdown file",
    async () => {
      await using tmp = await tmpdir({})
      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const write = run(
            MemoryWriteTool,
            { locator: "notes/thing", type: "learning", body: "x", reason: "test" },
            LOCAL,
          )
          await expect(write).rejects.toThrow(/\.md/)
        },
      })
    },
    300_000,
  )
})
