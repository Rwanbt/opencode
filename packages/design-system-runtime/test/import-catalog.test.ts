/* SPDX-License-Identifier: MIT */

import { describe, expect, test } from "bun:test"
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import {
  DESIGN_SYSTEM_ID_REGEX,
  SKIP_REASONS,
  importCatalogs,
  normaliseDesignMdPath,
} from "../src/import-catalog"

type WriteOpts = { name?: string; version?: string; includeManifest?: boolean; includeDesignMd?: boolean }

async function writeCatalog(root: string, id: string, opts: WriteOpts = {}): Promise<string> {
  const dir = join(root, id)
  await mkdir(dir, { recursive: true })
  if (opts.includeDesignMd !== false) {
    await writeFile(join(dir, "DESIGN.md"), `# ${opts.name ?? id}\n\nA design system for testing.\n`, "utf8")
  }
  if (opts.includeManifest !== false) {
    const manifest: Record<string, unknown> = { id, name: opts.name ?? id }
    if (opts.version) manifest.version = opts.version
    await writeFile(join(dir, "manifest.json"), JSON.stringify(manifest, null, 2), "utf8")
  }
  return dir
}

async function withTempRoot<T>(run: (root: string) => Promise<T>): Promise<T> {
  const root = await mkdtemp(join(tmpdir(), "dsr-"))
  try {
    return await run(root)
  } finally {
    await rm(root, { recursive: true, force: true }).catch(() => undefined)
  }
}

