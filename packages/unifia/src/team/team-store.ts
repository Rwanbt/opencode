import { Database } from "bun:sqlite"
// WHY: read at build time, not at runtime. `resolve(import.meta.dir, ...)` points
// inside the Bun single-file executable's virtual FS (`B:\~BUN\`), where the
// migration file does not exist — every compiled build (CLI, desktop sidecar,
// mobile) died with ENOENT on the first team-store call. A text import is inlined
// into the bundle and keeps working in dev.
import TEAM_STORE_MIGRATION from "../../migration/20260726193000_team_store/migration.sql" with { type: "text" }
import {
  TEAM_STORE_MAX_EVENT_BYTES,
  TEAM_STORE_MAX_JSON_BYTES,
  TEAM_STORE_SCHEMA_VERSION,
  TEAM_STORE_TABLES,
  type TeamStoreTable,
} from "./team-store.sql"

const DEFAULT_QUEUE_LIMIT = 256

export class TeamStoreQueueFullError extends Error {
  constructor(limit: number) {
    super(`Team store writer queue is full (limit ${limit})`)
    this.name = "TeamStoreQueueFullError"
  }
}

export interface TeamStoreOptions {
  queueLimit?: number
}

export interface TeamRunInput {
  runId: string
  planId: string
  status?: "pending" | "running" | "completed" | "failed" | "aborted"
}

export interface TeamTaskInput {
  taskId: string
  runId: string
  status?: "pending" | "assigned" | "running" | "completed" | "blocked" | "cancelled"
  dependsOn?: string[]
  scope: unknown
}
export interface TeamAttemptInput {
  attemptId: string
  taskId: string
  workerId: string
  outcome?: "success" | "failure" | "aborted" | "in_progress"
  commitSha?: string
  report?: unknown
}

export interface TeamGateInput {
  gateId: string
  runId: string
  taskId?: string
  verdict: TeamGateRow["verdict"]
  findings: unknown
}

function now(): string {
  return new Date().toISOString()
}

function json(value: unknown, maxBytes: number, field: string): string {
  const encoded = JSON.stringify(value)
  if (encoded === undefined) throw new TypeError(`${field} must be JSON serializable`)
  if (new TextEncoder().encode(encoded).byteLength > maxBytes) {
    throw new RangeError(`${field} exceeds the ${maxBytes}-byte limit`)
  }
  return encoded
}

// ---------------------------------------------------------------------------
// Read side (TEAM-L02): row shapes and keyset pagination helpers.
//
// The row types are the store's own contract, in camelCase. Callers never see
// the `*_json` columns: a caller that has to JSON.parse a field is a caller
// that will eventually forget to.
// ---------------------------------------------------------------------------

/** Largest page a caller may request. Matches team/events.ts. */
export const TEAM_STORE_MAX_PAGE_SIZE = 1_000
const DEFAULT_PAGE_SIZE = 100

/** An unusable cursor — bad syntax, or one that names a row that is gone. */
export class TeamStoreCursorError extends TypeError {
  constructor(message: string) {
    super(message)
    this.name = "TeamStoreCursorError"
  }
}

export interface PageOf<T> {
  readonly items: readonly T[]
  /** Pass back as `cursor` for the next page. `null` means this was the last. */
  readonly nextCursor: string | null
}

export interface TeamRunRow {
  readonly runId: string
  readonly schemaVersion: string
  readonly planId: string
  readonly status: "pending" | "running" | "completed" | "failed" | "aborted"
  readonly createdAt: string
  readonly updatedAt: string
}

export interface TeamTaskRow {
  readonly taskId: string
  readonly runId: string
  readonly status: "pending" | "assigned" | "running" | "completed" | "blocked" | "cancelled"
  readonly dependsOn: readonly string[]
  readonly scope: unknown
  readonly createdAt: string
  readonly updatedAt: string
}

export interface TeamEventRow {
  readonly eventId: string
  readonly runId: string
  readonly sequence: number
  readonly kind: string
  readonly payload: unknown
  readonly occurredAt: string
}

