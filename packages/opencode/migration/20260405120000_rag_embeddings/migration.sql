CREATE TABLE IF NOT EXISTS `embedding` (
  `id` text PRIMARY KEY NOT NULL,
  `project_id` text NOT NULL REFERENCES `project`(`id`) ON DELETE CASCADE,
  `source_type` text NOT NULL,
  `source_id` text NOT NULL,
  `content` text NOT NULL,
  `vector` blob NOT NULL,
  `model` text NOT NULL,
  `dimensions` integer NOT NULL,
  `metadata` text,
  `content_hash` text NOT NULL,
  `time_created` integer DEFAULT (unixepoch() * 1000),
  `time_updated` integer DEFAULT (unixepoch() * 1000)
);

CREATE INDEX IF NOT EXISTS `embedding_project_idx` ON `embedding` (`project_id`);
CREATE INDEX IF NOT EXISTS `embedding_source_idx` ON `embedding` (`source_type`, `source_id`);
CREATE INDEX IF NOT EXISTS `embedding_hash_idx` ON `embedding` (`content_hash`);
