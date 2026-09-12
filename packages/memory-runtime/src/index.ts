/* SPDX-License-Identifier: MIT */
export type MemoryRecord = { id: string; workspaceId: string; content: string; source: "user" | "agent" | "import"; createdAt: number; updatedAt: number; tags: readonly string[]; deleted?: boolean }
export type MemoryQuery = { workspaceId: string; text?: string; tags?: readonly string[]; includeDeleted?: boolean }
export type MemoryStore = { list(query: MemoryQuery): Promise<MemoryRecord[]>; save(record: MemoryRecord): Promise<void>; delete(workspaceId: string, id: string): Promise<boolean> }
export type MemoryPolicy = { promptInjectionEnabled: boolean; maxRecordsPerWorkspace: number; maxContentLength: number }

export class InMemoryMemoryStore implements MemoryStore {
  readonly #records = new Map<string, MemoryRecord>()
  async list(query: MemoryQuery): Promise<MemoryRecord[]> { return [...this.#records.values()].filter((record) => record.workspaceId === query.workspaceId && (query.includeDeleted || !record.deleted) && (!query.text || record.content.toLowerCase().includes(query.text.toLowerCase())) && (!query.tags?.length || query.tags.every((tag) => record.tags.includes(tag)))).map((record) => structuredClone(record)) }
  async save(record: MemoryRecord): Promise<void> { this.#records.set(`${record.workspaceId}:${record.id}`, structuredClone(record)) }
  async delete(workspaceId: string, id: string): Promise<boolean> { const record = this.#records.get(`${workspaceId}:${id}`); if (!record) return false; record.deleted = true; record.updatedAt = Date.now(); return true }
}

export class MemoryRuntime {
  readonly #store: MemoryStore
  readonly #policy: MemoryPolicy
  readonly #now: () => number
  constructor(store: MemoryStore, policy: MemoryPolicy = { promptInjectionEnabled: false, maxRecordsPerWorkspace: 1_000, maxContentLength: 20_000 }, now: () => number = () => Date.now()) { this.#store = store; this.#policy = policy; this.#now = now }
  async remember(input: { workspaceId: string; content: string; source: MemoryRecord["source"]; tags?: readonly string[]; id?: string }): Promise<MemoryRecord> { if (!input.content || input.content.length > this.#policy.maxContentLength) throw new Error("memory content exceeds policy"); const existing = await this.#store.list({ workspaceId: input.workspaceId }); if (existing.length >= this.#policy.maxRecordsPerWorkspace) throw new Error("memory quota exceeded"); const now = this.#now(); const record: MemoryRecord = { id: input.id ?? `memory-${now}-${existing.length}`, workspaceId: input.workspaceId, content: input.content, source: input.source, createdAt: now, updatedAt: now, tags: [...(input.tags ?? [])] }; await this.#store.save(record); return record }
  search(query: MemoryQuery): Promise<MemoryRecord[]> { return this.#store.list(query) }
  remove(workspaceId: string, id: string): Promise<boolean> { return this.#store.delete(workspaceId, id) }
  async promptContext(query: MemoryQuery): Promise<string> { if (!this.#policy.promptInjectionEnabled) return ""; const records = await this.search(query); return records.map((record) => `[memory:${record.id}] ${record.content}`).join("\n") }
}
