/**
 * Native observability endpoints — Phase 1 metadata + Phase 2 export/compare
 * + Phase 3 opt-in content capture.
 *
 * Endpoints:
 *   GET /observability/health         Current instance's queue/circuit-breaker
 *                                       state. Per-project-instance
 *                                       (observability/runtime.ts), not global.
 *   GET /observability/settings       Resolved capture policy + storage
 *                                       disclosure flags for the settings UI.
 *   GET    /observability/events         Keyset-paginated events for one session.
 *   GET    /observability/events/:eventId Single event by its ULID.
 *   GET    /observability/trace/:traceId  Full span sequence for one trace.
 *   GET    /observability/summary        Aggregate counts/cost for one session.
 *   GET    /observability/compare        Cohort comparison across configurations.
 *   GET    /observability/export         NDJSON export of matching events.
 *   GET    /observability/summary/aggregate Aggregate across sessions/projects.
 *   GET    /observability/privacy        Content-capture opt-in status for a scope.
 *   PUT    /observability/privacy        Grant local_content_redacted/local_full,
 *                                          with a mandatory TTL (ADR-1032).
 *   POST   /observability/privacy/revoke Revoke an opt-in + clear captured content now.
 *   DELETE /observability/data           Delete events by scope. Requires
 *                                          header `X-Confirm-Delete: yes`.
 *   GET    /observability/exporters/config  Phase 4 (ADR-1026): configured exporters
 *                                          (secrets never returned) + last periodic
 *                                          export tick's per-exporter outcome.
 *   GET    /observability/exporters/preview/:eventId Exact ExportProjection that would be
 *                                          sent for one event — without sending it.
 *   POST   /observability/exporters/test    Sends a synthetic (non-real) projection
 *                                          through every configured exporter right now.
 *
 * Ownership (ADR-1028): project_id/workspace_id are populated from the
 * owned SessionInfo and verified against the current project/workspace. A
 * foreign scope returns a non-revealing 404; DELETE workspace requires an
 * existing Workspace row belonging to the current project. The Phase 3
 * privacy routes reuse the same ownership anchor for all three scopes.
 */
import { Hono } from "hono"
import { describeRoute, resolver, validator } from "hono-openapi"
import z from "zod"
import { Config } from "../../config/config"
import { ObservabilityRuntime } from "../../observability/runtime"
import { resolveCapturePolicy } from "../../observability/capture-policy"
import { ObservabilityRepository, cursor, toDto, derivedOrphanedRows, exportEvents, summaryAll, byTraceId } from "../../observability/repository"
import { deleteByScope, purgeContentForScope, resolveRetentionConfig, type DeleteScope } from "../../observability/purge"
import { getOptIn, setOptIn, revokeOptIn, OptInScopeSchema, ContentCaptureLevelSchema, MAX_TTL_DAYS, type OptInScope } from "../../observability/capture-content"
import { ExporterRegistry } from "../../observability/exporter"
import { ExportProjectionSchema, shouldExportSpan, toExportProjection } from "../../observability/export-projection"
import { exportToAll } from "../../observability/export-runner"
import { secret as hmacSecret } from "../../observability/hmac-secret"
import { ObservabilityId } from "../../observability/id"
import { Session } from "../../session"
import { Workspace } from "../../control-plane/workspace"
import { WorkspaceID } from "../../control-plane/schema"
import { SessionID } from "@/session/schema"
import { Instance } from "../../project/instance"
import { NotFoundError } from "../../storage/db"
import { AuditLog } from "../../session/audit"
import { errors } from "../error"

