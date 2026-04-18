import path from "path"
import { Effect, Layer, Record, Result, Schema, ServiceMap } from "effect"
import { makeRuntime } from "@/effect/run-service"
import { zod } from "@/util/effect-zod"
import { Global } from "../global"
import { AppFileSystem } from "../filesystem"
// NOTE: Audit log is imported dynamically at call sites below to avoid a
// static cycle (audit -> config -> auth -> audit). The dynamic form keeps
// the dependency lazy and breaks the cycle at module-evaluation time.

// ─────────────────────────────────────────────────────────────────────────────
// B1 — Keychain migration design (Sprint 2 — design only, not yet implemented)
// ─────────────────────────────────────────────────────────────────────────────
//
// Goal: stop storing OAuth refresh tokens / API keys as plaintext JSON under
// $Global.Path.data/auth.json (mode 0o600). A full backup of $HOME (Time
// Machine, adb backup, Backblaze) currently exfiltrates every provider token.
//
// Target architecture:
//
//   interface AuthStorage {
//     load(): Promise<Record<string, unknown>>
//     save(data: Record<string, unknown>): Promise<void>
//   }
//
//   class FileStorage implements AuthStorage { /* current behaviour */ }
//   class KeychainStorage implements AuthStorage {
//     // Desktop: Tauri command -> Rust `keyring` crate (wincred / keychain /
//     //          libsecret). One entry per providerID, JSON blob.
//     // Android: Stronghold or EncryptedSharedPreferences via a dedicated
//     //          tauri plugin. Reading is an IPC call from the sidecar to
//     //          the host Tauri shell.
//     // CLI (no Tauri): fall back to AES-GCM-at-rest (see below).
//   }
//
// Why this sprint ships design-only:
//   - `keyring` crate is not yet a dependency; adding it + the Tauri command
//     needs cross-platform wiring (Windows wincred quirks, Android plugin
//     selection between Stronghold and EncryptedSharedPreferences).
//   - The sidecar process runs independently of the Tauri shell in some
//     deployment modes (CLI-only, headless). An IPC contract has to be
//     designed before coding.
//   - Reliable migration requires read-fallback from legacy `auth.json`,
//     write-through to the new backend, and a one-shot `auth.json` deletion
//     gate (only after a successful read-back from the new backend).
//
// Minimal fallback design (for headless / CLI-only):
//   - AES-GCM-256, key derived with Argon2id(memory=64MB, iters=3, parallel=4)
//     from a machine-bound secret: os.hostname() || machine-id || random salt
//     persisted in $Global.Path.data/.auth.salt (0o600).
//   - Ciphertext stored in auth.enc.json with envelope:
//       { v: 1, salt, iv, tag, ciphertext }  (all base64)
//   - Limitation (TOFU): rotation is not automatic. If the machine's hostname
//     changes or the salt file is lost, tokens are unrecoverable and the user
//     must re-auth. This is acceptable because re-auth is always available.
//   - This protects against casual `$HOME` backup exfiltration but not
//     against a local attacker with code execution as the same UID.
//
// Migration protocol:
//   1. On read: try new backend first. If empty, try legacy `auth.json`.
//   2. On any successful legacy read: immediately write to the new backend.
//   3. On next successful new-backend read: rename auth.json -> auth.json.bak
//      and log a one-shot warning ("migrated to <backend>, legacy backup
//      retained 7 days").
//   4. After 7 days, unlink auth.json.bak.
//
// Call sites to audit:
//   - `Auth.get`, `Auth.set`, `Auth.all`, `Auth.remove` below.
//   - All callers of `Auth.*` (provider oauth refresh, CLI login flows,
//     MCP oauth-callback). They already go through this namespace so a
//     storage-adapter swap is transparent.
//
// Status (Sprint 4):
//   - Rust Tauri commands `auth_storage_{get,set,delete,list}` are registered
//     in `packages/desktop/src-tauri/src/auth_storage.rs` using the `keyring`
//     crate. They are NOT yet invoked from this TypeScript module — the
//     sidecar keeps the FileStorage behaviour for backward compat.
//   - `AuthStorage` abstract type + a switch that could pick Keychain vs File
//     at runtime is below (unused, exported for the upcoming desktop client
//     migration).
//   - Android: EncryptedSharedPreferences is documented (see
//     packages/mobile/... TODO) but no plugin yet.
//   - CLI fallback (no Tauri): FileStorage current behaviour retained. AES-GCM
//     chiffré fallback reste design-only.
//   - Migration transparente : lorsqu'un `KeychainStorage.load()` répond vide
//     et qu'un `auth.json` existe, la logique de migration (implémentée sous
//     `maybeMigrateToKeychain`) écrira le contenu vers le keychain, renommera
//     `auth.json` en `auth.json.migrated` et emettra un warn one-shot. Non
//     activée tant que `AUTH_STORAGE_BACKEND !== "keychain"`.
// Tracking: see SPRINT4_NOTES.md (item B1).
// ─────────────────────────────────────────────────────────────────────────────

