CREATE TABLE IF NOT EXISTS `debate` (
  `id` text PRIMARY KEY NOT NULL,
  `status` text NOT NULL DEFAULT 'pending',
  `prompt` text NOT NULL,
  `prompt_hash` text NOT NULL,
  `workspace_hash` text NOT NULL,
  `tier` text NOT NULL,
  `config` text NOT NULL,
  `report` text,
  `cost` real,
  `duration_ms` integer,
  `provider_count` integer NOT NULL,
  `blind_spot_count` integer,
  `error` text,
  `time_created` integer NOT NULL,
  `time_updated` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `debate_status_idx` ON `debate` (`status`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `debate_time_created_idx` ON `debate` (`time_created`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `debate_prompt_hash_idx` ON `debate` (`prompt_hash`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `debate_workspace_hash_idx` ON `debate` (`workspace_hash`);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `debate_claim` (
  `id` text PRIMARY KEY NOT NULL,
  `debate_id` text NOT NULL REFERENCES `debate`(`id`) ON DELETE CASCADE,
  `source_id` text NOT NULL,
  `source_provider` text NOT NULL,
  `category` text NOT NULL,
  `content` text NOT NULL,
  `confidence` real,
  `novelty` text,
  `is_actionable` integer,
  `verification_hint` text,
  `is_existence_claim` integer,
  `jargon_risk` real,
  `is_recovered` integer,
  `time_created` integer NOT NULL,
  `time_updated` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `claim_debate_idx` ON `debate_claim` (`debate_id`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `claim_category_idx` ON `debate_claim` (`category`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `claim_novelty_idx` ON `debate_claim` (`novelty`);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `debate_claim_feedback` (
  `id` text PRIMARY KEY NOT NULL,
  `debate_id` text NOT NULL REFERENCES `debate`(`id`) ON DELETE CASCADE,
  `claim_id` text NOT NULL,
  `action` text NOT NULL,
  `time_created` integer NOT NULL,
  `time_updated` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `feedback_debate_idx` ON `debate_claim_feedback` (`debate_id`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `feedback_claim_idx` ON `debate_claim_feedback` (`claim_id`);
