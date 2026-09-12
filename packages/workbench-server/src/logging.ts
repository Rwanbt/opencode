/* SPDX-License-Identifier: MIT */
import { appendFileSync, mkdirSync, renameSync, rmSync, statSync } from "node:fs"
import path from "node:path"

export type ServerLogLevel = "error" | "warn" | "info" | "debug"
const LEVEL_ORDER: Record<ServerLogLevel, number> = { error: 0, warn: 1, info: 2, debug: 3 }
const SECRET_FIELD = /token|secret|password|authorization|cookie|prompt|content/i

export class ServerLogger {
  readonly #path: string
  readonly #level: ServerLogLevel
  readonly #maxBytes: number

  constructor(logPath: string, level: ServerLogLevel = "info", maxBytes = 1_048_576) {
    this.#path = logPath
    this.#level = level
    this.#maxBytes = maxBytes
    mkdirSync(path.dirname(logPath), { recursive: true })
  }

  log(level: ServerLogLevel, event: string, fields: Record<string, unknown> = {}): void {
    if (LEVEL_ORDER[level] > LEVEL_ORDER[this.#level]) return
    const safeFields = Object.fromEntries(Object.entries(fields).map(([key, value]) => [key, SECRET_FIELD.test(key) ? "[REDACTED]" : value]))
    const line = `${JSON.stringify({ timestamp: Date.now(), level, event, ...safeFields })}\n`
    if (this.#size() + Buffer.byteLength(line) > this.#maxBytes) { rmSync(`${this.#path}.1`, { force: true }); renameSync(this.#path, `${this.#path}.1`) }
    appendFileSync(this.#path, line, "utf8")
  }

  #size(): number {
    try { return statSync(this.#path).size } catch { return 0 }
  }
}