// ─── AuthStorage adapter pattern (Sprint 4 scaffold) ────────────────────────
// Exposed as a pure interface so the migration to keychain can happen without
// touching any call site. The FileStorage implementation below is the current
// behaviour verbatim.

/** Backend selector. Read from env at module init so tests can override. */
const AUTH_STORAGE_BACKEND = (process.env.OPENCODE_AUTH_STORAGE ?? "file").toLowerCase() as
  | "file"
  | "keychain"

/** Minimal storage abstraction for provider credentials. */
export interface AuthStorage {
  load(): Promise<Record<string, unknown>>
  save(data: Record<string, unknown>): Promise<void>
}

/**
 * KeychainStorage — stub, to be wired against the Tauri command above.
 *
 * Implementation outline (not yet enabled — would require an IPC channel to
 * the Tauri shell from the sidecar process, which is out of scope for this
 * sprint):
 *
 *   - load(): for each key in the index, invoke auth_storage_get(service, k)
 *     and parse the JSON blob; return the aggregate record.
 *   - save(data): diff vs the index; for each changed key call
 *     auth_storage_set(service, k, JSON.stringify(v)); for removed keys call
 *     auth_storage_delete(service, k).
 *
 * Why this isn't enabled yet:
 *   - The sidecar is a standalone Bun process. It does not have a handle to
 *     the Tauri `invoke` channel; we need either (a) a small local HTTP
 *     endpoint on the Tauri side that the sidecar POSTs to, or (b) a stdin
 *     IPC protocol. Picking (a) requires adding a localhost-only endpoint
 *     with a one-shot token minted at sidecar spawn. Deferred to Sprint 5.
 */
export class KeychainStorage implements AuthStorage {
  /** Namespace under which all OpenCode keys live in the OS keychain. */
  static readonly SERVICE = "auth"

  private readonly baseUrl?: string
  private readonly token?: string

  constructor() {
    this.baseUrl = process.env.OPENCODE_KEYCHAIN_URL
    this.token = process.env.OPENCODE_KEYCHAIN_TOKEN
  }

  /** True when the Tauri shell injected a reachable endpoint. */
  available(): boolean {
    return !!this.baseUrl && !!this.token
  }

  private headers(): HeadersInit {
    return {
      "X-Keychain-Token": this.token ?? "",
      "Content-Type": "application/octet-stream",
    }
  }

  async load(): Promise<Record<string, unknown>> {
    if (!this.available()) {
      throw new Error(
        "KeychainStorage unavailable (OPENCODE_KEYCHAIN_URL/TOKEN not set). " +
          "Set OPENCODE_AUTH_STORAGE=file to use FileStorage explicitly.",
      )
    }
    const listRes = await fetch(`${this.baseUrl}/kc/${encodeURIComponent(KeychainStorage.SERVICE)}`, {
      method: "GET",
      headers: this.headers(),
    })
    if (!listRes.ok) throw new Error(`keychain list failed: ${listRes.status}`)
    const keys = (await listRes.json()) as string[]
    const out: Record<string, unknown> = {}
    for (const key of keys) {
      const r = await fetch(
        `${this.baseUrl}/kc/${encodeURIComponent(KeychainStorage.SERVICE)}/${encodeURIComponent(key)}`,
        { method: "GET", headers: this.headers() },
      )
      if (r.status === 404) continue
      if (!r.ok) throw new Error(`keychain get ${key} failed: ${r.status}`)
      const { value } = (await r.json()) as { value: string }
      try {
        out[key] = JSON.parse(value)
      } catch {
        out[key] = value
      }
    }
    return out
  }

