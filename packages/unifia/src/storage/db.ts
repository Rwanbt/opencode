import type { SQLiteBunDatabase } from "drizzle-orm/bun-sqlite"
import { migrate } from "drizzle-orm/bun-sqlite/migrator"
import type { SQLiteTransaction } from "drizzle-orm/sqlite-core"
export * from "drizzle-orm"
import { Context } from "../util/context"
import { lazy } from "../util/lazy"
import { Global } from "../global"
import { Log } from "../util/log"
import { NamedError } from "@unifia/util/error"
import z from "zod"
import path from "node:path"
import { readFileSync, readdirSync, existsSync, copyFileSync } from "node:fs"
import { Flag } from "../flag/flag"
import { CHANNEL } from "../installation/meta"
import { InstanceState } from "@/effect/instance-state"
import { iife } from "@/util/iife"
import { init } from "#db"

declare const UNIFIA_MIGRATIONS: { sql: string; timestamp: number; name: string }[] | undefined

export const NotFoundError = NamedError.create(
  "NotFoundError",
  z.object({
    message: z.string(),
  }),
)

const log = Log.create({ service: "db" })

// Names live in ./db-file so drizzle.config.ts can read them without importing
// the database runtime. Re-exported here: importers keep using storage/db.
import { DATABASE_FILE, LEGACY_DATABASE_FILE } from "./db-file"
export { DATABASE_FILE, LEGACY_DATABASE_FILE }

function channelFileNames() {
  if (["latest", "beta"].includes(CHANNEL) || Flag.UNIFIA_DISABLE_CHANNEL_DB) {
    return { current: DATABASE_FILE, legacy: LEGACY_DATABASE_FILE }
  }
  const safe = CHANNEL.replace(/[^a-zA-Z0-9._-]/g, "-")
  return { current: `unifia-${safe}.db`, legacy: `opencode-${safe}.db` }
}

// Copy a legacy database file (and its `-wal` / `-shm` siblings) to the new
// path. Idempotent: bails out if the destination already exists, so a second
// startup is a no-op. Never deletes the source — the legacy file stays as a
// backup and a concurrent upstream install keeps working.
//
// Returns true if a copy actually happened.
export function migrateLegacyDatabaseFile(newPath: string, oldPath: string): boolean {
  if (existsSync(newPath)) return false
  if (!existsSync(oldPath)) return false
  log.info("migrating legacy database file", { from: oldPath, to: newPath })
  for (const suffix of ["", "-wal", "-shm"]) {
    const src = oldPath + suffix
    if (!existsSync(src)) continue
    copyFileSync(src, newPath + suffix)
  }
  return true
}

export namespace Database {
  export function getChannelPath() {
    const files = channelFileNames()
    const newPath = path.join(Global.Path.data, files.current)
    const oldPath = path.join(Global.Path.data, files.legacy)
    migrateLegacyDatabaseFile(newPath, oldPath)
    return newPath
  }

  export const Path = iife(() => {
    const override = Flag.UNIFIA_DB
    if (override) {
      if (override === ":memory:" || path.isAbsolute(override)) return override
      return path.join(Global.Path.data, override)
    }
    return getChannelPath()
  })

  export type Transaction = SQLiteTransaction<"sync", void>

  type Client = SQLiteBunDatabase

  type Journal = { sql: string; timestamp: number; name: string }[]

