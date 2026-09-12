export const TEAM_EVENT_SCHEMA_VERSION = "1.0.0"
const MAX_EVENT_PAYLOAD_BYTES = 64 * 1024
const MAX_PAGE_SIZE = 1_000

export type TeamEventFamily = "run" | "task" | "worker" | "gate" | "system"
const EVENT_FAMILIES: readonly TeamEventFamily[] = ["run", "task", "worker", "gate", "system"]

export interface TeamEventInput {
  readonly eventId: string
  readonly runId: string
  readonly family: TeamEventFamily
  readonly type: string
  readonly payload: unknown
}

export interface TeamEvent extends TeamEventInput {
  readonly schemaVersion: typeof TEAM_EVENT_SCHEMA_VERSION
  readonly sequence: number
  readonly runSequence: number
  readonly occurredAt: string
}

export interface EventPage<T extends TeamEvent> {
  readonly items: readonly T[]
  readonly nextCursor: string | null
}

function assertNonEmpty(value: string, field: string): void {
  if (value.trim().length === 0) throw new TypeError(`${field} must not be empty`)
}

function assertPayload(payload: unknown): void {
  const encoded = JSON.stringify(payload)
  if (encoded === undefined) throw new TypeError("event payload must be JSON serializable")
  if (new TextEncoder().encode(encoded).byteLength > MAX_EVENT_PAYLOAD_BYTES) throw new RangeError(`event payload exceeds ${MAX_EVENT_PAYLOAD_BYTES} bytes`)
}

export function validateTeamEventInput(input: TeamEventInput): void {
  assertNonEmpty(input.eventId, "eventId")
  assertNonEmpty(input.runId, "runId")
  assertNonEmpty(input.type, "type")
  if (!EVENT_FAMILIES.includes(input.family)) throw new TypeError(`unknown event family: ${input.family}`)
  assertPayload(input.payload)
}

export function createTeamEvent(input: TeamEventInput, sequence: number, runSequence: number, occurredAt: string): TeamEvent {
  validateTeamEventInput(input)
  if (!Number.isInteger(sequence) || sequence <= 0) throw new RangeError("sequence must be a positive integer")
  if (!Number.isInteger(runSequence) || runSequence <= 0) throw new RangeError("runSequence must be a positive integer")
  assertNonEmpty(occurredAt, "occurredAt")
  return { ...input, schemaVersion: TEAM_EVENT_SCHEMA_VERSION, sequence, runSequence, occurredAt }
}

function lowerBound<T extends TeamEvent>(events: readonly T[], sequence: number): number {
  let low = 0
  let high = events.length
  while (low < high) {
    const middle = Math.floor((low + high) / 2)
    if (events[middle].sequence <= sequence) low = middle + 1
    else high = middle
  }
  return low
}

export function paginateEvents<T extends TeamEvent>(events: readonly T[], cursor: string | null = null, limit = 100): EventPage<T> {
  if (!Number.isInteger(limit) || limit <= 0 || limit > MAX_PAGE_SIZE) throw new RangeError(`limit must be between 1 and ${MAX_PAGE_SIZE}`)
  const afterSequence = cursor === null ? 0 : Number(cursor)
  if (!Number.isSafeInteger(afterSequence) || afterSequence < 0) throw new TypeError("cursor must be a non-negative sequence")
  const start = lowerBound(events, afterSequence)
  const items = events.slice(start, start + limit)
  const hasNext = start + items.length < events.length
  return { items, nextCursor: hasNext && items.length > 0 ? String(items[items.length - 1].sequence) : null }
}
