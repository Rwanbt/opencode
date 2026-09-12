/* SPDX-License-Identifier: MIT */

/**
 * Pure helpers shared by `WorkbenchThread` and any future thread surface
 * (e.g. an in-tab thread inside the Open Design tabs bar).
 *
 * WHY split: `WorkbenchThread` is a Solid component that depends on the app
 * context tree (`useSync`, `useLanguage`, `useSDK`, `useMode`). Pure
 * formatting and suggestion selection must be unit-testable without that
 * tree, and `WorkbenchChat` already inlines the same text-extraction
 * logic — promoting it here kills the duplication without coupling the
 * helpers to a render layer.
 */

export type ThreadMessageRole = "user" | "assistant"

export type ThreadMessage = {
  id: string
  role: ThreadMessageRole
  text: string
}

export type NextStepSuggestion = {
  id: string
  label: string
  prompt: string
}

type PartLike = { type?: string; text?: string }

/**
 * Flatten a session message's parts to a single plain-text string. Mirrors
 * the contract `MessageEnvelope` already exposes through the SDK shim:
 * only the `text` part type carries user-visible content, everything else
 * (tool calls, snapshots, file attachments) is dropped from the thread.
 *
 * `parts` is the per-message parts map (`sync.data.part[messageId]`). The
 * field is optional on the shim to allow envelopes that arrive before
 * their parts, so callers should treat `undefined` as "no text yet".
 */
export function extractMessageText(parts: readonly PartLike[] | undefined): string {
  return (parts ?? [])
    .filter((part): part is { type: string; text: string } => part.type === "text" && typeof part.text === "string")
    .map((part) => part.text)
    .join("\n")
    .trim()
}

export type RegenerateTarget = {
  /** The user message id to revert to and resend — never the assistant message itself. */
  userMessageId: string
  /** The exact text of that user message, resent verbatim via `session.prompt`. */
  userText: string
}

/**
 * Phase 10.1 — resolves what "Regenerate" must revert+resend for a given
 * assistant message: the nearest preceding `user` message in `messages`
 * (skipping over any other assistant messages in between, which can't
 * happen in a well-formed thread but costs nothing to handle correctly).
 *
 * Pure by design: the actual revert (`session.revert`) and resend
 * (`session.prompt`) are I/O and live in `WorkbenchThread`, which depends
 * on the SDK/sync context tree. This resolver is the one piece of that
 * flow with real branching logic, so it is the one piece worth testing
 * without spinning up that tree — same split as `extractMessageText`.
 *
 * Returns `undefined` when `assistantMessageId` doesn't exist, isn't an
 * assistant message, or has no preceding user message (first message in
 * the thread) — all cases where "Regenerate" has nothing to act on.
 */
export function findRegenerateTarget(
  messages: readonly ThreadMessage[],
  assistantMessageId: string,
): RegenerateTarget | undefined {
  const index = messages.findIndex((m) => m.id === assistantMessageId)
  if (index === -1) return undefined
  if (messages[index]?.role !== "assistant") return undefined
  for (let i = index - 1; i >= 0; i -= 1) {
    const candidate = messages[i]
    if (candidate?.role === "user") return { userMessageId: candidate.id, userText: candidate.text }
  }
  return undefined
}

export type PendingSendStatus = "sending" | "failed"

/**
 * Phase 10.2 — a composer submission that hasn't landed in `sync.data`
 * yet (or failed to). Purely client-side/local: a successful send is
 * removed from this list the moment `session.prompt` resolves, because
 * from then on the real message lives in `sync.data` and renders through
 * the normal `messages()` memo instead.
 */
export type PendingSend = {
  id: string
  text: string
  status: PendingSendStatus
}

/** Appends a new pending send in the "sending" state. */
export function addPendingSend(list: readonly PendingSend[], id: string, text: string): readonly PendingSend[] {
  return [...list, { id, text, status: "sending" }]
}

/**
 * Marks a pending send as failed — this is what gives it its own
 * independent Retry button. No-op (same reference) if `id` isn't in the
 * list, so two concurrent failures never clobber each other's state.
 */
export function markPendingSendFailed(list: readonly PendingSend[], id: string): readonly PendingSend[] {
  if (!list.some((p) => p.id === id)) return list
  return list.map((p) => (p.id === id ? { ...p, status: "failed" } : p))
}

/** Moves a failed send back to "sending" (Retry was clicked). No-op if `id` isn't in the list. */
export function markPendingSendRetrying(list: readonly PendingSend[], id: string): readonly PendingSend[] {
  if (!list.some((p) => p.id === id)) return list
  return list.map((p) => (p.id === id ? { ...p, status: "sending" } : p))
}

