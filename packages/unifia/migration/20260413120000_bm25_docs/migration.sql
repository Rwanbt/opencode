CREATE TABLE IF NOT EXISTS `bm25_doc` (
  `id` text PRIMARY KEY NOT NULL,
  `project_id` text NOT NULL REFERENCES `project`(`id`) ON DELETE CASCADE,
  `source_type` text NOT NULL,
  `source_id` text NOT NULL,
  `content` text NOT NULL,
  `content_hash` text NOT NULL,
  `tokens` text NOT NULL,
  `doc_length` integer NOT NULL,
  `time_created` integer DEFAULT (unixepoch() * 1000),
  `time_updated` integer DEFAULT (unixepoch() * 1000)
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `bm25_doc_project_idx` ON `bm25_doc` (`project_id`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `bm25_doc_source_idx` ON `bm25_doc` (`source_type`, `source_id`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `bm25_doc_hash_idx` ON `bm25_doc` (`content_hash`);
