// FORK: ADR-0005 — Dual-mode Agent ⇄ IDE layout effect.
// Called once per session mount. Reacts to settings.general.viewMode()
// changes and adjusts the side-panel state automatically. Uses defer:true
// so the initial persisted value is left as-is without a layout reset on
// every page load — the user's last explicit layout state is preserved.
import { createEffect, on } from "solid-js"
import { useLayout } from "@/context/layout"
import { useSettings } from "@/context/settings"

export function useViewMode() {
  const layout = useLayout()
  const settings = useSettings()

  createEffect(
    on(
      settings.general.viewMode,
      (mode, prev) => {
        if (mode === "ide") {
          // IDE mode: open the Explorer tab and show all files.
          layout.inspector.setTab("explorer")
          layout.inspector.open()
          layout.inspector.setExplorerView("all")
        } else if (prev === "ide") {
          // Returning from IDE to Agent: close the inspector (agent-centric
          // layout defaults to full-width chat) and restore the changed-files view.
          layout.inspector.close()
          layout.inspector.setExplorerView("changed")
        }
      },
      { defer: true },
    ),
  )

  return { viewMode: settings.general.viewMode }
}