  function time(tag: string) {
    const match = /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})/.exec(tag)
    if (!match) return 0
    return Date.UTC(
      Number(match[1]),
      Number(match[2]) - 1,
      Number(match[3]),
      Number(match[4]),
      Number(match[5]),
      Number(match[6]),
    )
  }

  function migrations(dir: string): Journal {
    const dirs = readdirSync(dir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)

    const sql = dirs
      .map((name) => {
        const file = path.join(dir, name, "migration.sql")
        if (!existsSync(file)) return
        return {
          sql: readFileSync(file, "utf-8"),
          timestamp: time(name),
          name,
        }
      })
      .filter(Boolean) as Journal

    return sql.sort((a, b) => a.timestamp - b.timestamp)
  }

  export const Client = lazy(() => {
    log.info("opening database", { path: Path })

    const db = init(Path)

    db.run("PRAGMA journal_mode = WAL")
    db.run("PRAGMA synchronous = NORMAL")
    db.run("PRAGMA busy_timeout = 5000")
    db.run("PRAGMA cache_size = -64000")
    db.run("PRAGMA foreign_keys = ON")
    db.run("PRAGMA wal_checkpoint(PASSIVE)")

    // Apply schema migrations. The journal reaches us one of three ways:
    //   1. compile-time — script/build.ts and script/build-node.ts inline it
    //      through Bun's `define` as UNIFIA_MIGRATIONS;
    //   2. runtime — scripts/bundle-mobile.mjs assigns it on globalThis for the
    //      Android bundle;
    //   3. dev — read off disk, which only exists in a source checkout.
    //
    // WHY this reads two globalThis spellings: the rebrand renamed the define
    // to UNIFIA_MIGRATIONS on the producing side but left this consumer on
    // OPENCODE_MIGRATIONS, so branch 1 never matched in a compiled binary and
    // execution fell through to branch 3 — which scans a directory that does
    // not exist inside a `bun build --compile` binary (B:\~BUN\migration). The
    // sidecar died with ENOENT on its first database open, before it could ever
    // answer /global/health, and the desktop shells reported "cannot reach the
    // local server". The legacy globalThis name stays readable until the
    // checked-in Android bundle is regenerated, because that artifact is
    // committed and would otherwise silently lose every migration.
    const bundledMigrations = (globalThis as any).UNIFIA_MIGRATIONS ?? (globalThis as any).OPENCODE_MIGRATIONS
    const entries: Journal =
      typeof UNIFIA_MIGRATIONS !== "undefined"
        ? UNIFIA_MIGRATIONS
        : bundledMigrations
          ? bundledMigrations
          : migrations(path.join(import.meta.dirname, "../../migration"))
    if (entries.length > 0) {
      log.info("applying migrations", {
        count: entries.length,
        mode: typeof UNIFIA_MIGRATIONS !== "undefined" || bundledMigrations ? "bundled" : "dev",
      })
      if (Flag.UNIFIA_SKIP_MIGRATIONS) {
        for (const item of entries) {
          item.sql = "select 1;"
        }
      }
      migrate(db, entries)
    }

    return db
  })

  export function close() {
    Client().$client.close()
    Client.reset()
  }

  export type TxOrDb = Transaction | Client

  const ctx = Context.create<{
    tx: TxOrDb
    effects: (() => void | Promise<void>)[]
  }>("database")

  export function use<T>(callback: (trx: TxOrDb) => T): T {
    try {
      return callback(ctx.use().tx)
    } catch (err) {
      if (err instanceof Context.NotFound) {
        const effects: (() => void | Promise<void>)[] = []
        const result = ctx.provide({ effects, tx: Client() }, () => callback(Client()))
        for (const effect of effects) effect()
        return result
      }
      throw err
    }
  }

  export function effect(fn: () => any | Promise<any>) {
    const bound = InstanceState.bind(fn)
    try {
      ctx.use().effects.push(bound)
    } catch {
      bound()
    }
  }

  type NotPromise<T> = T extends Promise<any> ? never : T

  export function transaction<T>(
    callback: (tx: TxOrDb) => NotPromise<T>,
    options?: {
      behavior?: "deferred" | "immediate" | "exclusive"
    },
  ): NotPromise<T> {
    try {
      return callback(ctx.use().tx)
    } catch (err) {
      if (err instanceof Context.NotFound) {
        const effects: (() => void | Promise<void>)[] = []
        const txCallback = InstanceState.bind((tx: TxOrDb) => ctx.provide({ tx, effects }, () => callback(tx)))
        const result = Client().transaction(txCallback, { behavior: options?.behavior })
        for (const effect of effects) effect()
        return result as NotPromise<T>
      }
      throw err
    }
  }
}
