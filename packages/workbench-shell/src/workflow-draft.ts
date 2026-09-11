/* SPDX-License-Identifier: MIT */
/// <reference lib="dom" />

const DATABASE_NAME = "unifia-workbench"
// Shares the Design draft database. Version 2 creates this independent store
// while preserving the existing version-1 design-drafts store.
const DATABASE_VERSION = 2
const STORE_NAME = "workflow-drafts"
const DESIGN_DRAFT_STORE_NAME = "design-drafts"
const RECORD_VERSION = 1

export type WorkflowDraftRecord = {
  key: string
  workspaceId: string
  definitionPath: string
  schemaVersion: typeof RECORD_VERSION
  revision: number
  source: string
  updatedAt: number
}

export class WorkflowDraftConflictError extends Error {
  readonly current: WorkflowDraftRecord

  constructor(current: WorkflowDraftRecord) {
    super("workflow draft changed in another window")
    this.name = "WorkflowDraftConflictError"
    this.current = current
  }
}

export type WorkflowDraftStore = {
  load(workspaceId: string, definitionPath: string): Promise<WorkflowDraftRecord | undefined>
  save(workspaceId: string, definitionPath: string, source: string, expectedRevision?: number): Promise<WorkflowDraftRecord>
}

export function workflowDraftKey(workspaceId: string, definitionPath: string): string {
  if (!workspaceId.trim() || !definitionPath.trim()) throw new Error("workspace id and workflow definition path are required for a draft")
  return `${workspaceId}:workflow-draft:${definitionPath}`
}

function openDatabase(): Promise<IDBDatabase> {
  if (typeof indexedDB === "undefined") return Promise.reject(new Error("versioned workflow draft storage is unavailable"))
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION)
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(DESIGN_DRAFT_STORE_NAME)) request.result.createObjectStore(DESIGN_DRAFT_STORE_NAME, { keyPath: "key" })
      if (!request.result.objectStoreNames.contains(STORE_NAME)) request.result.createObjectStore(STORE_NAME, { keyPath: "key" })
    }
    request.onerror = () => reject(request.error ?? new Error("could not open workflow draft storage"))
    request.onsuccess = () => resolve(request.result)
  })
}

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onerror = () => reject(request.error ?? new Error("workflow draft storage request failed"))
    request.onsuccess = () => resolve(request.result)
  })
}

export function createIndexedDbWorkflowDraftStore(now: () => number = Date.now): WorkflowDraftStore {
  async function load(workspaceId: string, definitionPath: string): Promise<WorkflowDraftRecord | undefined> {
    const database = await openDatabase()
    try {
      return await requestResult(database.transaction(STORE_NAME, "readonly").objectStore(STORE_NAME).get(workflowDraftKey(workspaceId, definitionPath))) as WorkflowDraftRecord | undefined
    } finally { database.close() }
  }

  async function save(workspaceId: string, definitionPath: string, source: string, expectedRevision?: number): Promise<WorkflowDraftRecord> {
    const database = await openDatabase()
    try {
      const store = database.transaction(STORE_NAME, "readwrite").objectStore(STORE_NAME)
      const current = await requestResult(store.get(workflowDraftKey(workspaceId, definitionPath))) as WorkflowDraftRecord | undefined
      if (current && expectedRevision !== undefined && current.revision !== expectedRevision) throw new WorkflowDraftConflictError(current)
      const next: WorkflowDraftRecord = { key: workflowDraftKey(workspaceId, definitionPath), workspaceId, definitionPath, schemaVersion: RECORD_VERSION, revision: (current?.revision ?? 0) + 1, source, updatedAt: now() }
      await requestResult(store.put(next))
      return next
    } finally { database.close() }
  }

  return { load, save }
}
