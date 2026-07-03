import { Hono } from "hono"
import { describeRoute, validator, resolver } from "hono-openapi"
import z from "zod"
import { lazy } from "../../util/lazy"
import { Log } from "../../util/log"
import { Collective, Orchestrator, DebateStore } from "../../collective"

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
          log.error("debate failed", { error: String(e) })
          return c.json({ error: String(e) }, 500)
        }
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
