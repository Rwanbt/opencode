import { Global } from "../global"
import { Log } from "../util/log"
import path from "node:path"
import z from "zod"
import { Installation } from "../installation"
import { Flag } from "../flag/flag"
import { lazy } from "@/util/lazy"
import { Filesystem } from "../util/filesystem"
import { Flock } from "@/util/flock"
import { Hash } from "@/util/hash"

// Try to import bundled snapshot (generated at build time)
// Falls back to undefined in dev mode when snapshot doesn't exist

export namespace ModelsDev {
  const log = Log.create({ service: "models.dev" })
  const refreshCallbacks: Array<() => void | Promise<void>> = []
  export function onRefresh(cb: () => void | Promise<void>) {
    refreshCallbacks.push(cb)
    return () => {
      const idx = refreshCallbacks.indexOf(cb)
      if (idx >= 0) refreshCallbacks.splice(idx, 1)
    }
  }
  const source = url()
  const filepath = path.join(
    Global.Path.cache,
    source === "https://models.dev" ? "models.json" : `models-${Hash.fast(source)}.json`,
  )
  const ttl = 5 * 60 * 1000

  export const Model = z.object({
    id: z.string(),
    name: z.string(),
    family: z.string().optional(),
    release_date: z.string(),
    attachment: z.boolean(),
    reasoning: z.boolean(),
    temperature: z.boolean(),
    tool_call: z.boolean(),
    interleaved: z
      .union([
        z.literal(true),
        z
          .object({
            field: z.enum(["reasoning_content", "reasoning_details"]),
          })
          .strict(),
      ])
      .optional(),
    cost: z
      .object({
        input: z.number(),
        output: z.number(),
        cache_read: z.number().optional(),
        cache_write: z.number().optional(),
        context_over_200k: z
          .object({
            input: z.number(),
            output: z.number(),
            cache_read: z.number().optional(),
            cache_write: z.number().optional(),
          })
          .optional(),
      })
      .optional(),
    limit: z.object({
      context: z.number(),
      input: z.number().optional(),
      output: z.number(),
    }),
    modalities: z
      .object({
        input: z.array(z.enum(["text", "audio", "image", "video", "pdf"])),
        output: z.array(z.enum(["text", "audio", "image", "video", "pdf"])),
      })
      .optional(),
    experimental: z.boolean().optional(),
    status: z.enum(["alpha", "beta", "deprecated"]).optional(),
    options: z.record(z.string(), z.any()),
    headers: z.record(z.string(), z.string()).optional(),
    provider: z.object({ npm: z.string().optional(), api: z.string().optional() }).optional(),
    variants: z.record(z.string(), z.record(z.string(), z.any())).optional(),
  })
  export type Model = z.infer<typeof Model>

  export const Provider = z.object({
    api: z.string().optional(),
    name: z.string(),
    env: z.array(z.string()),
    id: z.string(),
    npm: z.string().optional(),
    models: z.record(z.string(), Model),
  })

  export type Provider = z.infer<typeof Provider>

  function url() {
    return Flag.OPENCODE_MODELS_URL || "https://models.dev"
  }

  function fresh() {
    return Date.now() - Number(Filesystem.stat(filepath)?.mtimeMs ?? 0) < ttl
  }

  function skip(force: boolean) {
    return !force && fresh()
  }

  const fetchApi = async () => {
    const result = await fetch(`${url()}/api.json`, {
      headers: { "User-Agent": Installation.USER_AGENT },
      signal: AbortSignal.timeout(10000),
    })
    return { ok: result.ok, status: result.status, text: await result.text() }
  }

  export const Data = lazy(async () => {
    const result = await Filesystem.readJson(Flag.OPENCODE_MODELS_PATH ?? filepath).catch(() => {})
    if (result) return result
    const snapshot = await import("./models-snapshot.js")
      .then((m) => m.snapshot as Record<string, unknown>)
      .catch(() => undefined)
    if (snapshot) return snapshot
    if (Flag.OPENCODE_DISABLE_MODELS_FETCH) return {}
    try {
      return await Flock.withLock(`models-dev:${filepath}`, async () => {
        const result = await Filesystem.readJson(Flag.OPENCODE_MODELS_PATH ?? filepath).catch(() => {})
        if (result) return result
        const result2 = await fetchApi()
        if (result2.ok) {
          await Filesystem.write(filepath, result2.text).catch((e) => {
            log.error("Failed to write models cache", { error: e })
          })
          return JSON.parse(result2.text)
        }
        log.warn("models.dev fetch failed", { status: result2.ok })
        return {}
      })
    } catch (e) {
      log.error("ModelsDev.Data failed to load from any source", { error: e })
      return {}
    }
  })

  export async function get() {
    const result = await Data()
    return result as Record<string, Provider>
  }

  export async function refresh(force = false): Promise<{ ok: boolean; error?: string }> {
    // Custom path is managed by the user/another process — refresh() must not
    // clobber it, and Data() never reads `filepath` while this is set (see
    // above), so a fetch here would silently do nothing useful anyway.
    if (Flag.OPENCODE_MODELS_PATH) {
      return { ok: false, error: "Custom models path is set (OPENCODE_MODELS_PATH) — refresh is managed externally" }
    }
    if (Flag.OPENCODE_DISABLE_MODELS_FETCH) {
      return { ok: false, error: "Models fetch is disabled (OPENCODE_DISABLE_MODELS_FETCH)" }
    }
    if (skip(force)) {
      ModelsDev.Data.reset()
      return { ok: true }
    }
    try {
      return await Flock.withLock(`models-dev:${filepath}`, async () => {
        if (skip(force)) {
          ModelsDev.Data.reset()
          return { ok: true }
        }
        const result = await fetchApi()
        if (!result.ok) {
          log.warn("models.dev fetch failed", { status: result.status })
          return { ok: false, error: `models.dev fetch failed (HTTP ${result.status})` }
        }
        // Validate BEFORE writing: a corrupted/truncated response body must
        // never overwrite a previously-good cache on disk.
        try {
          JSON.parse(result.text)
        } catch (e) {
          log.error("Invalid response from models.dev", { error: e })
          return { ok: false, error: "Invalid response from models.dev" }
        }
        await Filesystem.write(filepath, result.text)
        ModelsDev.Data.reset()
        await Promise.all(refreshCallbacks.map((cb) => cb()))
        return { ok: true }
      })
    } catch (e) {
      log.error("Failed to fetch models.dev", {
        error: e,
      })
      return { ok: false, error: e instanceof Error ? e.message : String(e) }
    }
  }
}

if (!Flag.OPENCODE_DISABLE_MODELS_FETCH && !process.argv.includes("--get-yargs-completions")) {
  ModelsDev.refresh()
  setInterval(
    async () => {
      await ModelsDev.refresh()
    },
    60 * 1000 * 60,
  ).unref()
}
