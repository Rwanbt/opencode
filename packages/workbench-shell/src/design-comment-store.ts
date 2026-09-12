/* SPDX-License-Identifier: MIT */
/// <reference lib="dom" />

import type { CommentState } from "./design-comments.js"

/**
 * Phase 8.2 — persistance IndexedDB des commentaires Design.
 *
 * Réplique le pattern de `createIndexedDbDesignDraftStore` (design-draft.ts :
 * `indexedDB.open` → `onupgradeneeded` crée le store → `get`/`put` promisifiés
 * → `database.close()` dans un `finally`), mais dans sa PROPRE base
 * IndexedDB plutôt que de partager "unifia-workbench" : deux modules
 * indépendants qui ouvrent la même base avec des `onupgradeneeded`
 * différents se marchent dessus — celui qui ouvre en premier "gagne" la
 * création de son store, et le second n'a plus jamais l'occasion de créer
 * le sien tant que la version de la base ne bouge pas (IndexedDB ne
 * redéclenche `onupgradeneeded` que sur un changement de version). Une
 * base dédiée évite ce couplage sans qu'aucun des deux modules ait besoin
 * de connaître l'existence de l'autre.
 *
 * Pas de détection de conflit par révision ici, contrairement au brouillon
 * de spec : `CommentState` est un registre plat partagé par tous les
 * onglets artefact d'un même workspace, dans une seule fenêtre — il n'y a
 * pas de "deux auteurs concurrents" à arbitrer, juste "sauvegarder l'état
 * courant, le retrouver au prochain montage" (la porte de cette phase).
 */

const DATABASE_NAME = "unifia-workbench-comments"
const DATABASE_VERSION = 1
const STORE_NAME = "comment-state"

type CommentRecord = { workspaceId: string; state: CommentState }

export type CommentStore = {
  load(workspaceId: string): Promise<CommentState | undefined>
  save(workspaceId: string, state: CommentState): Promise<void>
}

function openDatabase(): Promise<IDBDatabase> {
  if (typeof indexedDB === "undefined") return Promise.reject(new Error("versioned comment storage is unavailable"))
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION)
    request.onupgradeneeded = () => request.result.createObjectStore(STORE_NAME, { keyPath: "workspaceId" })
    request.onerror = () => reject(request.error ?? new Error("could not open comment storage"))
    request.onsuccess = () => resolve(request.result)
  })
}

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onerror = () => reject(request.error ?? new Error("comment storage request failed"))
    request.onsuccess = () => resolve(request.result)
  })
}

export function createIndexedDbCommentStore(): CommentStore {
  async function load(workspaceId: string): Promise<CommentState | undefined> {
    const database = await openDatabase()
    try {
      const transaction = database.transaction(STORE_NAME, "readonly")
      const record = (await requestResult(transaction.objectStore(STORE_NAME).get(workspaceId))) as CommentRecord | undefined
      return record?.state
    } finally {
      database.close()
    }
  }

  async function save(workspaceId: string, state: CommentState): Promise<void> {
    const database = await openDatabase()
    try {
      const transaction = database.transaction(STORE_NAME, "readwrite")
      const record: CommentRecord = { workspaceId, state }
      await requestResult(transaction.objectStore(STORE_NAME).put(record))
    } finally {
      database.close()
    }
  }

  return { load, save }
}
