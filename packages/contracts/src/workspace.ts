/* SPDX-License-Identifier: MIT */
/**
 * WorkspacePort — abstraction sur le storage des workspaces
 *
 * ADR-0002
 * Source : Plan V3 §7.2
 */
export type WorkspaceId = string
export type ProjectId = string
export type SessionId = string
export type FileSessionId = string

export interface Workspace {
  id: WorkspaceId
  name: string
  path: string
  createdAt: number
  updatedAt: number
}

export interface WorkspaceHandle {
  id: WorkspaceId
  token: string
}

export interface FileReadResult {
  path: string
  content: string | Uint8Array
  mime: string
  size: number
}

export interface FileWrite {
  path: string
  content: string | Uint8Array
  metadata?: Record<string, string>
}

export interface FileWriteResult {
  path: string
  bytesWritten: number
  sha: string
}

/**
 * `removed: false` means the path was already gone — remove() is
 * idempotent (deleting a file twice is not an error), matching
 * `createArtifact`'s idempotency posture rather than `read`/`write`'s
 * "must exist" one.
 */
export interface FileRemoveResult {
  path: string
  removed: boolean
}

export interface FileEvent {
  sequence?: number
  type: "created" | "modified" | "deleted" | "renamed"
  path: string
  timestamp: number
}

export interface WorkspaceEntry {
  path: string
  kind: "file" | "directory"
  size: number
  modifiedAt: number
}

/**
 * FUNC-004/C5-1: `list()` is paginated instead of throwing past a quota.
 * `nextCursor` is opaque and bound to the workspace + prefix that produced
 * it — passing it back with a different prefix (or against a different
 * workspace's session) is refused, not silently reinterpreted. `skipped`
 * counts entries omitted because their real path resolved outside the
 * workspace root (a symlink/junction escape) — the listing completes
 * instead of aborting.
 */
export interface WorkspaceListPage {
  entries: readonly WorkspaceEntry[]
  nextCursor?: string
  skipped: number
}

export interface WorkspacePort {
  register(input: { name: string; path: string }): Promise<Workspace>
  open(id: WorkspaceId): Promise<WorkspaceHandle>
  read(session: FileSessionId, paths: string[]): Promise<FileReadResult[]>
  write(session: FileSessionId, writes: FileWrite[]): Promise<FileWriteResult[]>
  /** Refuses (not an upsert) if any target already exists — a distinct primitive from write(), mirroring createArtifact vs "modify an artifact". */
  create(session: FileSessionId, creates: FileWrite[]): Promise<FileWriteResult[]>
  /** Idempotent: a path that doesn't exist reports `removed: false`, not an error. */
  remove(session: FileSessionId, paths: string[]): Promise<FileRemoveResult[]>
  /** Refuses if `to` already exists — a silent overwrite-by-rename would lose data with no undo. */
  rename(session: FileSessionId, from: string, to: string): Promise<FileWriteResult>
  list(session: FileSessionId, prefix?: string, cursor?: string): Promise<WorkspaceListPage>
  search(session: FileSessionId, query: string, prefix?: string): Promise<readonly WorkspaceEntry[]>
  watch(session: FileSessionId): AsyncIterable<FileEvent>
  close(session: FileSessionId): Promise<void>
}
