/* SPDX-License-Identifier: MIT */
/**
 * End-to-end through a real process, against a real vault on disk (R-0019).
 *
 * The existing `dev-fixture` test calls the router in-process with a synthetic
 * source. That is an integration test wearing an e2e name, and its blind spot
 * was total: the Sovereign Knowledge Core was absent from the shipped binary
 * for the whole life of this branch and not one of 883 tests noticed, because
 * every one of them imported the modules directly. Imports cannot tell you
 * whether the entrypoint reaches the code — only running the entrypoint can.
 *
 * So these tests spawn `bun src/index.ts knowledge …` as a child process and
 * assert on stdout, on the exit code, and on what the run left on disk. They
 * are the slowest tests in the suite and the only ones that would have caught
 * the defect.
 *
 * They deliberately drive the CLI the way a user does — flags included —
 * because the first wiring attempt passed every unit test while yargs quietly
 * ate `--workspace` and ran commands against the wrong vault.
 */

import { describe, it, expect, beforeAll, afterAll } from "bun:test"
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync, readFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

const ENTRYPOINT = join(import.meta.dir, "..", "..", "..", "src", "index.ts")
const PKG_ROOT = join(import.meta.dir, "..", "..", "..")

/** A note's Class A representation, written the way a user's vault holds it. */
function note(
  id: number,
  body: string,
  restrictions: readonly string[] = ["  remote_model: allow", "  local_model: allow"],
  tags: readonly string[] = [],
): string {
  return [
    "---",
    "unifia_schema: 1",
    `unifia_id: "0190d2c0-7b00-7000-8000-${String(id).padStart(12, "0")}"`,
    'unifia_type: "decision"',
    'unifia_lifecycle: "active"',
    'unifia_created_at: "2026-01-01T00:00:00Z"',
    'unifia_updated_at: "2026-08-01T00:00:00Z"',
    'unifia_project_ref: "unifia"',
    "unifia_supersedes: []",
    `unifia_tags: [${tags.join(", ")}]`,
    "unifia_restrictions:",
    ...restrictions,
    "---",
    body,
  ].join("\n")
}

interface Run {
  code: number
  stdout: string
  stderr: string
}

/** Run the CLI the way a user would, and wait for it to finish. */
async function runCli(args: readonly string[]): Promise<Run> {
  const proc = Bun.spawn(["bun", ENTRYPOINT, "knowledge", ...args], {
    cwd: PKG_ROOT,
    stdout: "pipe",
    stderr: "pipe",
    // A vault the test does not control would make the result depend on the
    // developer's own notes.
    env: { ...process.env, NO_COLOR: "1" },
  })
  const [stdout, stderr, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ])
  // The first run of the binary migrates its database and says so on stdout;
  // that noise is not what any of these tests are about.
  const clean = (s: string) =>
    s
      .split("\n")
      .filter((l) => !l.includes("sqlite-migration") && !l.includes("atabase migration"))
      .join("\n")
  return { code, stdout: clean(stdout), stderr: clean(stderr) }
}

const SECRET = "PHRASE_QUI_NE_DOIT_PAS_FUIR"

let vault: string

beforeAll(() => {
  vault = mkdtempSync(join(tmpdir(), "unifia-e2e-"))
  mkdirSync(join(vault, "memory"), { recursive: true })
  writeFileSync(join(vault, "memory", "open.md"), note(1, "alpha ouvert au modèle local", undefined, ["alpha"]))
  writeFileSync(
    join(vault, "memory", "closed.md"),
    note(2, `alpha ${SECRET}`, ["  remote_model: deny", "  local_model: deny"]),
  )
  writeFileSync(join(vault, "memory", "linked.md"), note(3, "alpha voir [[open]] et [[absente]]"))
})

afterAll(() => rmSync(vault, { recursive: true, force: true }))

describe("R-0019 — the shipped entrypoint reaches the knowledge core", () => {
  it("answers `knowledge status` at all", async () => {
    // The whole defect in one assertion: before the wiring, this printed the
    // top-level usage because no such subcommand existed.
    const r = await runCli(["status"])
    expect(r.code).toBe(0)
    expect(r.stdout).toContain("Sovereign Knowledge Core")
  })

  it("refuses an unknown subcommand with a non-zero code", async () => {
    const r = await runCli(["definitely-not-a-subcommand"])
    expect(r.code).not.toBe(0)
    expect(`${r.stdout}${r.stderr}`).toContain("unknown subcommand")
  })
})

