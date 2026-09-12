/* SPDX-License-Identifier: MIT */
/// <reference lib="dom" />

const DATABASE_NAME = "unifia-workbench"
const DATABASE_VERSION = 1
const STORE_NAME = "design-drafts"
const RECORD_VERSION = 1

export type DesignDraftRecord = {
  key: string
  workspaceId: string
  schemaVersion: typeof RECORD_VERSION
  revision: number
  source: string
  updatedAt: number
}

export class DesignDraftConflictError extends Error {
  readonly current: DesignDraftRecord

  constructor(current: DesignDraftRecord) {
    super("design draft changed in another window")
    this.name = "DesignDraftConflictError"
    this.current = current
  }
}

export type DesignDraftStore = {
  load(workspaceId: string): Promise<DesignDraftRecord | undefined>
  save(workspaceId: string, source: string, expectedRevision?: number): Promise<DesignDraftRecord>
}

export function designDraftKey(workspaceId: string): string {
  if (!workspaceId.trim()) throw new Error("workspace id is required for a design draft")
  return `${workspaceId}:design-draft`
}

export function createDesignDraftRecord(workspaceId: string, source: string, revision: number, updatedAt: number): DesignDraftRecord {
  if (!Number.isSafeInteger(revision) || revision < 0) throw new Error("draft revision must be a non-negative integer")
  return { key: designDraftKey(workspaceId), workspaceId, schemaVersion: RECORD_VERSION, revision, source, updatedAt }
}

function openDatabase(): Promise<IDBDatabase> {
  if (typeof indexedDB === "undefined") return Promise.reject(new Error("versioned design draft storage is unavailable"))
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION)
    request.onupgradeneeded = () => request.result.createObjectStore(STORE_NAME, { keyPath: "key" })
    request.onerror = () => reject(request.error ?? new Error("could not open design draft storage"))
    request.onsuccess = () => resolve(request.result)
  })
}

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onerror = () => reject(request.error ?? new Error("design draft storage request failed"))
    request.onsuccess = () => resolve(request.result)
  })
}

export function createIndexedDbDesignDraftStore(now: () => number = Date.now): DesignDraftStore {
  async function load(workspaceId: string): Promise<DesignDraftRecord | undefined> {
    const database = await openDatabase()
    try {
      const transaction = database.transaction(STORE_NAME, "readonly")
      return await requestResult(transaction.objectStore(STORE_NAME).get(designDraftKey(workspaceId))) as DesignDraftRecord | undefined
    } finally {
      database.close()
    }
  }

  async function save(workspaceId: string, source: string, expectedRevision?: number): Promise<DesignDraftRecord> {
    const database = await openDatabase()
    try {
      const transaction = database.transaction(STORE_NAME, "readwrite")
      const store = transaction.objectStore(STORE_NAME)
      const current = await requestResult(store.get(designDraftKey(workspaceId))) as DesignDraftRecord | undefined
      if (current && expectedRevision !== undefined && current.revision !== expectedRevision) throw new DesignDraftConflictError(current)
      const next = createDesignDraftRecord(workspaceId, source, (current?.revision ?? 0) + 1, now())
      await requestResult(store.put(next))
      return next
    } finally {
      database.close()
    }
  }

  return { load, save }
}
