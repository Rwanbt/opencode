import { Effect } from "effect"
import { NamedError } from "@opencode-ai/util/error"
import z from "zod"
import { Provider } from "../provider/provider"
import { Auth } from "../auth"
import { ProviderID, ModelID } from "../provider/schema"
import { Collective } from "./types"
import { Log } from "../util/log"

export namespace ProviderDiscovery {
  const log = Log.create({ service: "provider-discovery" })

  export const InsufficientProvidersError = NamedError.create(
    "InsufficientProvidersError",
    z.object({ available: z.number(), required: z.number() }),
  )

  export type DiscoveredProvider = {
    providerID: ProviderID
    modelID: ModelID
    role?: string
    authMethod: "api_key" | "credential_file" | "cli_subprocess"
    cost?: { input: number; output: number }
  }

  export type GhostWarning = {
    providerID: string
    modelID: string
    reason: string
  }

  const PREFERRED_MODELS: Array<{ providerID: string; modelID: string }> = [
    { providerID: "anthropic", modelID: "claude-sonnet-4-20250514" },
    { providerID: "openai", modelID: "gpt-4.1" },
    { providerID: "google", modelID: "gemini-2.5-pro" },
    { providerID: "mistral", modelID: "mistral-large-latest" },
    { providerID: "deepseek", modelID: "deepseek-chat" },
    { providerID: "groq", modelID: "llama-3.3-70b-versatile" },
    { providerID: "openrouter", modelID: "anthropic/claude-sonnet-4" },
  ]

  const CLI_AUTH_CONFIGS: Record<string, { binary: string; args: string[] }> = {
    anthropic: { binary: "claude", args: ["--print"] },
    openai: { binary: "codex", args: ["exec"] },
    google: { binary: "gemini", args: ["-p", "--skip-trust"] },
  }

  const CREDENTIAL_FILE_PATHS: Record<string, { path: string; extractor: (content: string) => string | null }> = {
    anthropic: {
      path: "~/.claude/.credentials.json",
      extractor: (content) => {
        try {
          const json = JSON.parse(content)
          return json?.claudeAiOauth?.accessToken ?? null
        } catch {
          return null
        }
      },
    },
    openai: {
      path: "~/.codex/auth.json",
      extractor: (content) => {
        try {
          const json = JSON.parse(content)
          return json?.tokens?.access_token ?? null
        } catch {
          return null
        }
      },
    },
  }

  export const discover = Effect.fn("ProviderDiscovery.discover")(function* (
    explicit?: Array<{ providerID: string; modelID: string; role?: string }>,
    maxProviders?: number,
  ) {
    if (explicit && explicit.length >= 2) {
      log.info("using explicit participants", { count: explicit.length })
      return {
        providers: explicit.map((p) => ({
          providerID: ProviderID.make(p.providerID),
          modelID: ModelID.make(p.modelID),
          role: p.role,
          authMethod: "api_key" as const,
        })),
        ghostWarnings: [] as GhostWarning[],
      }
    }

    const providers = yield* Effect.promise(() => Provider.list())
    const authEntries = yield* Effect.promise(() => Auth.all())
    const available: DiscoveredProvider[] = []
    const ghostWarnings: GhostWarning[] = []
    const cap = maxProviders ?? 5

    for (const pref of PREFERRED_MODELS) {
      if (available.length >= cap) break

      const pid = ProviderID.make(pref.providerID)
      const provider = providers[pid]

      // Step 1: Check env vars
      if (provider) {
        const hasEnvKey = provider.env.some((envVar) => !!process.env[envVar])
        if (hasEnvKey) {
          const mid = resolveModelID(provider, pref.modelID)
          if (mid) {
            const model = provider.models[mid]
            available.push({
              providerID: pid,
              modelID: ModelID.make(mid),
              authMethod: "api_key",
              cost: model ? { input: model.cost.input, output: model.cost.output } : undefined,
            })
            continue
          }
        }
      }

      // Step 2: Check stored auth
      const hasAuth = !!authEntries[pref.providerID]
      if (hasAuth && provider) {
        const mid = resolveModelID(provider, pref.modelID)
        if (mid) {
          const model = provider.models[mid]
          available.push({
            providerID: pid,
            modelID: ModelID.make(mid),
            authMethod: "api_key",
            cost: model ? { input: model.cost.input, output: model.cost.output } : undefined,
          })
          continue
        }
      }

      // Step 3: Check credential files
      const credConfig = CREDENTIAL_FILE_PATHS[pref.providerID]
      if (credConfig && provider) {
        const token = yield* tryReadCredentialFile(credConfig.path, credConfig.extractor)
        if (token) {
          const mid = resolveModelID(provider, pref.modelID)
          if (mid) {
            available.push({
              providerID: pid,
              modelID: ModelID.make(mid),
              authMethod: "credential_file",
            })
            continue
          }
        }
      }

      // Step 4: Check CLI subprocess
      const cliConfig = CLI_AUTH_CONFIGS[pref.providerID]
      if (cliConfig && provider) {
        const hasCliAuth = yield* tryCliAuth(cliConfig.binary, cliConfig.args)
        if (hasCliAuth) {
          const mid = resolveModelID(provider, pref.modelID)
          if (mid) {
            available.push({
              providerID: pid,
              modelID: ModelID.make(mid),
              authMethod: "cli_subprocess",
            })
            continue
          }
        }
      }
    }

    // Ghost model audit
    for (const p of available) {
      const provider = providers[p.providerID]
      if (!provider) continue
      const model = provider.models[p.modelID as string]
      if (model && model.status === "deprecated") {
        ghostWarnings.push({
          providerID: p.providerID as string,
          modelID: p.modelID as string,
          reason: `Model ${p.modelID} is deprecated, consider upgrading`,
        })
      }
    }

    if (available.length < 2) {
      return yield* Effect.fail(
        new InsufficientProvidersError({ available: available.length, required: 2 }),
      )
    }

    log.info("discovered providers", {
      count: available.length,
      providers: available.map((p) => `${p.providerID}/${p.modelID}`).join(", "),
      ghostWarnings: ghostWarnings.length,
    })

    return { providers: available, ghostWarnings }
  })