const EventDtoSchema = z.object({
  eventId: z.string(),
  traceId: z.string(),
  spanId: z.string(),
  parentSpanId: z.string().optional(),
  sessionId: z.string().optional(),
  projectId: z.string().optional(),
  workspaceId: z.string().optional(),
  messageId: z.string().optional(),
  turnId: z.string().optional(),
  stepIndex: z.number().optional(),
  type: z.string(),
  status: z.string(),
  derivedStatus: z.literal("orphaned").optional(),
  tsMs: z.number(),
  durationMs: z.number().optional(),
  costNanoUsd: z.number().optional(),
  pricingVersion: z.string().optional(),
  pricingSource: z.string().optional(),
  costComputedAtMs: z.number().optional(),
  redactionStatus: z.string(),
  originalSizeBytes: z.number().optional(),
  payloadTruncated: z.boolean(),
  metadata: z.record(z.string(), z.unknown()),
  localRedacted: z.record(z.string(), z.unknown()),
  // Phase 3 opt-in content (ADR-1032) — both absent on every event unless a
  // non-expired opt-in was active at capture time (capture-content.ts).
  localContentRedacted: z.string().optional(),
  localFull: z.string().optional(),
  hasSensitiveContent: z.boolean(),
  schemaVersion: z.number(),
})

// Throws the SAME NotFoundError shape as an unknown session/event so a
// cross-project probe can't distinguish "doesn't exist" from "exists but
// isn't yours". Takes a pre-validated SessionID (either from a
// SessionID.zod-typed Hono validator, or a raw DB column we wrote ourselves)
// — never re-parses, so a malformed id from user input surfaces as the
// standard 400 at the Hono validator layer, not an uncaught ZodError here.
async function requireOwnedWorkspace(workspaceId: string) {
  const parsed = WorkspaceID.zod.safeParse(workspaceId)
  const workspace = parsed.success ? await Workspace.get(parsed.data) : undefined
  if (!workspace || workspace.projectID !== Instance.project.id) throw new NotFoundError({ message: `Workspace not found: ${workspaceId}` })
  return workspace
}

async function requireOwnedSession(sessionId: SessionID) {
  const session = await Session.get(sessionId)
  if (session.projectID !== Instance.project.id) {
    throw new NotFoundError({ message: `Session not found: ${sessionId}` })
  }
  return session
}

// Phase 3 privacy routes (ADR-1032) accept any of the three opt-in scopes —
// same ownership anchor as every other route in this file, just dispatched
// by the scope discriminant instead of a fixed shape.
async function requireOwnedScope(scope: OptInScope, id: string) {
  if (scope === "session") await requireOwnedSession(id as SessionID)
  else if (scope === "workspace") await requireOwnedWorkspace(id)
  else if (id !== Instance.project.id) throw new NotFoundError({ message: `Project not found: ${id}` })
}

const HealthSchema = z.object({
  enabled: z.boolean(),
  captureMode: z.enum(["local_metadata", "local_redacted"]),
  circuitOpen: z.boolean(),
  eventsAccepted: z.number(),
  eventsInserted: z.number(),
  eventsRejectedInvalidContext: z.number(),
  eventsRejectedInvalidEvent: z.number(),
  eventsDroppedQueueFull: z.number(),
  eventsDroppedCircuitOpen: z.number(),
  eventsFailedDb: z.number(),
  eventsFailedBusy: z.number(),
  eventsFailedFull: z.number(),
  eventsFailedCorrupt: z.number(),
  sanitizerFailed: z.number(),
  lastErrorAt: z.number().optional(),
  lastErrorKind: z.string().optional(),
  queueSize: z.number(),
  queueBytes: z.number(),
})

const DeleteBodySchema = z.discriminatedUnion("scope", [
  z.object({ scope: z.literal("workspace"), id: WorkspaceID.zod }),
  z.object({ scope: z.literal("all") }),
  z.object({ scope: z.literal("project"), id: z.string().min(1) }),
  z.object({ scope: z.literal("session"), id: SessionID.zod }),
])

const DeleteResultSchema = z.object({
  deletedCount: z.number(),
})

const SummaryAllSchema = z.object({
  totalEvents: z.number(),
  totalCostNanoUsd: z.number(),
  byType: z.record(z.string(), z.number()),
  byStatus: z.record(z.string(), z.number()),
  firstEventTsMs: z.number().optional(),
  lastEventTsMs: z.number().optional(),
})

