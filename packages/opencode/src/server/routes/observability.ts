/**
 * Native observability read endpoints — Phase 1 (health + settings).
 *
 * Endpoints:
 *   GET /observability/health    Current instance's queue/circuit-breaker
 *                                 state. Per-project-instance (Instance.state
 *                                 in observability/runtime.ts), not global.
 *   GET /observability/settings  Resolved capture policy + Phase 1 storage
 *                                 disclosure flags for the settings UI.
 *
 * Event listing/detail and deletion routes land in a later slice — this file
 * only exposes what needs no cross-session ownership check (health/settings
 * describe the current process/config, not another user's data).
 */
import { Hono } from "hono"
import { describeRoute, resolver } from "hono-openapi"
import z from "zod"
import { Config } from "../../config/config"
import { ObservabilityRuntime } from "../../observability/runtime"
import { resolveCapturePolicy } from "../../observability/capture-policy"

const HealthSchema = z.object({
  enabled: z.boolean(),
  captureMode: z.enum(["local_metadata", "local_redacted"]),
  circuitOpen: z.boolean(),
  eventsInserted: z.number(),
  eventsFailedDb: z.number(),
  queueSize: z.number(),
  queueBytes: z.number(),
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
