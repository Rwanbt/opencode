import { Storage } from "@/storage/storage"
import type { SessionID } from "@/session/schema"
import { Collective } from "./types"

const key = (sessionID: SessionID) => ["session_debate_selection", sessionID]

export namespace DebateSelection {
  export async function get(sessionID: SessionID) {
    try {
      const value = await Storage.read<unknown>(key(sessionID))
      return Collective.DebateSelection.parse(value)
    } catch {
      return undefined
    }
  }

  export async function set(sessionID: SessionID, selection: Collective.DebateSelection) {
    await Storage.write(key(sessionID), Collective.DebateSelection.parse(selection))
    return selection
  }
}
