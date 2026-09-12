import path from "node:path"
import { defineConfig } from "drizzle-kit"
import { Global } from "./src/global/path"
import { DATABASE_FILE } from "./src/storage/db-file"

export default defineConfig({
  dialect: "sqlite",
  schema: "./src/**/*.sql.ts",
  out: "./migration",
  dbCredentials: {
    // Derived, never hardcoded: this used to carry an upstream author's absolute
    // home directory, which pointed drizzle-kit at a database nobody else has.
    // Channel-suffixed databases (see channelFileNames in storage/db.ts) are a
    // runtime concern — drizzle-kit works against the default file.
    url: path.join(Global.Path.data, DATABASE_FILE),
  },
})
