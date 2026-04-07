import { base64Encode } from "@opencode-ai/util/encode"

/** Accept mode: true = full auto, "auto-edit" = auto-accept edits only, false/undefined = ask */
export type AcceptMode = boolean | "auto-edit"

export function acceptKey(sessionID: string, directory?: string) {
  if (!directory) return sessionID
  return `${base64Encode(directory)}/${sessionID}`
}

export function directoryAcceptKey(directory: string) {
  return `${base64Encode(directory)}/*`
}

/** Edit-related permission types that "Auto Edit" mode auto-accepts */
const EDIT_PERMISSIONS = new Set(["edit", "write", "apply_patch", "todowrite"])

function accepted(autoAccept: Record<string, AcceptMode>, sessionID: string, directory?: string) {
  const key = acceptKey(sessionID, directory)
  const directoryKey = directory ? directoryAcceptKey(directory) : undefined
  return autoAccept[key] ?? autoAccept[sessionID] ?? (directoryKey ? autoAccept[directoryKey] : undefined)
}

export function isDirectoryAutoAccepting(autoAccept: Record<string, AcceptMode>, directory: string) {
  const key = directoryAcceptKey(directory)
  return autoAccept[key] ?? false
}

function sessionLineage(session: { id: string; parentID?: string }[], sessionID: string) {
  const parent = session.reduce((acc, item) => {
    if (item.parentID) acc.set(item.id, item.parentID)
    return acc
  }, new Map<string, string>())
  const seen = new Set([sessionID])
  const ids = [sessionID]

  for (const id of ids) {
    const parentID = parent.get(id)
    if (!parentID || seen.has(parentID)) continue
    seen.add(parentID)
    ids.push(parentID)
  }

  return ids
}

export function autoRespondsPermission(
  autoAccept: Record<string, AcceptMode>,
  session: { id: string; parentID?: string }[],
  permission: { sessionID: string; permission?: string },
  directory?: string,
) {
  const value = sessionLineage(session, permission.sessionID)
    .map((id) => accepted(autoAccept, id, directory))
    .find((item): item is AcceptMode => item !== undefined)
  if (value === undefined) return false
  if (value === true) return true
  if (value === "auto-edit") {
    // In auto-edit mode, auto-accept edit/write tools but ask for bash/shell
    const perm = permission.permission
    if (!perm) return false
    return EDIT_PERMISSIONS.has(perm)
  }
  return false
}
