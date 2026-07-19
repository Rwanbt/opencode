import { BusEvent } from "@/bus/bus-event"
import { Bus } from "@/bus"
import { Log } from "../util/log"
import { LSPClient } from "./client"
import path from "node:path"
import { pathToFileURL, fileURLToPath } from "node:url"
import { LSPServer } from "./server"
import z from "zod"
import { Config } from "../config/config"
import { Instance } from "../project/instance"
import { Flag } from "@/flag/flag"
import { Process } from "../util/process"
import { spawn as lspspawn } from "./launch"
import { Effect, Layer, ServiceMap } from "effect"
import { InstanceState } from "@/effect/instance-state"
import { makeRuntime } from "@/effect/run-service"
import { LSPPool } from "./pool"

export namespace LSP {
  const log = Log.create({ service: "lsp" })

  // FORK (LSP-SAVE-LATENCY): a single failed spawn/initialize (timeout or crash)
  // used to blacklist a (root, serverID) pair for the rest of the process
  // lifetime — a slow cold-index on a large project (e.g. rust-analyzer without a
  // warm target/ cache) permanently killed LSP support for it, silently. A
  // cooldown lets a later touch retry instead of being stuck forever.
  const BROKEN_COOLDOWN_MS = 5 * 60_000

  export const Event = {
    Updated: BusEvent.define("lsp.updated", z.object({})),
  }

  export const Range = z
    .object({
      start: z.object({
        line: z.number(),
        character: z.number(),
      }),
      end: z.object({
        line: z.number(),
        character: z.number(),
      }),
    })
    .meta({
      ref: "Range",
    })
  export type Range = z.infer<typeof Range>

  // biome-ignore lint/suspicious/noShadowRestrictedNames: LSP protocol uses Symbol as the canonical name
  export const Symbol = z
    .object({
      name: z.string(),
      kind: z.number(),
      location: z.object({
        uri: z.string(),
        range: Range,
      }),
    })
    .meta({
      ref: "Symbol",
    })
  export type Symbol = z.infer<typeof Symbol>

  export const DocumentSymbol = z
    .object({
      name: z.string(),
      detail: z.string().optional(),
      kind: z.number(),
      range: Range,
      selectionRange: Range,
    })
    .meta({
      ref: "DocumentSymbol",
    })
  export type DocumentSymbol = z.infer<typeof DocumentSymbol>

  export const Status = z
    .object({
      id: z.string(),
      name: z.string(),
      root: z.string(),
      status: z.union([z.literal("connected"), z.literal("error")]),
    })
    .meta({
      ref: "LSPStatus",
    })
  export type Status = z.infer<typeof Status>

  enum SymbolKind {
    File = 1,
    Module = 2,
    Namespace = 3,
    Package = 4,
    Class = 5,
    Method = 6,
    Property = 7,
    Field = 8,
    Constructor = 9,
    Enum = 10,
    Interface = 11,
    Function = 12,
    Variable = 13,
    Constant = 14,
    String = 15,
    Number = 16,
    Boolean = 17,
    Array = 18,
    Object = 19,
    Key = 20,
    Null = 21,
    EnumMember = 22,
    Struct = 23,
    Event = 24,
    Operator = 25,
    TypeParameter = 26,
  }

  const kinds = [
    SymbolKind.Class,
    SymbolKind.Function,
    SymbolKind.Method,
    SymbolKind.Interface,
    SymbolKind.Variable,
    SymbolKind.Constant,
    SymbolKind.Struct,
    SymbolKind.Enum,
  ]

  const filterExperimentalServers = (servers: Record<string, LSPServer.Info>) => {
    if (Flag.OPENCODE_EXPERIMENTAL_LSP_TY) {
      if (servers["pyright"]) {
        log.info("LSP server pyright is disabled because OPENCODE_EXPERIMENTAL_LSP_TY is enabled")
        delete servers["pyright"]
      }
    } else {
      if (servers["ty"]) {
        delete servers["ty"]
      }
    }
  }

  type LocInput = { file: string; line: number; character: number }

