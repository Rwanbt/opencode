/* SPDX-License-Identifier: MIT */

import { fileKind, type DesignFileKind } from "./design-files.js"
import type { WorkspaceFileEntry } from "./client.js"

/**
 * Phase 7.1 — dossier tree for the Design "Fichiers" tab.
 *
 * `listFiles` (`workspace-runtime`'s `#walkEntries`) already recurses the
 * whole workspace and reports both `kind: "file"` and `kind: "directory"`
 * entries at every depth — the flat list `DesignFilesTab` already fetches
 * (`collectFiles`) is a full recursive snapshot, not just the top level.
 * This module turns that flat, order-independent snapshot into a nested
 * tree; no new server call is needed.
 *
 * Directory nodes are built from both explicit `kind: "directory"` entries
 * (so an *empty* directory still appears) and from the parent segments of
 * every file path (defensive — a directory entry could in principle be
 * paginated apart from its children, so path segments alone must be enough
 * to reconstruct the shape).
 */

export type DesignFileTreeNode =
  | { type: "file"; path: string; name: string; kind: DesignFileKind }
  | { type: "directory"; path: string; name: string; children: readonly DesignFileTreeNode[] }

type MutableDirNode = { type: "directory"; path: string; name: string; children: MutableTreeNode[] }
type MutableTreeNode = MutableDirNode | { type: "file"; path: string; name: string; kind: DesignFileKind }

function parentPath(path: string): string {
  const index = path.lastIndexOf("/")
  return index === -1 ? "" : path.slice(0, index)
}

function baseName(path: string): string {
  return path.slice(path.lastIndexOf("/") + 1)
}

function sortNodes(nodes: MutableTreeNode[]): void {
  nodes.sort((left, right) => {
    if (left.type !== right.type) return left.type === "directory" ? -1 : 1
    return left.name.localeCompare(right.name)
  })
  for (const node of nodes) if (node.type === "directory") sortNodes(node.children)
}

/** Pure, order-independent: works no matter how `entries` is paginated/ordered. */
export function buildFileTree(entries: readonly WorkspaceFileEntry[]): readonly DesignFileTreeNode[] {
  const root: MutableDirNode = { type: "directory", path: "", name: "", children: [] }
  const directories = new Map<string, MutableDirNode>([["", root]])

  function ensureDirectory(path: string): MutableDirNode {
    const existing = directories.get(path)
    if (existing) return existing
    const node: MutableDirNode = { type: "directory", path, name: baseName(path), children: [] }
    directories.set(path, node)
    ensureDirectory(parentPath(path)).children.push(node)
    return node
  }

  for (const entry of entries) if (entry.kind === "directory" && entry.path) ensureDirectory(entry.path)
  for (const entry of entries) {
    if (entry.kind !== "file") continue
    ensureDirectory(parentPath(entry.path)).children.push({
      type: "file",
      path: entry.path,
      name: baseName(entry.path),
      kind: fileKind(entry.path),
    })
  }

  sortNodes(root.children)
  return root.children
}

/** Directory paths currently expanded — a plain path set, nothing more. */
export type DesignFilesTreeExpansion = ReadonlySet<string>

export const EMPTY_TREE_EXPANSION: DesignFilesTreeExpansion = new Set()

export function toggleTreeDirectory(state: DesignFilesTreeExpansion, path: string): DesignFilesTreeExpansion {
  const next = new Set(state)
  if (next.has(path)) next.delete(path)
  else next.add(path)
  return next
}

/**
 * Versioned like `WORKSPACE_TABS_STORAGE_KEY` (`context/workspace-tabs.ts`)
 * — `:v1` because a future change to what a "path" means here (e.g. moving
 * off POSIX-style workspace-relative paths) would need to invalidate old
 * state rather than silently misinterpret it. Scoped per workspace: two
 * open workspaces must not share which folders are expanded.
 */
const DESIGN_FILES_TREE_STORAGE_KEY_PREFIX = "unifia:design-files-tree:v1"

export function designFilesTreeStorageKey(workspaceId: string): string {
  return `${DESIGN_FILES_TREE_STORAGE_KEY_PREFIX}:${workspaceId}`
}

export function serializeTreeExpansion(state: DesignFilesTreeExpansion): string {
  return JSON.stringify([...state])
}

export function deserializeTreeExpansion(raw: string): DesignFilesTreeExpansion | null {
  try {
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed) || !parsed.every((item) => typeof item === "string")) return null
    return new Set(parsed)
  } catch {
    return null
  }
}
