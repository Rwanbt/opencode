import { Hono } from "hono"
import { describeRoute } from "hono-openapi"
import { resolver, validator as zValidator } from "hono-openapi/zod"
import { Project } from "../project/project"

export const ProjectRoute = new Hono().get(
  "/",
  describeRoute({
    description: "List all projects",
    operationId: "project.list",
    responses: {
      200: {
        description: "List of projects",
        content: {
          "application/json": {
            schema: resolver(Project.Info.array()),
          },
        },
      },
    },
  }),
  async (c) => {
    const projects = await Project.list()
    return c.json(projects)
  },
)
