import { Storage } from "@/storage/storage"
import type { SessionID } from "@/session/schema"
import z from "zod"

export const TeamModelSchema = z.object({ providerID: z.string().min(1), modelID: z.string().min(1) })

export const MAX_TEAM_MODELS = 8

export const TeamSelectionSchema = z.object({ models: z.array(TeamModelSchema).min(2).max(MAX_TEAM_MODELS) })

export const TeamSelection = z
  .object({ models: z.array(TeamModelSchema).min(2).max(MAX_TEAM_MODELS) })
  .superRefine((selection, context) => {
    const keys = new Set<string>()
    for (const [index, model] of selection.models.entries()) {
      const key = `${model.providerID}:${model.modelID}`
      if (keys.has(key)) context.addIssue({ code: "custom", path: ["models", index], message: "duplicate model" })
      keys.add(key)
    }
  })

const globalKey = ["team_selection"]
const sessionKey = (sessionID: SessionID) => ["session_team_selection", sessionID]

export namespace TeamSelectionStore {
  export async function getSession(sessionID: SessionID) {
    try {
      return TeamSelection.parse(await Storage.read<unknown>(sessionKey(sessionID)))
    } catch {
      return undefined
    }
  }

  export async function get(sessionID?: SessionID) {
    if (sessionID) {
      const selection = await getSession(sessionID)
      if (selection) return selection
    }
    try {
      return TeamSelection.parse(await Storage.read<unknown>(globalKey))
    } catch {
      return undefined
    }
  }

  export async function setGlobal(selection: z.infer<typeof TeamSelection>) {
    await Storage.write(globalKey, TeamSelection.parse(selection))
    return selection
  }

  export async function set(sessionID: SessionID, selection: z.infer<typeof TeamSelection>) {
    await Storage.write(sessionKey(sessionID), TeamSelection.parse(selection))
    return selection
  }

  export async function snapshot(sessionID: SessionID) {
    const existing = await getSession(sessionID)
    if (existing) return existing
    const selection = await get()
    if (!selection) return undefined
    await set(sessionID, selection)
    return selection
  }
}

export function orderTeamModels(
  selection: z.infer<typeof TeamSelection>,
  primary: z.infer<typeof TeamModelSchema>,
) {
  const key = `${primary.providerID}:${primary.modelID}`
  const selected = selection.models.find((model) => `${model.providerID}:${model.modelID}` === key)
  if (!selected) return selection.models
  return [selected, ...selection.models.filter((model) => `${model.providerID}:${model.modelID}` !== key)]
}
