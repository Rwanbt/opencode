/* SPDX-License-Identifier: MIT */
/// <reference lib="dom" />

import type { AnnotationState } from "./design-annotation.js"

/**
 * Phase 9.1 — persistance IndexedDB des traits de dessin.
 *
 * Même forme que `createIndexedDbCommentStore` (8.2), y compris sa
 * propre base dédiée pour la même raison (deux modules indépendants qui
 * partageraient une base avec des `onupgradeneeded` différents se
 * marchent dessus). Différence de portée : les commentaires sont un
 * registre plat par WORKSPACE ; un trait de dessin n'a de sens que
 * rapporté au rendu d'un ARTEFACT précis, donc la clé est `artifactId`,
 * pas `workspaceId`.
 */

const DATABASE_NAME = "unifia-workbench-annotations"
const DATABASE_VERSION = 1
const STORE_NAME = "annotation-state"

type AnnotationRecord = { artifactId: string; state: AnnotationState }

export type AnnotationStore = {
  load(artifactId: string): Promise<AnnotationState | undefined>
  save(artifactId: string, state: AnnotationState): Promise<void>
}

function openDatabase(): Promise<IDBDatabase> {
  if (typeof indexedDB === "undefined") return Promise.reject(new Error("versioned annotation storage is unavailable"))
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION)
    request.onupgradeneeded = () => request.result.createObjectStore(STORE_NAME, { keyPath: "artifactId" })
    request.onerror = () => reject(request.error ?? new Error("could not open annotation storage"))
    request.onsuccess = () => resolve(request.result)
  })
}

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onerror = () => reject(request.error ?? new Error("annotation storage request failed"))
    request.onsuccess = () => resolve(request.result)
  })
}

export function createIndexedDbAnnotationStore(): AnnotationStore {
  async function load(artifactId: string): Promise<AnnotationState | undefined> {
    const database = await openDatabase()
    try {
      const transaction = database.transaction(STORE_NAME, "readonly")
      const record = (await requestResult(transaction.objectStore(STORE_NAME).get(artifactId))) as AnnotationRecord | undefined
      return record?.state
    } finally {
      database.close()
    }
  }

  async function save(artifactId: string, state: AnnotationState): Promise<void> {
    const database = await openDatabase()
    try {
      const transaction = database.transaction(STORE_NAME, "readwrite")
      const record: AnnotationRecord = { artifactId, state }
      await requestResult(transaction.objectStore(STORE_NAME).put(record))
    } finally {
      database.close()
    }
  }

  return { load, save }
}
