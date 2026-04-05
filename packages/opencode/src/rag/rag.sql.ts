import { sqliteTable, text, integer, index, blob } from "drizzle-orm/sqlite-core"
import { ProjectTable } from "../project/project.sql"
import type { ProjectID } from "../project/schema"
import { Timestamps } from "../storage/schema.sql"

export const EmbeddingTable = sqliteTable(
  "embedding",
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
    /** The text chunk that was embedded */
    content: text().notNull(),
    /** Embedding vector stored as raw Float32Array bytes */
    vector: blob({ mode: "buffer" }).notNull(),
    /** Embedding model used (e.g., "text-embedding-3-small") */
    model: text().notNull(),
    /** Dimensions of the embedding vector */
    dimensions: integer().notNull(),
    /** Optional metadata (file path, line range, symbol name, tags) */
    metadata: text({ mode: "json" }).$type<Record<string, unknown>>(),
    /** Content hash for deduplication */
    content_hash: text().notNull(),
    ...Timestamps,
  },
  (table) => [
    index("embedding_project_idx").on(table.project_id),
    index("embedding_source_idx").on(table.source_type, table.source_id),
    index("embedding_hash_idx").on(table.content_hash),
  ],
)
