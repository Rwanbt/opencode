/* SPDX-License-Identifier: MIT */

import { For, Show, createMemo, type JSX } from "solid-js"
import { VList } from "virtua/solid"
import { Markdown } from "@unifia/ui/markdown"
import type { useLanguage } from "@/context/language"
import {
  buildThreadRenderItems,
  type NextStepSuggestion,
  type PendingSend,
  type ThreadMessage,
  type ThreadRenderItem,
} from "@/pages/workbench/workbench-thread-shared"

/**
 * Phase 10.6 — virtualized message history for `WorkbenchThread`.
 *
 * WHY `virtua`, not `@tanstack/solid-virtual` (the plan's original
 * wording): verified by reading every package.json under packages/app
 * and packages/workbench-shell — `@tanstack/solid-virtual` isn't a
 * dependency anywhere in this repo, only mentioned in a stray planning
 * doc. `virtua` IS an actual dependency (`packages/app/package.json`)
 * with zero real consumers before this — this is its first real use.
 * `VList` auto-measures item height, which matters here: assistant
 * messages render Markdown at wildly different heights, and a
 * fixed-itemSize virtualizer would need every item pre-measured or
 * would jump on scroll.
 *
 * Extracted out of `workbench-thread.tsx` (which had grown past the
 * ≤500 LOC target across phases 10.1-10.5) rather than inlined, so the
 * message-rendering concern — now driven by `VList`'s render-prop
 * shape instead of a plain `<For>` — has its own file and its own
 * (small, pure) test surface (`buildThreadRenderItems`).
 */
export function WorkbenchThreadList(props: {
  messages: readonly ThreadMessage[]
  pendingSends: readonly PendingSend[]
  lastAssistantId: string | undefined
  feedback: Record<string, "like" | "dislike" | undefined>
  regenerating: boolean
  suggestions: readonly NextStepSuggestion[]
  t: ReturnType<typeof useLanguage>["t"]
  onCopy: (messageId: string, text: string) => void
  onRegenerate: (assistantMessageId: string) => void
  onRate: (messageId: string, value: "like" | "dislike") => void
  onRetryPending: (id: string) => void
  onApplySuggestion: (suggestion: NextStepSuggestion) => void
}): JSX.Element {
  const items = createMemo(() => buildThreadRenderItems(props.messages, props.pendingSends))

  return (
    <div class="flex-1 min-h-0" data-workbench-thread-history aria-live="polite">
      <Show
        when={items().length > 0}
        fallback={
          <p class="px-4 py-3 text-12-regular text-text-weak" data-workbench-thread-empty>
            Démarre la conversation par un message. Le fil reste affiché quand tu changes de mode.
          </p>
        }
      >
        <VList data={items() as ThreadRenderItem[]} class="h-full overflow-y-auto px-4 py-3">
          {(item) => (
            <div class="pb-6">
              <Show when={item.kind === "message" ? item.message : undefined}>
                {(message) => (
                  <div data-workbench-thread-message={message().role}>
                    <Show
                      when={message().role === "user"}
                      fallback={
                        <div data-component="assistant-message" data-workbench-thread-message-body>
                          <div data-component="text-part">
                            <div data-slot="text-part-body">
                              <Markdown text={message().text} cacheKey={message().id} />
                            </div>
                            <Show when={message().id === props.lastAssistantId}>
                              <div data-slot="text-part-copy-wrapper" data-workbench-thread-execution>
                                <button
                                  type="button"
                                  class="rounded border border-border-base px-2 py-1 text-12-regular"
                                  data-workbench-thread-action="copy"
                                  onClick={() => props.onCopy(message().id, message().text)}
                                >
                                  Copier
                                </button>
                                <button
                                  type="button"
                                  class="rounded border border-border-base px-2 py-1 text-12-regular disabled:opacity-50"
                                  data-workbench-thread-action="regenerate"
                                  title="Régénérer la réponse"
                                  disabled={props.regenerating}
                                  onClick={() => props.onRegenerate(message().id)}
                                >
                                  Régénérer
                                </button>
                                <button
                                  type="button"
                                  class="rounded border border-border-base px-2 py-1 text-12-regular"
                                  classList={{ "border-border-focus": props.feedback[message().id] === "like" }}
                                  data-workbench-thread-action="like"
                                  aria-pressed={props.feedback[message().id] === "like"}
                                  onClick={() => props.onRate(message().id, "like")}
                                  title="Réponse utile"
                                >
                                  👍
                                </button>
                                <button
                                  type="button"
                                  class="rounded border border-border-base px-2 py-1 text-12-regular"
                                  classList={{ "border-border-focus": props.feedback[message().id] === "dislike" }}
                                  data-workbench-thread-action="dislike"
                                  aria-pressed={props.feedback[message().id] === "dislike"}
                                  onClick={() => props.onRate(message().id, "dislike")}
                                  title="Réponse à améliorer"
                                >
                                  👎
                                </button>
                              </div>
                            </Show>
                          </div>
                        </div>
                      }
                    >
                      <div data-component="user-message" data-workbench-thread-message-body>
                        <div data-slot="user-message-body">
                          <div data-slot="user-message-text">{message().text}</div>
                        </div>
                        <div data-slot="user-message-copy-wrapper">
                          <span data-slot="user-message-meta">{props.t("workbench.chat.you")}</span>
                        </div>
                      </div>
                    </Show>
                  </div>
                )}
              </Show>
              <Show when={item.kind === "pending" ? item.pending : undefined}>
                {(pending) => (
                  <div data-workbench-thread-message="user" data-workbench-thread-pending={pending().status}>
                    <div data-component="user-message" data-workbench-thread-message-body>
                      <div data-slot="user-message-body">
                        <div data-slot="user-message-text">{pending().text}</div>
                      </div>
                      <div data-slot="user-message-copy-wrapper">
                        <span data-slot="user-message-meta">{props.t("workbench.chat.you")}</span>
                      </div>
                    </div>
                    <Show when={pending().status === "failed"}>
                      <div class="mt-1 flex items-center gap-2" data-workbench-thread-pending-error>
                        <p class="text-12-regular text-text-danger" role="alert">
                          {props.t("workbench.chat.sendFailed")}
                        </p>
                        <button
                          type="button"
                          class="rounded border border-border-base px-2 py-1 text-12-regular"
                          data-workbench-thread-action="retry"
                          onClick={() => props.onRetryPending(pending().id)}
                        >
                          {props.t("workbench.chat.retry")}
                        </button>
                      </div>
                    </Show>
                  </div>
                )}
              </Show>
              <Show when={item.kind === "next-step"}>
                <section
                  class="rounded-md border border-border-weak-base bg-background-stronger p-3"
                  data-workbench-thread-next-step
                >
                  <p class="text-12-medium text-text-weak">Étapes suivantes</p>
                  <p class="mt-1 text-12-regular text-text-weak">
                    Quelques suggestions pour continuer la conversation.
                  </p>
                  <ul class="mt-2 flex flex-col gap-1">
                    <For each={props.suggestions}>
                      {(suggestion) => (
                        <li>
                          <button
                            type="button"
                            class="w-full rounded border border-border-base bg-background-base px-2 py-1 text-left text-12-regular"
                            data-workbench-thread-next-step-suggestion={suggestion.id}
                            onClick={() => props.onApplySuggestion(suggestion)}
                          >
                            {suggestion.label}
                          </button>
                        </li>
                      )}
                    </For>
                  </ul>
                </section>
              </Show>
            </div>
          )}
        </VList>
      </Show>
    </div>
  )
}