  interface BrokenEntry {
    root: string
    serverID: string
    failedAt: number
  }

  interface State {
    clients: LSPClient.Info[]
    servers: Record<string, LSPServer.Info>
    /** keyed by (root+serverID), same scheme as `s.clients`/`s.spawning` lookups. */
    broken: Map<string, BrokenEntry>
    spawning: Map<string, Promise<LSPClient.Info | undefined>>
    pool: LSPPool.Pool
    /** Set by the finalizer — a client that finishes spawning after this must
     * never be tracked/used, only shut down. See ensureClient. */
    disposed: boolean
  }

  /** True while `key` is still within its post-failure cooldown window. */
  function isCoolingDown(broken: Map<string, BrokenEntry>, key: string): boolean {
    const entry = broken.get(key)
    if (!entry) return false
    return Date.now() - entry.failedAt < BROKEN_COOLDOWN_MS
  }

  // FORK (LSP-SAVE-LATENCY, P2): shared by getClients() (per-file, extension-gated)
  // and warmup() (per-project, extension-agnostic) — a single place that spawns,
  // initializes, dedups in-flight attempts, and tracks a client in the pool. Was
  // previously inlined as a nested `schedule()` closure only reachable from
  // getClients(); extracted so warmup() doesn't duplicate the spawn/init/broken/
  // pool-eviction logic.
  async function ensureClient(s: State, server: LSPServer.Info, root: string): Promise<LSPClient.Info | undefined> {
    const key = root + server.id
    if (isCoolingDown(s.broken, key)) return undefined

    const existing = s.clients.find((x) => x.root === root && x.serverID === server.id)
    if (existing) return existing

    const inflight = s.spawning.get(key)
    if (inflight) return inflight

    const markBroken = () => s.broken.set(key, { root, serverID: server.id, failedAt: Date.now() })

    const task = (async () => {
      const handle = await server
        .spawn(root)
        .then((value) => {
          if (!value) markBroken()
          return value
        })
        .catch((err) => {
          markBroken()
          log.error(`Failed to spawn LSP server ${server.id}`, { error: err })
          return undefined
        })

      if (!handle) return undefined
      log.info("spawned lsp server", { serverID: server.id })

      // FORK (LSP-SAVE-LATENCY): check again right after the raw process
      // spawn resolves, before paying for a full LSPClient.create() (which
      // opens a connection and starts listening) only to immediately shut it
      // down. Killing the bare process here — before any connection/listener
      // exists — is the cheapest and safest way to avoid ever creating a
      // connection for an instance that's already gone.
      if (s.disposed) {
        await Process.stop(handle.process)
        return undefined
      }

      const client = await LSPClient.create({
        serverID: server.id,
        server: handle,
        root,
      }).catch(async (err) => {
        markBroken()
        await Process.stop(handle.process)
        log.error(`Failed to initialize LSP client ${server.id}`, { error: err })
        return undefined
      })

      // A successful (re)connect clears any prior failure record for this key.
      if (client) s.broken.delete(key)
      if (!client) return undefined

      // FORK (LSP-SAVE-LATENCY): the instance was disposed while this spawn
      // was in flight (e.g. project closed/switched during a background
      // warmup). Never track or hand back a client for a dead instance —
      // shut it down immediately instead of leaving it to write against a
      // connection nothing will ever gracefully close.
      if (s.disposed) {
        await client.shutdown().catch(() => Process.stop(handle.process))
        return undefined
      }

      // Another concurrent caller may have finished first (spawning-dedup covers
      // the common case, but two DIFFERENT keys resolving to the same root+server
      // — e.g. two file extensions mapped to one server — could still race here).
      const raced = s.clients.find((x) => x.root === root && x.serverID === server.id)
      if (raced) {
        // client.shutdown() (not a raw Process.stop) — disposes the
        // connection cleanly so no queued write can land on a stream that's
        // about to be destroyed (see client.ts's initialize-catch comment).
        await client.shutdown().catch(() => Process.stop(handle.process))
        return raced
      }

      if (s.pool.atCapacity()) await s.pool.evictLRU()

      s.clients.push(client)
      s.pool.track(client, server.id, root)
      return client
    })()

    s.spawning.set(key, task)
    task.finally(() => {
      if (s.spawning.get(key) === task) s.spawning.delete(key)
    })

    const client = await task
    if (client) Bus.publish(Event.Updated, {})
    return client
  }

