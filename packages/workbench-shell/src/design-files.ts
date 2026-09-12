/* SPDX-License-Identifier: MIT */

import type { WorkspaceFileEntry, WorkspaceFilePage } from "./client.js"

export type DesignFileKind = "asset" | "component" | "style" | "unknown"
export type DesignFile = Omit<WorkspaceFileEntry, "kind"> & { kind: DesignFileKind }
export type DesignFilesPanelState = { files: readonly DesignFile[]; selectedPath?: string }
export type DesignFileRow = { path: string; label: string; kind: DesignFileKind; selected: boolean }

export function fileKind(path: string): DesignFileKind {
  const extension = path.split(".").at(-1)?.toLowerCase()
  if (extension && ["png", "jpg", "jpeg", "gif", "webp", "svg", "ico"].includes(extension)) return "asset"
  if (extension && ["tsx", "jsx", "vue", "svelte"].includes(extension)) return "component"
  if (extension && ["css", "scss", "less", "json", "tokens"].includes(extension)) return "style"
  return "unknown"
}

/** Adapts the bounded workspace index into a stable Design file catalog. */
export function adaptDesignFiles(page: WorkspaceFilePage): readonly DesignFile[] {
  return page.entries.filter((entry) => entry.kind === "file").map((entry) => ({ ...entry, kind: fileKind(entry.path) })).sort((left, right) => left.path.localeCompare(right.path))
}

export function createDesignFilesPanelState(page: WorkspaceFilePage, selectedPath?: string): DesignFilesPanelState {
  const files = adaptDesignFiles(page)
  return { files, selectedPath: files.some((file) => file.path === selectedPath) ? selectedPath : undefined }
}

export function renderDesignFileRows(state: DesignFilesPanelState): readonly DesignFileRow[] {
  return state.files.map((file) => ({ path: file.path, label: file.path.split("/").at(-1) ?? file.path, kind: file.kind, selected: file.path === state.selectedPath }))
}

/**
 * Phase 7.3 — rename → "the open tab follows the new path". There is no
 * separate workspace tab per file here (selecting a file just sets this
 * one signal), so "follows" is exactly: if the renamed path was the
 * selected one, the selection moves to its new path; any other selection
 * is untouched.
 */
export function nextSelectedPathAfterRename(selectedPath: string | undefined, from: string, to: string): string | undefined {
  return selectedPath === from ? to : selectedPath
}

/**
 * Phase 7.3 — delete → "the tab closes cleanly if it was the active
 * file". Clearing the selection is exactly that close: `createDesignFilesPanelState`
 * already refuses to keep a `selectedPath` that isn't in the current file
 * list, so a deleted active file would self-correct on the next query
 * refresh anyway — this makes the intent explicit and immediate instead
 * of waiting on a refetch.
 */
export function nextSelectedPathAfterRemove(selectedPath: string | undefined, removedPaths: readonly string[]): string | undefined {
  return selectedPath !== undefined && removedPaths.includes(selectedPath) ? undefined : selectedPath
}
