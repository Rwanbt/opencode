import { afterEach, describe, expect, test } from "bun:test"
import { tmpdir } from "../fixture/fixture"
import { Instance } from "../../src/project/instance"
import { Agent } from "../../src/agent/agent"
import { Permission } from "../../src/permission"
import { TeamTool } from "../../src/tool/team"

afterEach(async () => {
  await Instance.disposeAll()
})

function action(agent: Agent.Info | undefined, permission: string): Permission.Action | undefined {
  if (!agent) return undefined
  return Permission.evaluate(permission, "*", agent.permission).action
}

async function teamAgent(): Promise<Agent.Info | undefined> {
  await using tmp = await tmpdir()
  return Instance.provide({ directory: tmp.path, fn: () => Agent.get("team") })
}

describe("team agent — registration", () => {
  test("is a native agent and is listed", async () => {
    await using tmp = await tmpdir()
    const names = await Instance.provide({
      directory: tmp.path,
      fn: async () => (await Agent.list()).map((agent) => agent.name),
    })

    expect(names).toContain("team")
  })

  test("is invocable both as a primary agent and as a subagent", async () => {
    const agent = await teamAgent()

    expect(agent?.native).toBe(true)
    expect(agent?.mode).toBe("all")
  })

  test("carries a prompt that states it does not write files itself", async () => {
    // The prompt is the only place that rule lives; permissions enforce it but
    // an agent told nothing about it wastes turns trying.
    const agent = await teamAgent()

    expect(agent?.prompt).toBeTruthy()
    expect(agent?.prompt).toContain("You do not write files yourself")
  })

  test("carries a description, so it is selectable without reading its prompt", async () => {
    const agent = await teamAgent()

    expect(agent?.description).toBeTruthy()
    expect(agent?.description).toContain("team tool")
  })
})

describe("team agent — no hidden provider", () => {
  test("pins no model, so the run inherits the caller's provider", async () => {
    // A model pinned on the agent is a provider the user never chose and
    // never sees billed against the model they selected.
    const agent = await teamAgent()

    expect(agent?.model).toBeUndefined()
  })
})

describe("team agent — final permissions", () => {
  test("may dispatch, plan and read", async () => {
    const agent = await teamAgent()

    for (const permission of ["team", "todowrite", "read", "grep", "glob", "list"]) {
      expect(action(agent, permission)).toBe("allow")
    }
  })

  test("may not write, edit or run commands", async () => {
    // It would be racing the workers it just dispatched into their own
    // worktrees, in the directory they were branched from.
    const agent = await teamAgent()

    for (const permission of ["write", "edit", "multiedit", "patch", "bash"]) {
      expect(action(agent, permission)).toBe("deny")
    }
  })

  test("denies an unlisted tool rather than inheriting the permissive default", async () => {
    // The agent's own set starts from `"*": "deny"`; if that were dropped, a
    // tool added later would silently become available to it.
    const agent = await teamAgent()

    expect(action(agent, "some_tool_added_later")).toBe("deny")
  })
})

describe("team tool — registration surface", () => {
  test("exports TeamTool under the id the registry builds", async () => {
    // Regression guard: an earlier attempt at this card replaced this module
    // with a bare schema, deleting the export that src/tool/registry.ts
    // imports. The test suite stayed green and the typecheck did not.
    expect(TeamTool.id).toBe("team")
  })

  test("is imported and built by the tool registry", async () => {
    const registry = await Bun.file(new URL("../../src/tool/registry.ts", import.meta.url)).text()

    expect(registry).toContain(`import { TeamTool } from "./team"`)
    expect(registry).toContain("build(TeamTool)")
  })

  test("describes its own parameters, from team.txt", async () => {
    const definition = await TeamTool.init()

    expect(definition.description).toContain("budget.max_agents")
    expect(definition.description).toContain("depends_on")
    // The description is the only contract the model sees before calling.
    // Silence about cancellation is how a cancelled run reads as a finished one.
    expect(definition.description).toContain("cancelled")
  })

  test("accepts at most five sub-tasks and at least one", async () => {
    const definition = await TeamTool.init()
    const task = { description: "d", prompt: "p", agent: "general" }

    expect(definition.parameters.safeParse({ description: "run", tasks: [] }).success).toBe(false)
    expect(definition.parameters.safeParse({ description: "run", tasks: Array(6).fill(task) }).success).toBe(false)
    expect(definition.parameters.safeParse({ description: "run", tasks: Array(5).fill(task) }).success).toBe(true)
  })

  test("rejects a max_agents budget outside 1..5", async () => {
    const definition = await TeamTool.init()
    const tasks = [{ description: "d", prompt: "p", agent: "general" }]

    expect(definition.parameters.safeParse({ description: "r", tasks, budget: { max_agents: 0 } }).success).toBe(false)
    expect(definition.parameters.safeParse({ description: "r", tasks, budget: { max_agents: 6 } }).success).toBe(false)
    expect(definition.parameters.safeParse({ description: "r", tasks, budget: { max_agents: 1 } }).success).toBe(true)
  })
})
