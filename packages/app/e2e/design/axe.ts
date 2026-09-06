/* SPDX-License-Identifier: MIT */

import { createRequire } from "node:module"
import { readFileSync } from "node:fs"
import type { Page, TestInfo } from "@playwright/test"
import { expect } from "../fixtures"

// Axe injection, without @axe-core/playwright.
//
// That wrapper is a thin one — it reads axe.min.js, injects it into the page,
// and calls axe.run — and taking it as a dependency would pin a second copy of
// axe-core alongside the one already in the tree. axe-core itself is a direct
// devDependency of this package precisely so this file does not read a
// transitively hoisted copy that could vanish on an unrelated upgrade.

const require = createRequire(import.meta.url)
const AXE_SOURCE = readFileSync(require.resolve("axe-core/axe.min.js"), "utf8")

/**
 * The rule sets this gate holds the surface to.
 *
 * WCAG 2.1 level AA, the bar the accessibility plan names. Axe's
 * "best-practice" rules are deliberately excluded: they are opinions, and a
 * gate that mixes opinions with conformance failures gets muted the first time
 * an opinion is wrong.
 */
export const WCAG_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"] as const

export interface AxeViolation {
  id: string
  impact: string
  help: string
  helpUrl: string
  /** One entry per offending element: its selector and axe's own explanation. */
  nodes: Array<{ target: string; summary: string }>
}

/**
 * Runs axe against the page, or against one subtree when `context` is given.
 *
 * `context` matters for the approval modal: scanning the whole document there
 * would also re-report everything already wrong with the surface underneath,
 * and the modal's own result would be unreadable.
 */
export async function analyze(page: Page, context?: string): Promise<AxeViolation[]> {
  await page.addScriptTag({ content: AXE_SOURCE })
  return await page.evaluate(
    async ({ selector, tags }) => {
      const axe = (
        window as unknown as {
          axe: { run: (context: unknown, options: unknown) => Promise<{ violations: unknown[] }> }
        }
      ).axe
      const results = await axe.run(selector ?? document, { runOnly: { type: "tag", values: tags } })
      return (results.violations as Array<Record<string, unknown>>).map((violation) => ({
        id: String(violation.id),
        impact: String(violation.impact ?? "unknown"),
        help: String(violation.help),
        helpUrl: String(violation.helpUrl),
        nodes: (violation.nodes as Array<{ target: string[]; failureSummary?: string }>).map((node) => ({
          target: node.target.join(" "),
          summary: (node.failureSummary ?? "").replace(/\s+/g, " ").trim(),
        })),
      }))
    },
    { selector: context ?? null, tags: [...WCAG_TAGS] },
  )
}

/** Readable enough that a failure names what to fix without opening a report. */
export function describe(violations: readonly AxeViolation[]): string {
  if (violations.length === 0) return "no violations"
  return violations
    .map((violation) => {
      const header = `${violation.impact} — ${violation.id}: ${violation.help} (${violation.helpUrl})`
      const nodes = violation.nodes.map((node) => `    ${node.target}\n      ${node.summary}`).join("\n")
      return `${header}\n${nodes}`
    })
    .join("\n")
}

/**
 * Rules this gate records instead of failing on, and why.
 *
 * `color-contrast` fires on the `text-text-weak` token wherever it sits on
 * `background-base` or `background-stronger` — the connection banner, the tab
 * labels, the empty states, the approval id and its deadline. It is not a
 * Design-surface defect and it cannot be fixed here: the token is used across
 * the whole application, and changing it is a palette decision with a visual
 * baseline behind it. First measured 2026-09-01: 12 nodes on the surface,
 * 2 in the approval modal.
 *
 * Every other rule fails the run. Recorded violations are attached to the
 * report on each run, so the debt stays visible instead of becoming an
 * exemption nobody remembers.
 */
export const RECORDED_RULES: ReadonlySet<string> = new Set(["color-contrast"])

/** Fails on any violation whose rule is not in {@link RECORDED_RULES}. */
export async function expectNoNewViolations(
  page: Page,
  testInfo: TestInfo,
  label: string,
  context?: string,
): Promise<void> {
  const violations = await analyze(page, context)
  const recorded = violations.filter((violation) => RECORDED_RULES.has(violation.id))
  const failing = violations.filter((violation) => !RECORDED_RULES.has(violation.id))
  if (recorded.length > 0) {
    testInfo.annotations.push({ type: "a11y-debt", description: label + ": " + describe(recorded) })
  }
  expect(failing, `${label}\n${describe(failing)}`).toEqual([])
}