const SummarySchema = z.object({
  sessionId: z.string(),
  totalEvents: z.number(),
  totalCostNanoUsd: z.number(),
  byType: z.record(z.string(), z.number()),
  byStatus: z.record(z.string(), z.number()),
  firstEventTsMs: z.number().optional(),
  lastEventTsMs: z.number().optional(),
})

const CohortMetricsSchema = z.object({
  modelProvider: z.string().nullable(),
  modelId: z.string().nullable(),
  skillHmac: z.string().nullable(),
  latencyP50Ms: z.number(),
  latencyP95Ms: z.number(),
  costPerTurnNanoUsd: z.number(),
  failureRatePct: z.number(),
  totalEvents: z.number(),
  traceCount: z.number(),
})

const CompareSchema = z.object({
  cohorts: z.array(CohortMetricsSchema),
  referenceIndex: z.number().optional(),
  timeWindowMs: z.number().optional(),
})

const OptInSchema = z.object({
  scope: OptInScopeSchema,
  scopeId: z.string(),
  level: ContentCaptureLevelSchema,
  ttlDays: z.number(),
  createdAtMs: z.number(),
  expiresAtMs: z.number(),
})

const TraceDetailSchema = z.object({
  traceId: z.string(),
  events: z.array(EventDtoSchema),
})

// Phase 4 (ADR-1026). secretKey is NEVER included — it's a credential, not
// something the settings UI needs to display, not even masked.
const ExporterSummarySchema = z.object({
  type: z.literal("langfuse"),
  host: z.string(),
  publicKey: z.string(),
})

const ExportAttemptResultSchema = z.object({
  exporter: z.string(),
  ok: z.boolean(),
  attempts: z.number(),
  error: z.string().optional(),
})

const ExportConfigSchema = z.object({
  exporters: z.array(ExporterSummarySchema),
  backfillOnStart: z.boolean(),
  lastRun: z
    .object({
      atMs: z.number(),
      results: z.array(ExportAttemptResultSchema),
    })
    .optional(),
})

const ExportPreviewSchema = z.object({
  exportable: z.boolean(),
  reason: z.string().optional(),
  projection: ExportProjectionSchema.optional(),
})

const ExportTestResultSchema = z.object({
  results: z.array(ExportAttemptResultSchema),
})

const SettingsSchema = z.object({
  enabled: z.boolean(),
  captureMode: z.enum(["local_metadata", "local_redacted"]),
  policyVersion: z.literal(3),
  // True as of Phase 3: local_full/local_content_redacted are reachable, but
  // ONLY for a scope with a non-expired opt-in (GET /observability/privacy).
  // This flag communicates the capability exists at all, not that it's
  // active for any particular session/project/workspace right now.
  localFullAvailable: z.literal(true),
  maxOptInTtlDays: z.number(),
  storage: z.literal("sqlite_unencrypted_local"),
  retentionDays: z.number().optional(),
  maxEvents: z.number(),
})

