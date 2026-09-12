import type { ModelKey } from "@/context/local"

export const MAX_TEAM_MODELS = 8

// WHY: mirrors the server schema (`TeamSelection` in packages/opencode/src/team/selection.ts),
// which rejects anything below this with HTTP 400. Any UI that persists a selection has to
// know the minimum, otherwise every intermediate state it saves is an invalid request.
export const MIN_TEAM_MODELS = 2

export type TeamSelection = { models: ModelKey[] }

export function teamModelKey(model: ModelKey) {
  return `${model.providerID}:${model.modelID}`
}

// WHY: the server answers unknown API routes with the SPA fallback — HTTP 200 and
// `Content-Type: text/html` — so the generated SDK client parses the body as text and
// hands back an HTML string in `data` instead of an error. A sidecar older than the
// `/team/config` route therefore looks like a successful response. Treat everything
// crossing that boundary as `unknown` until it is proven to be a TeamSelection.
export function normalizeTeamSelection(value: unknown): TeamSelection | undefined {
  if (typeof value !== "object" || value === null) return undefined
  const models = (value as { models?: unknown }).models
  if (!Array.isArray(models) || models.length > MAX_TEAM_MODELS) return undefined

  const normalized: ModelKey[] = []
  for (const entry of models) {
    if (typeof entry !== "object" || entry === null) return undefined
    const { providerID, modelID } = entry as { providerID?: unknown; modelID?: unknown }
    if (typeof providerID !== "string" || providerID.length === 0) return undefined
    if (typeof modelID !== "string" || modelID.length === 0) return undefined
    normalized.push({ providerID, modelID })
  }
  return { models: normalized }
}

export type TeamTogglePlan =
  | { action: "reject"; reason: "minimum" | "maximum" }
  | { action: "stage"; models: ModelKey[] }
  | { action: "persist"; models: ModelKey[] }

// Decides what one toggle in the Team model selector must do. Pure on purpose: the
// component cannot express the trap this encodes. `selected()` only advances after a
// successful save, so persisting a sub-minimal selection is unrecoverable — the server
// answers 400, the local state never moves, and the next toggle repeats it forever.
// Reaching MIN_TEAM_MODELS requires passing through a smaller selection, so that
// intermediate state has to be staged locally rather than sent.
export function planTeamToggle(current: readonly ModelKey[], model: ModelKey): TeamTogglePlan {
  const key = teamModelKey(model)
  const removing = current.some((item) => teamModelKey(item) === key)

  if (removing && current.length === MIN_TEAM_MODELS) return { action: "reject", reason: "minimum" }
  if (!removing && current.length >= MAX_TEAM_MODELS) return { action: "reject", reason: "maximum" }

  const models = removing
    ? current.filter((item) => teamModelKey(item) !== key)
    : [...current, { providerID: model.providerID, modelID: model.modelID }]

  return models.length < MIN_TEAM_MODELS ? { action: "stage", models } : { action: "persist", models }
}

// A saved selection can outlive the connectivity of some of its models (a
// provider's auth expires, a model is retired). Requiring every entry to
// still be connected would invalidate the whole selection over one stale
// entry, even with plenty of working models left — so this only requires
// that at least two DISTINCT entries are currently available, not that all
// of them are.
export function validateTeamSelection(selection: TeamSelection | undefined, available: ReadonlySet<string>) {
  if (!selection || !Array.isArray(selection.models) || selection.models.length < MIN_TEAM_MODELS || selection.models.length > MAX_TEAM_MODELS) return false
  const keys = selection.models.map(teamModelKey)
  if (new Set(keys).size !== keys.length) return false
  return keys.filter((key) => available.has(key)).length >= MIN_TEAM_MODELS
}
