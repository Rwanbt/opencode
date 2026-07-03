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
    // FORK: Stretch Phase 2 — LSP rename symbol
    .post(
      "/rename",
      describeRoute({
        summary: "LSP rename symbol",
        description: "Rename a symbol at the given position across the workspace. Returns a WorkspaceEdit.",
        operationId: "lsp.rename",
        responses: {
          200: {
            description: "WorkspaceEdit — map of file URI → TextEdit[]",
            content: {
              "application/json": {
                schema: resolver(
                  z.object({ changes: z.record(z.string(), z.array(z.object({ range: RangeSchema, newText: z.string() }))) })
                    .meta({ ref: "LspWorkspaceEdit" }),
                ),
              },
            },
          },
          ...errors(400),
        },
      }),
      validator("json", LocInputSchema.extend({ newName: z.string().min(1) })),
      async (c) => {
        const input = c.req.valid("json")
        const result = await withTimeout(LSP.rename(input), 5_000).catch((err) => {
          log.warn("lsp.rename failed", { error: err instanceof Error ? err.message : String(err) })
          return { changes: {} }
        })
        return c.json(result ?? { changes: {} })
      },
    )
    // FORK: Stretch Phase 2 — LSP code actions (Ctrl+.)
    .post(
      "/code-action",
      describeRoute({
        summary: "LSP code actions",
        description: "Return code actions (quick fixes, refactors, source actions) available at the given range.",
        operationId: "lsp.codeAction",
        responses: {
          200: {
            description: "List of CodeAction objects (may include WorkspaceEdit and/or Command)",
            content: { "application/json": { schema: resolver(z.array(z.any()).meta({ ref: "LspCodeActions" })) } },
          },
          ...errors(400),
        },
      }),
      validator(
        "json",
        LocInputSchema.extend({
          endLine: z.number().int().min(0),
          endCharacter: z.number().int().min(0),
        }),
      ),
      async (c) => {
        const input = c.req.valid("json")
        const result = await withTimeout(LSP.codeAction(input), 5_000).catch((err) => {
          log.warn("lsp.codeAction failed", { error: err instanceof Error ? err.message : String(err) })
          return [] as unknown[]
        })
        return c.json(result ?? [])
      },
    )
    // FORK: Stretch Phase 2 — LSP execute command (companion to code actions)
    .post(
      "/execute-command",
      describeRoute({
        summary: "LSP execute command",
        description: "Execute a workspace command returned by a code action that has no WorkspaceEdit.",
        operationId: "lsp.executeCommand",
        responses: {
          200: {
            description: "Command result (opaque — varies per LSP server)",
            content: { "application/json": { schema: resolver(z.any()) } },
          },
          ...errors(400),
        },
      }),
      validator(
        "json",
        LocInputSchema.extend({
          command: z.string().min(1),
          commandArgs: z.array(z.unknown()).optional(),
        }),
      ),
      async (c) => {
        const input = c.req.valid("json")
        const result = await withTimeout(LSP.executeCommand(input), 8_000).catch((err) => {
          log.warn("lsp.executeCommand failed", { error: err instanceof Error ? err.message : String(err) })
          return null
        })
        return c.json(result ?? null)
      },
    )
    // FORK: Stretch Phase 2 — LSP completion (autocomplete)
    .post(
      "/completion",
      describeRoute({
        summary: "LSP completion",
        description: "Return completion items at the given position (for autocomplete).",
        operationId: "lsp.completion",
        responses: {
          200: {
            description: "List of completion items",
            content: {
              "application/json": {
                schema: resolver(z.array(z.any()).meta({ ref: "LspCompletionItems" })),
              },
            },
          },
          ...errors(400),
        },
      }),
      validator("json", LocInputSchema.extend({ triggerCharacter: z.string().optional() })),
      async (c) => {
        const input = c.req.valid("json")
        const result = await withTimeout(LSP.completion(input), TIMEOUT_MS).catch((err) => {
          log.warn("lsp.completion failed", { error: err instanceof Error ? err.message : String(err) })
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
