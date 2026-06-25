// References panel extracted from file-tabs.tsx (PLAN-EDITEUR-IDE-DEFINITIF Phase 2.5).
//
// WHY extracted: the Shift+F12 references list is a self-contained UI fed by
// `refLocations` (set by handleReferences from CM LSP callbacks). The
// uriToDisplayPath helper + the navigate handler stay in file-tabs.tsx since
// they depend on the file-tree context; this component only renders and
// emits selection events.
//
// Translation note: hardcoded "Références" preserved verbatim for behavior
// parity. i18n tracked in PLAN-EDITEUR-IDE-DEFINITIF §2 (R-code&conv).

import { For, Show } from "solid-js"
import type { LspLocation } from "@opencode-ai/ui/code-mirror-lsp"

export interface ReferencesPanelProps {
  locations: () => LspLocation[]
  onSelect: (location: LspLocation) => void
  onClose: () => void
}

export function ReferencesPanel(props: ReferencesPanelProps) {
  return (
    <Show when={props.locations().length > 0}>
      <div class="border-t border-border-weak-base bg-background-stronger flex flex-col max-h-48 overflow-y-auto shrink-0">
        <div class="flex items-center justify-between px-3 py-1.5 border-b border-border-weak-base sticky top-0 bg-background-stronger z-10">
          <span class="text-11-regular text-text-weaker uppercase tracking-wide">
            Références ({props.locations().length})
          </span>
          <button
            type="button"
            onClick={() => props.onClose()}
            class="text-10-regular text-text-weaker hover:text-text-base px-1"
          >
            ✕
          </button>
        </div>
        <For each={props.locations()}>
          {(loc) => {
            const displayPath = uriToDisplayPath(loc.uri)
            const short = displayPath.split("/").slice(-2).join("/")
            return (
              <button
                type="button"
                class="flex items-center gap-2 px-3 py-1 hover:bg-surface-base text-left w-full"
                onClick={() => props.onSelect(loc)}
              >
                <span class="text-11-regular text-text-base truncate flex-1 font-mono">{short}</span>
                <span class="text-10-regular text-text-weaker shrink-0">
                  :{loc.range.start.line + 1}:{loc.range.start.character + 1}
                </span>
              </button>
            )
          }}
        </For>
      </div>
    </Show>
  )
}

// WHY kept local: only this component renders references; the inverse
// (file:// → display path) is not needed elsewhere. If a second consumer
// appears, lift to a shared util module.
export function uriToDisplayPath(uri: string): string {
  const p = uri.startsWith("file://")
    ? decodeURIComponent(uri.slice(7).replace(/^\/([A-Z]:)/, "$1"))
    : uri
  return p.replace(/\\/g, "/")
}