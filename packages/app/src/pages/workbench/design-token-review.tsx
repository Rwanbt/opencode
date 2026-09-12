/* SPDX-License-Identifier: MIT */

import { For, type JSX } from "solid-js"
import type { DesignSystemTokens } from "@unifia/contracts"

export type DesignCatalogSummary = {
  id: string
  name: string
  version: string
  source: string
  tokens: DesignSystemTokens
}

export function TokenReview(props: {
  catalog: DesignCatalogSummary
  onAdd: (catalogId: string, elementId: string) => void
}): JSX.Element {
  const groups: readonly [keyof DesignSystemTokens, string][] = [
    ["colors", "Colors"],
    ["spacing", "Spacing"],
    ["typography", "Typography"],
  ]
  return (
    <div class="mt-4 space-y-3" data-design-token-review>
      <h3 class="text-12-medium uppercase tracking-wide text-text-weak">Token review</h3>
      <For each={groups}>
        {([group, label]) => (
          <section data-design-token-group={group}>
            <h4 class="text-12-medium">{label}</h4>
            <ul class="mt-1 space-y-1">
              <For each={Object.entries(props.catalog.tokens[group])}>
                {([key, value]) => {
                  const elementId = `${group}.${key}`
                  return (
                    <li class="flex items-center justify-between gap-2 text-12-regular" data-design-token={elementId}>
                      <code>{elementId}</code>
                      <span class="truncate text-text-weak">{String(value)}</span>
                      <button
                        type="button"
                        class="shrink-0 rounded border border-border-base px-2 py-0.5"
                        data-design-token-add={elementId}
                        onClick={() => props.onAdd(props.catalog.id, elementId)}
                      >
                        Ajouter
                      </button>
                    </li>
                  )
                }}
              </For>
            </ul>
          </section>
        )}
      </For>
    </div>
  )
}
