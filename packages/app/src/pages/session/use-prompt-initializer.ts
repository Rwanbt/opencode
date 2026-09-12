/* SPDX-License-Identifier: MIT */

import { createEffect, untrack, type Accessor } from "solid-js"

type PromptPart = { type: "text"; content: string; start: number; end: number }
type PromptInitializer = {
  ready: () => boolean
  set: (parts: PromptPart[], end: number) => void
}

type PromptSearchParams = Record<string, string | undefined>

/**
 * Side-effect hook that initialises the prompt composer from a URL
 * query param (`?prompt=...`). When the prompt is ready and no
 * session id is set, the prompt text is moved into the composer and
 * the URL search-param is cleared so refresh does not re-submit.
 *
 * Originally lifted from `session.tsx:99-108` as part of the P1-5
 * split plan (ADR-037, Vague 2). Pure effect, no return value.
 */
export function usePromptInitializer(args: {
  prompt: PromptInitializer
  hasSessionId: () => boolean
  searchParams: Accessor<PromptSearchParams>
  setSearchParams: (next: PromptSearchParams) => void
}): void {
  createEffect(() => {
    if (!args.prompt.ready()) return
    untrack(() => {
      if (args.hasSessionId()) return
      const text = args.searchParams().prompt
      if (!text) return
      args.prompt.set([{ type: "text" as const, content: text, start: 0, end: text.length }], text.length)
      args.setSearchParams({ ...args.searchParams(), prompt: undefined })
    })
  })
}
