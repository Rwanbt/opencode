import path from "path"
import { Effect, Layer, Record, Result, Schema, ServiceMap } from "effect"
import { makeRuntime } from "@/effect/run-service"
import { zod } from "@/util/effect-zod"
import { Global } from "../global"
import { AppFileSystem } from "../filesystem"

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
// Status: design committed in Sprint 2, implementation targeted Sprint 3.
// Tracking: see SPRINT2_NOTES.md (item B1). Runtime unchanged in this sprint.
// ─────────────────────────────────────────────────────────────────────────────

export const OAUTH_DUMMY_KEY = "opencode-oauth-dummy-key"

const file = path.join(Global.Path.data, "auth.json")

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

  export const layer = Layer.effect(
    Service,
    Effect.gen(function* () {
      const fsys = yield* AppFileSystem.Service
      const decode = Schema.decodeUnknownOption(Info)

      const all = Effect.fn("Auth.all")(function* () {
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
        yield* fsys
          .writeJson(file, { ...data, [norm]: info }, 0o600)
          .pipe(Effect.mapError(fail("Failed to write auth data")))
      })

      const remove = Effect.fn("Auth.remove")(function* (key: string) {
        const norm = key.replace(/\/+$/, "")
        const data = yield* all()
        delete data[key]
        delete data[norm]
        yield* fsys.writeJson(file, data, 0o600).pipe(Effect.mapError(fail("Failed to write auth data")))
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
