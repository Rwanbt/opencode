ALTER TABLE `observability_event` ADD COLUMN `local_content_redacted_json` text;
--> statement-breakpoint
ALTER TABLE `observability_event` ADD COLUMN `local_full_json` text;
--> statement-breakpoint
ALTER TABLE `observability_event` ADD COLUMN `content_expires_at_ms` integer;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `observability_event_content_expires_idx` ON `observability_event` (`content_expires_at_ms`);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `observability_content_optin` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `scope` text NOT NULL,
  `scope_id` text NOT NULL,
  `level` text NOT NULL,
  `ttl_days` integer NOT NULL,
  `created_at_ms` integer NOT NULL,
  `expires_at_ms` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `observability_content_optin_scope_idx` ON `observability_content_optin` (`scope`,`scope_id`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `observability_content_optin_expires_idx` ON `observability_content_optin` (`expires_at_ms`);
