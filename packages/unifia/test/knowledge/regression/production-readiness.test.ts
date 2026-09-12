/* SPDX-License-Identifier: MIT */
/**
 * Characterization suite for the production-readiness counter-review
 * (2026-08-30, HEAD 9785000e48). Cards C18–C24.
 *
 * Several of these defects were introduced by the previous remediation, not
 * inherited: `service.get()` hardcoded `restriction: "allow"` — the exact
 * defect that had just been fixed in the router — and `serialiseNote()` was
 * never taught about the frontmatter key added alongside it.
 */

import { describe, it, expect, beforeEach, afterEach } from "bun:test"
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, symlinkSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { composeKnowledgeService } from "../../../src/knowledge/facade/compose.js"
import { ContextRouter } from "../../../src/knowledge/context/router.js"
import { SourceRegistry } from "../../../src/knowledge/source/source.js"
import type { KnowledgeSource } from "../../../src/knowledge/source/source.js"
import { VaultSource } from "../../../src/knowledge/source/vault.js"
import { parseFrontmatter, serialiseNote } from "../../../src/knowledge/parser/frontmatter.js"
import { withDeadline, DeadlineExceeded } from "../../../src/knowledge/context/deadline.js"
import { runProbes } from "../../../src/knowledge/mobile/android-runtime.js"
import { writePolicy, DEFAULT_POLICY } from "../../../src/knowledge/policy/store.js"

const LOCAL = { providerId: "cli", destinationKind: "local" as const, defaultRestriction: "allow" as const }

function note(id: string, body: string, restrictions?: string[]) {
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
    ...(restrictions ? ["unifia_restrictions:", ...restrictions] : []),
    "---",
    body,
  ].join("\n")
}

// ---------------------------------------------------------------------------
// C18 — no capability may serve a note the egress policy denies.
// ---------------------------------------------------------------------------

describe("C18 — every read path applies the egress guard", () => {
  let root: string
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "unifia-c18-"))
    mkdirSync(join(root, "memory"))
    writeFileSync(
      join(root, "memory", "target.md"),
      note("1", "public target", ["  remote_model: allow"]),
    )
    writeFileSync(
      join(root, "memory", "secret.md"),
      note("2", "TOP_SECRET_LEAK links to [[target]]", ["  remote_model: deny"]),
    )
  })
  afterEach(() => rmSync(root, { recursive: true, force: true }))

  const remote = () =>
    composeKnowledgeService({ workspaceRoot: root, providerId: "cloud", destinationKind: "remote" })
      .service

  it("search does not return the denied note", async () => {
    const { pack } = await remote().search({
      query: "TOP_SECRET_LEAK",
      spaces: [],
      types: [],
      tags: [],
      maxCandidates: 50,
      maxPayloadBytes: 1_000_000,
      maxSnippetBytes: 65_536,
      deadlineMs: 2_000,
    })
    expect(pack.items).toHaveLength(0)
  })

  it("get does not serve the denied note", async () => {
    expect(await remote().get(undefined, "secret.md")).toBeNull()
  })

  it("backlinks does not disclose the denied note's id", async () => {
    expect(await remote().backlinks({ locator: "target.md" })).toEqual([])
  })

  it("denies every remote read when no policy file allows the destination", async () => {
    // Fail-closed: an unconfigured workspace serves nothing remotely, not
    // even a note whose own frontmatter says remote_model: allow.
    expect(await remote().get(undefined, "target.md")).toBeNull()
  })

  it("resolves the real restriction once the policy allows the destination", async () => {
    writePolicy(root, {
      ...DEFAULT_POLICY,
      version: 1,
      egress: "deny",
      egressByDestination: { "provider:cloud:remote": "allow" },
    })
    const svc = composeKnowledgeService({
      workspaceRoot: root,
      providerId: "cloud",
      destinationKind: "remote",
    }).service
    // The permitted note comes back with its own resolved value...
    expect((await svc.get(undefined, "target.md"))?.candidates[0]?.restriction).toBe("allow")
    // ...and the denied one is still withheld, because a policy that opens a
    // destination does not override a note that refuses it.
    expect(await svc.get(undefined, "secret.md")).toBeNull()
  })

  it("still serves the denied note to a local destination", async () => {
    const local = composeKnowledgeService({
      workspaceRoot: root,
      providerId: "cli",
      destinationKind: "local",
    }).service
    const res = await local.get(undefined, "secret.md")
    expect(res?.candidates[0]?.snippet).toContain("TOP_SECRET_LEAK")
  })
})

// ---------------------------------------------------------------------------
// C19 — the vault root is a real boundary, not a lexical one.
// ---------------------------------------------------------------------------

describe("C19 — filesystem containment uses real paths", () => {
  let root: string
  let outside: string
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "unifia-c19-"))
    outside = mkdtempSync(join(tmpdir(), "unifia-outside-"))
    writeFileSync(join(root, "inside.md"), note("1", "inside the vault"))
    writeFileSync(join(outside, "secret.md"), note("2", "outside the vault"))
  })
  afterEach(() => {
    rmSync(root, { recursive: true, force: true })
    rmSync(outside, { recursive: true, force: true })
  })

  function vault() {
    return new VaultSource({ root, space: { kind: "personal", id: "p", label: "P" } })
  }

  it("refuses a locator that lexically escapes", async () => {
    await expect(vault().read("../../etc/passwd" as never)).rejects.toThrow(/escapes/)
  })

  it("does not list notes reached through a directory link", async () => {
    try {
      symlinkSync(outside, join(root, "escape"), "junction")
    } catch {
      return // link creation unavailable in this environment
    }
    expect(await vault().locators()).toEqual(["inside.md"])
  })

  it("refuses to read through a directory link", async () => {
    try {
      symlinkSync(outside, join(root, "escape"), "junction")
    } catch {
      return
    }
    await expect(vault().read("escape/secret.md" as never)).rejects.toThrow(/outside the vault/)
  })
})

