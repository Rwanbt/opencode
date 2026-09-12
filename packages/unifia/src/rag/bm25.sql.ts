import { sqliteTable, text, integer, index } from "drizzle-orm/sqlite-core"
import { ProjectTable } from "../project/project.sql"
import type { ProjectID } from "../project/schema"
import { Timestamps } from "../storage/schema.sql"

export const BM25DocTable = sqliteTable(
  "bm25_doc",
  {
    id: text().primaryKey(),
    project_id: text()
      .$type<ProjectID>()
      .notNull()
      .references(() => ProjectTable.id, { onDelete: "cascade" }),
    /** Source type: "file", "summary", "learning" */
    source_type: text().notNull(),
    /** Source identifier (file path, session ID, learning file) */
    source_id: text().notNull(),
    /** The text chunk */
    content: text().notNull(),
    /** Content hash for deduplication */
    content_hash: text().notNull(),
    /** Term frequency map as JSON: Record<string, number> */
    tokens: text({ mode: "json" }).$type<Record<string, number>>().notNull(),
    /** Total token count in document */
    doc_length: integer().notNull(),
    ...Timestamps,
  },
  (table) => [
    index("bm25_doc_project_idx").on(table.project_id),
    index("bm25_doc_source_idx").on(table.source_type, table.source_id),
    index("bm25_doc_hash_idx").on(table.content_hash),
  ],
)