export const ObservabilityRoutes = () =>
  new Hono()
    .get(
      "/health",
      describeRoute({
        summary: "Observability health",
        description:
          "Current instance's observability queue/circuit-breaker state. Reflects only the process serving this request, not a global/cross-project view.",
        operationId: "observability.health",
        responses: {
          200: {
            description: "Health snapshot",
            content: { "application/json": { schema: resolver(HealthSchema) } },
          },
        },
      }),
      async (c) => {
        const cfg = await Config.get()
        const policy = resolveCapturePolicy(cfg.experimental?.observability)
        const stats = ObservabilityRuntime.service().stats()
        return c.json({
          enabled: policy.enabled,
          captureMode: policy.level,
          circuitOpen: stats.circuitOpen,
          eventsAccepted: stats.eventsAccepted,
          eventsInserted: stats.eventsInserted,
          eventsRejectedInvalidContext: stats.eventsRejectedInvalidContext,
          eventsRejectedInvalidEvent: stats.eventsRejectedInvalidEvent,
          eventsDroppedQueueFull: stats.eventsDroppedQueueFull,
          eventsDroppedCircuitOpen: stats.eventsDroppedCircuitOpen,
          eventsFailedDb: stats.eventsFailedDb,
          eventsFailedBusy: stats.eventsFailedBusy,
          eventsFailedFull: stats.eventsFailedFull,
          eventsFailedCorrupt: stats.eventsFailedCorrupt,
          sanitizerFailed: stats.sanitizerFailed,
          lastErrorAt: stats.lastErrorAt,
          lastErrorKind: stats.lastErrorKind,
          queueSize: stats.queueSize,
          queueBytes: stats.queueBytes,
        })
      },
    )
    .get(
      "/settings",
      describeRoute({
        summary: "Observability settings",
        description:
          "Resolved capture policy plus Phase 1 storage disclosure flags for the settings UI (unencrypted local SQLite, no full-content capture available).",
        operationId: "observability.settings",
        responses: {
          200: {
            description: "Settings",
            content: { "application/json": { schema: resolver(SettingsSchema) } },
          },
        },
      }),
      async (c) => {
        const cfg = await Config.get()
        const policy = resolveCapturePolicy(cfg.experimental?.observability)
        const retention = resolveRetentionConfig(cfg.experimental?.observability)
        return c.json({
          enabled: policy.enabled,
          captureMode: policy.level,
          policyVersion: policy.policyVersion,
          localFullAvailable: true,
          maxOptInTtlDays: MAX_TTL_DAYS,
          storage: "sqlite_unencrypted_local",
          retentionDays: retention.retentionDays,
          maxEvents: retention.maxEvents,
        })
      },
    )
    .get(
      "/events",
      describeRoute({
        summary: "List observability events for a session",
        description:
          "Keyset-paginated (ts_ms, id) events for one session, newest first. The session must belong " +
          "to the current project — a session from another project 404s.",
        operationId: "observability.events.list",
        responses: {
          200: {
            description: "Events",
            content: { "application/json": { schema: resolver(z.array(EventDtoSchema)) } },
          },
          ...errors(400, 404),
        },
      }),
      validator(
        "query",
        z.object({
          sessionId: SessionID.zod,
          workspace: WorkspaceID.zod.optional(),
          limit: z.coerce.number().int().min(1).max(200).optional(),
          before: z
            .string()
            .optional()
            .refine(
              (value) => {
                if (!value) return true
                try {
                  cursor.decode(value)
                  return true
                } catch {
                  return false
                }
              },
              { message: "Invalid cursor" },
            ),
        }),
      ),
      async (c) => {
        const query = c.req.valid("query")
        await requireOwnedSession(query.sessionId)
        if (query.workspace) await requireOwnedWorkspace(query.workspace)
        const limit = query.limit ?? 50
        const page = ObservabilityRepository.page({ sessionId: query.sessionId, workspaceId: query.workspace, limit, before: query.before })
        if (page.cursor) {
          const url = new URL(c.req.url)
          url.searchParams.set("sessionId", query.sessionId)
          if (query.workspace) url.searchParams.set("workspace", query.workspace)
          url.searchParams.set("limit", String(limit))
          url.searchParams.set("before", page.cursor)
          c.header("Access-Control-Expose-Headers", "Link, X-Next-Cursor")
          c.header("Link", `<${url.toString()}>; rel="next"`)
          c.header("X-Next-Cursor", page.cursor)
        }
        const orphaned = derivedOrphanedRows(page.items)
        return c.json(page.items.map((item) => toDto(item, orphaned.get(item.id))))
      },
    )
    .get(
      "/events/:eventId",
      describeRoute({
        summary: "Get a single observability event",
        description: "Fetch one event by its ULID. 404s if it doesn't exist or belongs to another project.",
        operationId: "observability.events.get",
        responses: {
          200: {
            description: "Event",
            content: { "application/json": { schema: resolver(EventDtoSchema) } },
          },
          ...errors(404),
        },
      }),
      validator("param", z.object({ eventId: z.string().min(1) })),
      async (c) => {
        const { eventId } = c.req.valid("param")
        const row = ObservabilityRepository.getByEventId(eventId)
        if (!row || !row.session_id) throw new NotFoundError({ message: `Event not found: ${eventId}` })
        // Trusted: this came from our own DB column, written by record()
        // from a TraceContext.sessionId — not user input, no re-validation.
        await requireOwnedSession(row.session_id as SessionID)
        const orphaned = derivedOrphanedRows([row])
        return c.json(toDto(row, orphaned.get(row.id)))
      },
    )
    .get(
      "/trace/:traceId",
      describeRoute({
        summary: "Get all events in a trace",
        description:
          "The full span sequence for one trace (Timeline/TraceDetail UI), oldest first. Ownership is " +
          "checked against the first event's session — 404s if the trace doesn't exist or belongs to another project.",
        operationId: "observability.trace.get",
        responses: {
          200: {
            description: "Trace detail",
            content: { "application/json": { schema: resolver(TraceDetailSchema) } },
          },
          ...errors(404),
        },
      }),
      validator("param", z.object({ traceId: z.string().min(1) })),
      async (c) => {
        const { traceId } = c.req.valid("param")
        const rows = byTraceId(traceId)
        const anchor = rows.find((row) => row.session_id)
        if (!rows.length || !anchor?.session_id) throw new NotFoundError({ message: `Trace not found: ${traceId}` })
        await requireOwnedSession(anchor.session_id as SessionID)
        const orphaned = derivedOrphanedRows(rows)
        return c.json({ traceId, events: rows.map((row) => toDto(row, orphaned.get(row.id))) })
      },
    )
    .get(
      "/summary",
      describeRoute({
        summary: "Observability summary for a session",
        description:
          "Aggregate event counts (by type/status) and total cost for one session. Same ownership check as /events.",
        operationId: "observability.summary",
        responses: {
          200: {
            description: "Summary",
            content: { "application/json": { schema: resolver(SummarySchema) } },
          },
          ...errors(400, 404),
        },
      }),
      validator("query", z.object({ sessionId: SessionID.zod })),
      async (c) => {
        const { sessionId } = c.req.valid("query")
        await requireOwnedSession(sessionId)
        const summary = ObservabilityRepository.summary(sessionId)
        return c.json({ sessionId, ...summary })
      },
    )
    .get(
      "/privacy",
      describeRoute({
        summary: "Get the content-capture opt-in for a scope",
        description:
          "Phase 3 (ADR-1032). Returns the active, non-expired opt-in for one session/project/workspace, " +
          "or null if none is active. Ownership-checked like every other route in this file.",
        operationId: "observability.privacy.get",
        responses: {
          200: {
            description: "Opt-in status",
            content: { "application/json": { schema: resolver(z.object({ optIn: OptInSchema.nullable() })) } },
          },
          ...errors(400, 404),
        },
      }),
      validator("query", z.object({ scope: OptInScopeSchema, id: z.string().min(1) })),
      async (c) => {
        const { scope, id } = c.req.valid("query")
        await requireOwnedScope(scope, id)
        const optIn = getOptIn(scope, id)
        return c.json({ optIn: optIn ?? null })
      },
    )
    .put(
      "/privacy",
      describeRoute({
        summary: "Set the content-capture opt-in for a scope",
        description:
          "Phase 3 (ADR-1032). Grants local_content_redacted or local_full capture for a scope, with a " +
          `mandatory TTL (max ${MAX_TTL_DAYS} days). Re-opting-in overwrites the previous level/TTL — it never stacks.`,
        operationId: "observability.privacy.set",
        responses: {
          200: {
            description: "Opt-in created",
            content: { "application/json": { schema: resolver(OptInSchema) } },
          },
          ...errors(400, 404),
        },
      }),
      validator(
        "json",
        z.object({
          scope: OptInScopeSchema,
          id: z.string().min(1),
          level: ContentCaptureLevelSchema,
          ttlDays: z.number().int().positive().max(MAX_TTL_DAYS),
        }),
      ),
      async (c) => {
        const body = c.req.valid("json")
        await requireOwnedScope(body.scope, body.id)
        await AuditLog.record({
          action: "observability.privacy.optIn",
          force: true,
          target: body.id,
          metadata: { scope: body.scope, level: body.level, ttlDays: body.ttlDays },
        })
        const optIn = setOptIn({ scope: body.scope, scopeId: body.id, level: body.level, ttlDays: body.ttlDays })
        return c.json(optIn)
      },
    )
    .post(
      "/privacy/revoke",
      describeRoute({
        summary: "Revoke the content-capture opt-in for a scope",
        description:
          "Phase 3 (ADR-1032). Immediately stops future content capture for the scope AND clears content " +
          "already captured on existing events (metadata rows are kept, only local_content_redacted/local_full are cleared).",
        operationId: "observability.privacy.revoke",
        responses: {
          200: {
            description: "Revoked",
            content: { "application/json": { schema: resolver(z.object({ revoked: z.boolean(), contentCleared: z.number() })) } },
          },
          ...errors(400, 404),
        },
      }),
      validator("json", z.object({ scope: OptInScopeSchema, id: z.string().min(1) })),
      async (c) => {
        const body = c.req.valid("json")
        await requireOwnedScope(body.scope, body.id)
        await AuditLog.record({
          action: "observability.privacy.revoke",
          force: true,
          target: body.id,
          metadata: { scope: body.scope },
        })
        revokeOptIn(body.scope, body.id)
        const contentCleared = purgeContentForScope({ scope: body.scope, id: body.id } as DeleteScope)
        return c.json({ revoked: true, contentCleared })
      },
    )
    .get(
      "/compare",
      describeRoute({
        summary: "Compare configuration cohorts",
        description:
          "Aggregates latency p50/p95, cost per turn, and failure rate by (model_provider, model_id, skill_hmac). " +
          "Phase 2 feature — returns empty array if insufficient data.",
        operationId: "observability.compare",
        responses: {
          200: {
            description: "Cohort comparison",
            content: { "application/json": { schema: resolver(CompareSchema) } },
          },
          ...errors(400, 404),
        },
      }),
      validator(
        "query",
        z.object({
          timeWindowMs: z.coerce.number().int().positive().optional(),
        }),
      ),
      async (c) => {
        const query = c.req.valid("query")
        const now = Date.now()
        const cohorts = ObservabilityRepository.compareCohorts({
          projectId: Instance.project.id,
          sinceMs: query.timeWindowMs ? now - query.timeWindowMs : undefined,
        })
        // CompareSchema (and settings-observability.tsx's `data.cohorts`
        // read) both expect the array wrapped in an object — returning the
        // bare array here previously made the Comparisons tab throw at
        // runtime the moment any cohort data existed (`data.cohorts` was
        // undefined on the real response despite the documented/generated
        // SDK type claiming it was always present).
        return c.json({ cohorts, timeWindowMs: query.timeWindowMs })
      },
    )
    .delete(
      "/data",
      describeRoute({
        summary: "Delete observability data",
        description:
          "Destroys observability events for a scope (session/project/workspace/all). Requires header " +
          "`X-Confirm-Delete: yes`.",
        operationId: "observability.data.delete",
        responses: {
          200: {
            description: "Deleted",
            content: { "application/json": { schema: resolver(DeleteResultSchema) } },
          },
          ...errors(400, 404),
        },
      }),
      validator("json", DeleteBodySchema),
      async (c) => {
        const confirm = c.req.header("x-confirm-delete")
        if (confirm !== "yes") {
          return c.json(
            { error: "missing_confirmation", message: "Set X-Confirm-Delete: yes to confirm destructive action." },
            400,
          )
        }

        const body = c.req.valid("json")
        let scope: DeleteScope
        if (body.scope === "session") {
          await requireOwnedSession(body.id)
          scope = { scope: "session", id: body.id }
        } else if (body.scope === "workspace") {
          await requireOwnedWorkspace(body.id)
          scope = { scope: "workspace", id: body.id }
        } else if (body.scope === "project") {
          if (body.id !== Instance.project.id) {
            return c.json({ error: "invalid_scope", message: "id must match the current project" }, 400)
          }
          scope = { scope: "project", id: body.id }
        } else {
          scope = { scope: "all" }
        }

        // Audit first (pre-wipe) so the record survives, same rationale as
        // gdpr.ts's DELETE /user/data.
        await AuditLog.record({
          action: "observability.data.delete",
          force: true,
          target: body.scope === "all" ? undefined : body.id,
          metadata: { scope: body.scope },
        })

        const result = await deleteByScope(scope)
        return c.json(result)
      },
    )
    .get(
      "/export",
      describeRoute({
        summary: "Export observability events as NDJSON",
        description:
          "Streams all matching events as newline-delimited JSON. Supports filtering by session/project/workspace and time window. Returns NDJSON lines.",
        operationId: "observability.export",
        responses: {
          200: {
            description: "NDJSON stream of events",
            content: { "application/x-ndjson": { schema: { type: "string", format: "binary" } } },
          },
          ...errors(400, 404),
        },
      }),
      validator(
        "query",
        z.object({
          sessionId: SessionID.zod,

          projectId: z.string().optional(),
          workspaceId: z.string().optional(),
          sinceMs: z.coerce.number().int().positive().optional(),
          untilMs: z.coerce.number().int().positive().optional(),
          limit: z.coerce.number().int().min(1).max(100000).optional(),
        }),
      ),
      async (c) => {
        const query = c.req.valid("query")

        // Ownership check for session
        if (query.sessionId) {
          await requireOwnedSession(query.sessionId)
        }
        if (query.projectId && query.projectId !== Instance.project.id) {
          throw new NotFoundError({ message: "Project not found" })
        }

        c.header("Content-Type", "application/x-ndjson")
        c.header("Cache-Control", "no-store")

        // Same ownership anchor as every other route in this file (ADR-1028):
        // an unscoped export must never stream another project's events.
        const scoped =
          query.sessionId || query.projectId || query.workspaceId
            ? query
            : { ...query, projectId: Instance.project.id }

        const stream = exportEvents({
          sessionId: scoped.sessionId,
          projectId: scoped.projectId,
          workspaceId: scoped.workspaceId,
          sinceMs: scoped.sinceMs,
          untilMs: scoped.untilMs,
          limit: scoped.limit,
        })

        // Convert async generator to ReadableStream
        const readable = new ReadableStream({
          async start(controller) {
            for await (const line of stream) {
              controller.enqueue(new TextEncoder().encode(line))
            }
            controller.close()
          },
        })

        return c.body(readable)
      },
    )
    .get(
      "/summary/aggregate",
      describeRoute({
        summary: "Aggregate summary across sessions/projects/workspaces",
        description:
          "Aggregate event counts (by type/status) and total cost across a scope. Defaults to the current " +
          "project when no sessionId/projectId/workspaceId is given — never returns other projects' data implicitly.",
        operationId: "observability.summaryAggregate",
        responses: { 200: { description: "Summary", content: { "application/json": { schema: resolver(SummaryAllSchema) } } } },
      }),
      validator("query", z.object({ sessionId: z.string().optional(), projectId: z.string().optional(), workspaceId: z.string().optional(), sinceMs: z.coerce.number().optional(), untilMs: z.coerce.number().optional() })),
      async (c) => {
        const query = c.req.valid("query")
        if (query.sessionId) await requireOwnedSession(SessionID.make(query.sessionId))
        if (query.projectId && query.projectId !== Instance.project.id) throw new NotFoundError({ message: "Project not found" })
        // Same ownership anchor as every other route in this file (ADR-1028):
        // an unscoped request must never see another project's aggregates.
        const scoped = query.sessionId || query.projectId || query.workspaceId ? query : { ...query, projectId: Instance.project.id }
        const summary = summaryAll(scoped)
        return c.json(summary)
      },
    )
    .get(
      "/exporters/config",
      describeRoute({
        summary: "Phase 4 exporter configuration and last run",
        description:
          "Configured exporters (ADR-1026) — secrets are never returned, only type/host/publicKey — plus the " +
          "most recent periodic export tick's per-exporter outcome, if any exporter has ever run.",
        operationId: "observability.exporters.config",
        responses: {
          200: {
            description: "Exporter config summary",
            content: { "application/json": { schema: resolver(ExportConfigSchema) } },
          },
        },
      }),
      async (c) => {
        const cfg = await Config.get()
        const obsConfig = cfg.experimental?.observability
        const exporters = (obsConfig?.exporters ?? []).map((entry) => ({
          type: entry.type,
          host: entry.host,
          publicKey: entry.publicKey,
        }))
        const lastRun = ObservabilityRuntime.exportStats()
        return c.json({
          exporters,
          backfillOnStart: obsConfig?.backfillOnStart ?? false,
          lastRun,
        })
      },
    )
    .get(
      "/exporters/preview/:eventId",
      describeRoute({
        summary: "Preview the ExportProjection for one event",
        description:
          "Returns exactly what would be sent to a configured exporter for this event — without sending it " +
          "anywhere. `exportable: false` if the event is not yet a terminal event (shouldExportSpan, ADR-1026) " +
          "even if it is otherwise valid.",
        operationId: "observability.exporters.preview",
        responses: {
          200: {
            description: "Preview",
            content: { "application/json": { schema: resolver(ExportPreviewSchema) } },
          },
          ...errors(404),
        },
      }),
      validator("param", z.object({ eventId: z.string().min(1) })),
      async (c) => {
        const { eventId } = c.req.valid("param")
        const row = ObservabilityRepository.getByEventId(eventId)
        if (!row || !row.session_id) throw new NotFoundError({ message: `Event not found: ${eventId}` })
        // Same ownership anchor as GET /events/:eventId — trusted DB column,
        // not user input.
        await requireOwnedSession(row.session_id as SessionID)
        if (!shouldExportSpan(row)) {
          return c.json({ exportable: false, reason: "not a terminal event (started, no matching finished/failed/aborted yet)" })
        }
        const secretBytes = await hmacSecret()
        const projection = toExportProjection(row, secretBytes)
        return c.json({ exportable: true, projection })
      },
    )
    .post(
      "/exporters/test",
      describeRoute({
        summary: "Send a synthetic test event through every configured exporter",
        description:
          "Exercises each configured exporter right now with a synthetic, non-real ExportProjection (fake " +
          "trace/span ids, no data derived from any real event) so credentials/connectivity can be validated " +
          "without waiting for real traffic or risking real content. Returns per-exporter success/failure, " +
          "with the same bounded retry policy as the periodic export tick.",
        operationId: "observability.exporters.test",
        responses: {
          200: {
            description: "Test results",
            content: { "application/json": { schema: resolver(ExportTestResultSchema) } },
          },
        },
      }),
      async (c) => {
        const cfg = await Config.get()
        const exporters = ExporterRegistry.from(cfg.experimental?.observability)
        if (!exporters.length) return c.json({ results: [] })
        const now = Date.now()
        const projection = ExportProjectionSchema.parse({
          eventId: ObservabilityId.create(),
          traceId: ObservabilityId.create(),
          spanId: ObservabilityId.create(),
          type: "llm.call.finished",
          status: "finished",
          tsMs: now,
          durationMs: 1,
          modelProvider: "opencode-test",
          modelId: "export-connection-test",
          redactionStatus: "metadata_only",
          redactedClasses: [],
        })
        const results = await exportToAll(exporters, [projection])
        return c.json({ results })
      },
    )
