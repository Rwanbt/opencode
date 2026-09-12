/* SPDX-License-Identifier: MIT */
import { promises as fs } from "node:fs"
import path from "node:path"

export type QueueName = "inbox" | "outbox"
export type QueueItem<T> = { sequence: number; payload: T }
type ItemRecord<T> = { kind: "item"; sequence: number; payload: T }
type AckRecord = { kind: "ack"; sequence: number }

type QueueRecord<T> = ItemRecord<T> | AckRecord

export class DurableQueue<T> {
  readonly #directory: string
  readonly #paths: Record<QueueName, string>

  constructor(root: string) {
    this.#directory = path.join(root, ".unifia", "queues")
    this.#paths = { inbox: path.join(this.#directory, "inbox.jsonl"), outbox: path.join(this.#directory, "outbox.jsonl") }
  }

  async enqueue(name: QueueName, payload: T): Promise<QueueItem<T>> {
    await this.#ensureDirectory()
    const records = await this.#readRecords(name)
    const sequence = records.reduce((maximum, record) => Math.max(maximum, record.sequence), 0) + 1
    await fs.appendFile(this.#paths[name], `${JSON.stringify({ kind: "item", sequence, payload } satisfies ItemRecord<T>)}\n`, "utf8")
    return { sequence, payload }
  }

  async pending(name: QueueName, afterSequence = 0, limit = 100): Promise<QueueItem<T>[]> {
    const records = await this.#readRecords(name)
    const acknowledged = new Set(records.filter((record): record is AckRecord => record.kind === "ack").map((record) => record.sequence))
    return records
      .filter((record): record is ItemRecord<T> => record.kind === "item" && record.sequence > afterSequence && !acknowledged.has(record.sequence))
      .sort((left, right) => left.sequence - right.sequence)
      .slice(0, limit)
      .map(({ sequence, payload }) => ({ sequence, payload }))
  }

  async acknowledge(name: QueueName, sequence: number): Promise<void> {
    await this.#ensureDirectory()
    const pending = await this.pending(name, 0, Number.MAX_SAFE_INTEGER)
    if (!pending.some((item) => item.sequence === sequence)) throw new Error("cannot acknowledge an unknown queue item")
    await fs.appendFile(this.#paths[name], `${JSON.stringify({ kind: "ack", sequence } satisfies AckRecord)}\n`, "utf8")
  }

  async repair(name: QueueName): Promise<{ truncated: boolean; validRecords: number }> {
    await this.#ensureDirectory()
    let raw: string
    try { raw = await fs.readFile(this.#paths[name], "utf8") } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return { truncated: false, validRecords: 0 }
      throw error
    }
    const completeLength = raw.endsWith("\n") ? raw.length : raw.lastIndexOf("\n") + 1
    const complete = raw.slice(0, completeLength)
    const records = complete.split("\n").filter(Boolean).map((line) => JSON.parse(line) as QueueRecord<T>)
    if (completeLength !== raw.length) await fs.writeFile(this.#paths[name], complete, "utf8")
    return { truncated: completeLength !== raw.length, validRecords: records.length }
  }

  async #readRecords(name: QueueName): Promise<QueueRecord<T>[]> {
    await this.repair(name)
    try {
      const raw = await fs.readFile(this.#paths[name], "utf8")
      return raw.split("\n").filter(Boolean).map((line) => JSON.parse(line) as QueueRecord<T>)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return []
      throw error
    }
  }

  async #ensureDirectory(): Promise<void> {
    await fs.mkdir(this.#directory, { recursive: true })
  }
}