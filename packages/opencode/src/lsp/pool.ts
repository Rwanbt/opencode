import { Log } from "../util/log"
import type { LSPClient } from "./client"

const log = Log.create({ service: "lsp.pool" })

export namespace LSPPool {
  export interface Config {
    maxConcurrent: number
    idleTimeoutMs: number
    maxMemoryMB?: number
  }

  export interface Entry {
    client: LSPClient.Info
    serverID: string
    root: string
    lastUsed: number
    idleTimer?: ReturnType<typeof setTimeout>
  }

  export interface Pool {
    readonly config: Config
    track(client: LSPClient.Info, serverID: string, root: string): void
    touch(serverID: string, root: string): void
    evictLRU(): Promise<Entry | undefined>
    shutdown(serverID: string, root: string): Promise<void>
    shutdownAll(): Promise<void>
    activeCount(): number
    atCapacity(): boolean
    entries(): Entry[]
    onEvict: (fn: (entry: Entry) => void) => void
  }

  export function create(config: Config): Pool {
    const pool = new Map<string, Entry>()
    const evictListeners: ((entry: Entry) => void)[] = []

    function key(serverID: string, root: string) {
      return root + serverID
    }

    function resetIdleTimer(entry: Entry) {
      if (entry.idleTimer) clearTimeout(entry.idleTimer)
      if (config.idleTimeoutMs <= 0) return
      entry.idleTimer = setTimeout(async () => {
        log.info("idle timeout, shutting down LSP", {
          serverID: entry.serverID,
          root: entry.root,
        })
        await shutdownEntry(entry)
      }, config.idleTimeoutMs)
    }

    async function shutdownEntry(entry: Entry) {
      const k = key(entry.serverID, entry.root)
      if (entry.idleTimer) clearTimeout(entry.idleTimer)
      pool.delete(k)
      for (const fn of evictListeners) fn(entry)
      try {
        await entry.client.shutdown()
      } catch (err) {
        log.warn("failed to shutdown LSP client", { serverID: entry.serverID, error: err })
      }
    }

    return {
      config,

      track(client, serverID, root) {
        const k = key(serverID, root)
        if (pool.has(k)) return
        const entry: Entry = {
          client,
          serverID,
          root,
          lastUsed: Date.now(),
        }
        pool.set(k, entry)
        resetIdleTimer(entry)
        log.info("tracking LSP client", {
          serverID,
          active: pool.size,
          max: config.maxConcurrent,
        })
      },

      touch(serverID, root) {
        const entry = pool.get(key(serverID, root))
        if (!entry) return
        entry.lastUsed = Date.now()
        resetIdleTimer(entry)
      },

      async evictLRU() {
        if (pool.size === 0) return undefined
        let oldest: Entry | undefined
        for (const entry of pool.values()) {
          if (!oldest || entry.lastUsed < oldest.lastUsed) {
            oldest = entry
          }
        }
        if (!oldest) return undefined
        log.info("evicting LRU LSP", {
          serverID: oldest.serverID,
          root: oldest.root,
          idle: Date.now() - oldest.lastUsed,
        })
        await shutdownEntry(oldest)
        return oldest
      },

      async shutdown(serverID, root) {
        const entry = pool.get(key(serverID, root))
        if (!entry) return
        await shutdownEntry(entry)
      },

      async shutdownAll() {
        const entries = [...pool.values()]
        for (const entry of entries) {
          if (entry.idleTimer) clearTimeout(entry.idleTimer)
        }
        await Promise.all(entries.map((e) => e.client.shutdown().catch(() => {})))
        pool.clear()
      },

      activeCount() {
        return pool.size
      },

      atCapacity() {
        return pool.size >= config.maxConcurrent
      },

      entries() {
        return [...pool.values()]
      },

      onEvict(fn) {
        evictListeners.push(fn)
      },
    }
  }
}
