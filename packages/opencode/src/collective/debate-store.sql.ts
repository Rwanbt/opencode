import { sqliteTable, text, integer, real, index } from "drizzle-orm/sqlite-core"
import { Timestamps } from "../storage/schema.sql"
import type { Collective } from "./types"

export const DebateTable = sqliteTable(
  "debate",
  {
    id: text().$type<Collective.DebateID>().primaryKey(),
    status: text().$type<Collective.DebateStatus>().notNull().default("pending"),
    prompt: text().notNull(),
    prompt_hash: text().notNull(),
    workspace_hash: text().notNull(),
    tier: text().$type<Collective.DebateTier>().notNull(),
    config: text({ mode: "json" }).notNull().$type<Collective.DebateConfig>(),
    report: text({ mode: "json" }).$type<Collective.DebateReport>(),
    cost: real(),
    duration_ms: integer(),
    provider_count: integer().notNull(),
    blind_spot_count: integer(),
    error: text(),
    ...Timestamps,
  },
  (table) => [
    index("debate_status_idx").on(table.status),
    index("debate_time_created_idx").on(table.time_created),
    index("debate_prompt_hash_idx").on(table.prompt_hash),
    index("debate_workspace_hash_idx").on(table.workspace_hash),
  ],
)

export const ClaimTable = sqliteTable(
  "debate_claim",
  {
    id: text().$type<Collective.ClaimID>().primaryKey(),
    debate_id: text()
      .$type<Collective.DebateID>()
      .notNull()
      .references(() => DebateTable.id, { onDelete: "cascade" }),
    source_id: text().notNull(),
    source_provider: text().notNull(),
    category: text().$type<Collective.ClaimCategory>().notNull(),
    content: text().notNull(),
    confidence: real(),
    novelty: text().$type<Collective.NoveltyMarker>(),
    is_actionable: integer({ mode: "boolean" }),
    verification_hint: text(),
    is_existence_claim: integer({ mode: "boolean" }),
    jargon_risk: real(),
    is_recovered: integer({ mode: "boolean" }),
    ...Timestamps,
  },
  (table) => [
    index("claim_debate_idx").on(table.debate_id),
    index("claim_category_idx").on(table.category),
    index("claim_novelty_idx").on(table.novelty),
  ],
)

export const ClaimFeedbackTable = sqliteTable(
  "debate_claim_feedback",
  {
    id: text().primaryKey().$defaultFn(() => `fbk_${crypto.randomUUID().replace(/-/g, "")}`),
    debate_id: text()
      .$type<Collective.DebateID>()
      .notNull()
      .references(() => DebateTable.id, { onDelete: "cascade" }),
    claim_id: text().$type<Collective.ClaimID>().notNull(),
    action: text().$type<"acted" | "dismissed" | "bookmarked">().notNull(),
    ...Timestamps,
  },
  (table) => [
    index("feedback_debate_idx").on(table.debate_id),
    index("feedback_claim_idx").on(table.claim_id),
  ],
)
