import { Effect, Layer, ServiceMap } from "effect"
import { eq, desc, and, sql } from "drizzle-orm"
import { createHash } from "node:crypto"
import { NamedError } from "@opencode-ai/util/error"
import z from "zod"
import { Database } from "../storage/db"
import { DebateTable, ClaimTable, ClaimFeedbackTable } from "./debate-store.sql"
import { Collective } from "./types"
import { Log } from "../util/log"
import { makeRuntime } from "../effect/run-service"

export namespace DebateStore {
  const log = Log.create({ service: "debate-store" })

  export const NotFoundError = NamedError.create(
    "DebateNotFoundError",
    z.object({ debateID: z.string() }),
  )

  export function hashPrompt(prompt: string): string {
    return createHash("sha256").update(prompt.trim().toLowerCase()).digest("hex").slice(0, 16)
  }

  export function hashWorkspace(directory: string): string {
    return createHash("sha256").update(directory).digest("hex").slice(0, 16)
  }

  export interface Interface {
    readonly create: (
      config: Collective.DebateConfig,
      providerCount: number,
      directory: string,
    ) => Effect.Effect<Collective.DebateID>
    readonly get: (
      id: Collective.DebateID,
    ) => Effect.Effect<typeof DebateTable.$inferSelect, InstanceType<typeof NotFoundError>>
    readonly updateStatus: (id: Collective.DebateID, status: Collective.DebateStatus) => Effect.Effect<void>
    readonly saveReport: (id: Collective.DebateID, report: Collective.DebateReport) => Effect.Effect<void>
    readonly setError: (id: Collective.DebateID, error: string) => Effect.Effect<void>
    readonly list: (limit?: number) => Effect.Effect<Array<typeof DebateTable.$inferSelect>>
    readonly saveClaims: (debateID: Collective.DebateID, claims: Collective.Claim[]) => Effect.Effect<void>
    readonly getClaims: (debateID: Collective.DebateID) => Effect.Effect<Array<typeof ClaimTable.$inferSelect>>
    readonly queryPastDebates: (
      prompt: string,
      directory: string,
      limit?: number,
    ) => Effect.Effect<Array<typeof DebateTable.$inferSelect>>
    readonly seedWithPastBlindSpots: (
      prompt: string,
      directory: string,
      maxSeeds?: number,
    ) => Effect.Effect<Collective.Claim[]>
    readonly garbageCollect: (maxAgeDays: number) => Effect.Effect<number>
    readonly recordFeedback: (
      debateID: Collective.DebateID,
      actions: Array<{ claimId: string; action: string }>,
    ) => Effect.Effect<void>
    readonly getUserActionRate: (debateID: Collective.DebateID) => Effect.Effect<number>
  }

  export class Service extends ServiceMap.Service<Service, Interface>()("@opencode/DebateStore") {}