  export interface Interface {
    readonly init: () => Effect.Effect<void>
    readonly warmup: () => Effect.Effect<void>
    readonly status: () => Effect.Effect<Status[]>
    readonly hasClients: (file: string) => Effect.Effect<boolean>
    readonly touchFile: (input: string, waitForDiagnostics?: boolean) => Effect.Effect<void>
    readonly diagnostics: () => Effect.Effect<Record<string, LSPClient.Diagnostic[]>>
    readonly hover: (input: LocInput) => Effect.Effect<any>
    readonly definition: (input: LocInput) => Effect.Effect<any[]>
    readonly references: (input: LocInput) => Effect.Effect<any[]>
    readonly completion: (input: LocInput & { triggerCharacter?: string }) => Effect.Effect<any[]>
    readonly rename: (input: LocInput & { newName: string }) => Effect.Effect<any>
    readonly codeAction: (input: LocInput & { endLine: number; endCharacter: number }) => Effect.Effect<any[]>
    readonly executeCommand: (input: LocInput & { command: string; commandArgs?: unknown[] }) => Effect.Effect<unknown>
    readonly implementation: (input: LocInput) => Effect.Effect<any[]>
    readonly documentSymbol: (uri: string) => Effect.Effect<(LSP.DocumentSymbol | LSP.Symbol)[]>
    readonly workspaceSymbol: (query: string) => Effect.Effect<LSP.Symbol[]>
    readonly prepareCallHierarchy: (input: LocInput) => Effect.Effect<any[]>
    readonly incomingCalls: (input: LocInput) => Effect.Effect<any[]>
    readonly outgoingCalls: (input: LocInput) => Effect.Effect<any[]>
  }

  export class Service extends ServiceMap.Service<Service, Interface>()("@opencode/LSP") {}