describe("R-0019 — a real vault, through a real process", () => {
  it("finds a note and honours --workspace", async () => {
    // yargs would otherwise consume the flag before the dispatcher saw it, and
    // the command would search the developer's own vault instead.
    const r = await runCli(["search", "alpha", "--workspace", vault])
    expect(r.code).toBe(0)
    expect(r.stdout).toContain("open.md")
  })

  it("withholds a note the policy denies, and never prints its body", async () => {
    const r = await runCli(["search", "alpha", "--workspace", vault])
    // `closed.md` denies the local model, and the CLI is a local destination.
    expect(r.stdout).not.toContain(SECRET)
    expect(r.stdout).not.toContain("closed.md")
  })

  it("lists the vault it was pointed at, not another one", async () => {
    const r = await runCli(["list", vault])
    expect(r.code).toBe(0)
    expect(r.stdout).toContain(vault.replace(/\\/g, "/").split("/").pop() ?? "")
  })

  it("reports a broken wikilink, and exits non-zero because it found one", async () => {
    const r = await runCli(["broken-links", vault])
    expect(r.stdout).toContain("absente")
    // Linter convention: a finding is a non-zero exit, so the command can
    // gate a commit hook. Asserting 0 here would have pinned the opposite
    // contract and made a real finding look like a failure.
    expect(r.code).not.toBe(0)
  })

  it("resolves the link that does exist", async () => {
    const r = await runCli(["broken-links", vault])
    // `[[open]]` points at open.md and must not be reported; only the
    // genuinely missing target is.
    expect(r.stdout).not.toContain("-> open ")
  })

  it("parses every note and attributes its findings", async () => {
    const r = await runCli(["validate", vault])
    expect(r.stdout).toContain("notes parsed: 3")
    expect(r.stdout).toContain("notes failed: 0")
    // Same convention: findings exist, so the exit code says so.
    expect(r.code).not.toBe(0)
  })
})

describe("R-0019 — the egress trail is written by the real process", () => {
  it("creates the Class C control log on disk", async () => {
    // Every unit test for the control log constructed the sink itself. This
    // asserts the composition root actually wires it in a real run.
    const own = mkdtempSync(join(tmpdir(), "unifia-e2e-trail-"))
    try {
      mkdirSync(join(own, "memory"), { recursive: true })
      writeFileSync(join(own, "memory", "a.md"), note(4, "gamma visible"))
      const r = await runCli(["search", "gamma", "--workspace", own])
      expect(r.code).toBe(0)

      const log = join(own, ".unifia", "control-log.jsonl")
      expect(existsSync(log)).toBe(true)
      const entries = readFileSync(log, "utf8")
        .trim()
        .split("\n")
        .map((l) => JSON.parse(l) as Record<string, unknown>)
      expect(entries.length).toBeGreaterThan(0)
      expect(entries[0]).toMatchObject({ decision: "allow", guardVersion: expect.any(String) })
      expect(String(entries[0]?.hash)).toMatch(/^[0-9a-f]{64}$/)
    } finally {
      rmSync(own, { recursive: true, force: true })
    }
  })

  it("records the refusal without quoting what it refused", async () => {
    // The trail is the one artefact that survives the process; a body leaking
    // into it would outlive the refusal that produced it.
    const log = join(vault, ".unifia", "control-log.jsonl")
    expect(existsSync(log)).toBe(true)
    const raw = readFileSync(log, "utf8")
    expect(raw).toContain('"decision":"deny"')
    expect(raw).not.toContain(SECRET)
    expect(raw).not.toContain("closed.md")
  })

  it("survives the process that wrote it", async () => {
    // The point of persisting: a second, independent process can still answer
    // "did this content ever leave?".
    const before = readFileSync(join(vault, ".unifia", "control-log.jsonl"), "utf8").trim().split("\n").length
    await runCli(["search", "alpha", "--workspace", vault])
    const after = readFileSync(join(vault, ".unifia", "control-log.jsonl"), "utf8").trim().split("\n").length
    expect(after).toBeGreaterThan(before)
  })
})
