/* SPDX-License-Identifier: MIT */

import { readdir, readFile } from "node:fs/promises"
import path from "node:path"

/**
 * P6-3 — Garde couleurs sur le workbench.
 *
 * Le plan de parité design impose que `packages/app/src/pages/workbench/`
 * reste à zéro couleur littérale. Les couleurs viennent des tokens
 * sémantiques (`text-text-weak`, `bg-background-stronger`,
 * `border-border-base`, etc.) — pas de `#rrggbb`, pas de `rgb(`,
 * pas de classes Tailwind de couleur (`bg-red-500`, `text-blue-300`,
 * etc.). La charte graphique est définie séparément
 * ([[Unifia/Charte-graphique-Unifia]]) et toute couleur littérale qui
 * apparaît ici est soit un oubli, soit une régression.
 *
 * Le scan est restreint à `pages/workbench/` (le périmètre du plan).
 * Étendre au reste de l'app est un autre chantier et dépasse la portée
 * d'un garde de parité design.
 *
 * Le pattern Tailwind exclut explicitement les préfixes sémantiques :
 * `text-text-weak` n'est pas un match (le 2e token est `text`, pas une
 * couleur), `bg-background-base` non plus (le 2e token est `background`).
 * Le token `text-` n'est pas dans la liste des couleurs Tailwind
 * standard, donc le match ne se déclenche pas.
 */

const repoRoot = path.resolve(import.meta.dirname, "..")
const scanRoot = "packages/app/src/pages/workbench"

// Tailwind palette v3/v4 (sans les prefixes sémantiques du projet).
const TAILWIND_COLORS = [
  "red", "orange", "amber", "yellow", "lime", "green", "emerald",
  "teal", "cyan", "sky", "blue", "indigo", "violet", "purple",
  "fuchsia", "pink", "rose",
  "slate", "gray", "zinc", "neutral", "stone",
]
const TAILWIND_PREFIXES = [
  "bg", "text", "border", "ring", "fill", "stroke", "outline",
  "divide", "placeholder", "caret", "accent", "from", "via", "to",
  "shadow", "decoration",
]

const HEX_RE = /#[0-9a-fA-F]{3,8}\b/g
const RGB_RE = /\brgba?\s*\(/g
// Capture : <prefix>-<color>-<n> (Tailwind). Limite par \b pour ne pas
// matcher au milieu d'un mot plus long.
const TAILWIND_RE = new RegExp(
  `\\b(?:${TAILWIND_PREFIXES.join("|")})-(?:${TAILWIND_COLORS.join("|")})-\\d{2,3}\\b`,
  "g",
)

const offenders = []

async function visit(relativeDirectory) {
  const directory = path.join(repoRoot, relativeDirectory)
  let entries
  try {
    entries = await readdir(directory, { withFileTypes: true })
  } catch {
    return
  }
  for (const entry of entries) {
    const relativePath = path.posix.join(
      relativeDirectory.replaceAll("\\", "/"),
      entry.name,
    )
    if (entry.isDirectory()) {
      if (!new Set(["node_modules", "dist", "build", "target", "gen"]).has(entry.name)) {
        await visit(relativePath)
      }
      continue
    }
    if (!/\.(?:ts|tsx|js|mjs|css)$/.test(entry.name)) continue
    const source = await readFile(path.join(repoRoot, relativePath), "utf8")
    const lines = source.split(/\r?\n/)
    for (let i = 0; i < lines.length; i += 1) {
      const line = lines[i]
      // Skip les commentaires // qui documentent la règle.
      if (line.trimStart().startsWith("//")) continue
      for (const pattern of [HEX_RE, RGB_RE, TAILWIND_RE]) {
        pattern.lastIndex = 0
        const match = pattern.exec(line)
        if (match) {
          offenders.push(`${relativePath}:${i + 1}: ${match[0]}`)
          break
        }
      }
    }
  }
}

await visit(scanRoot)
if (offenders.length > 0) {
  console.error(
    [
      "WorkbenchColorLiteralsGuard: literal colors found in pages/workbench/.",
      "Use semantic tokens (text-text-weak, bg-background-stronger, etc.)",
      "from the charte graphique. Offending lines:",
      ...offenders,
    ].join("\n"),
  )
  process.exit(1)
}
console.log("WorkbenchColorLiteralsGuard: no literal colors in pages/workbench/")
