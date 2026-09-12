// =============================================================================
// routes/model-intelligence.ts — TEAM-L02
//
// HTTP surface over the model-intelligence registry: which providers and
// models exist, what they cost, what state they are in.
//
//   Versioned      Responses carry the registry's own `schemaVersion`, not the
//                  server's. A client pinned to N-1 needs to know which schema
//                  produced the rows it is holding, not when it fetched them.
//
//   Paginated      The registry is a few thousand models and grows with every
//                  provider. An unpaginated list is a route that works in
//                  development and times out in production.
//
//   Not initialised is a 503, not a 500. The registry is loaded on demand; a
//   client that asks too early should retry, and a 500 tells it not to.
//
// No route here mutates a model. `POST /sync` refreshes from the configured
// source and is the one write: it is idempotent by construction — syncing an
// already-current registry is a no-op that reports zero changes.
// =============================================================================

import { Hono, type Context } from "hono"
import { describeRoute, resolver, validator } from "hono-openapi"
import z from "zod"
import { Effect } from "effect"
import { lazy } from "../../util/lazy"
import { Log } from "../../util/log"
import { makeRuntime } from "../../effect/run-service"
import { Registry, LiveRegistryLayer, type ModelFilter } from "../../model-intelligence/registry"
import { RegistryNotInitializedError } from "../../model-intelligence/errors"
import { Model, Provider } from "../../model-intelligence/schema"
import { SCHEMA_VERSION } from "../../model-intelligence/schema-version"
import { invalidQuery, rejectUnknownQuery } from "./query"

const log = Log.create({ service: "server.model-intelligence" })

const { runPromise } = makeRuntime(Registry, LiveRegistryLayer)

const MAX_PAGE_SIZE = 500
const DEFAULT_PAGE_SIZE = 100

const ErrorSchema = z.object({ error: z.string() })

const PageSchema = z.object({
  schemaVersion: z.string(),
  items: z.array(z.unknown()),
  nextCursor: z.string().nullable(),
  total: z.number(),
})

// Derived from the registry schema, never re-typed here. A hand-written copy
// drifts the moment a status is added, and the drift shows up as a 400 on a
// value the registry considers perfectly valid.
const MODEL_STATUS = Model.shape.status.options
const PROVIDER_STATUS = Provider.shape.status.options
const MODALITY = ["text", "audio", "image", "video", "pdf"] as const

/**
 * Paging shared by both list routes.
 *
 * Declared through `validator` rather than parsed from `c.req.query()` so the
 * parameters reach the OpenAPI document and the generated SDK. A hand-parsed
 * parameter is invisible to codegen, and an SDK that cannot express a page
 * leaves every consumer reading the first one as if it were the whole list.
 */
const PageQuery = {
  limit: z.coerce.number().int().min(1).max(MAX_PAGE_SIZE).default(DEFAULT_PAGE_SIZE),
  cursor: z.coerce.number().int().min(0).default(0),
}

// The enums are carried in the schema, not checked afterwards, so that the SDK
// receives them as a union: a consumer gets `status: "active" | ...` from the
// type system instead of discovering the valid set from a 400.
const ModelQuerySchema = z.object({
  ...PageQuery,
  providerID: z.string().min(1).optional(),
  status: z.enum(MODEL_STATUS).optional(),
  lifecycleStage: z.string().min(1).optional(),
  modality: z.enum(MODALITY).optional(),
})

const ProviderQuerySchema = z.object({
  ...PageQuery,
  status: z.enum(PROVIDER_STATUS).optional(),
})

const MODEL_QUERY = Object.keys(ModelQuerySchema.shape)
const PROVIDER_QUERY = Object.keys(ProviderQuerySchema.shape)

/**
 * Slice an in-memory list into a page.
 *
 * The registry is held whole in memory and is not append-ordered, so there is
 * no key to seek on: an offset cursor is what the underlying data supports.
 * `total` is returned alongside so a client can tell a short last page from a
 * truncated one.
 */
function page<T>(items: readonly T[], offset: number, limit: number) {
  const visible = items.slice(offset, offset + limit)
  const nextOffset = offset + visible.length
  return {
    schemaVersion: SCHEMA_VERSION,
    items: visible,
    nextCursor: nextOffset < items.length ? String(nextOffset) : null,
    total: items.length,
  }
}

/**
 * The registry not being loaded yet is a temporary condition, so it is a 503
 * with a retry hint rather than a 500 the client will give up on.
 */
