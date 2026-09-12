// =============================================================================
// components/team/model-selector.tsx — TEAM-M01
//
// The shared registry-backed model selector.
//
// It offers two distinct actions, because they are two distinct requests:
// picking a model for this session, and making it the saved default. A selector
// that only had one control would have to guess which one the user meant, and
// whichever it guessed would be wrong half the time.
//
// Labels arrive as props for the reason given in collection-view.tsx.
// =============================================================================

import { For, Show } from "solid-js"
import { selectionKey, type Selection, type SelectionSource } from "@/context/team"

export interface ModelOption {
  readonly providerID: string
  readonly modelID: string
  readonly label: string
}

export interface SelectorLabels {
  readonly title: string
  /** Explains that the current pick applies to this session only. */
  readonly sessionOnly: string
  /** The control that promotes the session pick to the saved default. */
  readonly saveDefault: string
  /** The control that drops the session pick and returns to the saved default. */
  readonly clearOverride: string
  /**
   * Shown when the resolved selection names a model the registry no longer
   * has. Receives the key so the user can see which one went missing.
   */
  readonly missing: (key: string) => string
}

export interface ModelSelectorProps {
  readonly options: readonly ModelOption[]
  readonly selected: Selection | undefined
  readonly source: SelectionSource
  readonly labels: SelectorLabels
  readonly onPick: (selection: Selection) => void
  readonly onSaveDefault: (selection: Selection) => void
  readonly onClearOverride: () => void
  /**
   * The selection that was asked for but could not be honoured, if any. The
   * context reports it rather than dropping it silently, and the selector is
   * where the user finds out.
   */
  readonly rejected?: Selection
}

export function ModelSelector(props: ModelSelectorProps) {
  const isOverridden = () => props.source === "override"

  return (
    <div class="flex flex-col gap-2">
      <p class="text-11-medium text-text-weak px-2">{props.labels.title}</p>

      <Show when={props.rejected}>
        {(rejected) => (
          <p role="alert" class="text-11-regular text-text-danger px-2">
            {props.labels.missing(selectionKey(rejected()))}
          </p>
        )}
      </Show>

      <ul class="flex flex-col gap-px" role="listbox">
        <For each={props.options}>
          {(option) => {
            const current = () =>
              props.selected?.providerID === option.providerID && props.selected?.modelID === option.modelID
            return (
              <li>
                <button
                  type="button"
                  role="option"
                  aria-selected={current()}
                  // 44px rows: on a phone the model list is the one place a
                  // mis-tap silently changes which model answers the next
                  // prompt, and the user has no way to notice.
                  class="w-full text-left text-11-regular px-2 min-h-11 rounded hover:bg-surface-base"
                  classList={{ "bg-surface-base text-text-base": current(), "text-text-weak": !current() }}
                  onClick={() => props.onPick({ providerID: option.providerID, modelID: option.modelID })}
                >
                  {option.label}
                </button>
              </li>
            )
          }}
        </For>
      </ul>

      <Show when={isOverridden() && props.selected}>
        {(selected) => (
          <div class="flex items-center gap-2 px-2">
            <span class="text-10-regular text-text-weaker">{props.labels.sessionOnly}</span>
            <button
              type="button"
              class="text-10-regular text-text-weak hover:text-text-base underline px-2 min-h-11"
              onClick={() => props.onSaveDefault(selected())}
            >
              {props.labels.saveDefault}
            </button>
            <button
              type="button"
              class="text-10-regular text-text-weak hover:text-text-base underline px-2 min-h-11"
              onClick={() => props.onClearOverride()}
            >
              {props.labels.clearOverride}
            </button>
          </div>
        )}
      </Show>
    </div>
  )
}
