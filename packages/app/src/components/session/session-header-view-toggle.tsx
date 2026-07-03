// FORK: ADR-0005 — Dual-mode Agent ⇄ IDE toggle.
// Renders as a compact segmented pill in the session header titlebar.
// Persisted in settings.general.viewMode so the choice survives page reload.
import { useSettings } from "@/context/settings"

export function SessionHeaderViewToggle() {
  const settings = useSettings()
  const isIDE = () => settings.general.viewMode() === "ide"

  return (
    <div
      class="flex h-[24px] items-center rounded-md border border-border-weak-base bg-surface-panel overflow-hidden text-12-regular select-none"
      role="group"
      aria-label="View mode"
    >
      <button
        type="button"
        class="px-2 h-full transition-colors"
        classList={{
          "bg-background-stronger text-text-strong font-medium": !isIDE(),
          "text-text-weak hover:text-text-base": isIDE(),
        }}
        onClick={() => settings.general.setViewMode("agent")}
        aria-pressed={!isIDE()}
      >
        Agent
      </button>
      <div class="w-px h-3 bg-border-weak-base shrink-0" aria-hidden />
      <button
        type="button"
        class="px-2 h-full transition-colors"
        classList={{
          "bg-background-stronger text-text-strong font-medium": isIDE(),
          "text-text-weak hover:text-text-base": !isIDE(),
        }}
        onClick={() => settings.general.setViewMode("ide")}
        aria-pressed={isIDE()}
      >
        IDE
      </button>
    </div>
  )
}