export interface TeamGateRow {
  readonly gateId: string
  readonly runId: string
  readonly taskId: string | null
  readonly verdict: "APPROVED" | "APPROVED_WITH_FOLLOWUP" | "CHANGES_REQUESTED"
  readonly findings: unknown
  readonly decidedAt: string
}

interface RunRecord {
  run_id: string
  schema_version: string
  plan_id: string
  status: TeamRunRow["status"]
  created_at: string
  updated_at: string
}

interface TaskRecord {
  task_id: string
  run_id: string
  status: TeamTaskRow["status"]
  depends_on_json: string
  scope_json: string
  created_at: string
  updated_at: string
}

interface EventRecord {
  event_id: string
  run_id: string
  sequence: number
  kind: string
  payload_json: string
  occurred_at: string
}

interface GateRecord {
  gate_id: string
  run_id: string
  task_id: string | null
  verdict: TeamGateRow["verdict"]
  findings_json: string
  decided_at: string
}

function assertLimit(limit: number | undefined): number {
  if (limit === undefined) return DEFAULT_PAGE_SIZE
  if (!Number.isInteger(limit) || limit <= 0 || limit > TEAM_STORE_MAX_PAGE_SIZE) {
    throw new RangeError(`limit must be an integer between 1 and ${TEAM_STORE_MAX_PAGE_SIZE}`)
  }
  return limit
}

function parseSequenceCursor(cursor: string | null): number {
  if (cursor === null) return 0
  const sequence = Number(cursor)
  if (!Number.isSafeInteger(sequence) || sequence < 0) {
    throw new TeamStoreCursorError(`cursor must be a non-negative sequence, got ${JSON.stringify(cursor)}`)
  }
  return sequence
}

/**
 * Turn `limit + 1` fetched rows into a page of at most `limit`.
 *
 * Over-fetching by one is how `nextCursor` can be null on the exact last page
 * instead of handing back a cursor that resolves to nothing.
 */
function page<Row, Item>(
  rows: Row[],
  limit: number,
  map: (row: Row) => Item,
  cursorOf: (row: Row) => string,
): PageOf<Item> {
  const hasMore = rows.length > limit
  const visible = hasMore ? rows.slice(0, limit) : rows
  return {
    items: visible.map(map),
    nextCursor: hasMore && visible.length > 0 ? cursorOf(visible[visible.length - 1]) : null,
  }
}

