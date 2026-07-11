/**
 * Native observability read endpoints — Phase 1.
 *
 * Endpoints:
 *   GET /observability/health         Current instance's queue/circuit-breaker
 *                                       state. Per-project-instance
 *                                       (observability/runtime.ts), not global.
 *   GET /observability/settings       Resolved capture policy + Phase 1 storage
 *                                       disclosure flags for the settings UI.
 *   GET    /observability/events         Keyset-paginated events for one session.
 *   GET    /observability/events/:eventId Single event by its ULID.
 *   GET    /observability/summary        Aggregate counts/cost for one session.
 *   DELETE /observability/data           Delete events by scope. Requires
 *                                          header `X-Confirm-Delete: yes`.
 *
 * Ownership (ADR-1028): event.sql.ts's project_id/workspace_id columns are
 * never actually populated yet — no call site threads them through
 * TraceContext (only sessionId is set today). So the only scope that can be
 * verified is session_id -> session.projectID -> Instance.project.id. Every
 * events/delete route below resolves the session first and 404s (not 403 —
 * a non-revealing not-found, matching Session.get's own behavior) if it
 * belongs to a different project. `DELETE /data` only accepts "session",
 * "project" (id must equal the current instance's project), and "all" —
 * "workspace" is deferred until Instance exposes a verifiable current-
 * workspace identity to check against.
 */
import { Hono } from "hono"
import { describeRoute, resolver, validator } from "hono-openapi"
import z from "zod"
import { Config } from "../../config/config"
import { ObservabilityRuntime } from "../../observability/runtime"
import { resolveCapturePolicy } from "../../observability/capture-policy"
import { ObservabilityRepository, cursor, toDto } from "../../observability/repository"
import { deleteByScope, type DeleteScope } from "../../observability/purge"
import { Session } from "../../session"
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
  schemaVersion: z.number(),
})

// Throws the SAME NotFoundError shape as an unknown session/event so a
// cross-project probe can't distinguish "doesn't exist" from "exists but
// isn't yours". Takes a pre-validated SessionID (either from a
// SessionID.zod-typed Hono validator, or a raw DB column we wrote ourselves)
// — never re-parses, so a malformed id from user input surfaces as the
// standard 400 at the Hono validator layer, not an uncaught ZodError here.
async function requireOwnedSession(sessionId: SessionID) {
  const session = await Session.get(sessionId)
  if (session.projectID !== Instance.project.id) {
    throw new NotFoundError({ message: `Session not found: ${sessionId}` })
  }
  return session
}

const HealthSchema = z.object({
  enabled: z.boolean(),
  captureMode: z.enum(["local_metadata", "local_redacted"]),
  circuitOpen: z.boolean(),
  eventsInserted: z.number(),
  eventsFailedDb: z.number(),
  queueSize: z.number(),
  queueBytes: z.number(),
})

const DeleteBodySchema = z.discriminatedUnion("scope", [
  z.object({ scope: z.literal("all") }),
  z.object({ scope: z.literal("project"), id: z.string().min(1) }),
  z.object({ scope: z.literal("session"), id: SessionID.zod }),
])

const DeleteResultSchema = z.object({ deletedCount: z.number() })

const SummarySchema = z.object({
  sessionId: z.string(),
  totalEvents: z.number(),
  totalCostNanoUsd: z.number(),
  byType: z.record(z.string(), z.number()),
  byStatus: z.record(z.string(), z.number()),
  firstEventTsMs: z.number().optional(),
  lastEventTsMs: z.number().optional(),
})

const SettingsSchema = z.object({
  enabled: z.boolean(),
  captureMode: z.enum(["local_metadata", "local_redacted"]),
  policyVersion: z.literal(3),
  localFullAvailable: z.literal(false),
  storage: z.literal("sqlite_unencrypted_local"),
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
          eventsInserted: stats.eventsInserted,
          eventsFailedDb: stats.eventsFailedDb,
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
        return c.json({
          enabled: policy.enabled,
          captureMode: policy.level,
          policyVersion: policy.policyVersion,
          localFullAvailable: false,
          storage: "sqlite_unencrypted_local",
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
        const limit = query.limit ?? 50
        const page = ObservabilityRepository.page({ sessionId: query.sessionId, limit, before: query.before })
        if (page.cursor) {
          const url = new URL(c.req.url)
          url.searchParams.set("sessionId", query.sessionId)
          url.searchParams.set("limit", String(limit))
          url.searchParams.set("before", page.cursor)
          c.header("Access-Control-Expose-Headers", "Link, X-Next-Cursor")
          c.header("Link", `<${url.toString()}>; rel="next"`)
          c.header("X-Next-Cursor", page.cursor)
        }
        return c.json(page.items.map(toDto))
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
        return c.json(toDto(row))
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
    .delete(
      "/data",
      describeRoute({
        summary: "Delete observability data",
        description:
          "Destroys observability events for a scope (session/project/all). Requires header " +
          '`X-Confirm-Delete: yes`. "workspace" scope is not yet supported (see file header comment).',
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
