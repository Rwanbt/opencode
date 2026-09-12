import { afterEach, describe, expect, test } from "bun:test"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { assertWriteScope, rollbackIntegration, type OpenCodeTeamTask } from "../../src/team/opencode-application"

const temporaryDirectories: string[] = []

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })))
})

function task(writeSet: string[]): OpenCodeTeamTask {
  return {
    taskId: "card-1",
    description: "scope test",
    prompt: "test",
    agent: "general",
    modelIndex: 0,
    mode: "write",
    required: true,
    dependsOn: [],
    scope: { readSet: [], writeSet },
    risk: "medium",
  }
}

describe("OpenCode Team product safety", () => {
  test("write scope accepts declared paths and rejects every undeclared path", () => {
    assertWriteScope(task(["src/**"]), process.cwd(), "base", ["src/allowed.ts"])
    expect(() => assertWriteScope(task(["src/**"]), process.cwd(), "base", ["docs/outside.md"])).toThrow("outside write_set")
    expect(() => assertWriteScope(task([]), process.cwd(), "base", ["src/undeclared.ts"])).toThrow("outside write_set")
  })

  test("integration rollback restores the exact base commit and removes untracked files", async () => {
    const directory = await mkdtemp(join(tmpdir(), "opencode-team-rollback-"))
    temporaryDirectories.push(directory)
    await run(directory, ["git", "init"])
    await run(directory, ["git", "config", "user.email", "team-test@example.invalid"])
    await run(directory, ["git", "config", "user.name", "Team Test"])
    await writeFile(join(directory, "base.txt"), "base\n")
    await run(directory, ["git", "add", "base.txt"])
    await run(directory, ["git", "commit", "-m", "base"])
    const baseSha = (await run(directory, ["git", "rev-parse", "HEAD"])).trim()
    await writeFile(join(directory, "later.txt"), "later\n")
    await run(directory, ["git", "add", "later.txt"])
    await run(directory, ["git", "commit", "-m", "later"])
    await writeFile(join(directory, "untracked.txt"), "untracked\n")

    expect(await rollbackIntegration(directory, baseSha)).toBe("TESTED")
    expect((await run(directory, ["git", "rev-parse", "HEAD"])).trim()).toBe(baseSha)
    expect((await run(directory, ["git", "status", "--porcelain", "--untracked-files=all"])).trim()).toBe("")
  })
})

async function run(directory: string, argv: string[]): Promise<string> {
  const process = Bun.spawn(argv, { cwd: directory, stdout: "pipe", stderr: "pipe" })
  const [exitCode, stdout, stderr] = await Promise.all([
    process.exited,
    new Response(process.stdout).text(),
    new Response(process.stderr).text(),
  ])
  if (exitCode !== 0) throw new Error(`${argv.join(" ")} failed: ${stderr || stdout}`)
  return stdout
}
