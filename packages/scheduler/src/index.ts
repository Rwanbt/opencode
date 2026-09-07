/* SPDX-License-Identifier: MIT */
import { TriggerBindingSchema, type CatchUpPolicy, type OverlapPolicy, type TriggerBinding, type TriggerRuntimeState } from "@unifia/contracts"

export type OverlapDecision = { readonly accept: boolean; readonly queued?: boolean; readonly cancel?: string; readonly reason?: string }
export type CatchUpFire = { readonly scheduledAt: number }

export function applyOverlap(policy: OverlapPolicy, current: Pick<TriggerRuntimeState, "inFlightRunId">, candidateRunId: string): OverlapDecision {
  if (!current.inFlightRunId || policy === "allow") return { accept: true }
  if (policy === "forbid") return { accept: false, reason: "RUN_IN_FLIGHT" }
  if (policy === "queue") return { accept: true, queued: true }
  return { accept: true, cancel: current.inFlightRunId === candidateRunId ? undefined : current.inFlightRunId }
}

export function applyCatchUp(policy: CatchUpPolicy, missedSlots: readonly number[], maxCatchUpMs: number, now = Date.now()): readonly CatchUpFire[] {
  const eligible = missedSlots.filter((slot) => now - slot <= maxCatchUpMs && slot <= now).sort((a, b) => a - b)
  if (policy === "skip" || eligible.length === 0) return []
  if (policy === "fire-once") return [{ scheduledAt: eligible[eligible.length - 1]! }]
  return eligible.map((scheduledAt) => ({ scheduledAt }))
}

export function validateBinding(binding: TriggerBinding): TriggerBinding { return TriggerBindingSchema.parse(binding) }

export function nextFireAt(binding: TriggerBinding, now: number): number | null {
  const trigger = validateBinding(binding).trigger
  if (trigger.kind === "manual") return null
  if (trigger.timezone && trigger.timezone !== "UTC" && trigger.timezone !== "Etc/UTC") throw new SchedulerError("TIMEZONE_ENGINE_REQUIRED")
  const fields = trigger.cron.trim().split(/\s+/).map(parseCronField)
  if (fields.length !== 5 || fields.some((field) => field.size === 0)) throw new SchedulerError("INVALID_CRON")
  const start = new Date(now); start.setUTCSeconds(0, 0)
  for (let minute = 0; minute <= 366 * 24 * 60; minute++) {
    const candidate = new Date(start.getTime() + minute * 60_000)
    if (fields[0]!.has(candidate.getUTCMinutes()) && fields[1]!.has(candidate.getUTCHours()) && fields[2]!.has(candidate.getUTCDate()) && fields[3]!.has(candidate.getUTCMonth() + 1) && fields[4]!.has(candidate.getUTCDay())) return candidate.getTime()
  }
  return null
}

export class SchedulerError extends Error { constructor(message: string) { super(message); this.name = "SchedulerError" } }

function parseCronField(value: string): ReadonlySet<number> {
  const result = new Set<number>()
  for (const part of value.split(",")) {
    const [base, stepText] = part.split("/"); const step = stepText === undefined ? 1 : Number(stepText)
    if (!Number.isInteger(step) || step <= 0) throw new SchedulerError("INVALID_CRON")
    if (base === "*") { for (let item = 0; item <= 59; item += step) result.add(item); continue }
    const range = base!.split("-"); if (range.length > 2) throw new SchedulerError("INVALID_CRON")
    const first = Number(range[0]); const last = range.length === 2 ? Number(range[1]) : first
    if (!Number.isInteger(first) || !Number.isInteger(last)) throw new SchedulerError("INVALID_CRON")
    for (let item = first; item <= last; item += step) result.add(item)
  }
  return result
}
