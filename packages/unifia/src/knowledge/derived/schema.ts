/* SPDX-License-Identifier: MIT */
/**
 * Derived (Class D) schema.
 *
 * Per ADR-KNOW-0005 and runbook §13 P3.1. The derived DB is
 * SQLite + FTS5 (Drizzle ORM, see ADR 1030). Migrations are
 * timestamped and additive. The first migration is a new
 * knowledge_* namespace; no existing table is touched.
 *
 * The schema is declared but not run by this module. Phase 3.2
 * wires the runtime, the watcher feeds it, the indexer applies
 * the migration on cold start.
 */

import type { KnowledgeId, KnowledgeLocator, KnowledgeVersionHash } from "@unifia/contracts/knowledge"

/** SQLite tables for the derived state. */
export interface KnowledgeNoteRow {
  id: KnowledgeId
  locator: KnowledgeLocator
  version_hash: KnowledgeVersionHash
  type: string
  lifecycle: string
  space: string
  updated_at: string
  content_hash: string
  body: string
}

export interface KnowledgeChunkRow {
  id: number
  note_id: KnowledgeId
  chunk_index: number
  text: string
  start_offset: number
  end_offset: number
}

export interface KnowledgeLinkRow {
  id: number
  source_id: KnowledgeId
  target_locator: KnowledgeLocator
  /** Relation: 'wikilink', 'backlink', 'tag' */
  relation: "wikilink" | "backlink" | "tag"
}

export interface KnowledgeEmbeddingRow {
  id: number
  note_id: KnowledgeId
  model_id: string
  vector: Float32Array
  dim: number
}

export interface KnowledgeIndexStateRow {
  /** Always 1; future migrations bump this. */
  schema_version: number
  rebuilt_at: string
  candidates_count: number
  /** JSON: {fts: bool, vector: bool, graph: bool} */
  enabled: string
}

/**
 * SQL DDL for V1. The `knowledge_*` prefix is reserved. Migrations
 * are versioned by `schema_version` in `index_state`.
 */
export const KNOWLEDGE_SCHEMA_DDL: readonly string[] = [
  `CREATE TABLE IF NOT EXISTS knowledge_note (
     id TEXT PRIMARY KEY,
     locator TEXT NOT NULL UNIQUE,
     version_hash TEXT NOT NULL,
     type TEXT NOT NULL,
     lifecycle TEXT NOT NULL,
     space TEXT NOT NULL,
     updated_at TEXT NOT NULL,
     content_hash TEXT NOT NULL,
     body TEXT NOT NULL
  );`,
  `CREATE INDEX IF NOT EXISTS idx_knowledge_note_lifecycle ON knowledge_note(lifecycle);`,
  `CREATE INDEX IF NOT EXISTS idx_knowledge_note_space ON knowledge_note(space);`,
  `CREATE VIRTUAL TABLE IF NOT EXISTS knowledge_fts USING fts5(
     body,
     content='knowledge_note',
     content_rowid='rowid',
     tokenize='porter unicode61'
  );`,
  `CREATE TABLE IF NOT EXISTS knowledge_chunk (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     note_id TEXT NOT NULL,
     chunk_index INTEGER NOT NULL,
     text TEXT NOT NULL,
     start_offset INTEGER NOT NULL,
     end_offset INTEGER NOT NULL,
     FOREIGN KEY (note_id) REFERENCES knowledge_note(id) ON DELETE CASCADE
  );`,
  `CREATE TABLE IF NOT EXISTS knowledge_link (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     source_id TEXT NOT NULL,
     target_locator TEXT NOT NULL,
     relation TEXT NOT NULL,
     FOREIGN KEY (source_id) REFERENCES knowledge_note(id) ON DELETE CASCADE
  );`,
  `CREATE INDEX IF NOT EXISTS idx_knowledge_link_target ON knowledge_link(target_locator);`,
  `CREATE TABLE IF NOT EXISTS knowledge_embedding (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     note_id TEXT NOT NULL,
     model_id TEXT NOT NULL,
     vector BLOB NOT NULL,
     dim INTEGER NOT NULL,
     FOREIGN KEY (note_id) REFERENCES knowledge_note(id) ON DELETE CASCADE
  );`,
  `CREATE TABLE IF NOT EXISTS knowledge_index_state (
     schema_version INTEGER PRIMARY KEY,
     rebuilt_at TEXT NOT NULL,
     candidates_count INTEGER NOT NULL,
     enabled TEXT NOT NULL
  );`,
] as const

/**
 * The single V1 migration. Additive only.
 */
export const KNOWLEDGE_MIGRATION_V1 = {
  version: 1,
  description: "Initial knowledge_*: notes, FTS5, chunks, links, embeddings, state.",
  sql: KNOWLEDGE_SCHEMA_DDL,
} as const
