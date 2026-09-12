/* SPDX-License-Identifier: MIT */

import { describe, expect, test } from "bun:test"
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import {
  TEMPLATE_FILES,
  TEMPLATE_ID_REGEX,
  TEMPLATE_SKIP_REASONS,
  discoverTemplates,
  normaliseTemplatePath,
  templateReferenceLooksRenderable,
} from "../src/template-registry"

async function writeTemplate(root: string, id: string, opts: { includeReference?: boolean; includeSkill?: boolean; skill?: string } = {}): Promise<string> {
  const dir = join(root, id)
  await mkdir(dir, { recursive: true })
  if (opts.includeSkill !== false) {
    const source = opts.skill ?? `---
name: ${id}
description: A test template.
mode: prototype
scenario: design
requiresDesignSystem: false
---

body of ${id}
`
    await writeFile(join(dir, TEMPLATE_FILES.skill), source, "utf8")
  }
  if (opts.includeReference !== false) {
    await writeFile(join(dir, TEMPLATE_FILES.reference), "<!doctype html><html><body>reference</body></html>", "utf8")
  }
  await writeFile(join(dir, TEMPLATE_FILES.readme), `# ${id}`, "utf8")
  return dir
}

async function withTempRoot<T>(run: (root: string) => Promise<T>): Promise<T> {
  const root = await mkdtemp(join(tmpdir(), "tmpl-"))
  try {
    return await run(root)
  } finally {
    await rm(root, { recursive: true, force: true }).catch(() => undefined)
  }
}

describe("discoverTemplates", () => {
  test("discovers the four template directories shipped in the repo", async () => {
    const root = join(import.meta.dir, "..", "..", "..", "templates", "design")
    const result = await discoverTemplates(root)
    const ids = result.templates.map((t) => t.id)
    expect(ids).toEqual(["dashboard", "deck", "mobile-app", "web-prototype"])
  })

  test("an unknown root is reported with not-a-directory", async () => {
    const result = await discoverTemplates(join(tmpdir(), "definitely-does-not-exist-xyz-12345"))
    expect(result.templates).toHaveLength(0)
    expect(result.skipped[0]?.reason).toBe(TEMPLATE_SKIP_REASONS.notADirectory)
  })

  test("an invalid id is skipped", async () => {
    await withTempRoot(async (root) => {
      await writeTemplate(root, "FOO")
      const result = await discoverTemplates(root)
      expect(result.templates).toHaveLength(0)
      expect(result.skipped[0]?.reason).toBe(TEMPLATE_SKIP_REASONS.invalidId)
    })
  })

  test("a directory without SKILL.md is skipped", async () => {
    await withTempRoot(async (root) => {
      await writeTemplate(root, "linear-app", { includeSkill: false })
      const result = await discoverTemplates(root)
      expect(result.templates).toHaveLength(0)
      expect(result.skipped[0]?.reason).toBe(TEMPLATE_SKIP_REASONS.missingSkill)
    })
  })

  test("a directory without reference.html is skipped", async () => {
    await withTempRoot(async (root) => {
      await writeTemplate(root, "linear-app", { includeReference: false })
      const result = await discoverTemplates(root)
      expect(result.templates).toHaveLength(0)
      expect(result.skipped[0]?.reason).toBe(TEMPLATE_SKIP_REASONS.missingReference)
    })
  })

  test("an invalid skill manifest is skipped with a reason", async () => {
    await withTempRoot(async (root) => {
      await writeTemplate(root, "linear-app", { skill: "---\nbroken: true\n---\n" })
      const result = await discoverTemplates(root)
      expect(result.templates).toHaveLength(0)
      expect(result.skipped[0]?.reason).toMatch(/invalid-skill-manifest/)
    })
  })

  test("four valid templates are discovered, sorted by id", async () => {
    await withTempRoot(async (root) => {
      await writeTemplate(root, "figma")
      await writeTemplate(root, "ant")
      await writeTemplate(root, "linear-app")
      await writeTemplate(root, "vercel")
      const result = await discoverTemplates(root)
      expect(result.templates.map((t) => t.id)).toEqual(["ant", "figma", "linear-app", "vercel"])
    })
  })

  test("deterministic on the same input", async () => {
    await withTempRoot(async (root) => {
      await writeTemplate(root, "figma")
      await writeTemplate(root, "ant")
      const first = await discoverTemplates(root)
      const second = await discoverTemplates(root)
      expect(first).toEqual(second)
    })
  })
})

describe("templateReferenceLooksRenderable", () => {
  test("a benign reference body is reported as renderable", () => {
    const result = templateReferenceLooksRenderable("<!doctype html><html><body>Hi</body></html>")
    expect(result.ok).toBe(true)
    expect(result.needsStorageShim).toBe(false)
    expect(result.needsFocusGuard).toBe(false)
  })
})

describe("TEMPLATE_ID_REGEX", () => {
  test("matches the same shape as the design-system id", () => {
    expect(TEMPLATE_ID_REGEX.test("web-prototype")).toBe(true)
    expect(TEMPLATE_ID_REGEX.test("ab")).toBe(false)
    expect(TEMPLATE_ID_REGEX.test("App")).toBe(false)
    expect(TEMPLATE_ID_REGEX.test("123-app")).toBe(false)
  })
})

describe("normaliseTemplatePath", () => {
  test("uses forward slashes on every platform", () => {
    const input = "C:\\Users\\me\\templates\\design\\linear-app"
    expect(normaliseTemplatePath(input)).not.toContain("\\")
  })
})
