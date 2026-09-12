/* SPDX-License-Identifier: MIT */

import { Log } from "../util/log"

// Instance diagnostics (carte C10).
// Tracks the reason, owner, and creation time of every Instance.provide call,
// so the 4 instances observed at startup can be explained (cf. plan §5 P0-C :
// "Instrumenter chaque création avec reason, appelant, route, répertoire
// canonique et owner"). This module is the data sink; the wiring lives in
// `Instance.provide` / `Instance.dispose*`.

export namespace InstanceDiagnostics {
  export interface Record {
    directory: string
    owner: string
    reason: string
    createdAt: number
  }

  const records = new Map<string, Record>()
  const log = Log.create({ service: "instance.diagnostics" })

  export function record(directory: string, owner: string, reason: string): void {
    records.set(directory, { directory, owner, reason, createdAt: Date.now() })
    log.info("instance recorded", { directory, owner, reason })
  }

  export function get(directory: string): Record | undefined {
    return records.get(directory)
  }

  export function list(): Record[] {
    return [...records.values()]
  }

  export function clear(directory: string): void {
    records.delete(directory)
  }

  // Test-only. The diagnostics map is process-global; tests must reset it
  // explicitly to avoid bleed-through.
  export function _resetForTests(): void {
    records.clear()
  }
}