describe("importCatalogs", () => {
  test("rejects an unknown root with not-a-directory", async () => {
    const result = await importCatalogs(join(tmpdir(), "definitely-does-not-exist-xyz-12345"))
    expect(result.catalogs).toHaveLength(0)
    expect(result.skipped).toHaveLength(1)
    expect(result.skipped[0]?.reason).toBe(SKIP_REASONS.notADirectory)
  })

  test("skips a directory whose name does not match the id regex", async () => {
    await withTempRoot(async (root) => {
      await writeCatalog(root, "Foo") // upper-case → invalid
      const result = await importCatalogs(root)
      expect(result.catalogs).toHaveLength(0)
      expect(result.skipped).toHaveLength(1)
      expect(result.skipped[0]?.reason).toBe(SKIP_REASONS.invalidId)
    })
  })

  test("skips a directory that has no DESIGN.md", async () => {
    await withTempRoot(async (root) => {
      await writeCatalog(root, "linear-app", { includeDesignMd: false })
      const result = await importCatalogs(root)
      expect(result.catalogs).toHaveLength(0)
      expect(result.skipped).toHaveLength(1)
      expect(result.skipped[0]?.reason).toBe(SKIP_REASONS.missingDesignMd)
    })
  })

  test("duplicates inside the same root are not produced by the filesystem", async () => {
    // The directory tree of a single `rootDir` cannot contain two entries
    // with the same name, so the `duplicate-id` branch is defensive only.
    // It exists because the runbook rule 2 reserves the right to refuse a
    // second catalogue of the same id once a multi-source import API is
    // added on top of this one. Until then, the dedup set is reset every
    // call and two passes over the same root produce the same result.
    await withTempRoot(async (root) => {
      await writeCatalog(root, "linear-app")
      await writeCatalog(root, "ant")
      const first = await importCatalogs(root)
      const second = await importCatalogs(root)
      expect(first.catalogs.map((c) => c.id)).toEqual(["ant", "linear-app"])
      expect(second.catalogs.map((c) => c.id)).toEqual(["ant", "linear-app"])
    })
  })

  test("the same input produces the same output (deterministic)", async () => {
    await withTempRoot(async (root) => {
      await writeCatalog(root, "linear-app", { name: "Linear" })
      await writeCatalog(root, "ant", { name: "Ant Design" })
      await writeCatalog(root, "figma", { name: "Figma" })
      const first = await importCatalogs(root)
      const second = await importCatalogs(root)
      expect(first).toEqual(second)
    })
  })

  test("three valid catalogues produce three entries sorted by id", async () => {
    await withTempRoot(async (root) => {
      await writeCatalog(root, "figma", { name: "Figma" })
      await writeCatalog(root, "ant", { name: "Ant Design" })
      await writeCatalog(root, "linear-app", { name: "Linear" })
      const result = await importCatalogs(root)
      expect(result.catalogs.map((c) => c.id)).toEqual(["ant", "figma", "linear-app"])
      expect(result.skipped).toHaveLength(0)
      const linear = result.catalogs.find((c) => c.id === "linear-app")
      expect(linear).toBeDefined()
      expect(linear?.name).toBe("Linear")
      expect(linear?.source).toBe("workspace://imports/linear-app")
      expect(linear?.version).toBe("1.0.0")
    })
  })

  test("version is read from manifest.json when valid", async () => {
    await withTempRoot(async (root) => {
      await writeCatalog(root, "linear-app", { name: "Linear", version: "1.2.3" })
      const result = await importCatalogs(root)
      expect(result.catalogs[0]?.version).toBe("1.2.3")
    })
  })

  test("falls back to the directory name when manifest.json has no name", async () => {
    await withTempRoot(async (root) => {
      await mkdir(join(root, "linear-app"), { recursive: true })
      await writeFile(join(root, "linear-app", "DESIGN.md"), "# Linear\n", "utf8")
      await writeFile(join(root, "linear-app", "manifest.json"), JSON.stringify({ id: "linear-app" }), "utf8")
      const result = await importCatalogs(root)
      expect(result.catalogs[0]?.name).toBe("linear-app")
    })
  })

  test("falls back to 1.0.0 when manifest.json has no version", async () => {
    await withTempRoot(async (root) => {
      await mkdir(join(root, "linear-app"), { recursive: true })
      await writeFile(join(root, "linear-app", "DESIGN.md"), "# Linear\n", "utf8")
      await writeFile(join(root, "linear-app", "manifest.json"), JSON.stringify({ id: "linear-app", name: "Linear" }), "utf8")
      const result = await importCatalogs(root)
      expect(result.catalogs[0]?.version).toBe("1.0.0")
    })
  })

  test("returns empty for an empty directory", async () => {
    await withTempRoot(async (root) => {
      const result = await importCatalogs(root)
      expect(result.catalogs).toHaveLength(0)
      expect(result.skipped).toHaveLength(0)
    })
  })

  test("mixed valid and invalid catalogues are reported without throwing", async () => {
    await withTempRoot(async (root) => {
      await writeCatalog(root, "linear-app")
      await writeCatalog(root, "FOO") // invalid
      await writeCatalog(root, "ant", { includeDesignMd: false }) // missing-design-md
      const result = await importCatalogs(root)
      // Only `linear-app` survives; `FOO` is invalid-id, `ant` is missing-design-md.
      expect(result.catalogs.map((c) => c.id)).toEqual(["linear-app"])
      const reasons = result.skipped.map((s) => s.reason).sort()
      expect(reasons).toEqual([SKIP_REASONS.invalidId, SKIP_REASONS.missingDesignMd].sort())
    })
  })

  test("DESIGN_SYSTEM_ID_REGEX matches the same shape as the contracts parser", () => {
    expect(DESIGN_SYSTEM_ID_REGEX.test("linear-app")).toBe(true)
    expect(DESIGN_SYSTEM_ID_REGEX.test("ab")).toBe(false) // 2 chars is below the floor
    expect(DESIGN_SYSTEM_ID_REGEX.test("123-app")).toBe(false) // must start with a-z
    expect(DESIGN_SYSTEM_ID_REGEX.test("App")).toBe(false) // upper-case
    // 64 a's is the upper bound: 1 leading + 63 tail characters.
    expect(DESIGN_SYSTEM_ID_REGEX.test("a".repeat(64))).toBe(true)
    // 65 a's is one over the upper bound.
    expect(DESIGN_SYSTEM_ID_REGEX.test("a".repeat(65))).toBe(false)
  })

  test("normaliseDesignMdPath uses forward slashes on every platform", () => {
    const input = "C:\\Users\\me\\design-systems\\linear-app\\DESIGN.md"
    expect(normaliseDesignMdPath(input)).not.toContain("\\")
  })
})