function registryError(c: Context, error: unknown, context: string) {
  if (error instanceof RegistryNotInitializedError || (error as { _tag?: string })?._tag === "RegistryNotInitializedError") {
    return c.json({ error: "model registry is not loaded yet; sync it or retry" }, 503)
  }
  if (error instanceof TypeError || error instanceof RangeError) return c.json({ error: error.message }, 400)
  log.error(context, { error: error instanceof Error ? error.message : String(error) })
  return c.json({ error: "internal error" }, 500)
}

export const ModelIntelligenceRoutes = lazy(() =>
  new Hono()
    .get(
      "/models",
      describeRoute({
        summary: "List models",
        description: "List models known to the registry, optionally filtered by provider, status, lifecycle or modality.",
        operationId: "modelIntelligence.listModels",
        responses: {
          200: { description: "A page of models", content: { "application/json": { schema: resolver(PageSchema) } } },
          400: { description: "Unknown filter, cursor or limit", content: { "application/json": { schema: resolver(ErrorSchema) } } },
          503: { description: "Registry not loaded", content: { "application/json": { schema: resolver(ErrorSchema) } } },
        },
      }),
      validator("query", ModelQuerySchema, invalidQuery),
      async (c) => {
        const unknown = rejectUnknownQuery(c.req.url, MODEL_QUERY)
        if (unknown) return c.json({ error: unknown }, 400)
        const query = c.req.valid("query")
        try {
          const filter: ModelFilter = {}
          if (query.providerID) filter.providerID = query.providerID
          if (query.status) filter.status = query.status
          if (query.lifecycleStage) filter.lifecycleStage = query.lifecycleStage as NonNullable<ModelFilter["lifecycleStage"]>
          if (query.modality) filter.modality = query.modality

          const models = await runPromise((svc) => svc.listModels(filter))
          return c.json(page(models, query.cursor, query.limit))
        } catch (e) {
          return registryError(c, e, "list models failed")
        }
      },
    )
    .get(
      "/providers",
      describeRoute({
        summary: "List providers",
        description: "List providers known to the registry.",
        operationId: "modelIntelligence.listProviders",
        responses: {
          200: { description: "A page of providers", content: { "application/json": { schema: resolver(PageSchema) } } },
          400: { description: "Unknown filter, cursor or limit", content: { "application/json": { schema: resolver(ErrorSchema) } } },
          503: { description: "Registry not loaded", content: { "application/json": { schema: resolver(ErrorSchema) } } },
        },
      }),
      validator("query", ProviderQuerySchema, invalidQuery),
      async (c) => {
        const unknown = rejectUnknownQuery(c.req.url, PROVIDER_QUERY)
        if (unknown) return c.json({ error: unknown }, 400)
        const query = c.req.valid("query")
        try {
          const providers = await runPromise((svc) => svc.listProviders(query.status ? { status: query.status } : undefined))
          return c.json(page(providers, query.cursor, query.limit))
        } catch (e) {
          return registryError(c, e, "list providers failed")
        }
      },
    )
    .get(
      "/models/:providerID/:modelID",
      describeRoute({
        summary: "Get a model",
        description: "Fetch one model by provider and model id.",
        operationId: "modelIntelligence.getModel",
        responses: {
          200: { description: "The model", content: { "application/json": { schema: resolver(z.unknown()) } } },
          404: { description: "No such model", content: { "application/json": { schema: resolver(ErrorSchema) } } },
          503: { description: "Registry not loaded", content: { "application/json": { schema: resolver(ErrorSchema) } } },
        },
      }),
      async (c) => {
        const providerID = c.req.param("providerID")
        const modelID = c.req.param("modelID")
        try {
          const model = await runPromise((svc) => svc.getModel(providerID, modelID))
          if (model === null) return c.json({ error: `model ${providerID}/${modelID} not found` }, 404)
          return c.json({ schemaVersion: SCHEMA_VERSION, model })
        } catch (e) {
          return registryError(c, e, "get model failed")
        }
      },
    )
    .get(
      "/aliases/:alias",
      describeRoute({
        summary: "Resolve a model alias",
        description: "Resolve an alias such as a vendor shorthand to the concrete provider and model it names.",
        operationId: "modelIntelligence.resolveAlias",
        responses: {
          200: { description: "The resolved alias", content: { "application/json": { schema: resolver(z.unknown()) } } },
          404: { description: "No such alias", content: { "application/json": { schema: resolver(ErrorSchema) } } },
          503: { description: "Registry not loaded", content: { "application/json": { schema: resolver(ErrorSchema) } } },
        },
      }),
      async (c) => {
        const alias = c.req.param("alias")
        try {
          const resolved = await runPromise((svc) => svc.resolveAlias(alias))
          if (resolved === null) return c.json({ error: `alias ${alias} not found` }, 404)
          return c.json({ schemaVersion: SCHEMA_VERSION, resolved })
        } catch (e) {
          return registryError(c, e, "resolve alias failed")
        }
      },
    )
    .get(
      "/snapshot",
      describeRoute({
        summary: "Get the registry snapshot hash",
        description:
          "Return the registry's content hash and schema version. A client that already holds this hash needs no further fetch.",
        operationId: "modelIntelligence.snapshot",
        responses: {
          200: {
            description: "Snapshot identity",
            content: {
              "application/json": {
                schema: resolver(z.object({ schemaVersion: z.string(), hash: z.string(), byteLength: z.number() })),
              },
            },
          },
          503: { description: "Registry not loaded", content: { "application/json": { schema: resolver(ErrorSchema) } } },
        },
      }),
      async (c) => {
        try {
          const snapshot = await runPromise((svc) => svc.snapshot())
          // The snapshot body itself is not returned here: it is megabytes,
          // and every consumer that wants rows wants them filtered anyway.
          return c.json({ schemaVersion: SCHEMA_VERSION, hash: snapshot.hash, byteLength: snapshot.json.length })
        } catch (e) {
          return registryError(c, e, "snapshot failed")
        }
      },
    )
    .get(
      "/licenses",
      describeRoute({
        summary: "Get registry license notices",
        description: "Attribution and license notices for the data sources the registry ingests.",
        operationId: "modelIntelligence.licenses",
        responses: {
          200: {
            description: "License notices",
            content: { "application/json": { schema: resolver(z.object({ schemaVersion: z.string(), notices: z.string() })) } },
          },
          503: { description: "Registry not loaded", content: { "application/json": { schema: resolver(ErrorSchema) } } },
        },
      }),
      async (c) => {
        try {
          const notices = await runPromise((svc) => svc.licenseNotices())
          return c.json({ schemaVersion: SCHEMA_VERSION, notices })
        } catch (e) {
          return registryError(c, e, "license notices failed")
        }
      },
    )
    .get(
      "/health",
      describeRoute({
        summary: "Registry load state",
        description: "Whether the registry has been loaded. Always 200, so a client can poll it without treating it as an error.",
        operationId: "modelIntelligence.health",
        responses: {
          200: {
            description: "Load state",
            content: { "application/json": { schema: resolver(z.object({ schemaVersion: z.string(), loaded: z.boolean() })) } },
          },
        },
      }),
      async (c) => {
        const loaded = await runPromise((svc) => svc.isLoaded()).catch(() => false)
        return c.json({ schemaVersion: SCHEMA_VERSION, loaded })
      },
    )
    .post(
      "/sync",
      describeRoute({
        summary: "Sync the registry from its source",
        description:
          "Refresh the registry. Idempotent: syncing an already-current registry reports zero changes rather than duplicating rows.",
        operationId: "modelIntelligence.sync",
        responses: {
          200: { description: "Sync result", content: { "application/json": { schema: resolver(z.unknown()) } } },
          400: { description: "Unknown query parameter", content: { "application/json": { schema: resolver(ErrorSchema) } } },
          502: { description: "The source could not be fetched, parsed or validated", content: { "application/json": { schema: resolver(ErrorSchema) } } },
        },
      }),
      async (c) => {
        const unknown = rejectUnknownQuery(c.req.url, ["force", "validate"])
        if (unknown) return c.json({ error: unknown }, 400)
        const force = c.req.query("force") === "true"
        const validate = c.req.query("validate") !== "false"
        try {
          const result = await runPromise((svc) => svc.sync({ force, validate }).pipe(Effect.orDie))
          return c.json({ schemaVersion: SCHEMA_VERSION, ...result })
        } catch (e) {
          // A failing upstream source is not this server failing: 502 tells the
          // caller the fault is downstream of us and retrying may help.
          const message = e instanceof Error ? e.message : String(e)
          log.error("registry sync failed", { error: message })
          return c.json({ error: `registry source failed: ${message}` }, 502)
        }
      },
    ),
)
