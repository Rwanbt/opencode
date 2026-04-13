CREATE TABLE IF NOT EXISTS "collab_user" (
  "id" text PRIMARY KEY NOT NULL,
  "username" text NOT NULL,
  "email" text,
  "display_name" text,
  "password_hash" text NOT NULL,
  "role" text NOT NULL DEFAULT 'member',
  "time_created" integer NOT NULL DEFAULT (unixepoch() * 1000),
  "time_updated" integer NOT NULL DEFAULT (unixepoch() * 1000)
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "collab_user_username_idx" ON "collab_user" ("username");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "collab_user_token" (
  "id" text PRIMARY KEY NOT NULL,
  "user_id" text NOT NULL REFERENCES "collab_user"("id") ON DELETE CASCADE,
  "token_hash" text NOT NULL,
  "expires_at" integer NOT NULL,
  "time_created" integer NOT NULL DEFAULT (unixepoch() * 1000)
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "collab_user_token_user_idx" ON "collab_user_token" ("user_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "collab_user_token_hash_idx" ON "collab_user_token" ("token_hash");
