/* SPDX-License-Identifier: MIT */
/**
 * P2 (tokens) — two processes may share one token store.
 *
 * The first file-backed registry wrote the store from its own memory,
 * through a temporary called `<file>.tmp`, with nothing serialising the
 * read-modify-write and no `fsync` on the directory after the rename.
 * Three failures followed:
 *
 *   - a *lost update*: a daemon that loaded the file an hour ago and then
 *     issued a token erased every token and revocation written since;
 *   - a *torn publish*: two processes persisting at once opened the same
 *     `<file>.tmp` with `"w"`, so one truncated the other's half-written
 *     file and either could rename it into place;
 *   - a *lost revocation*: the rename was durable only once the directory
 *     entry reached disk, which nothing asked for.
 *
 * These tests run real child processes against one store, because that is
 * the only shape in which any of it happens. The second also pins the
 * ordering rule the merge exists to enforce: revocation is monotonic, so a
 * token record can never displace a tombstone for the same id.
 */

import { describe, it, expect, beforeEach, afterEach } from "bun:test"
import { existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { McpTokenRegistry } from "../../../src/knowledge/mcp/token.js"

const TOKEN_MODULE = join(import.meta.dir, "..", "..", "..", "src", "knowledge", "mcp", "token.ts")

describe("P2 — McpTokenRegistry across processes", () => {
  let root: string
  let file: string
  let script: string

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "unifia-tokconc-"))
    file = join(root, "tokens.bin")
    script = join(root, "child.ts")
  })
  afterEach(() => rmSync(root, { recursive: true, force: true }))

  /**
   * A child that opens the store, issues `count` tokens, and prints their
   * ids one per line.
   */
  function writeIssueChild(): void {
    writeFileSync(
      script,
      [
        `import { McpTokenRegistry } from ${JSON.stringify(TOKEN_MODULE.replace(/\\/g, "/"))}`,
        `const registry = new McpTokenRegistry({ path: process.argv[2] })`,
        `const count = Number(process.argv[3])`,
        `for (let i = 0; i < count; i++) {`,
        `  process.stdout.write(registry.issue({ workspace: process.argv[4] }).id + "\\n")`,
        `}`,
      ].join("\n"),
    )
  }

  it("keeps every token four concurrent processes issued", async () => {
    writeIssueChild()
    const procs = Array.from({ length: 4 }, (_, i) =>
      Bun.spawn(["bun", script, file, "3", `ws-${i}`], { stdout: "pipe", stderr: "pipe" }),
    )
    const issued: string[] = []
    for (const p of procs) {
      const text = await new Response(p.stdout).text()
      const code = await p.exited
      const err = await new Response(p.stderr).text()
      expect(code, `child failed: ${err}`).toBe(0)
      for (const line of text.split("\n")) {
        const id = line.trim()
        if (id.startsWith("tok_")) issued.push(id)
      }
    }
    expect(issued).toHaveLength(12)

    // Every id a child was *told* it had is readable from a fresh registry.
    // The lost update showed up here as a store holding only the last
    // writer's three.
    const reopened = new McpTokenRegistry({ path: file })
    for (const id of issued) {
      expect(reopened.get(id), `token ${id} was lost`).toBeDefined()
    }

    // And no temporary survived to be renamed over the store later.
    expect(readdirSync(root).filter((f) => f.endsWith(".tmp"))).toEqual([])
  }, 60_000)

  it("never lets a concurrent issue reanimate a revoked token", async () => {
    // Seed a token, then revoke it from a second process while a third
    // issues. The merge must keep the tombstone whatever the order.
    const seed = new McpTokenRegistry({ path: file })
    const victim = seed.issue({ workspace: "ws" })

    writeFileSync(
      join(root, "revoke.ts"),
      [
        `import { McpTokenRegistry } from ${JSON.stringify(TOKEN_MODULE.replace(/\\/g, "/"))}`,
        `const r = new McpTokenRegistry({ path: process.argv[2] })`,
        `r.revoke(process.argv[3])`,
      ].join("\n"),
    )
    writeIssueChild()

    const revoker = Bun.spawn(["bun", join(root, "revoke.ts"), file, victim.id], {
      stdout: "pipe",
      stderr: "pipe",
    })
    const issuer = Bun.spawn(["bun", script, file, "4", "ws-other"], {
      stdout: "pipe",
      stderr: "pipe",
    })

    const issuedText = await new Response(issuer.stdout).text()
    expect(await issuer.exited, await new Response(issuer.stderr).text()).toBe(0)
    expect(await revoker.exited, await new Response(revoker.stderr).text()).toBe(0)

    const reopened = new McpTokenRegistry({ path: file })
    // The revocation survived the concurrent issues...
    expect(reopened.isValid(victim.id)).toBe(false)
    // ...and the concurrent issues survived the revocation.
    const issued = issuedText
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l.startsWith("tok_"))
    expect(issued).toHaveLength(4)
    for (const id of issued) {
      expect(reopened.isValid(id), `token ${id} was lost to the revoke`).toBe(true)
    }
  }, 60_000)

  it("does not erase what a second registry wrote while it was open", () => {
    // The lost update, with the concurrency taken out so nothing is left to
    // timing. Two long-lived registries over one store is exactly the shape
    // a CLI invocation and a running daemon have.
    const daemon = new McpTokenRegistry({ path: file })
    const first = daemon.issue({ workspace: "daemon" })

    const cli = new McpTokenRegistry({ path: file })
    const fromCli = cli.issue({ workspace: "cli" })

    // `daemon` has not seen `fromCli`. Writing from its own memory alone is
    // what erased it.
    const second = daemon.issue({ workspace: "daemon" })

    const reopened = new McpTokenRegistry({ path: file })
    expect(reopened.get(first.id), "the daemon's first token was lost").not.toBeNull()
    expect(reopened.get(fromCli.id), "the CLI's token was lost").not.toBeNull()
    expect(reopened.get(second.id), "the daemon's second token was lost").not.toBeNull()
  })

  it("keeps a revocation another registry recorded while it was open", () => {
    const daemon = new McpTokenRegistry({ path: file })
    const victim = daemon.issue({ workspace: "daemon" })

    const cli = new McpTokenRegistry({ path: file })
    cli.revoke(victim.id)

    // The daemon still believes the token is live; its next write must not
    // republish it as such.
    daemon.issue({ workspace: "daemon" })

    expect(new McpTokenRegistry({ path: file }).isValid(victim.id)).toBe(false)
  })

  it("leaves the store readable and the lock free after every write", async () => {
    const registry = new McpTokenRegistry({ path: file })
    const t = registry.issue({ workspace: "ws" })
    registry.revoke(t.id)

    expect(existsSync(file)).toBe(true)
    // The lock is a lock, not a leak.
    expect(existsSync(`${file}.lock`)).toBe(false)
    expect(readdirSync(root).filter((f) => f.endsWith(".tmp"))).toEqual([])
    expect(new McpTokenRegistry({ path: file }).isValid(t.id)).toBe(false)
  })
})
