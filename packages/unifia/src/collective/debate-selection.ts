import { Storage } from "@/storage/storage"
import type { SessionID } from "@/session/schema"
import { Collective } from "./types"

const globalKey = ["debate_selection"]
const sessionKey = (sessionID: SessionID) => ["session_debate_selection", sessionID]

export namespace DebateSelection {
  export async function get(sessionID?: SessionID) {
    if (sessionID) {
      try {
        const value = await Storage.read<unknown>(sessionKey(sessionID))
        return Collective.DebateSelection.parse(value)
      } catch {}
    }
    return getGlobal()
  }

  export async function getGlobal() {
    try {
      const value = await Storage.read<unknown>(globalKey)
      return Collective.DebateSelection.parse(value)
    } catch {
      return undefined
    }
  }

  export async function set(sessionID: SessionID, selection: Collective.DebateSelection) {
    await Storage.write(sessionKey(sessionID), Collective.DebateSelection.parse(selection))
    return selection
  }

  export async function setGlobal(selection: Collective.DebateSelection) {
    await Storage.write(globalKey, Collective.DebateSelection.parse(selection))
    return selection
  }
}