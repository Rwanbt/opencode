CREATE TABLE IF NOT EXISTS `observability_event` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `event_id` text NOT NULL,
  `trace_id` text NOT NULL,
  `span_id` text NOT NULL,
  `parent_span_id` text,
  `session_id` text,
  `project_id` text,
  `workspace_id` text,
  `message_id` text,
  `turn_id` text,
  `step_index` integer,
  `event_type` text NOT NULL,
  `status` text NOT NULL,
  `ts_ms` integer NOT NULL,
  `duration_ms` integer,
  `enqueue_seq` integer NOT NULL,
  `model_provider` text,
  `model_id` text,
  `input_tokens` integer,
  `output_tokens` integer,
  `cache_read_tokens` integer,
  `cache_write_tokens` integer,
  `cost_nano_usd` integer,
  `pricing_version` text,
  `pricing_source` text,
  `cost_computed_at_ms` integer,
  `redaction_status` text NOT NULL,
  `original_size_bytes` integer,
  `payload_truncated` integer DEFAULT false NOT NULL,
  `metadata_json` text NOT NULL,
  `local_redacted_json` text NOT NULL,
  `schema_version` integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `observability_event_event_id_idx` ON `observability_event` (`event_id`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `observability_event_ts_id_idx` ON `observability_event` (`ts_ms`,`id`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `observability_event_session_ts_id_idx` ON `observability_event` (`session_id`,`ts_ms`,`id`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `observability_event_project_ts_id_idx` ON `observability_event` (`project_id`,`ts_ms`,`id`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `observability_event_workspace_ts_id_idx` ON `observability_event` (`workspace_id`,`ts_ms`,`id`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `observability_event_trace_ts_id_idx` ON `observability_event` (`trace_id`,`ts_ms`,`id`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `observability_event_span_idx` ON `observability_event` (`span_id`);
