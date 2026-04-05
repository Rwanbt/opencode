import { Database, eq } from "../storage/db"
import { CollabUserTable, CollabUserTokenTable } from "./user.sql"
import { UserID, type UserRole } from "./schema"
import { Log } from "../util/log"
import { createHash, randomBytes } from "crypto"

export { UserID, type UserRole } from "./schema"

const log = Log.create({ service: "user" })

export namespace User {
  export interface Info {
    id: UserID
    username: string
    email?: string | null
    displayName?: string | null
    role: UserRole
    timeCreated: number
    timeUpdated: number
  }

  export interface CreateInput {
    username: string
    password: string
    email?: string
    displayName?: string
    role?: UserRole
  }

  function rowToInfo(row: typeof CollabUserTable.$inferSelect): Info {
    return {
      id: row.id,
      username: row.username,
      email: row.email,
      displayName: row.display_name,
      role: row.role as UserRole,
      timeCreated: row.time_created,
      timeUpdated: row.time_updated,
    }
  }

  export async function register(input: CreateInput): Promise<Info> {
    const id = UserID.ascending()
    const hash = await Bun.password.hash(input.password, { algorithm: "argon2id" })

    Database.use((db) => {
      db.insert(CollabUserTable)
        .values({
          id,
          username: input.username,
          password_hash: hash,
          email: input.email ?? null,
          display_name: input.displayName ?? null,
          role: (input.role ?? "member") as UserRole,
        })
        .run()
    })

    log.info("user registered", { id, username: input.username, role: input.role ?? "member" })
    return get(id)!
  }

  export async function authenticate(username: string, password: string): Promise<Info | null> {
    const row = Database.use((db) =>
      db.select().from(CollabUserTable).where(eq(CollabUserTable.username, username)).get(),
    )
    if (!row) return null

    const valid = await Bun.password.verify(password, row.password_hash)
    if (!valid) return null

    return rowToInfo(row)
  }

  export function get(id: UserID): Info | null {
    const row = Database.use((db) =>
      db.select().from(CollabUserTable).where(eq(CollabUserTable.id, id)).get(),
    )
    return row ? rowToInfo(row) : null
  }

  export function getByUsername(username: string): Info | null {
    const row = Database.use((db) =>
      db.select().from(CollabUserTable).where(eq(CollabUserTable.username, username)).get(),
    )
    return row ? rowToInfo(row) : null
  }

  export function list(): Info[] {
    const rows = Database.use((db) => db.select().from(CollabUserTable).all())
    return rows.map(rowToInfo)
  }

  export function updateRole(id: UserID, role: UserRole): void {
    Database.use((db) => {
      db.update(CollabUserTable).set({ role }).where(eq(CollabUserTable.id, id)).run()
    })
    log.info("user role updated", { id, role })
  }

  export function count(): number {
    const result = Database.use((db) =>
      db.select().from(CollabUserTable).all(),
    )
    return result.length
  }

  export function remove(id: UserID): void {
    Database.use((db) => {
      db.delete(CollabUserTable).where(eq(CollabUserTable.id, id)).run()
    })
    log.info("user removed", { id })
  }

  // Refresh token management
  export namespace Token {
    function hashToken(token: string): string {
      return createHash("sha256").update(token).digest("hex")
    }

    export function create(userId: UserID, expiresInMs: number = 7 * 24 * 60 * 60 * 1000): string {
      const token = randomBytes(48).toString("base64url")
      const hash = hashToken(token)
      const id = randomBytes(16).toString("hex")

      Database.use((db) => {
        db.insert(CollabUserTokenTable)
          .values({
            id,
            user_id: userId,
            token_hash: hash,
            expires_at: Date.now() + expiresInMs,
          })
          .run()
      })

      return token
    }

    export function verify(token: string): UserID | null {
      const hash = hashToken(token)
      const row = Database.use((db) =>
        db
          .select()
          .from(CollabUserTokenTable)
          .where(eq(CollabUserTokenTable.token_hash, hash))
          .get(),
      )
      if (!row) return null
      if (row.expires_at < Date.now()) {
        // Expired — clean up
        Database.use((db) => {
          db.delete(CollabUserTokenTable).where(eq(CollabUserTokenTable.id, row.id)).run()
        })
        return null
      }
      return row.user_id
    }

    export function revoke(token: string): void {
      const hash = hashToken(token)
      Database.use((db) => {
        db.delete(CollabUserTokenTable).where(eq(CollabUserTokenTable.token_hash, hash)).run()
      })
    }

    export function revokeAllForUser(userId: UserID): void {
      Database.use((db) => {
        db.delete(CollabUserTokenTable).where(eq(CollabUserTokenTable.user_id, userId)).run()
      })
    }

    export function cleanup(): void {
      const now = Date.now()
      Database.use((db) => {
        db.delete(CollabUserTokenTable)
          .where(eq(CollabUserTokenTable.expires_at, now))
          .run()
      })
    }
  }
}