  async save(data: Record<string, unknown>): Promise<void> {
    if (!this.available()) {
      throw new Error("KeychainStorage unavailable")
    }
    // Fetch the current key set to detect removals.
    const listRes = await fetch(`${this.baseUrl}/kc/${encodeURIComponent(KeychainStorage.SERVICE)}`, {
      method: "GET",
      headers: this.headers(),
    })
    const existing: string[] = listRes.ok ? await listRes.json() : []
    const wanted = new Set(Object.keys(data))
    // Upsert each wanted key.
    for (const [key, value] of Object.entries(data)) {
      const r = await fetch(
        `${this.baseUrl}/kc/${encodeURIComponent(KeychainStorage.SERVICE)}/${encodeURIComponent(key)}`,
        { method: "PUT", headers: this.headers(), body: JSON.stringify(value) },
      )
      if (!r.ok && r.status !== 204) throw new Error(`keychain set ${key} failed: ${r.status}`)
    }
    // Delete removed keys.
    for (const key of existing) {
      if (wanted.has(key)) continue
      await fetch(
        `${this.baseUrl}/kc/${encodeURIComponent(KeychainStorage.SERVICE)}/${encodeURIComponent(key)}`,
        { method: "DELETE", headers: this.headers() },
      )
    }
  }

  /** Single-entry set, used by the migration path. */
  async set(key: string, value: unknown): Promise<void> {
    if (!this.available()) throw new Error("KeychainStorage unavailable")
    const r = await fetch(
      `${this.baseUrl}/kc/${encodeURIComponent(KeychainStorage.SERVICE)}/${encodeURIComponent(key)}`,
      { method: "PUT", headers: this.headers(), body: JSON.stringify(value) },
    )
    if (!r.ok && r.status !== 204) throw new Error(`keychain set ${key} failed: ${r.status}`)
  }

  async get(key: string): Promise<unknown | undefined> {
    if (!this.available()) throw new Error("KeychainStorage unavailable")
    const r = await fetch(
      `${this.baseUrl}/kc/${encodeURIComponent(KeychainStorage.SERVICE)}/${encodeURIComponent(key)}`,
      { method: "GET", headers: this.headers() },
    )
    if (r.status === 404) return undefined
    if (!r.ok) throw new Error(`keychain get ${key} failed: ${r.status}`)
    const { value } = (await r.json()) as { value: string }
    try {
      return JSON.parse(value)
    } catch {
      return value
    }
  }
}

// ────────────────────────────────────────────────────────────────────────────
// Migration helper (dormant until KeychainStorage is wired).
//
// Contract: on first successful KeychainStorage.save of the aggregated
// auth.json content, rename `auth.json` to `auth.json.migrated`. Keep the
// backup for 7 days (see cleanup note below). Log a one-shot warn.
//
// Cleanup: a separate 7d purger would unlink `auth.json.migrated` older than
// 7d. Not scheduled in this sprint.
// ────────────────────────────────────────────────────────────────────────────
export const AUTH_BACKEND = AUTH_STORAGE_BACKEND

export const OAUTH_DUMMY_KEY = "opencode-oauth-dummy-key"

const file = path.join(Global.Path.data, "auth.json")
const migratedMarker = path.join(Global.Path.data, "auth.json.migrated")

// ─── Migration (Sprint 5 item 5) ────────────────────────────────────────────
//
// When OPENCODE_AUTH_STORAGE=keychain and a legacy auth.json exists:
//   1. Load each entry into the keychain.
//   2. Round-trip read to verify.
//   3. Rename auth.json -> auth.json.migrated (7-day retention window).
//   4. Log a one-shot warning.
// Idempotent: if all entries already present, no-op + rename only.
//
// Rollback: when OPENCODE_AUTH_STORAGE=file and auth.json.migrated exists but
// auth.json does not, restore the migrated file. This covers the "user flipped
// the env var back" case.

let migrationDone = false

async function maybeMigrateToKeychain(storage: KeychainStorage): Promise<void> {
  if (migrationDone) return
  migrationDone = true // set early so concurrent calls don't race
  const fs = await import("fs/promises")
  let legacy: Record<string, unknown>
  try {
    const raw = await fs.readFile(file, "utf8")
    legacy = JSON.parse(raw)
  } catch (e: any) {
    if (e?.code === "ENOENT") return // nothing to migrate
    throw e
  }
  if (!legacy || typeof legacy !== "object") return
  const keys = Object.keys(legacy)
  if (keys.length === 0) {
    // empty file — just rename and move on.
    await fs.rename(file, migratedMarker).catch(() => {})
    return
  }
  try {
    // Upsert + verify round-trip per entry.
    for (const k of keys) {
      await storage.set(k, legacy[k])
      const verify = await storage.get(k)
      if (JSON.stringify(verify) !== JSON.stringify(legacy[k])) {
        throw new Error(`keychain round-trip verification failed for key=${k}`)
      }
    }
    await fs.rename(file, migratedMarker)
    console.warn(
      `[auth] migrated ${keys.length} credential(s) from auth.json to OS keychain. ` +
        `A backup is kept at ${migratedMarker} for 7 days.`,
    )
  } catch (err) {
    migrationDone = false // allow retry on next call
    throw err
  }
}

