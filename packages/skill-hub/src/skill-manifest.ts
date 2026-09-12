/* SPDX-License-Identifier: MIT */

/**
 * P23 — Design-skill manifest format.
 *
 * WHY this is a separate manifest format from the runtime
 * `SkillManifest` in `./index.ts`: the runtime manifest describes
 * installable packages (digest, trust, capabilities, signature). The
 * design-skill manifest describes a single authoring skill — a recipe
 * for producing an artifact under a given mode and scenario. The two
 * share the same word ("skill") but have different lifecycles: the
 * runtime one is what the broker installs; the design one is what
 * the picker picks per generation.
 *
 * The format is frontmatter YAML on top, Markdown body below. The
 * frontmatter is intentionally hand-parsed: a real YAML library would
 * add a dependency for a constrained key/value shape. The body is
 * preserved verbatim — a model that reads it later is the consumer.
 */

export const SKILL_MODES = [
  "prototype",
  "deck",
  "image",
  "video",
  "audio",
  "template",
  "utility",
] as const

export type SkillMode = (typeof SKILL_MODES)[number]

export const SKILL_SCENARIOS = [
  "design",
  "marketing",
  "operation",
  "engineering",
  "product",
  "personal",
] as const

export type SkillScenario = (typeof SKILL_SCENARIOS)[number]

export type DesignSkillManifest = {
  name: string
  description: string
  mode: SkillMode
  scenario: SkillScenario
  requiresDesignSystem: boolean
  body: string
}

export type DesignSkillFrontmatter = {
  name?: unknown
  description?: unknown
  mode?: unknown
  scenario?: unknown
  requiresDesignSystem?: unknown
}

const NAME_REGEX = /^[a-z][a-z0-9-]{2,63}$/

/** Splits a `SKILL.md` into its frontmatter object and its Markdown body. */
function splitFrontmatter(source: string): { frontmatter: string; body: string } {
  // The file must start with `---` on the very first line. We do not
  // accept a leading BOM or any whitespace before the fence.
  if (!source.startsWith("---\n") && source !== "---") {
    throw new Error("skill manifest is missing the opening `---` fence")
  }
  // Find the closing fence on a line that contains only `---` (optional
  // trailing whitespace). The closing fence is the second one.
  const lines = source.split("\n")
  if (lines[0] !== "---") {
    throw new Error("skill manifest is missing the opening `---` fence")
  }
  let closingIndex = -1
  for (let index = 1; index < lines.length; index += 1) {
    if (lines[index] === "---") {
      closingIndex = index
      break
    }
  }
  if (closingIndex < 0) throw new Error("skill manifest is missing the closing `---` fence")
  const frontmatter = lines.slice(1, closingIndex).join("\n")
  const body = lines.slice(closingIndex + 1).join("\n").replace(/^\s+/, "")
  return { frontmatter, body }
}

/** Hand-parses a constrained YAML frontmatter. Throws on any unknown shape. */
function parseFrontmatter(raw: string): DesignSkillFrontmatter {
  const result: DesignSkillFrontmatter = {}
  const lines = raw.split("\n")
  for (const line of lines) {
    if (line.trim() === "" || line.trim().startsWith("#")) continue
    const match = line.match(/^([A-Za-z][A-Za-z0-9_-]*)\s*:\s*(.*)$/)
    if (!match) throw new Error(`skill manifest frontmatter line is not a key/value: ${JSON.stringify(line)}`)
    const key = match[1]
    if (!key) throw new Error(`skill manifest frontmatter line is missing a key: ${JSON.stringify(line)}`)
    const rawValue = (match[2] ?? "").trim()
    if (key === "name") result.name = stripQuotes(rawValue)
    else if (key === "description") result.description = stripQuotes(rawValue)
    else if (key === "mode") result.mode = stripQuotes(rawValue)
    else if (key === "scenario") result.scenario = stripQuotes(rawValue)
    else if (key === "requiresDesignSystem") result.requiresDesignSystem = parseBoolean(rawValue, key)
    else throw new Error(`skill manifest frontmatter has an unknown key: ${key}`)
  }
  return result
}

function stripQuotes(value: string): string {
  if (value.length >= 2) {
    const first = value[0]
    const last = value[value.length - 1]
    if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
      return value.slice(1, -1)
    }
  }
  return value
}

function parseBoolean(value: string, key: string): boolean {
  if (value === "true") return true
  if (value === "false") return false
  throw new Error(`skill manifest frontmatter key \`${key}\` is not a boolean: ${JSON.stringify(value)}`)
}

/**
 * Parses a `SKILL.md` source into a typed `SkillManifest`.
 *
 * Throws on:
 * - missing or malformed frontmatter fence
 * - missing `name` or `description`
 * - `name` not matching the id regex
 * - `mode` or `scenario` outside their closed union
 * - `requiresDesignSystem` not a boolean
 *
 * Defaults: `mode: "prototype"`, `scenario: "design"`,
 * `requiresDesignSystem: false`. The body is preserved verbatim.
 */
export function parseDesignSkillManifest(source: string): DesignSkillManifest {
  const { frontmatter, body } = splitFrontmatter(source)
  const parsed = parseFrontmatter(frontmatter)
  if (typeof parsed.name !== "string" || parsed.name.trim() === "") throw new Error("skill manifest is missing `name`")
  if (!NAME_REGEX.test(parsed.name)) throw new Error(`skill manifest \`name\` does not match the id regex: ${JSON.stringify(parsed.name)}`)
  if (typeof parsed.description !== "string" || parsed.description.trim() === "") throw new Error("skill manifest is missing `description`")
  const mode = typeof parsed.mode === "string" ? parsed.mode : "prototype"
  if (!(SKILL_MODES as readonly string[]).includes(mode)) {
    throw new Error(`skill manifest \`mode\` is not in the closed union: ${JSON.stringify(mode)}`)
  }
  const scenario = typeof parsed.scenario === "string" ? parsed.scenario : "design"
  if (!(SKILL_SCENARIOS as readonly string[]).includes(scenario)) {
    throw new Error(`skill manifest \`scenario\` is not in the closed union: ${JSON.stringify(scenario)}`)
  }
  const requiresDesignSystem = typeof parsed.requiresDesignSystem === "boolean" ? parsed.requiresDesignSystem : false
  return {
    name: parsed.name,
    description: parsed.description,
    mode: mode as SkillMode,
    scenario: scenario as SkillScenario,
    requiresDesignSystem,
    body,
  }
}

/**
 * Builds the English preamble the model is asked to follow when this
 * skill is active. The preamble is deterministic, names the skill, and
 * includes the body verbatim.
 */
export function buildDesignSkillContext(skill: DesignSkillManifest): string {
  const lines: string[] = []
  lines.push(`Active skill: ${skill.name}.`)
  lines.push(`Mode: ${skill.mode}. Scenario: ${skill.scenario}.`)
  if (skill.requiresDesignSystem) lines.push("A design system is required and is active for this run.")
  lines.push(skill.description)
  lines.push("")
  lines.push(skill.body)
  return lines.join("\n").replace(/\n+$/, "\n")
}

/** True when the skill can run given the presence (or absence) of a design system. */
export function canSkillRun(skill: DesignSkillManifest, hasDesignSystem: boolean): boolean {
  return !skill.requiresDesignSystem || hasDesignSystem
}
