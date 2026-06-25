import type { FileNode } from "../../types/sdk-shim"

type WatcherEvent = {
  type: string
  properties: unknown
}

type WatcherOps = {
  normalize: (input: string) => string
  hasFile: (path: string) => boolean
  isOpen?: (path: string) => boolean
  loadFile: (path: string) => void
  node: (path: string) => FileNode | undefined
  isDirLoaded: (path: string) => boolean
  refreshDir: (path: string) => void
}

export function invalidateFromWatcher(event: WatcherEvent, ops: WatcherOps) {
  if (event.type !== "file.watcher.updated") return
  const props =
    typeof event.properties === "object" && event.properties ? (event.properties as Record<string, unknown>) : undefined
  const rawPath = typeof props?.file === "string" ? props.file : undefined
  const kind = typeof props?.event === "string" ? props.event : undefined
  if (!rawPath) return
  if (!kind) return

  const path = ops.normalize(rawPath)
  if (!path) return
  // WHY: backend paths can use native separators ("\\" on win32); match either.
  if (path.startsWith(".git/") || path.startsWith(".git\\")) return

  if (ops.hasFile(path) || ops.isOpen?.(path)) {
    ops.loadFile(path)
  }

  if (kind === "change") {
    const node = ops.node(path)
    if (node?.type === "directory") {
      if (ops.isDirLoaded(path)) ops.refreshDir(path)
    } else {
      // WHY: backend paths can use native separators ("\\" on win32); split on
      // either so the parent path is computed correctly instead of "" (which
      // would trigger a full root refresh).
      const parent = path.split(/[/\\]/).slice(0, -1).join("/")
      if (ops.isDirLoaded(parent)) ops.refreshDir(parent)
    }
    return
  }
  if (kind !== "add" && kind !== "unlink") return

  const parent = path.split(/[/\\]/).slice(0, -1).join("/")
  if (ops.isDirLoaded(parent)) ops.refreshDir(parent)
}