async function maybeRollbackFromKeychain(): Promise<void> {
  const fs = await import("fs/promises")
  const exists = async (p: string) => {
    try {
      await fs.access(p)
      return true
    } catch {
      return false
    }
  }
  if (await exists(file)) return // nothing to restore
  if (!(await exists(migratedMarker))) return
  await fs.rename(migratedMarker, file)
  console.warn(`[auth] rolled back auth.json.migrated -> auth.json (OPENCODE_AUTH_STORAGE=file)`)
}

async function maybePurgeMigratedBackup(): Promise<void> {
  const fs = await import("fs/promises")
  try {
    const stat = await fs.stat(migratedMarker)
    const ageMs = Date.now() - stat.mtimeMs
    if (ageMs > 7 * 24 * 60 * 60 * 1000) {
      await fs.unlink(migratedMarker)
    }
  } catch {
    // ignore
  }
}

/**
 * Public entry point — invoked at app init from a suitable early boot hook.
 * Idempotent & safe to call in tests (no-op when the configured backend is
 * file, or when the keychain endpoint is unavailable).
 */
export async function initAuthStorage(): Promise<void> {
  try {
    await maybePurgeMigratedBackup()
    if (AUTH_STORAGE_BACKEND === "keychain") {
      const kc = new KeychainStorage()
      if (!kc.available()) return
      await maybeMigrateToKeychain(kc)
    } else {
      await maybeRollbackFromKeychain()
    }
  } catch (err) {
    // Never fail boot on a migration error; the legacy file still works.
    console.warn(`[auth] storage init failed: ${(err as Error)?.message ?? err}`)
  }
}

const fail = (message: string) => (cause: unknown) => new Auth.AuthError({ message, cause })

export namespace Auth {
  export class Oauth extends Schema.Class<Oauth>("OAuth")({
    type: Schema.Literal("oauth"),
    refresh: Schema.String,
    access: Schema.String,
    expires: Schema.Number,
    accountId: Schema.optional(Schema.String),
    enterpriseUrl: Schema.optional(Schema.String),
  }) {}

  export class Api extends Schema.Class<Api>("ApiAuth")({
    type: Schema.Literal("api"),
    key: Schema.String,
  }) {}

  export class WellKnown extends Schema.Class<WellKnown>("WellKnownAuth")({
    type: Schema.Literal("wellknown"),
    key: Schema.String,
    token: Schema.String,
  }) {}

  const _Info = Schema.Union([Oauth, Api, WellKnown]).annotate({ discriminator: "type", identifier: "Auth" })
  export const Info = Object.assign(_Info, { zod: zod(_Info) })
  export type Info = Schema.Schema.Type<typeof _Info>

  export class AuthError extends Schema.TaggedErrorClass<AuthError>()("AuthError", {
    message: Schema.String,
    cause: Schema.optional(Schema.Defect),
  }) {}

  export interface Interface {
    readonly get: (providerID: string) => Effect.Effect<Info | undefined, AuthError>
    readonly all: () => Effect.Effect<Record<string, Info>, AuthError>
    readonly set: (key: string, info: Info) => Effect.Effect<void, AuthError>
    readonly remove: (key: string) => Effect.Effect<void, AuthError>
  }

  export class Service extends ServiceMap.Service<Service, Interface>()("@opencode/Auth") {}

  // ─── Backend selector (Sprint 6 item 2) ─────────────────────────────────
  //
  // When OPENCODE_AUTH_STORAGE=keychain and OPENCODE_KEYCHAIN_URL is present,
  // route all reads/writes through the KeychainStorage HTTP adapter. When the
  // endpoint is unavailable (e.g. `opencode serve` running outside the desktop
  // shell with the env var lingering), log a one-shot warn and fall back to
  // the file path. Never crash — auth.json is always a valid last resort.
  //
  // The selection happens once per Auth.layer evaluation (runtime is memoized
  // via makeRuntime's internal cache). Tests that flip the env var between
  // cases must call `makeRuntime` fresh or override the layer explicitly.
  let keychainFallbackWarned = false
  function selectKeychain(): KeychainStorage | undefined {
    if (AUTH_STORAGE_BACKEND !== "keychain") return undefined
    const kc = new KeychainStorage()
    if (!kc.available()) {
      if (!keychainFallbackWarned) {
        keychainFallbackWarned = true
        console.warn(
          "[auth] OPENCODE_AUTH_STORAGE=keychain but OPENCODE_KEYCHAIN_URL is not set — falling back to FileStorage. " +
            "This is expected on headless CLI runs; desktop sidecar should inject the URL automatically.",
        )
      }
      return undefined
    }
    return kc
  }

