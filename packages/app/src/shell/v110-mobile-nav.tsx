/* SPDX-License-Identifier: MIT */

// A2-03 v110 mobile nav (Wave 0.5). Props-driven, no runtime import.
// WHY props: the rail already gates automate (mode.modes) and owns the
// 4-mode registry; a second rail reading stores directly would fork the
// registry (GAP-02) and the grant gate (GAP-03). This bar renders what it
// is given: modes plus settings, nothing else, never 10 buttons.
// Phone-portrait only (RESPONSIVE-MATRIX): hidden by default, shown by
// v110-shell.css under 600px portrait. Touch targets use the A1 touch
// var (44px). Safe areas use env() so the iOS notch never covers a tab.

import { For, type Accessor, type JSX } from "solid-js"
import { Icon } from "@unifia/ui/icon"
import type { ShellMode } from "@unifia/workbench-shell/modes"

type Props = {
  modes: Accessor<readonly ShellMode[]>
  active: Accessor<ShellMode>
  onMode: (mode: ShellMode) => void
  onSettings: () => void
  navLabel: string
  modeLabel: (mode: ShellMode) => string
  settingsLabel: string
}

export function MobileNav(props: Props): JSX.Element {
  return (
    <nav
      data-v110="mobile-nav"
      data-component="v110-mobile-nav"
      aria-label={props.navLabel}
      style={{
        "padding-bottom": "env(safe-area-inset-bottom)",
        "padding-left": "env(safe-area-inset-left)",
        "padding-right": "env(safe-area-inset-right)",
      }}
    >
      <For each={props.modes()}>
        {(mode) => (
          <button
            type="button"
            data-mode={mode}
            data-v110-tab={mode}
            aria-label={props.modeLabel(mode)}
            aria-pressed={props.active() === mode}
            style={{
              width: "var(--v110-target-touch, 44px)",
              height: "var(--v110-target-touch, 44px)",
            }}
            onClick={() => props.onMode(mode)}
          >
            <Icon size="medium" name={mode === "code" ? "code" : mode === "work" ? "folder" : mode === "design" ? "edit" : "checklist"} />
          </button>
        )}
      </For>
      <button
        type="button"
        data-action="mobile-settings"
        aria-label={props.settingsLabel}
        style={{
          width: "var(--v110-target-touch, 44px)",
          height: "var(--v110-target-touch, 44px)",
        }}
        onClick={props.onSettings}
      >
        <Icon size="medium" name="settings-gear" />
      </button>
    </nav>
  )
}
