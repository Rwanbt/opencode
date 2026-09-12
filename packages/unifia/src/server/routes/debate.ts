import { Hono } from "hono"
import { describeRoute, validator, resolver } from "hono-openapi"
import z from "zod"
import { lazy } from "../../util/lazy"
import { Log } from "../../util/log"
import { SessionID } from "../../session/schema"
import { Collective, DebateSelection, Orchestrator, DebateStore } from "../../collective"

const log = Log.create({ service: "server.debate" })

export const DebateRoutes = lazy(() =>
  new Hono()
    .post(
      "/",
      describeRoute({
        summary: "Start debate",
        description:
          "Start a new collective intelligence debate. Returns the debate report when complete.",
        operationId: "debate.start",
        responses: {
          200: {
            description: "Debate report",
            content: { "application/json": { schema: resolver(Collective.DebateReport) } },
          },
        },
      }),
      validator("json", Collective.DebateConfig),
      async (c) => {
        const config = c.req.valid("json" as never) as Collective.DebateConfig
        try {
          const report = await Orchestrator.runPromiseExport(config)
          return c.json(report)
        } catch (e) {
          const message = e instanceof Error ? e.message : String(e)
          log.error("debate failed", { error: message })
          return c.json({ error: message }, 500)
        }
      },
    )
    .put(
      "/config",
      describeRoute({
        summary: "Configure global debate models",
        description: "Select the primary synthesis model and parallel participants reused by Debate mode.",
        operationId: "debate.config",
        responses: {
          200: {
            description: "Saved global debate selection",
            content: { "application/json": { schema: resolver(Collective.DebateSelection) } },
          },
        },
      }),
      validator("json", Collective.DebateSelection),
      async (c) => {
        const selection = c.req.valid("json" as never) as Collective.DebateSelection
        await DebateSelection.setGlobal(selection)
        return c.json(selection)
      },
    )
    .get(
      "/config",
      describeRoute({
        summary: "Get global debate models",
        description: "Return the Debate mode model selection reused across sessions.",
        operationId: "debate.getConfig",
        responses: {
          200: {
            description: "Global debate selection or null",
            content: { "application/json": { schema: resolver(Collective.DebateSelection.nullable()) } },
          },
        },
      }),
      async (c) => {
        const selection = await DebateSelection.getGlobal()
        return c.json(selection ?? null)
      },
    )    .put(
      "/session/:sessionID/config",
      describeRoute({
        summary: "Configure session debate models",
        description: "Select the primary synthesis model and the parallel debate participants for a session.",
        operationId: "debate.sessionConfig",
        responses: {
          200: {
            description: "Saved debate selection",
            content: { "application/json": { schema: resolver(Collective.DebateSelection) } },
          },
        },
      }),
      validator("json", Collective.DebateSelection),
      async (c) => {
        const sessionID = c.req.param("sessionID")
        const selection = c.req.valid("json" as never) as Collective.DebateSelection
        await DebateSelection.set(SessionID.zod.parse(sessionID), selection)
        return c.json(selection)
      },
    )
    .get(
      "/session/:sessionID/config",
      describeRoute({
        summary: "Get session debate models",
        description: "Return the configured debate models for a session, if any.",
        operationId: "debate.getSessionConfig",
        responses: {
          200: {
            description: "Debate selection or null",
            content: { "application/json": { schema: resolver(Collective.DebateSelection.nullable()) } },
          },
        },
      }),
      async (c) => {
        const selection = await DebateSelection.get(SessionID.zod.parse(c.req.param("sessionID")))
        return c.json(selection ?? null)
      },
    )
    .post(
      "/estimate",
      describeRoute({
        summary: "Estimate debate cost",
        description: "Estimate the token and cost budget for a debate configuration.",
        operationId: "debate.estimate",
        responses: {
          200: {
            description: "Budget estimate",
            content: { "application/json": { schema: resolver(Collective.BudgetEstimate) } },
          },
        },
      }),
      validator("json", Collective.DebateConfig),
      async (c) => {
        const config = c.req.valid("json" as never) as Collective.DebateConfig
        try {
          const estimate = await Orchestrator.estimatePromise(config)
          return c.json(estimate)
        } catch (e) {
          log.error("estimate failed", { error: String(e) })
          return c.json({ error: String(e) }, 500)
        }
      },
    )
    .get(
      "/:id",
      describeRoute({
        summary: "Get debate",
        description: "Get a debate by ID, including its report if completed.",
        operationId: "debate.get",
        responses: {
          200: {
            description: "Debate record",
            content: { "application/json": { schema: resolver(z.any()) } },
          },
        },
      }),
      async (c) => {
        const id = c.req.param("id") as Collective.DebateID
        try {
          const debate = await DebateStore.getPromise(id)
          return c.json(debate)
        } catch {
          return c.json({ error: `Debate ${id} not found` }, 404)
        }
      },
    )
    .get(
      "/",
      describeRoute({
        summary: "List debates",
        description: "List past debates, most recent first.",
        operationId: "debate.list",
        responses: {
          200: {
            description: "List of debates",
            content: {
              "application/json": {
                schema: resolver(z.array(z.any())),
              },
            },
          },
        },
      }),
      async (c) => {
        const limit = Number(c.req.query("limit") ?? 20)
        const debates = await DebateStore.listPromise(limit)
        return c.json(debates)
      },
    )
    .post(
      "/:id/feedback",
      describeRoute({
        summary: "Submit claim feedback",
        description:
          "Record that a user acted on (or dismissed) specific claims. Used to compute user_action_rate metric.",
        operationId: "debate.feedback",
        responses: {
          200: {
            description: "Feedback recorded",
            content: { "application/json": { schema: resolver(z.object({ ok: z.boolean() })) } },
          },
        },
      }),
      validator(
        "json",
        z.object({
          actions: z.array(
            z.object({
              claimId: z.string(),
              action: z.enum(["acted", "dismissed", "bookmarked"]),
            }),
          ),
        }),
      ),
      async (c) => {
        const id = c.req.param("id") as Collective.DebateID
        const body = c.req.valid("json" as never) as {
          actions: Array<{ claimId: string; action: string }>
        }
        try {
          await DebateStore.recordFeedbackPromise(id, body.actions)
          return c.json({ ok: true })
        } catch (e) {
          log.error("feedback failed", { error: String(e) })
          return c.json({ error: String(e) }, 500)
        }
      },
    ),
)
