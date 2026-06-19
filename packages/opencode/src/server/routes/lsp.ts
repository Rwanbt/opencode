// FORK: LSP routes exposées à l'humain (Phase 2 — ADR-0005 roadmap).
// Le backend LSP existe déjà (lsp/index.ts) mais n'était pas exposé via HTTP
// pour la consommation humaine directe (uniquement les agents).
// Chaque route : withTimeout 3 s + fallback silencieux pour ne pas bloquer
// l'éditeur quand le serveur LSP est lent ou indisponible.
import { Hono } from "hono"
import { describeRoute, validator, resolver } from "hono-openapi"
import z from "zod"
import { LSP } from "../../lsp"
import { withTimeout } from "../../util/timeout"
import { Log } from "../../util/log"
import { pathToFileURL } from "node:url"
import { errors } from "../error"

const log = Log.create({ service: "lsp-routes" })

const TIMEOUT_MS = 3_000

// ─── Shared Zod schemas ───────────────────────────────────────────────────────

const RangeSchema = z
  .object({
    start: z.object({ line: z.number(), character: z.number() }),
    end: z.object({ line: z.number(), character: z.number() }),
  })
  .meta({ ref: "LspRange" })

const LocationSchema = z
  .object({
    uri: z.string(),
    range: RangeSchema,
  })
  .meta({ ref: "LspLocation" })

const DiagnosticEntrySchema = z
  .object({
    range: RangeSchema,
    severity: z.number().int().min(1).max(4).optional().meta({
      description: "1=Error 2=Warning 3=Information 4=Hint",
    }),
    code: z.union([z.string(), z.number()]).optional(),
    source: z.string().optional(),
    message: z.string(),
  })
  .meta({ ref: "LspDiagnosticEntry" })

// Hover result is intentionally opaque: the LSP protocol allows contents to be
// a MarkupContent, a MarkedString, or an array thereof. Use z.any() to avoid
// constraining valid server responses.
const HoverResultSchema = z
  .object({
    contents: z.any().optional(),
    range: RangeSchema.optional(),
  })
  .nullable()
  .meta({ ref: "LspHoverResult" })

const LocInputSchema = z.object({
  file: z.string().meta({ description: "Absolute path to the file" }),
  line: z.number().int().min(0).meta({ description: "Zero-based line number" }),
  character: z.number().int().min(0).meta({ description: "Zero-based character offset" }),
})

// ─── Routes ──────────────────────────────────────────────────────────────────

export function LspRoutes() {
  return new Hono()
    .get(
      "/diagnostics",
      describeRoute({
        summary: "Get LSP diagnostics",
        description:
          "Return all diagnostics from connected LSP servers. Pass ?file= to filter to a single file path.",
        operationId: "lsp.diagnostics",
        responses: {
          200: {
            description: "Map of file path → diagnostic list",
            content: {
              "application/json": {
                schema: resolver(z.record(z.string(), DiagnosticEntrySchema.array())),
              },
            },
          },
        },
      }),
      validator(
        "query",
        z.object({
          file: z.string().optional().meta({ description: "Filter to this file path" }),
        }),
      ),
      async (c) => {
        const { file } = c.req.valid("query")
        const all = await LSP.diagnostics()
        if (file) {
          return c.json({ [file]: all[file] ?? [] })
        }
        return c.json(all)
      },
    )
    .post(
      "/hover",
      describeRoute({
        summary: "LSP hover",
        description: "Get type / documentation hover information at a position in a file.",
        operationId: "lsp.hover",
        responses: {
          200: {
            description: "Hover result or null when unavailable",
            content: {
              "application/json": {
                schema: resolver(HoverResultSchema),
              },
            },
          },
          ...errors(400),
        },
      }),
      validator("json", LocInputSchema),
      async (c) => {
        const input = c.req.valid("json")
        const result = await withTimeout(LSP.hover(input), TIMEOUT_MS).catch((err) => {
          log.warn("lsp.hover failed", { error: err instanceof Error ? err.message : String(err) })
          return null
        })
        return c.json(result ?? null)
      },
    )
    .post(
      "/definition",
      describeRoute({
        summary: "LSP go-to-definition",
        description: "Return source location(s) for the definition of the symbol at the given position.",
        operationId: "lsp.definition",
        responses: {
          200: {
            description: "List of definition locations (empty when not found)",
            content: {
              "application/json": {
                schema: resolver(LocationSchema.array()),
              },
            },
          },
          ...errors(400),
        },
      }),
      validator("json", LocInputSchema),
      async (c) => {
        const input = c.req.valid("json")
        const result = await withTimeout(LSP.definition(input), TIMEOUT_MS).catch((err) => {
          log.warn("lsp.definition failed", { error: err instanceof Error ? err.message : String(err) })
          return [] as unknown[]
        })
        return c.json(result ?? [])
      },
    )
    .post(
      "/references",
      describeRoute({
        summary: "LSP find references",
        description: "Return all references to the symbol at the given position.",
        operationId: "lsp.references",
        responses: {
          200: {
            description: "List of reference locations (empty when not found)",
            content: {
              "application/json": {
                schema: resolver(LocationSchema.array()),
              },
            },
          },
          ...errors(400),
        },
      }),
      validator("json", LocInputSchema),
      async (c) => {
        const input = c.req.valid("json")
        const result = await withTimeout(LSP.references(input), TIMEOUT_MS).catch((err) => {
          log.warn("lsp.references failed", { error: err instanceof Error ? err.message : String(err) })
          return [] as unknown[]
        })
        return c.json(result ?? [])
      },
    )
    .get(
      "/document-symbol",
      describeRoute({
        summary: "LSP document symbols",
        description:
          "Return all symbols (functions, classes, variables, etc.) defined in a file. Pass ?file= as an absolute path; the route converts it to a file:// URI internally.",
        operationId: "lsp.documentSymbol",
        responses: {
          200: {
            description: "List of document symbols (DocumentSymbol or flat Symbol)",
            content: {
              "application/json": {
                schema: resolver(z.union([LSP.DocumentSymbol, LSP.Symbol]).array()),
              },
            },
          },
          ...errors(400),
        },
      }),
      validator(
        "query",
        z.object({
          file: z.string().meta({ description: "Absolute path to the file" }),
        }),
      ),
      async (c) => {
        const { file } = c.req.valid("query")
        const uri = pathToFileURL(file).href
        const result = await withTimeout(LSP.documentSymbol(uri), TIMEOUT_MS).catch((err) => {
          log.warn("lsp.documentSymbol failed", { error: err instanceof Error ? err.message : String(err) })
          return [] as unknown[]
        })
        return c.json(result ?? [])
      },
    )
}