  export const layer = Layer.effect(
    Service,
    Effect.gen(function* () {
      const config = yield* Config.Service

      const state = yield* InstanceState.make<State>(
        Effect.fn("LSP.state")(function* () {
          const cfg = yield* config.get()

          const servers: Record<string, LSPServer.Info> = {}

          if (cfg.lsp === false) {
            log.info("all LSPs are disabled")
          } else {
            for (const server of Object.values(LSPServer)) {
              servers[server.id] = server
            }

            filterExperimentalServers(servers)

            for (const [name, item] of Object.entries(cfg.lsp ?? {})) {
              const existing = servers[name]
              if (item.disabled) {
                log.info(`LSP server ${name} is disabled`)
                delete servers[name]
                continue
              }
              servers[name] = {
                ...existing,
                id: name,
                root: existing?.root ?? (async () => Instance.directory),
                extensions: item.extensions ?? existing?.extensions ?? [],
                spawn: async (root) => ({
                  process: lspspawn(item.command[0], item.command.slice(1), {
                    cwd: root,
                    env: { ...process.env, ...item.env },
                  }),
                  initialization: item.initialization,
                }),
              }
            }

            log.info("enabled LSP servers", {
              serverIds: Object.values(servers)
                .map((server) => server.id)
                .join(", "),
            })
          }

          const lspMemory = cfg.experimental?.lsp_memory
          const pool = LSPPool.create({
            maxConcurrent: lspMemory?.max_concurrent ?? 5,
            idleTimeoutMs: (lspMemory?.idle_timeout_minutes ?? 15) * 60_000,
            maxMemoryMB: lspMemory?.max_memory_mb,
          })

          const s: State = {
            clients: [],
            servers,
            broken: new Map<string, BrokenEntry>(),
            spawning: new Map(),
            pool,
            disposed: false,
          }

          // When pool evicts a client, remove it from the clients array
          pool.onEvict((entry) => {
            const idx = s.clients.indexOf(entry.client)
            if (idx !== -1) s.clients.splice(idx, 1)
          })

          yield* Effect.addFinalizer(() =>
            Effect.promise(async () => {
              // FORK (LSP-SAVE-LATENCY): flip the flag synchronously, before
              // awaiting anything — this must never block project close. A
              // spawn/initialize kicked off by warmup()/File.read()'s
              // fire-and-forget touch can still be mid-handshake when the
              // instance disposes; ensureClient checks `disposed` right after
              // its create() resolves and shuts the client down immediately
              // instead of tracking it, so it's never left running unattended
              // against a torn-down instance. See ensureClient below.
              s.disposed = true
              await pool.shutdownAll()
            }),
          )

          return s
        }),
      )

      const getClients = Effect.fnUntraced(function* (file: string) {
        if (!Instance.containsPath(file)) return [] as LSPClient.Info[]
        const s = yield* InstanceState.get(state)
        return yield* Effect.promise(async () => {
          const extension = path.parse(file).ext || file
          const result: LSPClient.Info[] = []

          for (const server of Object.values(s.servers)) {
            if (server.extensions.length && !server.extensions.includes(extension)) continue

            const root = await server.root(file)
            if (!root) continue

            const client = await ensureClient(s, server, root)
            if (client) result.push(client)
          }

          return result
        })
      })

      const run = Effect.fnUntraced(function* <T>(file: string, fn: (client: LSPClient.Info) => Promise<T>) {
        const clients = yield* getClients(file)
        const s = yield* InstanceState.get(state)
        for (const c of clients) s.pool.touch(c.serverID, c.root)
        return yield* Effect.promise(() => Promise.all(clients.map((x) => fn(x))))
      })

      const runAll = Effect.fnUntraced(function* <T>(fn: (client: LSPClient.Info) => Promise<T>) {
        const s = yield* InstanceState.get(state)
        for (const c of s.clients) s.pool.touch(c.serverID, c.root)
        return yield* Effect.promise(() => Promise.all(s.clients.map((x) => fn(x))))
      })

      const init = Effect.fn("LSP.init")(function* () {
        yield* InstanceState.get(state)
      })

      // FORK (LSP-SAVE-LATENCY, P2): proactively spawn LSP servers whose root
      // resolves at the project directory itself (typically the project's 1-2
      // dominant languages), so the cold spawn+initialize cost overlaps with the
      // user reading/thinking rather than landing entirely on their first save.
      // Best-effort and never awaited by the caller (see bootstrap.ts) — a slow
      // or hung spawn must never delay project open. Servers with no extension
      // filter are skipped (they'd otherwise "match" every project regardless of
      // language); they still warm normally the first time a matching file is
      // touched via getClients().
      const warmup = Effect.fn("LSP.warmup")(function* () {
        const s = yield* InstanceState.get(state)
        yield* Effect.promise(async () => {
          // NearestRoot()-based root() implementations do `path.dirname(file)`
          // and walk upward, bounded by `stop: Instance.directory` — passing
          // Instance.directory itself as `file` would make dirname() step to
          // its PARENT, walking past the project boundary entirely (the `stop`
          // check only fires once `current` walks back down to it, which never
          // happens going upward). A synthetic path *inside* the directory
          // makes dirname() resolve back to Instance.directory, matching what
          // a real file sitting at the project root would resolve to.
          const sentinel = path.join(Instance.directory, "__lsp_warmup_sentinel__")
          // Root detection across servers is independent, read-only filesystem
          // walks — run them concurrently instead of one-by-one. Sequentially
          // awaiting ~30+ servers' root() before ever reaching the first
          // ensureClient() call made warmup() itself slow (over a second on a
          // Windows dev machine), defeating its own purpose.
          await Promise.all(
            Object.values(s.servers).map(async (server) => {
              if (!server.extensions.length) return
              const root = await server.root(sentinel).catch(() => undefined)
              if (!root) return
              void ensureClient(s, server, root).catch((err) =>
                log.warn("warmup failed", { serverID: server.id, error: err }),
              )
            }),
          )
        })
      })

      const status = Effect.fn("LSP.status")(function* () {
        const s = yield* InstanceState.get(state)
        const result: Status[] = []
        for (const client of s.clients) {
          result.push({
            id: client.serverID,
            name: s.servers[client.serverID].id,
            root: path.relative(Instance.directory, client.root),
            status: "connected",
          })
        }
        // FORK (LSP-SAVE-LATENCY): surface servers still within their post-failure
        // cooldown — previously invisible (status() only ever iterated s.clients),
        // so a spawn/initialize failure looked identical to "never touched" in the
        // UI. Cooled-down entries (past BROKEN_COOLDOWN_MS) are omitted — they're
        // eligible for a fresh retry on the next touch, not meaningfully "broken".
        for (const entry of s.broken.values()) {
          if (!isCoolingDown(s.broken, entry.root + entry.serverID)) continue
          result.push({
            id: entry.serverID,
            name: s.servers[entry.serverID]?.id ?? entry.serverID,
            root: path.relative(Instance.directory, entry.root),
            status: "error",
          })
        }
        return result
      })

      const hasClients = Effect.fn("LSP.hasClients")(function* (file: string) {
        const s = yield* InstanceState.get(state)
        return yield* Effect.promise(async () => {
          const extension = path.parse(file).ext || file
          for (const server of Object.values(s.servers)) {
            if (server.extensions.length && !server.extensions.includes(extension)) continue
            const root = await server.root(file)
            if (!root) continue
            if (isCoolingDown(s.broken, root + server.id)) continue
            return true
          }
          return false
        })
      })

      const touchFile = Effect.fn("LSP.touchFile")(function* (input: string, waitForDiagnostics?: boolean) {
        log.info("touching file", { file: input })
        const clients = yield* getClients(input)
        yield* Effect.promise(() =>
          Promise.all(
            clients.map(async (client) => {
              const wait = waitForDiagnostics ? client.waitForDiagnostics({ path: input }) : Promise.resolve()
              await client.notify.open({ path: input })
              return wait
            }),
          ).catch((err) => {
            log.error("failed to touch file", { err, file: input })
          }),
        )
      })

      const diagnostics = Effect.fn("LSP.diagnostics")(function* () {
        const results: Record<string, LSPClient.Diagnostic[]> = {}
        const all = yield* runAll(async (client) => client.diagnostics)
        for (const result of all) {
          for (const [p, diags] of result.entries()) {
            const arr = results[p] || []
            arr.push(...diags)
            results[p] = arr
          }
        }
        return results
      })

      const hover = Effect.fn("LSP.hover")(function* (input: LocInput) {
        return yield* run(input.file, (client) =>
          client.connection
            .sendRequest("textDocument/hover", {
              textDocument: { uri: pathToFileURL(input.file).href },
              position: { line: input.line, character: input.character },
            })
            .catch(() => null),
        )
      })

      const definition = Effect.fn("LSP.definition")(function* (input: LocInput) {
        const results = yield* run(input.file, (client) =>
          client.connection
            .sendRequest("textDocument/definition", {
              textDocument: { uri: pathToFileURL(input.file).href },
              position: { line: input.line, character: input.character },
            })
            .catch(() => null),
        )
        return results.flat().filter(Boolean)
      })

      const references = Effect.fn("LSP.references")(function* (input: LocInput) {
        const results = yield* run(input.file, (client) =>
          client.connection
            .sendRequest("textDocument/references", {
              textDocument: { uri: pathToFileURL(input.file).href },
              position: { line: input.line, character: input.character },
              context: { includeDeclaration: true },
            })
            .catch(() => []),
        )
        return results.flat().filter(Boolean)
      })

      const completion = Effect.fn("LSP.completion")(function* (input: LocInput & { triggerCharacter?: string }) {
        const results = yield* run(input.file, (client) =>
          client.connection
            .sendRequest("textDocument/completion", {
              textDocument: { uri: pathToFileURL(input.file).href },
              position: { line: input.line, character: input.character },
              context: input.triggerCharacter
                ? { triggerKind: 2, triggerCharacter: input.triggerCharacter }
                : { triggerKind: 1 },
            })
            .catch(() => null),
        )
        // LSP servers return CompletionList | CompletionItem[] | null
        return results
          .flatMap((r: any) => (r && typeof r === "object" && Array.isArray(r.items) ? r.items : Array.isArray(r) ? r : []))
          .filter(Boolean)
      })

      const rename = Effect.fn("LSP.rename")(function* (input: LocInput & { newName: string }) {
        const results = yield* run(input.file, (client) =>
          client.connection
            .sendRequest("textDocument/rename", {
              textDocument: { uri: pathToFileURL(input.file).href },
              position: { line: input.line, character: input.character },
              newName: input.newName,
            })
            .catch(() => null),
        )
        // Merge WorkspaceEdits from all clients (typically only one handles the file)
        const merged: Record<string, any[]> = {}
        for (const r of results) {
          if (!r || typeof r !== "object") continue
          const changes = (r as any).changes ?? {}
          for (const [uri, edits] of Object.entries(changes)) {
            if (!merged[uri]) merged[uri] = []
            merged[uri].push(...(edits as any[]))
          }
        }
        return { changes: merged }
      })

      const codeAction = Effect.fn("LSP.codeAction")(function* (
        input: LocInput & { endLine: number; endCharacter: number },
      ) {
        const results = yield* run(input.file, (client) =>
          client.connection
            .sendRequest("textDocument/codeAction", {
              textDocument: { uri: pathToFileURL(input.file).href },
              range: {
                start: { line: input.line, character: input.character },
                end: { line: input.endLine, character: input.endCharacter },
              },
              context: { diagnostics: [] },
            })
            .catch(() => null),
        )
        return results.flatMap((r) => (Array.isArray(r) ? r : []))
      })

      const executeCommand = Effect.fn("LSP.executeCommand")(function* (
        input: LocInput & { command: string; commandArgs?: unknown[] },
      ) {
        const results = yield* run(input.file, (client) =>
          client.connection
            .sendRequest("workspace/executeCommand", {
              command: input.command,
              arguments: input.commandArgs ?? [],
            })
            .catch(() => null),
        )
        return results.find((r) => r !== null && r !== undefined) ?? null
      })

      const implementation = Effect.fn("LSP.implementation")(function* (input: LocInput) {
        const results = yield* run(input.file, (client) =>
          client.connection
            .sendRequest("textDocument/implementation", {
              textDocument: { uri: pathToFileURL(input.file).href },
              position: { line: input.line, character: input.character },
            })
            .catch(() => null),
        )
        return results.flat().filter(Boolean)
      })

      const documentSymbol = Effect.fn("LSP.documentSymbol")(function* (uri: string) {
        const file = fileURLToPath(uri)
        const results = yield* run(file, (client) =>
          client.connection.sendRequest("textDocument/documentSymbol", { textDocument: { uri } }).catch(() => []),
        )
        return (results.flat() as (LSP.DocumentSymbol | LSP.Symbol)[]).filter(Boolean)
      })

      const workspaceSymbol = Effect.fn("LSP.workspaceSymbol")(function* (query: string) {
        const results = yield* runAll((client) =>
          client.connection
            .sendRequest("workspace/symbol", { query })
            .then((result: any) => result.filter((x: LSP.Symbol) => kinds.includes(x.kind)))
            .then((result: any) => result.slice(0, 10))
            .catch(() => []),
        )
        return results.flat() as LSP.Symbol[]
      })

      const prepareCallHierarchy = Effect.fn("LSP.prepareCallHierarchy")(function* (input: LocInput) {
        const results = yield* run(input.file, (client) =>
          client.connection
            .sendRequest("textDocument/prepareCallHierarchy", {
              textDocument: { uri: pathToFileURL(input.file).href },
              position: { line: input.line, character: input.character },
            })
            .catch(() => []),
        )
        return results.flat().filter(Boolean)
      })

      const callHierarchyRequest = Effect.fnUntraced(function* (
        input: LocInput,
        direction: "callHierarchy/incomingCalls" | "callHierarchy/outgoingCalls",
      ) {
        const results = yield* run(input.file, async (client) => {
          const items = (await client.connection
            .sendRequest("textDocument/prepareCallHierarchy", {
              textDocument: { uri: pathToFileURL(input.file).href },
              position: { line: input.line, character: input.character },
            })
            .catch(() => [])) as any[]
          if (!items?.length) return []
          return client.connection.sendRequest(direction, { item: items[0] }).catch(() => [])
        })
        return results.flat().filter(Boolean)
      })

      const incomingCalls = Effect.fn("LSP.incomingCalls")(function* (input: LocInput) {
        return yield* callHierarchyRequest(input, "callHierarchy/incomingCalls")
      })

      const outgoingCalls = Effect.fn("LSP.outgoingCalls")(function* (input: LocInput) {
        return yield* callHierarchyRequest(input, "callHierarchy/outgoingCalls")
      })

      return Service.of({
        init,
        warmup,
        status,
        hasClients,
        touchFile,
        diagnostics,
        hover,
        definition,
        references,
        completion,
        rename,
        codeAction,
        executeCommand,
        implementation,
        documentSymbol,
        workspaceSymbol,
        prepareCallHierarchy,
        incomingCalls,
        outgoingCalls,
      })
    }),
  )

