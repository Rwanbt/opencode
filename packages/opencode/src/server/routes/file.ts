import { Hono } from "hono"
import { HTTPException } from "hono/http-exception"
import { describeRoute, validator, resolver } from "hono-openapi"
import z from "zod"
import { File } from "../../file"
import { Ripgrep } from "../../file/ripgrep"
import { LSP } from "../../lsp"
import { Instance } from "../../project/instance"
import { lazy } from "../../util/lazy"
import { Log } from "../../util/log"
import { withTimeout } from "../../util/timeout"

const log = Log.create({ service: "server" })

// FORK: file write API (ADR-0004) — map File service errors to typed HTTP codes.
// Without this, a plain Error falls through middleware.ts to a generic 500, so
// the editor could not distinguish conflict / escape / missing.
const StampSchema = z.object({
  hash: z.string(),
  mtime: z.number().optional(),
  size: z.number().optional(),
})

// ADR-0005: write returns the FINAL on-disk content (post-format) so the editor
// reconciles its buffer; stamp.hash keeps the next save's precondition correct.
const WriteResultSchema = z.object({
  content: z.string(),
  stamp: StampSchema,
  formatted: z.boolean(),
})

function rethrowFileError(e: unknown): never {
  if (e instanceof File.ConflictError || e instanceof File.TargetExistsError) {
    throw new HTTPException(409, { message: e.message })
  }
  if (e instanceof File.PathNotFoundError) {
    throw new HTTPException(404, { message: e.message })
  }
  if (e instanceof Error && e.message.startsWith("Access denied")) {
    throw new HTTPException(403, { message: e.message })
  }
  throw e
}
// END FORK

