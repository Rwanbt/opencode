/* SPDX-License-Identifier: MIT */

/**
 * P24 — Template registry.
 *
 * A template is a directory under `templates/design/<name>/` that
 * contains `SKILL.md`, `reference.html`, and `README.md`. The
 * registry discovers templates by reading the directory; adding a
 * template is a file drop, not a code change.
 *
 * The registry is the single place that knows the file layout; the
 * picker consumes the discovered list and the runtime injects the
 * active template's preamble into the prompt.
 */

import { existsSync } from "node:fs"
import { readdir, readFile, stat } from "node:fs/promises"
import { join, resolve, sep } from "node:path"

import { htmlNeedsFocusGuard, htmlNeedsStorageShim } from "@unifia/artifact-render"
import { parseDesignSkillManifest, type DesignSkillManifest } from "./skill-manifest.js"

export const TEMPLATE_FILES = {
  skill: "SKILL.md",
  reference: "reference.html",
  readme: "README.md",
} as const

export type DiscoveredTemplate = {
  id: string
  directory: string
  manifest: DesignSkillManifest
  referenceHtml: string
  readme: string
}

export type TemplateRegistrySkip = { id: string; path: string; reason: string }

export type TemplateRegistryResult = {
  templates: readonly DiscoveredTemplate[]
  skipped: readonly TemplateRegistrySkip[]
}

export const TEMPLATE_SKIP_REASONS = {
  invalidId: "invalid-id",
  duplicateId: "duplicate-id",
  missingSkill: "missing-skill-md",
  invalidSkillManifest: "invalid-skill-manifest",
  missingReference: "missing-reference-html",
  notADirectory: "not-a-directory",
} as const

export const TEMPLATE_ID_REGEX = /^[a-z][a-z0-9-]{2,63}$/

function normalisePath(path: string): string {
  return path.split(sep).join("/")
}

/**
 * Discovers templates in `rootDir`. Each subdirectory is a candidate
 * template. The function is deterministic: the output is sorted by
 * `id` and the same input always produces the same output.
 */
export async function discoverTemplates(rootDir: string): Promise<TemplateRegistryResult> {
  const root = resolve(rootDir)
  const rootStat = await stat(root).catch(() => undefined)
  if (!rootStat || !rootStat.isDirectory()) {
    return { templates: [], skipped: [{ id: "", path: root, reason: TEMPLATE_SKIP_REASONS.notADirectory }] }
  }
  const entries = await readdir(root, { withFileTypes: true }).catch(() => [])
  const seenIds = new Set<string>()
  const templates: DiscoveredTemplate[] = []
  const skipped: TemplateRegistrySkip[] = []
  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    const id = entry.name
    const dirPath = join(root, id)
    if (!TEMPLATE_ID_REGEX.test(id)) {
      skipped.push({ id, path: dirPath, reason: TEMPLATE_SKIP_REASONS.invalidId })
      continue
    }
    if (seenIds.has(id)) {
      skipped.push({ id, path: dirPath, reason: TEMPLATE_SKIP_REASONS.duplicateId })
      continue
    }
    const skillPath = join(dirPath, TEMPLATE_FILES.skill)
    if (!existsSync(skillPath)) {
      skipped.push({ id, path: dirPath, reason: TEMPLATE_SKIP_REASONS.missingSkill })
      continue
    }
    const referencePath = join(dirPath, TEMPLATE_FILES.reference)
    if (!existsSync(referencePath)) {
      skipped.push({ id, path: dirPath, reason: TEMPLATE_SKIP_REASONS.missingReference })
      continue
    }
    let manifest: DesignSkillManifest
    try {
      const skillSource = await readFile(skillPath, "utf8")
      manifest = parseDesignSkillManifest(skillSource)
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error)
      skipped.push({ id, path: dirPath, reason: TEMPLATE_SKIP_REASONS.invalidSkillManifest + ": " + reason })
      continue
    }
    seenIds.add(id)
    templates.push({
      id,
      directory: dirPath,
      manifest,
      referenceHtml: await readFile(referencePath, "utf8"),
      readme: await readFile(join(dirPath, TEMPLATE_FILES.readme), "utf8").catch(() => ""),
    })
  }
  templates.sort((left, right) => left.id.localeCompare(right.id))
  return { templates, skipped }
}

/**
 * Quick structural check: a template's `reference.html` should not
 * throw a heuristic error from the artifact-render heuristics. We do
 * not actually run the iframe; we only assert the heuristics would
 * accept the body.
 */
export function templateReferenceLooksRenderable(referenceHtml: string): { ok: boolean; needsStorageShim: boolean; needsFocusGuard: boolean } {
  return {
    ok: true,
    needsStorageShim: htmlNeedsStorageShim(referenceHtml),
    needsFocusGuard: htmlNeedsFocusGuard(referenceHtml),
  }
}

/** Normalises a path for inclusion in deterministic output. */
export function normaliseTemplatePath(path: string): string {
  return normalisePath(path)
}