  export const defaultLayer = layer.pipe(Layer.provide(Config.defaultLayer))

  const { runPromise } = makeRuntime(Service, defaultLayer)

  export const init = async () => runPromise((svc) => svc.init())

  export const warmup = async () => runPromise((svc) => svc.warmup())

  export const status = async () => runPromise((svc) => svc.status())

  export const hasClients = async (file: string) => runPromise((svc) => svc.hasClients(file))

  export const touchFile = async (input: string, waitForDiagnostics?: boolean) =>
    runPromise((svc) => svc.touchFile(input, waitForDiagnostics))

  export const diagnostics = async () => runPromise((svc) => svc.diagnostics())

  export const hover = async (input: LocInput) => runPromise((svc) => svc.hover(input))

  export const definition = async (input: LocInput) => runPromise((svc) => svc.definition(input))

  export const references = async (input: LocInput) => runPromise((svc) => svc.references(input))

  export const completion = async (input: LocInput & { triggerCharacter?: string }) =>
    runPromise((svc) => svc.completion(input))

  export const rename = async (input: LocInput & { newName: string }) =>
    runPromise((svc) => svc.rename(input))

  export const codeAction = async (input: LocInput & { endLine: number; endCharacter: number }) =>
    runPromise((svc) => svc.codeAction(input))

  export const executeCommand = async (input: LocInput & { command: string; commandArgs?: unknown[] }) =>
    runPromise((svc) => svc.executeCommand(input))

  export const implementation = async (input: LocInput) => runPromise((svc) => svc.implementation(input))

  export const documentSymbol = async (uri: string) => runPromise((svc) => svc.documentSymbol(uri))

  export const workspaceSymbol = async (query: string) => runPromise((svc) => svc.workspaceSymbol(query))

  export const prepareCallHierarchy = async (input: LocInput) => runPromise((svc) => svc.prepareCallHierarchy(input))

  export const incomingCalls = async (input: LocInput) => runPromise((svc) => svc.incomingCalls(input))

  export const outgoingCalls = async (input: LocInput) => runPromise((svc) => svc.outgoingCalls(input))

  export namespace Diagnostic {
    export function pretty(diagnostic: LSPClient.Diagnostic) {
      const severityMap = {
        1: "ERROR",
        2: "WARN",
        3: "INFO",
        4: "HINT",
      }

      const severity = severityMap[diagnostic.severity || 1]
      const line = diagnostic.range.start.line + 1
      const col = diagnostic.range.start.character + 1

      return `${severity} [${line}:${col}] ${diagnostic.message}`
    }
  }
}