export const FileRoutes = lazy(() =>
  new Hono()
    .get(
      "/find",
      describeRoute({
        summary: "Find text",
        description: "Search for text patterns across files in the project using ripgrep.",
        operationId: "find.text",
        responses: {
          200: {
            description: "Matches",
            content: {
              "application/json": {
                schema: resolver(Ripgrep.Match.shape.data.array()),
              },
            },
          },
        },
      }),
      validator(
        "query",
        z.object({
          pattern: z.string(),
        }),
      ),
      async (c) => {
        const pattern = c.req.valid("query").pattern
        const result = await Ripgrep.search({
          cwd: Instance.directory,
          pattern,
          limit: 10,
        })
        return c.json(result)
      },
    )
    .get(
      "/find/file",
      describeRoute({
        summary: "Find files",
        description: "Search for files or directories by name or pattern in the project directory.",
        operationId: "find.files",
        responses: {
          200: {
            description: "File paths",
            content: {
              "application/json": {
                schema: resolver(z.string().array()),
              },
            },
          },
        },
      }),
      validator(
        "query",
        z.object({
          query: z.string(),
          dirs: z.enum(["true", "false"]).optional(),
          type: z.enum(["file", "directory"]).optional(),
          limit: z.coerce.number().int().min(1).max(200).optional(),
        }),
      ),
      async (c) => {
        const query = c.req.valid("query").query
        const dirs = c.req.valid("query").dirs
        const type = c.req.valid("query").type
        const limit = c.req.valid("query").limit
        const results = await File.search({
          query,
          limit: limit ?? 10,
          dirs: dirs !== "false",
          type,
        })
        return c.json(results)
      },
    )
    .get(
      "/find/symbol",
      describeRoute({
        summary: "Find symbols",
        description: "Search for workspace symbols like functions, classes, and variables using LSP.",
        operationId: "find.symbols",
        responses: {
          200: {
            description: "Symbols",
            content: {
              "application/json": {
                schema: resolver(LSP.Symbol.array()),
              },
            },
          },
        },
      }),
      validator(
        "query",
        z.object({
          query: z.string(),
        }),
      ),
      async (c) => {
        const query = c.req.valid("query").query
        // DEBT: D-23 — this route was accidentally stubbed to [] by an OpenAPI
        // regen (f969b1dac), not for perf. Re-enabled with a timeout + fallback
        // so a slow or stuck LSP degrades to an empty result instead of hanging
        // the request.
        const result = await withTimeout(LSP.workspaceSymbol(query), 5000).catch((err) => {
          log.warn("find.symbols failed", {
            error: err instanceof Error ? err.message : String(err),
          })
          return [] as LSP.Symbol[]
        })
        return c.json(result)
      },
    )
    .get(
      "/file",
      describeRoute({
        summary: "List files",
        description: "List files and directories in a specified path.",
        operationId: "file.list",
        responses: {
          200: {
            description: "Files and directories",
            content: {
              "application/json": {
                schema: resolver(File.Node.array()),
              },
            },
          },
        },
      }),
      validator(
        "query",
        z.object({
          path: z.string(),
        }),
      ),
      async (c) => {
        const path = c.req.valid("query").path
        const content = await File.list(path)
        return c.json(content)
      },
    )
    .get(
      "/file/content",
      describeRoute({
        summary: "Read file",
        description: "Read the content of a specified file.",
        operationId: "file.read",
        responses: {
          200: {
            description: "File content",
            content: {
              "application/json": {
                schema: resolver(File.Content),
              },
            },
          },
        },
      }),
      validator(
        "query",
        z.object({
          path: z.string(),
        }),
      ),
      async (c) => {
        const path = c.req.valid("query").path
        const content = await File.read(path)
        return c.json(content)
      },
    )
    .get(
      "/file/status",
      describeRoute({
        summary: "Get file status",
        description: "Get the git status of all files in the project.",
        operationId: "file.status",
        responses: {
          200: {
            description: "File status",
            content: {
              "application/json": {
                schema: resolver(File.Info.array()),
              },
            },
          },
        },
      }),
      async (c) => {
        const content = await File.status()
        return c.json(content)
      },
    )
    .post(
      "/file/mkdir",
      describeRoute({
        summary: "Create directory",
        description: "Create a directory (recursive) at the specified path.",
        operationId: "file.mkdir",
        responses: {
          200: {
            description: "Created directory",
            content: {
              "application/json": {
                schema: resolver(z.object({ absolute: z.string() })),
              },
            },
          },
        },
      }),
      validator(
        "json",
        z.object({
          path: z.string(),
        }),
      ),
      async (c) => {
        const dir = c.req.valid("json").path
        const result = await File.mkdir(dir)
        return c.json(result)
      },
    )
    // FORK: file write API (ADR-0004) — write/rename/move/delete + raw read.
    .get(
      "/file/raw",
      describeRoute({
        summary: "Read raw file",
        description: "Read raw (untrimmed) text content plus a content stamp for round-trip editing.",
        operationId: "file.readRaw",
        responses: {
          200: {
            description: "Raw content + stamp",
            content: {
              "application/json": {
                schema: resolver(z.object({ content: z.string(), stamp: StampSchema })),
              },
            },
          },
        },
      }),
      validator("query", z.object({ path: z.string() })),
      async (c) => {
        const path = c.req.valid("query").path
        try {
          return c.json(await File.readRaw(path))
        } catch (e) {
          rethrowFileError(e)
        }
      },
    )
    .post(
      "/file/write",
      describeRoute({
        summary: "Write file",
        description:
          "Write text content to a file. Rejects (409) if the file changed on disk since expectedHash. With format=true, runs the formatter and returns the final content.",
        operationId: "file.write",
        responses: {
          200: {
            description: "Final content + stamp",
            content: { "application/json": { schema: resolver(WriteResultSchema) } },
          },
        },
      }),
      validator(
        "json",
        z.object({
          path: z.string(),
          content: z.string(),
          expectedHash: z.string().optional(),
          format: z.boolean().optional(),
        }),
      ),
      async (c) => {
        const body = c.req.valid("json")
        try {
          return c.json(await File.write(body))
        } catch (e) {
          rethrowFileError(e)
        }
      },
    )
    .post(
      "/file/rename",
      describeRoute({
        summary: "Rename file",
        description: "Rename a file within the project. Rejects (409) if the destination exists or source changed.",
        operationId: "file.rename",
        responses: {
          200: {
            description: "Content stamp",
            content: { "application/json": { schema: resolver(StampSchema) } },
          },
        },
      }),
      validator("json", z.object({ from: z.string(), to: z.string(), expectedHash: z.string().optional() })),
      async (c) => {
        const body = c.req.valid("json")
        try {
          return c.json(await File.rename(body.from, body.to, body.expectedHash))
        } catch (e) {
          rethrowFileError(e)
        }
      },
    )
    .post(
      "/file/move",
      describeRoute({
        summary: "Move file",
        description: "Move a file within the project. Rejects (409) if the destination exists or source changed.",
        operationId: "file.move",
        responses: {
          200: {
            description: "Content stamp",
            content: { "application/json": { schema: resolver(StampSchema) } },
          },
        },
      }),
      validator("json", z.object({ from: z.string(), to: z.string(), expectedHash: z.string().optional() })),
      async (c) => {
        const body = c.req.valid("json")
        try {
          return c.json(await File.move(body.from, body.to, body.expectedHash))
        } catch (e) {
          rethrowFileError(e)
        }
      },
    )
    .delete(
      "/file",
      describeRoute({
        summary: "Delete file",
        description: "Delete a file. 404 if absent; rejects (409) if the file changed since expectedHash.",
        operationId: "file.delete",
        responses: {
          200: {
            description: "Deleted",
            content: { "application/json": { schema: resolver(z.object({ deleted: z.boolean() })) } },
          },
        },
      }),
      validator("json", z.object({ path: z.string(), expectedHash: z.string().optional() })),
      async (c) => {
        const body = c.req.valid("json")
        try {
          await File.remove(body)
          return c.json({ deleted: true })
        } catch (e) {
          rethrowFileError(e)
        }
      },
    ),
  // END FORK
)
