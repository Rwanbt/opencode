import { sqliteTable, text, integer, index, uniqueIndex } from "drizzle-orm/sqlite-core"
import { Timestamps } from "../storage/schema.sql"
import type { UserID, UserRole } from "./schema"

export const CollabUserTable = sqliteTable(
  "collab_user",
  {
    id: text().$type<UserID>().primaryKey(),
    username: text().notNull(),
    email: text(),
    display_name: text(),
    password_hash: text().notNull(),
    role: text().$type<UserRole>().notNull().default("member"),
    ...Timestamps,
  },
  (table) => [uniqueIndex("collab_user_username_idx").on(table.username)],
)

export const CollabUserTokenTable = sqliteTable(
  "collab_user_token",
  {
    id: text().primaryKey(),
    user_id: text()
      .$type<UserID>()
      .notNull()
      .references(() => CollabUserTable.id, { onDelete: "cascade" }),
    token_hash: text().notNull(),
    expires_at: integer().notNull(),
    ...Timestamps,
  },
  (table) => [
    index("collab_user_token_user_idx").on(table.user_id),
    index("collab_user_token_hash_idx").on(table.token_hash),
  ],
)
