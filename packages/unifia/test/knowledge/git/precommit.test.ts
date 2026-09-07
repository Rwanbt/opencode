/* SPDX-License-Identifier: MIT */
import { describe, it, expect } from "bun:test"
import { mkdtempSync, writeFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import {
  scanStaged,
  installPrecommitHook,
  uninstallPrecommitHook,
} from "../../../src/knowledge/git/precommit.js"

function makeTmp(): { root: string; cleanup: () => void } {
  const root = mkdtempSync(join(tmpdir(), "unifia-precommit-"))
  // Pretend a .git directory exists.
  const { mkdirSync } = require("node:fs")
  mkdirSync(join(root, ".git"), { recursive: true })
  writeFileSync(join(root, ".git", "HEAD"), "ref: refs/heads/main")
  return {
    root,
    cleanup: () => rmSync(root, { recursive: true, force: true }),
  }
}

describe("P8.1 precommit — scan", () => {
  it("returns ok=true on plain prose", () => {
    const { root, cleanup } = makeTmp()
    try {
      const r = scanStaged({
        workspaceRoot: root,
        staged: ["docs/x.md"],
        read: () => "# hello world\n\nThis is plain prose.\n",
      })
      expect(r.ok).toBe(true)
      expect(r.findings).toHaveLength(0)
    } finally {
      cleanup()
    }
  })

  it("flags an OpenAI key as a secret (deny)", () => {
    const { root, cleanup } = makeTmp()
    try {
      const r = scanStaged({
        workspaceRoot: root,
        staged: ["config/x.env"],
        read: () => "OPENAI_API_KEY=sk-abcdefghijklmnopqrstuvwxyz1234567890",
      })
      expect(r.ok).toBe(false)
      expect(r.findings).toHaveLength(1)
      expect(r.findings[0].locator).toBe("config/x.env")
    } finally {
      cleanup()
    }
  })

  it("flags a GitHub PAT as a secret", () => {
    const { root, cleanup } = makeTmp()
    try {
      const r = scanStaged({
        workspaceRoot: root,
        staged: ["config/gh.env"],
        read: () => "GH_TOKEN=ghp_abcdefghijklmnopqrstuvwxyz0123456789",
      })
      expect(r.ok).toBe(false)
      expect(r.findings).toHaveLength(1)
    } finally {
      cleanup()
    }
  })

  it("flags a private key block as a secret", () => {
    const { root, cleanup } = makeTmp()
    try {
      const r = scanStaged({
        workspaceRoot: root,
        staged: ["keys/x.pem"],
        read: () => "-----BEGIN RSA PRIVATE KEY-----\nMIIEog==\n-----END RSA PRIVATE KEY-----\n",
      })
      expect(r.ok).toBe(false)
      expect(r.findings).toHaveLength(1)
    } finally {
      cleanup()
    }
  })

  it("ignores non-existent locators (read returns null)", () => {
    const { root, cleanup } = makeTmp()
    try {
      const r = scanStaged({
        workspaceRoot: root,
        staged: ["nope.md"],
        read: () => null,
      })
      expect(r.ok).toBe(true)
    } finally {
      cleanup()
    }
  })

  it("rejects a non-absolute workspaceRoot", () => {
    expect(() =>
      scanStaged({
        workspaceRoot: "relative/path",
        staged: [],
        read: () => null,
      }),
    ).toThrow()
  })
})

describe("P8.1 precommit — install / uninstall", () => {
  it("installs a hook into .git/hooks/pre-commit", () => {
    const { root, cleanup } = makeTmp()
    try {
      const r = installPrecommitHook(root)
      expect(r.ok).toBe(true)
      const { existsSync, readFileSync } = require("node:fs")
      expect(existsSync(join(root, ".git/hooks/pre-commit"))).toBe(true)
      const content = readFileSync(join(root, ".git/hooks/pre-commit"), "utf8")
      expect(content).toContain("unifia-knowledge-precommit-hook")
    } finally {
      cleanup()
    }
  })

  it("refuses to install when there is no .git directory", () => {
    const root = mkdtempSync(join(tmpdir(), "unifia-nogit-"))
    try {
      const r = installPrecommitHook(root)
      expect(r.ok).toBe(false)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it("refuses to uninstall a hook that is not ours", () => {
    const { root, cleanup } = makeTmp()
    try {
      const { mkdirSync } = require("node:fs")
      mkdirSync(join(root, ".git/hooks"), { recursive: true })
      writeFileSync(join(root, ".git/hooks/pre-commit"), "#!/bin/sh\n# not ours\n")
      const r = uninstallPrecommitHook(root)
      expect(r.ok).toBe(false)
    } finally {
      cleanup()
    }
  })
})
