import { Hono } from "hono"
import { describeRoute, resolver, validator } from "hono-openapi"
import z from "zod"
import { errors } from "../error"
import { Log } from "../../util/log"

const log = Log.create({ service: "agent-skills" })

/**
 * HTTP API for exposing OpenCode tools as AnythingLLM Agent Skills.
 * AnythingLLM can call these endpoints to execute OpenCode tools.
 */
export const AgentSkillRoutes = () =>
  new Hono()
    .get(
      "/",
      describeRoute({
        summary: "List agent skills",
        description: "List available OpenCode tools in AnythingLLM Agent Skill format.",
        operationId: "agentSkills.list",
        responses: {
          200: {
            description: "Available skills",
            content: {
              "application/json": {
                schema: resolver(
                  z.array(
                    z.object({
                      id: z.string(),
                      name: z.string(),
                      description: z.string(),
                      parameters: z.record(z.any()),
                    }),
                  ),
                ),
              },
            },
          },
        },
      }),
      async (c) => {
        // Lazy import to avoid circular dependency
        const { Tool } = await import("../../tool/tool")
        const registry = await import("../../tool/registry")

        const tools = await registry.list()
        const skills = tools.map((t) => ({
          id: t.id,
          name: t.id,
          description: t.description || `OpenCode tool: ${t.id}`,
          parameters: t.parameters || {},
        }))

        return c.json(skills)
      },
    )
    .post(
      "/:toolId/execute",
      describeRoute({
        summary: "Execute agent skill",
        description: "Execute an OpenCode tool by ID. Returns the tool output.",
        operationId: "agentSkills.execute",
        responses: {
          200: {
            description: "Execution result",
            content: {
              "application/json": {
                schema: resolver(
                  z.object({
                    success: z.boolean(),
                    output: z.string(),
                    title: z.string().optional(),
                    metadata: z.record(z.any()).optional(),
                    error: z.string().optional(),
                  }),
                ),
              },
            },
          },
          ...errors(400, 404),
        },
      }),
      validator(
        "param",
        z.object({
          toolId: z.string(),
        }),
      ),
      validator(
        "json",
        z.object({
          args: z.record(z.any()),
          sessionID: z.string().optional(),
        }),
      ),
      async (c) => {
        const { toolId } = c.req.valid("param")
        const { args } = c.req.valid("json")

        log.info("executing agent skill", { toolId, args: Object.keys(args) })

        try {
          const registry = await import("../../tool/registry")
          const tools = await registry.list()
          const tool = tools.find((t) => t.id === toolId)

          if (!tool) {
            return c.json({ success: false, output: "", error: `Tool not found: ${toolId}` }, 404)
          }

          // Initialize the tool and execute
          const def = await tool.init()
          const result = await def.execute(args, {
            sessionID: "agent-skill" as any,
            messageID: "agent-skill" as any,
            agent: "general",
            abort: AbortSignal.timeout(60000),
            callID: `skill_${Date.now()}`,
            messages: [],
            metadata: () => {},
            ask: async () => {},
          } as any)

          return c.json({
            success: true,
            output: typeof result === "string" ? result : result.output,
            title: typeof result === "object" ? result.title : undefined,
            metadata: typeof result === "object" ? result.metadata : undefined,
          })
        } catch (e: any) {
          log.error("agent skill execution failed", { toolId, error: e.message })
          return c.json({ success: false, output: "", error: e.message }, 500)
        }
      },
    )