/** Removes a pending send (successful — the real message now lives in `sync.data`). No-op if `id` isn't in the list. */
export function removePendingSend(list: readonly PendingSend[], id: string): readonly PendingSend[] {
  if (!list.some((p) => p.id === id)) return list
  return list.filter((p) => p.id !== id)
}

export type ThreadRenderItem =
  | { kind: "message"; message: ThreadMessage }
  | { kind: "pending"; pending: PendingSend }
  | { kind: "next-step" }

/**
 * Phase 10.6 — flattens the message history, in-flight sends, and the
 * trailing "next step" suggestions section into ONE array so `VList`
 * (virtua's Solid adapter, in workbench-thread-list.tsx) can virtualize
 * the whole scrollable region as a single list, instead of three
 * separately-scrolling pieces. The "next-step" entry only appears once,
 * at the end, and only when there is at least one real message — same
 * condition the pre-virtualization markup used
 * (`<Show when={messages().length > 0}>`).
 *
 * Lives here (a plain .ts module with zero Solid-component imports),
 * not in workbench-thread-list.tsx itself: importing a pure function
 * from a .tsx file that pulls in `virtua/solid` and `@unifia/ui/markdown`
 * breaks bun:test's happydom resolution (verified — the component-level
 * import resolves solid-js's server build and fails with a missing `use`
 * export). Every other pure helper in this file follows the same rule.
 */
export function buildThreadRenderItems(
  messages: readonly ThreadMessage[],
  pendingSends: readonly PendingSend[],
): readonly ThreadRenderItem[] {
  const items: ThreadRenderItem[] = []
  for (const message of messages) items.push({ kind: "message", message })
  for (const pending of pendingSends) items.push({ kind: "pending", pending })
  if (messages.length > 0) items.push({ kind: "next-step" })
  return items
}

/**
 * Static, mode-keyed next-step suggestions seeded into the thread footer.
 *
 * WHY static in v1: the workbench agent (Design / Automate) is not yet
 * wired to produce a live follow-up list. Seeding the card with curated
 * prompts keeps the affordance honest — the user can see what kind of
 * follow-up the thread expects — without inventing behaviour the agent
 * does not yet have. Once the agent is hooked, this becomes a
 * `Promise<NextStepSuggestion[]>` resolved from the session.
 */
export function selectNextStepSuggestions(mode: "work" | "design" | "automate"): readonly NextStepSuggestion[] {
  switch (mode) {
    case "work":
      return WORK_NEXT_STEPS
    case "design":
      return DESIGN_NEXT_STEPS
    case "automate":
      return AUTOMATE_NEXT_STEPS
  }
}

const WORK_NEXT_STEPS: readonly NextStepSuggestion[] = [
  {
    id: "work-summarize",
    label: "Résume l'état de l'espace de travail",
    prompt: "Résume l'état de l'espace de travail actuel et identifie la prochaine action sûre.",
  },
  {
    id: "work-list-files",
    label: "Liste les fichiers modifiés récemment",
    prompt: "Liste les fichiers modifiés au cours des 24 dernières heures dans cet espace de travail.",
  },
  {
    id: "work-artifacts",
    label: "Montre les artefacts persistés",
    prompt: "Quels artefacts ont été persistés et quelles versions sont disponibles ?",
  },
]

const DESIGN_NEXT_STEPS: readonly NextStepSuggestion[] = [
  {
    id: "design-iterate",
    label: "Itère sur la spec validée",
    prompt: "Propose trois variations sur la spec validée et applique celle qui respecte la charte.",
  },
  {
    id: "design-viewports",
    label: "Vérifie les trois fenêtres d'affichage",
    prompt: "Vérifie le rendu sur les trois fenêtres (desktop, tablette, mobile) et signale les débordements.",
  },
  {
    id: "design-export",
    label: "Exporte le rendu en SVG autonome",
    prompt: "Exporte le rendu courant en SVG autonome prêt à partager.",
  },
]

const AUTOMATE_NEXT_STEPS: readonly NextStepSuggestion[] = [
  {
    id: "automate-draft",
    label: "Propose un brouillon de workflow",
    prompt: "Propose un brouillon de workflow sûr pour la prochaine action approuvée.",
  },
  {
    id: "automate-list",
    label: "Liste les définitions disponibles",
    prompt: "Liste les définitions de workflow disponibles dans cet espace de travail.",
  },
  {
    id: "automate-approval",
    label: "Vérifie les portes d'approbation",
    prompt: "Décris les portes d'approbation de chaque définition de workflow active.",
  },
]
