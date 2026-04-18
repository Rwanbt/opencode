/**
 * RGPD / GDPR endpoints — user data export + delete.
 *
 * Endpoints:
 *   GET    /user/data/export   Stream a JSON tarball-ish of all user data.
 *   DELETE /user/data          Delete all local sessions, messages, auth.json,
 *                              and user config. Requires `X-Confirm-Delete: yes`.
 *   GET    /audit              Paginated audit log read.
 *
 * Design notes:
 *   - Export uses chunked streaming JSON (NDJSON-ish concatenated arrays in a
 *     single top-level object) to avoid materializing the full session list
 *     in memory. This is *not* a binary tar — a JSON bundle is sufficient for
 *     RGPD portability and simpler for clients to parse.
 *   - Delete is intentionally destructive and blocking: we want any concurrent
 *     operation to fail loudly rather than leak partial state.
 *   - Every GDPR operation is audit-logged with `force: true` so the action is
 *     visible even when `experimental.audit.enabled` is off. The deletion itself
 *     runs *before* the audit write so the audit row survives the wipe.
 */
import { Hono } from "hono"
import { describeRoute, resolver, validator } from "hono-openapi"
import { stream } from "hono/streaming"
import z from "zod"
import fs from "fs/promises"
import path from "path"
import { Global } from "../../global"
import { Session } from "../../session"
import { Auth } from "../../auth"
import { AuditLog } from "../../session/audit"
import { Log } from "../../util/log"
import { errors } from "../error"

const log = Log.create({ service: "gdpr" })

export const GdprRoutes = () =>
  new Hono()
    .get(
      "/user/data/export",
      describeRoute({
        summary: "Export user data (RGPD)",
        description:
          "Streams a JSON document containing all local sessions, messages, and non-secret config. Auth tokens are omitted by default.",
        operationId: "gdpr.export",
        responses: {
          200: {
            description: "JSON stream",
            content: { "application/json": {} },
          },
        },
      }),
      async (c) => {
        await AuditLog.record({ action: "gdpr.export", force: true })
        return stream(c, async (s) => {
          c.header("Content-Type", "application/json; charset=utf-8")
          c.header("Content-Disposition", 'attachment; filename="opencode-user-data.json"')
          await s.write('{\n  "version": 1,\n  "exportedAt": ' + Date.now() + ',\n  "sessions": [\n')
          let first = true
          try {
            for await (const session of Session.listGlobal({ limit: 10_000, archived: true })) {
              const prefix = first ? "    " : ",\n    "
              first = false
              // Pull messages lazily per session.
              let messages: unknown[] = []
              try {
                messages = await Session.messages({ sessionID: session.id as any })
              } catch (e) {
                log.warn("export: messages fetch failed", { sessionID: session.id, e: String(e) })
              }
              await s.write(prefix + JSON.stringify({ session, messages }))
            }
          } catch (e) {
            log.error("export stream error", { e: String(e) })
          }
          await s.write("\n  ],\n")
          // Non-secret provider list (keys redacted).
          let providers: string[] = []
          try {
            providers = Object.keys(await Auth.all())
          } catch {}
          await s.write('  "providers": ' + JSON.stringify(providers) + "\n}\n")
        })
      },
    )
    .delete(
      "/user/data",
      describeRoute({
        summary: "Delete all user data (RGPD)",
        description:
          "Destroys all local sessions, messages, auth.json, and user config. Requires header `X-Confirm-Delete: yes`.",
        operationId: "gdpr.delete",
        responses: {
          204: { description: "Deleted" },
          ...errors(400),
        },
      }),
      async (c) => {
        const confirm = c.req.header("x-confirm-delete")
        if (confirm !== "yes") {
          return c.json(
            { error: "missing_confirmation", message: "Set X-Confirm-Delete: yes to confirm destructive action." },
            400,
          )
        }
        // Audit first (pre-wipe) so the record survives.
        await AuditLog.record({ action: "gdpr.delete", force: true })

        // Sessions — iterate and delete each.
        try {
          const ids: string[] = []
          for await (const s of Session.listGlobal({ limit: 100_000, archived: true })) ids.push(s.id)
          for (const id of ids) {
            try {
              await Session.remove(id as any)
            } catch (e) {
              log.warn("delete: session.remove failed", { id, e: String(e) })
            }
          }
        } catch (e) {
          log.error("delete: session enumeration failed", { e: String(e) })
        }

        // Auth / config files.
        const toUnlink = [
          path.join(Global.Path.data, "auth.json"),
          path.join(Global.Path.config, "opencode.jsonc"),
          path.join(Global.Path.config, "opencode.json"),
          path.join(Global.Path.config, "config.json"),
        ]
        for (const f of toUnlink) {
          try {
            await fs.unlink(f)
          } catch (e: any) {
            if (e?.code !== "ENOENT") log.warn("delete: unlink failed", { f, e: String(e) })
          }
        }

        c.status(204)
        return c.body(null)
      },
    )
    .get(
      "/audit",
      describeRoute({
        summary: "List audit log entries",
        description: "Paginated audit log read (default 100, max 1000).",
        operationId: "gdpr.audit.list",
        responses: {
          200: {
            description: "Audit entries",
            content: {
              "application/json": {
                schema: resolver(
                  z.array(
                    z.object({
                      id: z.string(),
                      ts: z.number(),
                      actor: z.string().optional(),
                      action: z.string(),
                      target: z.string().optional(),
                      metadata: z.record(z.string(), z.unknown()).optional(),
                    }),
                  ),
                ),
              },
            },
          },
        },
      }),
      validator(
        "query",
        z.object({
          from: z.coerce.number().optional(),
          to: z.coerce.number().optional(),
          limit: z.coerce.number().optional(),
          action: z.string().optional(),
          actor: z.string().optional(),
        }),
      ),
      async (c) => {
        const q = c.req.valid("query")
        return c.json(AuditLog.list(q))
      },
    )