function toRun(row: RunRecord): TeamRunRow {
  return {
    runId: row.run_id,
    schemaVersion: row.schema_version,
    planId: row.plan_id,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

function toTask(row: TaskRecord): TeamTaskRow {
  return {
    taskId: row.task_id,
    runId: row.run_id,
    status: row.status,
    dependsOn: JSON.parse(row.depends_on_json) as string[],
    scope: JSON.parse(row.scope_json),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

function toEvent(row: EventRecord): TeamEventRow {
  return {
    eventId: row.event_id,
    runId: row.run_id,
    sequence: row.sequence,
    kind: row.kind,
    payload: JSON.parse(row.payload_json),
    occurredAt: row.occurred_at,
  }
}

function toGate(row: GateRecord): TeamGateRow {
  return {
    gateId: row.gate_id,
    runId: row.run_id,
    taskId: row.task_id,
    verdict: row.verdict,
    findings: JSON.parse(row.findings_json),
    decidedAt: row.decided_at,
  }
}

export class TeamStore {
  readonly #db: Database
  readonly #queueLimit: number
  #queuedWrites = 0
  #writerTail: Promise<void> = Promise.resolve()

  private constructor(db: Database, options: TeamStoreOptions = {}) {
    this.#db = db
    this.#queueLimit = options.queueLimit ?? DEFAULT_QUEUE_LIMIT
  }

  static open(path: string, options: TeamStoreOptions = {}): TeamStore {
    const db = new Database(path, { create: true })
    db.exec("PRAGMA journal_mode=WAL; PRAGMA synchronous=NORMAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;")
    db.exec(TEAM_STORE_MIGRATION)
    return new TeamStore(db, options)
  }

  get journalMode(): string {
    return String((this.#db.query("PRAGMA journal_mode").get() as { journal_mode: string }).journal_mode).toLowerCase()
  }

  get busyTimeoutMs(): number {
    return Number((this.#db.query("PRAGMA busy_timeout").get() as { timeout: number }).timeout)
  }

  get queuedWrites(): number {
    return this.#queuedWrites
  }

  count(table: TeamStoreTable): number {
    if (!TEAM_STORE_TABLES.includes(table)) throw new Error(`Unknown TeamStore table: ${table}`)
    return Number((this.#db.query(`SELECT COUNT(*) AS count FROM ${table}`).get() as { count: number }).count)
  }

  write<T>(operation: (db: Database) => T): Promise<T> {
    if (this.#queuedWrites >= this.#queueLimit) throw new TeamStoreQueueFullError(this.#queueLimit)
    this.#queuedWrites++
    const run = this.#writerTail.then(() => operation(this.#db))
    this.#writerTail = run.then(
      () => {
        this.#queuedWrites--
      },
      () => {
        this.#queuedWrites--
      },
    )
    return run
  }

  transaction<T>(operation: (db: Database) => T): Promise<T> {
    return this.write((db) => db.transaction(() => operation(db))())
  }

  createRun(input: TeamRunInput): Promise<void> {
    return this.write((db) => {
      const timestamp = now()
      db.prepare(
        `INSERT INTO team_runs(run_id, schema_version, plan_id, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      ).run(input.runId, TEAM_STORE_SCHEMA_VERSION, input.planId, input.status ?? "pending", timestamp, timestamp)
    })
  }

  createTask(input: TeamTaskInput): Promise<void> {
    const dependsOn = json(input.dependsOn ?? [], TEAM_STORE_MAX_JSON_BYTES, "dependsOn")
    const scope = json(input.scope, TEAM_STORE_MAX_JSON_BYTES, "scope")
    return this.write((db) => {
      const timestamp = now()
      db.prepare(
        `INSERT INTO team_tasks(task_id, run_id, status, depends_on_json, scope_json, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      ).run(input.taskId, input.runId, input.status ?? "pending", dependsOn, scope, timestamp, timestamp)
    })
  }

  updateRunStatus(runId: string, status: TeamRunRow["status"]): Promise<void> {
    return this.write((db) => {
      const result = db.prepare("UPDATE team_runs SET status = ?, updated_at = ? WHERE run_id = ?").run(status, now(), runId)
      if (result.changes !== 1) throw new Error(`Team run ${runId} does not exist`)
    })
  }

  updateTaskStatus(taskId: string, status: TeamTaskRow["status"]): Promise<void> {
    return this.write((db) => {
      const result = db.prepare("UPDATE team_tasks SET status = ?, updated_at = ? WHERE task_id = ?").run(status, now(), taskId)
      if (result.changes !== 1) throw new Error(`Team task ${taskId} does not exist`)
    })
  }

  createAttempt(input: TeamAttemptInput): Promise<void> {
    const report = input.report === undefined ? null : json(input.report, TEAM_STORE_MAX_JSON_BYTES, "attempt report")
    return this.write((db) => {
      const timestamp = now()
      db.prepare(
        `INSERT INTO team_attempts(attempt_id, task_id, worker_id, outcome, commit_sha, report_json, started_at, finished_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        input.attemptId,
        input.taskId,
        input.workerId,
        input.outcome ?? "in_progress",
        input.commitSha ?? null,
        report,
        timestamp,
        input.outcome && input.outcome !== "in_progress" ? timestamp : null,
      )
    })
  }

  finishAttempt(
    attemptId: string,
    outcome: Exclude<TeamAttemptInput["outcome"], "in_progress" | undefined>,
    input: { commitSha?: string; report?: unknown } = {},
  ): Promise<void> {
    const report = input.report === undefined ? null : json(input.report, TEAM_STORE_MAX_JSON_BYTES, "attempt report")
    return this.write((db) => {
      const result = db.prepare(
        `UPDATE team_attempts
         SET outcome = ?, commit_sha = ?, report_json = ?, finished_at = ?
         WHERE attempt_id = ? AND outcome = 'in_progress'`,
      ).run(outcome, input.commitSha ?? null, report, now(), attemptId)
      if (result.changes !== 1) throw new Error(`Active Team attempt ${attemptId} does not exist`)
    })
  }

  recordGate(input: TeamGateInput): Promise<void> {
    const findings = json(input.findings, TEAM_STORE_MAX_JSON_BYTES, "gate findings")
    return this.write((db) => {
      db.prepare(
        `INSERT INTO team_gates(gate_id, run_id, task_id, verdict, findings_json, decided_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      ).run(input.gateId, input.runId, input.taskId ?? null, input.verdict, findings, now())
    })
  }
  appendEvent(runId: string, eventId: string, kind: string, payload: unknown): Promise<number> {
    const payloadJson = json(payload, TEAM_STORE_MAX_EVENT_BYTES, "event payload")
    return this.write((db) => {
      const row = db
        .query("SELECT COALESCE(MAX(sequence), 0) + 1 AS next_sequence FROM team_events WHERE run_id = ?")
        .get(runId) as { next_sequence: number }
      db.prepare(
        `INSERT INTO team_events(event_id, run_id, sequence, kind, payload_json, occurred_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      ).run(eventId, runId, row.next_sequence, kind, payloadJson, now())
      return row.next_sequence
    })
  }

  saveCheckpoint(runId: string, checkpointId: string, state: unknown): Promise<number> {
    const stateJson = json(state, TEAM_STORE_MAX_JSON_BYTES, "checkpoint state")
    return this.write((db) => {
      const row = db
        .query("SELECT COALESCE(MAX(sequence), 0) + 1 AS next_sequence FROM team_checkpoints WHERE run_id = ?")
        .get(runId) as { next_sequence: number }
      db.prepare(
        `INSERT INTO team_checkpoints(checkpoint_id, run_id, sequence, state_json, created_at)
         VALUES (?, ?, ?, ?, ?)`,
      ).run(checkpointId, runId, row.next_sequence, stateJson, now())
      return row.next_sequence
    })
  }

  recordArtifact(input: {
    artifactId: string
    runId: string
    taskId?: string
    relativePath: string
    sha256: string
    byteLength: number
    metadata?: unknown
  }): Promise<void> {
    const metadata = input.metadata === undefined ? null : json(input.metadata, TEAM_STORE_MAX_JSON_BYTES, "artifact metadata")
    return this.write((db) => {
      db.prepare(
        `INSERT INTO team_artifacts(artifact_id, run_id, task_id, relative_path, sha256, byte_length, metadata_json, recorded_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(input.artifactId, input.runId, input.taskId ?? null, input.relativePath, input.sha256, input.byteLength, metadata, now())
    })
  }

  compactEvents(runId: string, keepLatest: number): Promise<number> {
    if (!Number.isInteger(keepLatest) || keepLatest < 0) throw new RangeError("keepLatest must be a non-negative integer")
    return this.transaction((db) => {
      const deleted = db
        .prepare(
          `DELETE FROM team_events WHERE run_id = ? AND sequence <= (
             SELECT COALESCE(MAX(sequence), 0) - ? FROM team_events WHERE run_id = ?
           )`,
        )
        .run(runId, keepLatest, runId)
      return deleted.changes
    })
  }

  deleteRunAudited(runId: string, reason: string): Promise<void> {
    const details = json({ reason }, 16 * 1024, "audit details")
    return this.transaction((db) => {
      db.prepare(
        `INSERT INTO team_audit(audit_id, run_id, action, target_id, details_json, recorded_at)
         VALUES (?, ?, 'DELETE_RUN', ?, ?, ?)`,
      ).run(crypto.randomUUID(), runId, runId, details, now())
      db.prepare("DELETE FROM team_runs WHERE run_id = ?").run(runId)
    })
  }

  // ---------------------------------------------------------------------
  // Read side (TEAM-L02)
  //
  // Reads bypass the writer queue on purpose: they are single SQLite
  // statements on a WAL database, so they neither block a writer nor wait
  // behind one. Routing them through `write()` would make a listing wait on
  // whatever the runtime happens to be persisting.
  //
  // Pagination is keyset, never OFFSET. A run appended while a client pages
  // through would shift every later offset and silently skip a row.
  // ---------------------------------------------------------------------

  /**
   * Runs, newest first, after `cursor` (a run_id returned as `nextCursor`).
   *
   * Ordered by (created_at DESC, run_id DESC): created_at alone is not
   * unique — two runs created in the same millisecond would page
   * non-deterministically.
   */
  listRuns(options: { limit?: number; cursor?: string | null } = {}): PageOf<TeamRunRow> {
    const limit = assertLimit(options.limit)
    const cursor = options.cursor ?? null
    if (cursor !== null && this.#db.query("SELECT 1 FROM team_runs WHERE run_id = ?").get(cursor) === null) {
      // Comparing against a row that no longer exists yields NULL in SQLite,
      // so the page would come back empty and read as "you are at the end".
      throw new TeamStoreCursorError(`cursor run ${cursor} no longer exists`)
    }
    const rows = (
      cursor === null
        ? this.#db
            .query(
              `SELECT run_id, schema_version, plan_id, status, created_at, updated_at
               FROM team_runs ORDER BY created_at DESC, run_id DESC LIMIT ?`,
            )
            .all(limit + 1)
        : this.#db
            .query(
              `SELECT run_id, schema_version, plan_id, status, created_at, updated_at
               FROM team_runs
               WHERE (created_at, run_id) < (SELECT created_at, run_id FROM team_runs WHERE run_id = ?)
               ORDER BY created_at DESC, run_id DESC LIMIT ?`,
            )
            .all(cursor, limit + 1)
    ) as RunRecord[]
    return page(rows, limit, toRun, (row) => row.run_id)
  }

  getRun(runId: string): TeamRunRow | null {
    const row = this.#db
      .query(
        `SELECT run_id, schema_version, plan_id, status, created_at, updated_at
         FROM team_runs WHERE run_id = ?`,
      )
      .get(runId) as RunRecord | null
    return row === null ? null : toRun(row)
  }

  listTasks(runId: string): TeamTaskRow[] {
    const rows = this.#db
      .query(
        `SELECT task_id, run_id, status, depends_on_json, scope_json, created_at, updated_at
         FROM team_tasks WHERE run_id = ? ORDER BY created_at ASC, task_id ASC`,
      )
      .all(runId) as TaskRecord[]
    return rows.map(toTask)
  }

  /**
   * Events for a run, oldest first, after `cursor` (a sequence number).
   *
   * `sequence` is unique per run and assigned monotonically on append, so it
   * is a total order that a client can resume from exactly — which is what
   * makes an interrupted stream replayable rather than restarted.
   */
  listEvents(runId: string, options: { limit?: number; cursor?: string | null } = {}): PageOf<TeamEventRow> {
    const limit = assertLimit(options.limit)
    const after = parseSequenceCursor(options.cursor ?? null)
    const rows = this.#db
      .query(
        `SELECT event_id, run_id, sequence, kind, payload_json, occurred_at
         FROM team_events WHERE run_id = ? AND sequence > ? ORDER BY sequence ASC LIMIT ?`,
      )
      .all(runId, after, limit + 1) as EventRecord[]
    return page(rows, limit, toEvent, (row) => String(row.sequence))
  }

  listGates(runId: string): TeamGateRow[] {
    const rows = this.#db
      .query(
        `SELECT gate_id, run_id, task_id, verdict, findings_json, decided_at
         FROM team_gates WHERE run_id = ? ORDER BY decided_at ASC, gate_id ASC`,
      )
      .all(runId) as GateRecord[]
    return rows.map(toGate)
  }

  integrityCheck(): { ok: boolean; foreignKeys: string[]; quickCheck: string } {
    const quickCheck = String((this.#db.query("PRAGMA quick_check").get() as { quick_check: string }).quick_check)
    const foreignKeys = this.#db.query("PRAGMA foreign_key_check").all() as string[]
    return { ok: quickCheck === "ok" && foreignKeys.length === 0, foreignKeys, quickCheck }
  }

  close(): void {
    this.#db.close()
  }
}