  export const layer = Layer.effect(
    Service,
    Effect.gen(function* () {
      const fsys = yield* AppFileSystem.Service
      const decode = Schema.decodeUnknownOption(Info)
      const keychain = selectKeychain()

      const all = Effect.fn("Auth.all")(function* () {
        if (keychain) {
          // Keychain path: best-effort read; on transport error, degrade to the
          // file (prevents a transient endpoint glitch from locking out the user).
          // The Promise/catch is handled *inside* tryPromise's `try` callback
          // so the Effect itself never fails (returns {} on any error).
          const loaded = yield* Effect.tryPromise({
            try: async () => {
              try {
                return await keychain.load()
              } catch (e) {
                console.warn(
                  `[auth] keychain read failed, falling back to auth.json: ${(e as Error)?.message ?? String(e)}`,
                )
                return undefined
              }
            },
            catch: (cause) => new AuthError({ message: "Failed to read keychain", cause }),
          })
          if (loaded !== undefined) {
            return Record.filterMap(loaded as Record<string, unknown>, (value) =>
              Result.fromOption(decode(value), () => undefined),
            )
          }
          // Fallthrough: file read below.
        }
        const data = (yield* fsys.readJson(file).pipe(Effect.orElseSucceed(() => ({})))) as Record<string, unknown>
        return Record.filterMap(data, (value) => Result.fromOption(decode(value), () => undefined))
      })

      const get = Effect.fn("Auth.get")(function* (providerID: string) {
        return (yield* all())[providerID]
      })

      const set = Effect.fn("Auth.set")(function* (key: string, info: Info) {
        const norm = key.replace(/\/+$/, "")
        const data = yield* all()
        if (norm !== key) delete data[key]
        delete data[norm + "/"]
        const next = { ...data, [norm]: info }
        if (keychain) {
          yield* Effect.tryPromise({
            try: () => keychain.save(next),
            catch: (cause) => new AuthError({ message: "Failed to write keychain", cause }),
          })
        } else {
          yield* fsys
            .writeJson(file, next, 0o600)
            .pipe(Effect.mapError(fail("Failed to write auth data")))
        }
        // Audit after successful write — best-effort, never blocks the flow.
        // `info.type` is safe to expose (oauth|api|wellknown); no secrets leak.
        // Dynamic import breaks the audit -> config -> auth cycle.
        void import("../session/audit").then(({ AuditLog }) =>
          AuditLog.recordAsync({ action: "auth.set", target: norm, metadata: { type: info.type } }),
        ).catch(() => {})
      })

      const remove = Effect.fn("Auth.remove")(function* (key: string) {
        const norm = key.replace(/\/+$/, "")
        const data = yield* all()
        delete data[key]
        delete data[norm]
        if (keychain) {
          yield* Effect.tryPromise({
            try: () => keychain.save(data as Record<string, unknown>),
            catch: (cause) => new AuthError({ message: "Failed to write keychain", cause }),
          })
        } else {
          yield* fsys.writeJson(file, data, 0o600).pipe(Effect.mapError(fail("Failed to write auth data")))
        }
        void import("../session/audit").then(({ AuditLog }) =>
          AuditLog.recordAsync({ action: "auth.remove", target: norm }),
        ).catch(() => {})
      })

      return Service.of({ get, all, set, remove })
    }),
  )

  export const defaultLayer = layer.pipe(Layer.provide(AppFileSystem.defaultLayer))

  const { runPromise } = makeRuntime(Service, defaultLayer)

  export async function get(providerID: string) {
    return runPromise((service) => service.get(providerID))
  }

  export async function all(): Promise<Record<string, Info>> {
    return runPromise((service) => service.all())
  }

  export async function set(key: string, info: Info) {
    return runPromise((service) => service.set(key, info))
  }

  export async function remove(key: string) {
    return runPromise((service) => service.remove(key))
  }
}
