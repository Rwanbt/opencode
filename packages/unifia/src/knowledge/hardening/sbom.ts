/* SPDX-License-Identifier: MIT */
/**
 * SBOM placeholder (P11.3).
 *
 * V1: walk the workspace, list the declared dependencies in
 * each `package.json`, and emit a CycloneDX-like JSON skeleton.
 * Real SBOM generation is delegated to `bunx @cyclonedx/cyclonedx-npm`
 * in CI; this stub is the testable surface.
 */

import { readFileSync, readdirSync, statSync } from "node:fs"
import { join } from "node:path"

export interface SbomComponent {
  type: "library" | "application"
  name: string
  version: string
  purl: string
}

export interface Sbom {
  bomFormat: "CycloneDX"
  specVersion: "1.5"
  version: number
  components: SbomComponent[]
}

export function buildSbomFromPackages(workspaceRoot: string): Sbom {
  const components: SbomComponent[] = []
  walk(workspaceRoot, (dir) => {
    const pkgPath = join(dir, "package.json")
    try {
      const stat = statSync(pkgPath)
      if (!stat.isFile()) return
      const json = JSON.parse(readFileSync(pkgPath, "utf8")) as {
        name?: string
        version?: string
        dependencies?: Record<string, string>
      }
      if (typeof json.name !== "string" || typeof json.version !== "string") return
      components.push({
        type: "application",
        name: json.name,
        version: json.version,
        purl: `pkg:npm/${json.name}@${json.version}`,
      })
      if (json.dependencies) {
        for (const [name, ver] of Object.entries(json.dependencies)) {
          if (typeof ver !== "string") continue
          components.push({
            type: "library",
            name,
            version: ver.replace(/^[\^~]/, ""),
            purl: `pkg:npm/${name}@${ver.replace(/^[\^~]/, "")}`,
          })
        }
      }
    } catch {
      // ignore
    }
  })
  return { bomFormat: "CycloneDX", specVersion: "1.5", version: 1, components }
}

function walk(dir: string, visit: (dir: string) => void): void {
  visit(dir)
  let entries: string[]
  try {
    entries = readdirSync(dir)
  } catch {
    return
  }
  for (const name of entries) {
    if (name === "node_modules" || name === ".git" || name === "target" || name === "dist") continue
    const full = join(dir, name)
    try {
      const stat = statSync(full)
      if (stat.isDirectory()) walk(full, visit)
    } catch {
      // ignore
    }
  }
}