  export function selectJudge(
    participants: DiscoveredProvider[],
    explicitProviderID?: ProviderID,
    explicitModelID?: ModelID,
  ): Effect.Effect<DiscoveredProvider> {
    return Effect.gen(function* () {
      if (explicitProviderID && explicitModelID) {
        return {
          providerID: explicitProviderID,
          modelID: explicitModelID,
          role: "judge",
          authMethod: "api_key" as const,
        }
      }

      const participantProviders = new Set(participants.map((p) => p.providerID as string))
      const providers = yield* Effect.promise(() => Provider.list())
      const authEntries = yield* Effect.promise(() => Auth.all())

      for (const pref of PREFERRED_MODELS) {
        if (participantProviders.has(pref.providerID)) continue

        const pid = ProviderID.make(pref.providerID)
        const provider = providers[pid]
        if (!provider) continue

        const hasAuth = !!authEntries[pref.providerID]
        const hasEnvKey = provider.env.some((envVar) => !!process.env[envVar])
        if (!hasAuth && !hasEnvKey) continue

        log.info("selected judge", { providerID: pref.providerID, modelID: pref.modelID })
        return {
          providerID: pid,
          modelID: ModelID.make(pref.modelID),
          role: "judge" as const,
          authMethod: "api_key" as const,
        }
      }

      const strongest = [...participants].sort((a, b) => {
        const costA = a.cost ? a.cost.output : 10
        const costB = b.cost ? b.cost.output : 10
        return costB - costA
      })
      const fallback = strongest[0]!
      log.info("judge fallback to strongest participant", {
        providerID: fallback.providerID,
        modelID: fallback.modelID,
      })
      return { ...fallback, role: "judge" as const }
    })
  }

  function resolveModelID(provider: Provider.Info, preferredModelID: string): string | undefined {
    if (provider.models[preferredModelID]) return preferredModelID
    const modelIDs = Object.keys(provider.models)
    return modelIDs.length > 0 ? modelIDs[0] : undefined
  }

  function tryReadCredentialFile(
    filePath: string,
    extractor: (content: string) => string | null,
  ): Effect.Effect<string | null> {
    return Effect.tryPromise({
      try: async () => {
        const os = await import("node:os")
        const fs = await import("node:fs/promises")
        const resolved = filePath.replace("~", os.homedir())
        const content = await fs.readFile(resolved, "utf-8")
        return extractor(content)
      },
      catch: (e) => e as Error,
    }).pipe(Effect.catch(() => Effect.succeed(null)))
  }

  function tryCliAuth(binary: string, args: string[]): Effect.Effect<boolean> {
    return Effect.tryPromise({
      try: async () => {
        const { execSync } = await import("node:child_process")
        execSync(`${binary} ${args.join(" ")}`, {
          timeout: 5000,
          stdio: ["pipe", "pipe", "pipe"],
        })
        return true
      },
      catch: (e) => e as Error,
    }).pipe(Effect.catch(() => Effect.succeed(false)))
  }
}
