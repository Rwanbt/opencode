/* SPDX-License-Identifier: MIT */
/**
 * P1-C — the swap is injected *inside* one read, in the window that matters.
 *
 * `W-FS-01-toctou.test.ts` swaps the entry between two complete calls to
 * `read()`. That proves the second call re-validates; it says nothing about
 * the window the finding named, which is *within* a single invocation:
 * between the moment the path is validated and the moment its bytes are
 * pulled. A `realpath`-then-`stat`-then-`readFile` sequence resolves the
 * name three times, and an actor who replaces the directory entry between
 * any two of them has their file read out of a location that passed the
 * containment check.
 *
 * These tests open that window from inside the read path. The first
 * filesystem call the read makes is hooked, and the hook performs the swap
 * before returning — so by construction the substitution lands after
 * validation and before the bytes are fetched, every run, with no timing to
 * lose. Hooking `lstat` *and* `stat` keeps the injection honest against
 * either shape of implementation: the path-based one calls `stat`, the
 * descriptor-based one calls `lstat`.
 *
 * The contract under test is narrow and absolute: whatever else happens,
 * the call must never return the substituted content.
 */

import { describe, it, expect, beforeEach, afterEach, spyOn } from "bun:test"
import { mkdtempSync, rmSync, writeFileSync, symlinkSync, unlinkSync } from "node:fs"
import * as fsp from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { KnowledgeLocator } from "@unifia/contracts/knowledge"
import { VaultSource } from "../../../src/knowledge/source/vault.js"

const SPACE = { kind: "personal", id: "p", label: "P" } as const
const SECRET = "TOP_SECRET outside the vault"

function note(id: string, body: string): string {
  return [
    "---",
    "unifia_schema: 1",
    `unifia_id: "0190d2c0-7b00-7000-8000-${id.padStart(12, "0")}"`,
    'unifia_type: "decision"',
    'unifia_lifecycle: "active"',
    'unifia_created_at: "2026-08-01T00:00:00Z"',
    'unifia_updated_at: "2026-08-29T00:00:00Z"',
    'unifia_project_ref: "unifia"',
    "unifia_supersedes: []",
    "unifia_tags: []",
    "---",
    body,
  ].join("\n")
}

describe("P1-C — TOCTOU injected inside a single read", () => {
  let root: string
  let outside: string
  let restore: Array<() => void> = []

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "unifia-p1c-"))
    outside = mkdtempSync(join(tmpdir(), "unifia-p1c-out-"))
    writeFileSync(join(root, "inside.md"), note("1", "the real body"))
    writeFileSync(join(outside, "secret.md"), note("9", SECRET))
    restore = []
  })

  afterEach(() => {
    for (const r of restore) r()
    rmSync(root, { recursive: true, force: true })
    rmSync(outside, { recursive: true, force: true })
  })

  /**
   * Run `swap` immediately *after* the read path first stats the target.
   *
   * The order is the whole point. Swapping before the stat would just hand
   * the implementation a different file to validate, which is not a race —
   * it is a different file. Swapping after it returns puts the substitution
   * exactly where the finding said it went: the identity is already
   * captured, the bytes are not yet fetched, and only an implementation
   * that reads through something other than the name survives it.
   *
   * Both `lstat` and `stat` are hooked so the injection does not depend on
   * which one the implementation happens to call.
   *
   * `skipHits` lets a caller step over stats that are not the read's. `list`
   * walks the tree before it reads, and the walk stats every entry, so the
   * read's own stat of a given locator is the *second* one it sees.
   */
  function injectAfterFirstStat(target: string, swap: () => void, skipHits = 0): void {
    let hits = 0
    let fired = false
    for (const name of ["lstat", "stat"] as const) {
      const spy = spyOn(fsp, name)
      const original = spy.getMockImplementation() as (...a: unknown[]) => Promise<unknown>
      spy.mockImplementation((async (...args: unknown[]) => {
        const result = await original(...args)
        if (!fired && String(args[0]) === target) {
          hits += 1
          if (hits > skipHits) {
            fired = true
            swap()
          }
        }
        return result
      }) as never)
      restore.push(() => spy.mockRestore())
    }
  }

  it("reads normally when nothing is substituted", async () => {
    const src = new VaultSource({ root, space: SPACE })
    const doc = await src.read("inside.md" as KnowledgeLocator)
    expect(doc?.note.body).toContain("the real body")
  })

  it("never returns a regular file substituted mid-read", async () => {
    const target = join(root, "inside.md")
    injectAfterFirstStat(target, () => {
      unlinkSync(target)
      writeFileSync(target, note("8", SECRET))
    })

    const src = new VaultSource({ root, space: SPACE })
    let body: string | undefined
    let refusal: string | undefined
    try {
      body = (await src.read("inside.md" as KnowledgeLocator))?.note.body
    } catch (e) {
      refusal = (e as Error).message
    }

    // Either the read refuses, or it serves the bytes of the file it
    // validated. What it must never do is serve the substitute.
    expect(body ?? "").not.toContain(SECRET)
    expect(refusal ?? "").toMatch(/identity changed|became a link|not a regular file/)
  })

  it("never follows a link to outside the vault substituted mid-read", async () => {
    const target = join(root, "inside.md")
    let linked = true
    injectAfterFirstStat(target, () => {
      unlinkSync(target)
      try {
        symlinkSync(join(outside, "secret.md"), target)
      } catch {
        // No privilege to create links here; the swap degrades to a plain
        // removal, which the assertions below still cover.
        linked = false
      }
    })

    const src = new VaultSource({ root, space: SPACE })
    let body: string | undefined
    let refusal: string | undefined
    try {
      body = (await src.read("inside.md" as KnowledgeLocator))?.note.body
    } catch (e) {
      refusal = (e as Error).message
    }

    expect(body ?? "").not.toContain(SECRET)
    if (linked) {
      expect(refusal ?? "").toMatch(/identity changed|became a link|not a regular file/)
    }
  })

  it("refuses loudly during a listing rather than skipping the note", async () => {
    const target = join(root, "inside.md")
    injectAfterFirstStat(
      target,
      () => {
        unlinkSync(target)
        writeFileSync(target, note("7", SECRET))
      },
      // Step over the walk's own stat of this entry; fire on the read's.
      1,
    )

    const src = new VaultSource({ root, space: SPACE })
    // A containment failure met while listing is a boundary being crossed:
    // it must reach the caller, not be recorded as one more skipped note.
    await expect(src.list({})).rejects.toThrow(
      /identity changed|became a link|not a regular file/,
    )
  })
})
