/* SPDX-License-Identifier: MIT */

/**
 * P23 — Build the rows of the design-skill picker.
 *
 * The picker is read-only here: the rows are computed from the list
 * of installed skills and the active design system. The component
 * lives in the app; this module is the pure transformation.
 */

import { canSkillRun, type DesignSkillManifest, type SkillMode, type SkillScenario } from "@unifia/skill-hub"

export type SkillPickerRow = {
  id: string
  name: string
  description: string
  mode: SkillMode
  scenario: SkillScenario
  requiresDesignSystem: boolean
  canRun: boolean
  selected: boolean
}

export type SkillPickerInput = {
  skills: readonly DesignSkillManifest[]
  selectedId?: string
  hasDesignSystem: boolean
}

/**
 * Sorts the rows alphabetically by name. The selected row, if any,
 * always comes first — the picker shows the active skill at the top
 * of the list. Within a tie, the original order is preserved.
 */
export function createSkillPickerRows(input: SkillPickerInput): readonly SkillPickerRow[] {
  const selectedId = input.selectedId
  const selected = selectedId ? input.skills.find((skill) => skill.name === selectedId) : undefined
  const rest = input.skills.filter((skill) => skill.name !== selectedId)
  const toRow = (skill: DesignSkillManifest, isSelected: boolean): SkillPickerRow => ({
    id: skill.name,
    name: skill.name,
    description: skill.description,
    mode: skill.mode,
    scenario: skill.scenario,
    requiresDesignSystem: skill.requiresDesignSystem,
    canRun: canSkillRun(skill, input.hasDesignSystem),
    selected: isSelected,
  })
  const rows: SkillPickerRow[] = []
  if (selected) rows.push(toRow(selected, true))
  for (const skill of rest.sort((left, right) => left.name.localeCompare(right.name))) {
    rows.push(toRow(skill, false))
  }
  return rows
}

/** Counts the skills that are blocked because of a missing design system. */
export function countBlockedSkills(skills: readonly DesignSkillManifest[], hasDesignSystem: boolean): number {
  let count = 0
  for (const skill of skills) if (!canSkillRun(skill, hasDesignSystem)) count += 1
  return count
}
