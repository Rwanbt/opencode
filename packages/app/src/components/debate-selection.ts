export type DebateModel = {
  providerID: string
  modelID: string
}

export type DebateSelection = {
  primary: DebateModel
  participants: DebateModel[]
}

export type DebateSelectionError = "missing-primary" | "too-few-participants" | "duplicate-participant" | "primary-selected" | "unavailable-model"

export function validateDebateSelection(
  selection: DebateSelection | undefined,
  available: ReadonlySet<string>,
): DebateSelectionError | undefined {
  if (!selection || !available.has(modelKey(selection.primary))) return "missing-primary"
  if (selection.participants.length < 1) return "too-few-participants"

  const seen = new Set<string>()
  for (const participant of selection.participants) {
    const key = modelKey(participant)
    if (!available.has(key)) return "unavailable-model"
    if (key === modelKey(selection.primary)) return "primary-selected"
    if (seen.has(key)) return "duplicate-participant"
    seen.add(key)
  }
}

export function modelKey(model: DebateModel) {
  return `${model.providerID}:${model.modelID}`
}

export function withCurrentPrimary(selection: DebateSelection, primary: DebateModel): DebateSelection {
  return { primary, participants: selection.participants.map((participant) => ({ ...participant })) }
}
