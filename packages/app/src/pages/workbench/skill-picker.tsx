/* SPDX-License-Identifier: MIT */

import { For, Show, type JSX } from "solid-js"
import type { SkillPickerRow } from "@unifia/workbench-shell"

export type SkillPickerProps = {
  rows: readonly SkillPickerRow[]
  hasDesignSystem: boolean
  onSelect: (row: SkillPickerRow) => void
}

/**
 * Renders the list of design skills. Rows that require a design system
 * are rendered as disabled when no design system is active, with a
 * short reason shown beneath the description. The component is
 * presentational: it does not own the source of truth for the skills
 * or the active design system.
 */
export function SkillPicker(props: SkillPickerProps): JSX.Element {
  return (
    <section class="space-y-3" data-workbench-skill-picker>
      <header class="flex items-center justify-between">
        <h2 class="text-14-medium">Design skills</h2>
        <span class="text-12-regular text-text-weak" data-workbench-skill-picker-count={props.rows.length}>
          {`${props.rows.length} skill(s) · ${props.hasDesignSystem ? "design system active" : "no design system"}`}
        </span>
      </header>
      <Show when={props.rows.length === 0} fallback={<SkillList rows={props.rows} onSelect={props.onSelect} />}>
        <p class="text-12-regular text-text-weak" data-workbench-skill-picker-empty>
          No skills installed. Add a `SKILL.md` to `templates/design/` to register one.
        </p>
      </Show>
    </section>
  )
}

function SkillList(props: { rows: readonly SkillPickerRow[]; onSelect: (row: SkillPickerRow) => void }): JSX.Element {
  return (
    <ul class="space-y-2" data-workbench-skill-picker-list>
      <For each={props.rows}>
        {(row) => (
          <li>
            <button
              type="button"
              data-workbench-skill-row={row.id}
              data-workbench-skill-row-selected={row.selected ? "true" : "false"}
              data-workbench-skill-row-runnable={row.canRun ? "true" : "false"}
              class="w-full rounded border border-border-base bg-background-stronger p-3 text-left text-12-regular disabled:opacity-50"
              disabled={!row.canRun}
              onClick={() => props.onSelect(row)}
            >
              <div class="flex items-center justify-between">
                <span class="text-14-medium">{row.name}</span>
                <span class="text-12-regular text-text-weak">{`${row.mode} · ${row.scenario}`}</span>
              </div>
              <p class="mt-1 text-12-regular text-text-weak">{row.description}</p>
              <Show when={!row.canRun}>
                <p class="mt-1 text-12-regular text-text-danger" data-workbench-skill-row-blocked>
                  Blocked: this skill requires an active design system.
                </p>
              </Show>
            </button>
          </li>
        )}
      </For>
    </ul>
  )
}
