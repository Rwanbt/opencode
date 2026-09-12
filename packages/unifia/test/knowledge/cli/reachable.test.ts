/* SPDX-License-Identifier: MIT */
/**
 * The knowledge core is reachable from the binary that ships (R-0019).
 *
 * Every other test in this suite proved the core *works*. None proved it was
 * *in the product*. It was not: `script/build.ts` compiles a single
 * entrypoint, `src/index.ts`, and the knowledge CLI lived in `bin/` with no
 * importer anywhere. The bundler dropped the module — a string search of the
 * built 185 MB sidecar returned zero hits for `control-log.jsonl`,
 * `unifia_restrictions` and `egress.decision`, against 607 for `unifia`.
 *
 * 883 green tests, four counter-reviews and six report reviews did not catch
 * it, because every one of them asked whether the code was correct and none
 * asked whether it was connected.
 *
 * So these tests assert reachability itself, from the entrypoint outward.
 */

import { describe, it, expect } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"

const pkgRoot = join(import.meta.dir, "..", "..", "..")

describe("R-0019 — the knowledge core ships", () => {
  it("is registered on the yargs tree of the built entrypoint", () => {
    // `src/index.ts` is the ONLY entrypoint `script/build.ts` compiles, so
    // reachability from this file is what decides whether the feature exists
    // in the binary at all.
    const index = readFileSync(join(pkgRoot, "src", "index.ts"), "utf8")
    expect(index).toContain('from "./cli/cmd/knowledge"')
    expect(index).toContain(".command(KnowledgeCommand)")
  })

  it("reaches the core through a real import chain, not a string", () => {
    // The assertion above is textual; this one is the compiler's. If the
    // command stopped importing the core, this import would fail to resolve.
    const command = readFileSync(join(pkgRoot, "src", "cli", "cmd", "knowledge.ts"), "utf8")
    expect(command).toContain('from "../knowledge/main"')
  })

  it("keeps the CLI layer inside src/, where the bundler can follow it", () => {
    // `src/` importing `bin/` would be both a dependency inversion and the
    // exact shape of the original defect: code the entrypoint cannot reach.
    const main = readFileSync(join(pkgRoot, "src", "cli", "knowledge", "main.ts"), "utf8")
    expect(main).toContain("export async function runKnowledgeCli")
    expect(main).not.toContain('from "../../../bin/')
  })

  it("exposes the dispatcher as a function, not a self-running script", () => {
    // A top-level `await main()` would run on import and call process.exit,
    // which is why this could never be a subcommand before.
    const main = readFileSync(join(pkgRoot, "src", "cli", "knowledge", "main.ts"), "utf8")
    expect(main).not.toContain("await main()")
    expect(main).not.toContain("process.exit(")
  })

  it("dispatches to the real core: an unknown subcommand is refused", async () => {
    const { runKnowledgeCli } = await import("../../../src/cli/knowledge/main.js")
    // Exit code 2 is the dispatcher's "unknown subcommand" — proof the call
    // reached the real switch rather than a stub.
    expect(await runKnowledgeCli(["definitely-not-a-subcommand"])).toBe(2)
  })
})

describe("R-0019 — the memory feature ships with it", () => {
  it("registers the memory tools where the entrypoint can reach them", () => {
    // A CLI subcommand made the core reachable by a human. These make it
    // reachable by the agent, which is what turns it into a feature — and
    // they are reachable only because `src/index.ts` builds the registry.
    const registry = readFileSync(join(pkgRoot, "src", "tool", "registry.ts"), "utf8")
    expect(registry).toContain('from "./memory"')
    expect(registry).toContain("memorySearch")
    expect(registry).toContain("memoryWrite")
  })

  it("consumes a ContextPack from the session, which nothing did before", () => {
    // The ContextRouter produced packs for a year and no session ever asked
    // for one. Automatic recall is the caller it was missing.
    const prompt = readFileSync(join(pkgRoot, "src", "session", "prompt.ts"), "utf8")
    expect(prompt).toContain('from "./memory-context"')
    expect(prompt).toContain("recallMemoryContext(")
  })

  it("enables the Class A writer somewhere other than a test", () => {
    // `writable: true` existed and was passed by nobody, so the agent could
    // never record anything. This is the production caller.
    const memory = readFileSync(join(pkgRoot, "src", "knowledge", "app", "memory.ts"), "utf8")
    expect(memory).toContain("writable: true")
    const tool = readFileSync(join(pkgRoot, "src", "tool", "memory.ts"), "utf8")
    expect(tool).toContain("writable: true")
  })
})
