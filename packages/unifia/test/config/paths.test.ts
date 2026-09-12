/* SPDX-License-Identifier: MIT */

import { test, expect, describe } from "bun:test"
import fs from "node:fs/promises"
import path from "node:path"
import os from "node:os"
import { ConfigPaths } from "../../src/config/paths"

describe("ConfigPaths project directories", () => {
  test("discovers both brands, current one last so it wins the merge", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "unifia-paths-"))
    const project = path.join(root, "project")
    await fs.mkdir(path.join(project, ConfigPaths.LEGACY_PROJECT_DIRECTORY), { recursive: true })
    await fs.mkdir(path.join(project, ConfigPaths.PROJECT_DIRECTORY), { recursive: true })

    const found = (await ConfigPaths.directories(project, project)).filter((dir) => dir.startsWith(project))

    // Callers merge in the order returned, so `.unifia` has to come after
    // `.opencode` at the same level — the rule projectFiles() applies to
    // filenames, extended to the directory name.
    expect(found).toEqual([
      path.join(project, ConfigPaths.LEGACY_PROJECT_DIRECTORY),
      path.join(project, ConfigPaths.PROJECT_DIRECTORY),
    ])

    await fs.rm(root, { recursive: true, force: true })
  })

  test("a project holding only the legacy directory is still discovered", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "unifia-paths-"))
    const project = path.join(root, "project")
    await fs.mkdir(path.join(project, ConfigPaths.LEGACY_PROJECT_DIRECTORY), { recursive: true })

    const found = (await ConfigPaths.directories(project, project)).filter((dir) => dir.startsWith(project))

    expect(found).toEqual([path.join(project, ConfigPaths.LEGACY_PROJECT_DIRECTORY)])

    await fs.rm(root, { recursive: true, force: true })
  })

  // The legacy directory is also the separately-installed OpenCode's. Anything
  // that writes has to consult this, or it drops a package.json, a .gitignore
  // and a node_modules tree into the other product's project config.
  test("only the legacy directory is flagged read-only", () => {
    expect(ConfigPaths.isLegacyDirectory(path.join("/repo", ".opencode"))).toBe(true)
    expect(ConfigPaths.isLegacyDirectory(path.join("/repo", ".unifia"))).toBe(false)

    expect(ConfigPaths.isConfigDirectory(path.join("/repo", ".opencode"))).toBe(true)
    expect(ConfigPaths.isConfigDirectory(path.join("/repo", ".unifia"))).toBe(true)
    expect(ConfigPaths.isConfigDirectory(path.join("/repo", "src"))).toBe(false)
  })
})