  export const layer = Layer.effect(
    Service,
    Effect.gen(function* () {
      const create = Effect.fn("DebateStore.create")(function* (
        config: Collective.DebateConfig,
        providerCount: number,
        directory: string,
      ) {
        const id = Collective.DebateID.make()
        log.info("creating debate", { id, tier: config.tier })
        Database.use((db) => {
          db.insert(DebateTable)
            .values({
              id,
              status: "pending",
              prompt: config.question,
              prompt_hash: hashPrompt(config.question),
              workspace_hash: hashWorkspace(directory),
              tier: config.tier,
              config,
              provider_count: providerCount,
            })
            .run()
        })
        return id
      })

      const get = Effect.fn("DebateStore.get")(function* (id: Collective.DebateID) {
        const row = Database.use((db) => db.select().from(DebateTable).where(eq(DebateTable.id, id)).get())
        if (!row) return yield* Effect.fail(new NotFoundError({ debateID: id }))
        return row
      })

      const updateStatus = Effect.fn("DebateStore.updateStatus")(function* (
        id: Collective.DebateID,
        status: Collective.DebateStatus,
      ) {
        log.info("updating status", { id, status })
        Database.use((db) => {
          db.update(DebateTable).set({ status, time_updated: Date.now() }).where(eq(DebateTable.id, id)).run()
        })
      })

      const saveReport = Effect.fn("DebateStore.saveReport")(function* (
        id: Collective.DebateID,
        report: Collective.DebateReport,
      ) {
        log.info("saving report", { id, blindSpots: report.blindSpots.length })
        Database.use((db) => {
          db.update(DebateTable)
            .set({
              status: "completed",
              report,
              cost: report.cost,
              duration_ms: report.durationMs,
              blind_spot_count: report.blindSpots.length,
              time_updated: Date.now(),
            })
            .where(eq(DebateTable.id, id))
            .run()
        })
      })

      const setError = Effect.fn("DebateStore.setError")(function* (
        id: Collective.DebateID,
        error: string,
      ) {
        log.info("setting error", { id })
        Database.use((db) => {
          db.update(DebateTable)
            .set({ status: "failed", error, time_updated: Date.now() })
            .where(eq(DebateTable.id, id))
            .run()
        })
      })

      const list = Effect.fn("DebateStore.list")(function* (limit?: number) {
        return Database.use((db) =>
          db.select().from(DebateTable).orderBy(desc(DebateTable.time_created)).limit(limit ?? 20).all(),
        )
      })

      const saveClaims = Effect.fn("DebateStore.saveClaims")(function* (
        debateID: Collective.DebateID,
        claims: Collective.Claim[],
      ) {
        log.info("saving claims", { debateID, count: claims.length })
        Database.use((db) => {
          for (const claim of claims) {
            db.insert(ClaimTable)
              .values({
                id: claim.claimId,
                debate_id: debateID,
                source_id: claim.sourceId,
                source_provider: claim.sourceProvider,
                category: claim.category,
                content: claim.content,
                confidence: claim.confidenceSelf,
                novelty: claim.noveltyMarker,
                is_actionable: claim.isActionable,
                verification_hint: claim.verificationHint,
                is_existence_claim: claim.isExistenceClaim,
                jargon_risk: claim.jargonRisk,
                is_recovered: claim.isRecovered,
              })
              .run()
          }
        })
      })

      const getClaims = Effect.fn("DebateStore.getClaims")(function* (debateID: Collective.DebateID) {
        return Database.use((db) =>
          db.select().from(ClaimTable).where(eq(ClaimTable.debate_id, debateID)).all(),
        )
      })

      const queryPastDebates = Effect.fn("DebateStore.queryPastDebates")(function* (
        prompt: string,
        directory: string,
        limit?: number,
      ) {
        const ph = hashPrompt(prompt)
        const wh = hashWorkspace(directory)
        return Database.use((db) =>
          db
            .select()
            .from(DebateTable)
            .where(
              and(
                eq(DebateTable.workspace_hash, wh),
                eq(DebateTable.status, "completed"),
              ),
            )
            .orderBy(
              sql`CASE WHEN ${DebateTable.prompt_hash} = ${ph} THEN 0 ELSE 1 END`,
              desc(DebateTable.time_created),
            )
            .limit(limit ?? 5)
            .all(),
        )
      })

      const seedWithPastBlindSpots = Effect.fn("DebateStore.seedWithPastBlindSpots")(function* (
        prompt: string,
        directory: string,
        maxSeeds?: number,
      ) {
        const pastDebates = yield* queryPastDebates(prompt, directory, 3)
        const seeds: Collective.Claim[] = []

        for (const debate of pastDebates) {
          if (!debate.report) continue
          const report = debate.report as Collective.DebateReport
          for (const bs of report.blindSpots) {
            if (bs.confidenceSelf >= 0.8 && seeds.length < (maxSeeds ?? 3)) {
              seeds.push(bs)
            }
          }
        }

        if (seeds.length > 0) {
          log.info("seeded from past blind spots", { count: seeds.length })
        }
        return seeds
      })

      const garbageCollect = Effect.fn("DebateStore.garbageCollect")(function* (maxAgeDays: number) {
        const cutoff = Date.now() - maxAgeDays * 24 * 60 * 60 * 1000
        const result = Database.use((db) => {
          const rows = db
            .select({ id: DebateTable.id })
            .from(DebateTable)
            .where(sql`${DebateTable.time_created} < ${cutoff}`)
            .all()
          for (const row of rows) {
            db.delete(ClaimTable).where(eq(ClaimTable.debate_id, row.id)).run()
            db.delete(DebateTable).where(eq(DebateTable.id, row.id)).run()
          }
          return rows.length
        })
        if (result > 0) log.info("garbage collected debates", { count: result, maxAgeDays })
        return result
      })

      const recordFeedback = Effect.fn("DebateStore.recordFeedback")(function* (
        debateID: Collective.DebateID,
        actions: Array<{ claimId: string; action: string }>,
      ) {
        log.info("recording feedback", { debateID, count: actions.length })
        Database.use((db) => {
          for (const a of actions) {
            db.insert(ClaimFeedbackTable)
              .values({
                debate_id: debateID,
                claim_id: a.claimId as Collective.ClaimID,
                action: a.action as "acted" | "dismissed" | "bookmarked",
              })
              .run()
          }
        })
      })

      const getUserActionRate = Effect.fn("DebateStore.getUserActionRate")(function* (
        debateID: Collective.DebateID,
      ) {
        const totalClaims = Database.use((db) =>
          db.select().from(ClaimTable).where(eq(ClaimTable.debate_id, debateID)).all(),
        )
        const actedCount = Database.use((db) =>
          db
            .select()
            .from(ClaimFeedbackTable)
            .where(
              and(
                eq(ClaimFeedbackTable.debate_id, debateID),
                eq(ClaimFeedbackTable.action, "acted"),
              ),
            )
            .all(),
        )
        return totalClaims.length > 0 ? actedCount.length / totalClaims.length : 0
      })

      return Service.of({
        create,
        get,
        updateStatus,
        saveReport,
        setError,
        list,
        saveClaims,
        getClaims,
        queryPastDebates,
        seedWithPastBlindSpots,
        garbageCollect,
        recordFeedback,
        getUserActionRate,
      })
    }),
  )

  const { runPromise } = makeRuntime(Service, layer)

  export async function getPromise(id: Collective.DebateID) {
    return runPromise((svc) => svc.get(id))
  }

  export async function listPromise(limit?: number) {
    return runPromise((svc) => svc.list(limit))
  }

  export async function queryPastDebatesPromise(prompt: string, directory: string, limit?: number) {
    return runPromise((svc) => svc.queryPastDebates(prompt, directory, limit))
  }

  export async function recordFeedbackPromise(
    debateID: Collective.DebateID,
    actions: Array<{ claimId: string; action: string }>,
  ) {
    return runPromise((svc) => svc.recordFeedback(debateID, actions))
  }
}