// ---------------------------------------------------------------------------
// C20 — restrictions survive a round-trip.
// ---------------------------------------------------------------------------

describe("C20 — serialiseNote preserves unifia_restrictions", () => {
  it("round-trips all four fields exactly", () => {
    const raw = note("1", "body", [
      "  remote_model: deny",
      "  local_model: allow",
      "  embeddable: deny",
      "  exportable: allow",
    ])
    const before = parseFrontmatter(raw).frontmatter.unifia_restrictions
    const after = parseFrontmatter(serialiseNote(parseFrontmatter(raw))).frontmatter
      .unifia_restrictions
    expect(after).toEqual(before)
  })

  it("never widens a deny by dropping it", () => {
    const raw = note("1", "body", ["  remote_model: deny"])
    const after = parseFrontmatter(serialiseNote(parseFrontmatter(raw))).frontmatter
    expect(after.unifia_restrictions?.remote_model).toBe("deny")
  })

  it("leaves an unrestricted note without a restrictions block", () => {
    const after = parseFrontmatter(serialiseNote(parseFrontmatter(note("1", "body")))).frontmatter
    expect(after.unifia_restrictions).toBeUndefined()
  })
})

// ---------------------------------------------------------------------------
// C21 — the deadline bounds the calls, not just the gaps between them.
// ---------------------------------------------------------------------------

describe("C21 — deadlines bound source calls", () => {
  function slowSource(delayMs: number): KnowledgeSource {
    return {
      space: { kind: "personal", id: "p", label: "p" },
      list: async () => {
        await new Promise((r) => setTimeout(r, delayMs))
        return []
      },
      read: async () => null,
      watch: () => () => undefined,
    } as KnowledgeSource
  }

  it("withDeadline rejects rather than waiting for a slow call", async () => {
    const slow = new Promise((r) => setTimeout(r, 500))
    await expect(withDeadline(slow, 10, "test")).rejects.toBeInstanceOf(DeadlineExceeded)
  })

  it("a zero budget fails immediately", async () => {
    await expect(withDeadline(Promise.resolve(1), 0, "test")).rejects.toBeInstanceOf(
      DeadlineExceeded,
    )
  })

  it("does not wait out a slow list(), and reports truncation", async () => {
    const reg = new SourceRegistry()
    reg.register(slowSource(400))
    const started = Date.now()
    const { truncated } = await new ContextRouter(reg, { providerPlan: LOCAL }).route({
      query: "x",
      spaces: ["personal"],
      types: [],
      tags: [],
      maxCandidates: 10,
      maxPayloadBytes: 1_000,
      maxSnippetBytes: 100,
      deadlineMs: 25,
    })
    expect(Date.now() - started).toBeLessThan(300)
    expect(truncated).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// C24 — an empty or inconsistent Android evidence never yields a PASS.
// ---------------------------------------------------------------------------

describe("C24 — Android evidence is validated, not trusted", () => {
  const ctx = { hasDevice: true, hasInstalledApk: true, apkPath: "/a.apk", onDeviceVault: "/v" }

  it("rejects evidence whose fields are empty", () => {
    const r = runProbes(ctx, [
      { probe: "vault.write", status: "PASS", command: "", deviceId: "", capturedAt: "", output: "" },
    ])
    expect(r.find((p) => p.probe === "vault.write")?.status).toBe(
      "NOT_EXECUTED_EXTERNAL_BOUNDARY",
    )
  })

  it("rejects evidence with an invalid timestamp", () => {
    const r = runProbes(ctx, [
      {
        probe: "vault.write",
        status: "PASS",
        command: "adb shell touch x",
        deviceId: "cmi",
        capturedAt: "not-a-date",
        output: "ok",
      },
    ])
    expect(r.find((p) => p.probe === "vault.write")?.status).toBe(
      "NOT_EXECUTED_EXTERNAL_BOUNDARY",
    )
  })

  it("rejects evidence for a probe that is not in the catalogue", () => {
    const r = runProbes(ctx, [
      {
        probe: "not.a.real.probe",
        status: "PASS",
        command: "x",
        deviceId: "cmi",
        capturedAt: "2026-08-29T10:00:00Z",
        output: "ok",
      },
    ])
    expect(r.every((p) => p.status === "NOT_EXECUTED_EXTERNAL_BOUNDARY")).toBe(true)
  })

  it("rejects evidence when no device is attached", () => {
    const r = runProbes({ ...ctx, hasDevice: false }, [
      {
        probe: "vault.write",
        status: "PASS",
        command: "adb shell touch x",
        deviceId: "cmi",
        capturedAt: "2026-08-29T10:00:00Z",
        output: "ok",
      },
    ])
    expect(r.find((p) => p.probe === "vault.write")?.status).toBe(
      "NOT_EXECUTED_EXTERNAL_BOUNDARY",
    )
  })

  it("accepts complete, consistent evidence", () => {
    const r = runProbes(ctx, [
      {
        probe: "vault.write",
        status: "PASS",
        command: "adb shell touch x",
        deviceId: "cmi_eea",
        capturedAt: "2026-08-29T10:00:00Z",
        output: "ok",
      },
    ])
    expect(r.find((p) => p.probe === "vault.write")?.status).toBe("PASS")
  })
})
