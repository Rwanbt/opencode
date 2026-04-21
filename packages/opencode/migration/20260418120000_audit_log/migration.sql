CREATE TABLE IF NOT EXISTS `audit_log` (
  `id` text PRIMARY KEY NOT NULL,
  `ts` integer NOT NULL,
  `actor` text,
  `action` text NOT NULL,
  `target` text,
  `metadata` text,
  `time_created` integer NOT NULL,
  `time_updated` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `audit_log_ts_idx` ON `audit_log` (`ts`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `audit_log_action_idx` ON `audit_log` (`action`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `audit_log_actor_idx` ON `audit_log` (`actor`);
