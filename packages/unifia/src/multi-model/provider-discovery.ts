/**
 * multi-model/provider-discovery.ts — TEAM-B02
 *
 * Canonical provider/model discovery substrate. Extracted from
 * packages/unifia/src/collective/provider-discovery.ts (TEAM-B02
 * migration) so the discovery logic can be shared by every consumer of
 * the multi-model invocation layer.
 *
 * Responsibilities (plan directeur §26 ligne 1558 — Carte B02):
 *   - discoverAvailableProviders : enumerate usable providers/models
 *     using the canonical ModelRef contract (B01) and the AuthMethod enum
 *     declared here (api_key | credential_file | cli_subprocess).
 *   - selectJudgeFromParticipants : pick the strongest/most-available
 *     provider-model pair to act as debate judge.
 *   - includeJudgeInList          : prepend a primary judge to an
 *     existing list without duplicating an existing entry.
 *   - InsufficientProvidersError  : raised when fewer than 2 distinct
 *     models are available (Debate requires ≥ 2 participants).
 *
 * Authority hierarchy (this module is leaf; does NOT redefine registry):
 *   - C01 (packages/unifia/src/model-intelligence/) owns the registry of
 *     known models, pricing, capabilities, alias resolution. B02 never
 *     re-implements those lookups — it asks Provider.list() and Auth.all()
 *     (the runtime discovery surfaces) and returns opaque ModelRefs.
 *   - B01 (multi-model/types.ts) owns the ModelRef/EndpointRef contract.
 *     B02 consumes it via `makeModelRef` and never builds raw providerID
 *     strings into un-validated objects.
 *   - The Debate agent (collective/orchestrator.ts) consumes the result of
 *     this module via the adapter in
 *     packages/unifia/src/collective/provider-discovery.ts, which converts
 *     MultiModelDiscoveredProvider into the legacy DiscoveredProvider shape.
 *
 * Hard constraints (B02 scope manifest):
 *   - No imports from packages/unifia/src/team/** (G01/G02 figé).
 *   - No imports from packages/unifia/src/model-intelligence/** (C01 figé).
 *   - No re-implementation of C01 registry. We use Provider.list() and
 *     Auth.all() which are runtime-discovery APIs, not registry APIs.
 *   - No second registry, no second catalogue.
 *
 * Behaviour vs Debate (preserved):
 *   - PREFERRED_MODELS table (7 entries) is identical to the previous
 *     collective/provider-discovery.ts implementation.
 *   - CLI_AUTH_CONFIGS (anthropic, openai, google) is identical.
 *   - CREDENTIAL_FILE_PATHS (anthropic, openai) is identical.
 *   - 4-step auth cascade (env var → stored auth → credential file → CLI)
 *     is identical.
 *   - Ghost-model audit (deprecated status) is identical.
 *   - InsufficientProvidersError threshold (≥ 2 distinct) is identical.
 *
 * Differences vs the legacy collective/provider-discovery.ts:
 *   - The canonical providerID/modelID pair is exposed as a B01 ModelRef
 *     (structurally validated via makeModelRef), not as un-typed strings.
 *   - The discovered list and ghost warnings carry ModelRef values
 *     instead of bare {providerID, modelID} strings, so downstream
 *     consumers (B03+ invoker) can pass them directly to the
 *     InvocationRequest.model field without re-parsing.
 *
 * @module multi-model/provider-discovery
 */

import { Effect } from "effect"
import { NamedError } from "@unifia/util/error"
import z from "zod"
import { Provider } from "../provider/provider"
import { Auth } from "../auth"
import { Log } from "../util/log"
import { makeModelRef, type ModelRef } from "./types"

// Re-export makeModelRef so trust-boundary adapters and tests can build
// ModelRef values from raw providerID/modelID strings without reaching
// into ./types directly. Behaviour unchanged from B01.
export { makeModelRef }

// --------------------------------------------------------------------------------------
// Public types — canonical discovery surface
// --------------------------------------------------------------------------------------

export const AUTH_METHODS = ["api_key", "credential_file", "cli_subprocess"] as const
export type AuthMethod = (typeof AUTH_METHODS)[number]

export type DiscoveredProvider = {
  /** Canonical ModelRef (B01). Both providerID and modelID are structurally validated. */
  readonly model: ModelRef
  readonly role?: string
  readonly authMethod: AuthMethod
  readonly cost?: { input: number; output: number }
}

export type GhostWarning = {
  readonly model: ModelRef
  readonly reason: string
}

export type DiscoveryResult = {
  readonly providers: DiscoveredProvider[]
  readonly ghostWarnings: GhostWarning[]
}

export type ExplicitParticipant = {
  readonly providerID: string
  readonly modelID: string
  readonly role?: string
}

// --------------------------------------------------------------------------------------
// Errors
// --------------------------------------------------------------------------------------

/**
 * Raised when fewer than 2 distinct provider/model pairs are available.
 * Matches the legacy behaviour of collective/provider-discovery.ts —
 * the Debate agent requires ≥ 2 participants.
 */
export const InsufficientProvidersError = NamedError.create(
  "InsufficientProvidersError",
  z.object({ available: z.number(), required: z.number() }),
)

// --------------------------------------------------------------------------------------
// Constants — preserved verbatim from the legacy collective module
// --------------------------------------------------------------------------------------

const PREFERRED_MODELS: ReadonlyArray<{ providerID: string; modelID: string }> = [
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

const CREDENTIAL_FILE_PATHS: Record<
  string,
  { path: string; extractor: (content: string) => string | null }
> = {
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

// --------------------------------------------------------------------------------------
// Logger
// --------------------------------------------------------------------------------------

const log = Log.create({ service: "multi-model/provider-discovery" })

// --------------------------------------------------------------------------------------
// Public API — discoverAvailableProviders
// --------------------------------------------------------------------------------------

/**
 * Discover available provider/model pairs that can serve as Debate
 * participants (≥ 2 distinct). Returns canonical DiscoveredProvider
 * entries carrying B01 ModelRef values, plus any ghost-model warnings
 * (deprecated models still returned to the caller for transparency).
 *
 * Resolution cascade for each preferred model:
 *   1. provider knows the model AND a required env var is set
 *   2. provider knows the model AND Auth.all() reports an entry
 *   3. credential file exists at the configured path AND its extractor
 *      returns a non-null token
 *   4. CLI binary can be invoked with the configured args (timeout 5s)
 *
 * Behaviour preserved from collective/provider-discovery.ts (B02
 * migration; no semantic changes — refactor is structural only).
 */
export const discoverAvailableProviders = Effect.fn("discoverAvailableProviders")(function* (
  explicit?: ExplicitParticipant[],
  _maxProviders?: number,
) {
  // Explicit participants short-circuit: same semantics as legacy.
  if (explicit && explicit.length >= 1) {
    const unique = new Map<string, ExplicitParticipant>()
    for (const participant of explicit) {
      unique.set(`${participant.providerID}:${participant.modelID}`, participant)
    }
    if (unique.size < 2) {
      return yield* Effect.fail(new InsufficientProvidersError({ available: unique.size, required: 2 }))
    }

    const providers: DiscoveredProvider[] = []
    for (const p of unique.values()) {
      const model = makeModelRef(p.providerID, p.modelID)
      const entry: DiscoveredProvider = {
        model,
        authMethod: "api_key",
      }
      if (p.role !== undefined) (entry as { role?: string }).role = p.role
      providers.push(entry)
    }

    log.info("using explicit participants", { count: providers.length })
    return { providers, ghostWarnings: [] }
  }

  const providers = yield* Effect.promise(() => Provider.list())
  const authEntries = yield* Effect.promise(() => Auth.all())
  const available: DiscoveredProvider[] = []
  const ghostWarnings: GhostWarning[] = []

  for (const pref of PREFERRED_MODELS) {
    const provider = (providers as Record<string, unknown>)[pref.providerID]

    // Step 1: env-var auth
    if (provider) {
      const envVars = (provider as { env?: string[] }).env
      const hasEnvKey = envVars?.some((envVar) => !!process.env[envVar]) ?? false
      if (hasEnvKey) {
        const mid = resolveModelID(provider, pref.modelID)
        if (mid) {
          const resolvedModel = makeModelRef(pref.providerID, mid)
          const cost = readCost(provider, mid)
          available.push({
            model: resolvedModel,
            authMethod: "api_key",
            ...(cost ? { cost } : {}),
          })
          continue
        }
      }
    }

    // Step 2: stored auth entry
    const hasAuth = !!authEntries[pref.providerID]
    if (hasAuth && provider) {
      const mid = resolveModelID(provider, pref.modelID)
      if (mid) {
        const resolvedModel = makeModelRef(pref.providerID, mid)
        const cost = readCost(provider, mid)
        available.push({
          model: resolvedModel,
          authMethod: "api_key",
          ...(cost ? { cost } : {}),
        })
        continue
      }
    }

    // Step 3: credential file
    const credConfig = CREDENTIAL_FILE_PATHS[pref.providerID]
    if (credConfig && provider) {
      const token = yield* tryReadCredentialFile(credConfig.path, credConfig.extractor)
      if (token) {
        const mid = resolveModelID(provider, pref.modelID)
        if (mid) {
          const resolvedModel = makeModelRef(pref.providerID, mid)
          available.push({
            model: resolvedModel,
            authMethod: "credential_file",
          })
          continue
        }
      }
    }

    // Step 4: CLI subprocess auth
    const cliConfig = CLI_AUTH_CONFIGS[pref.providerID]
    if (cliConfig && provider) {
      const hasCliAuth = yield* tryCliAuth(cliConfig.binary, cliConfig.args)
      if (hasCliAuth) {
        const mid = resolveModelID(provider, pref.modelID)
        if (mid) {
          const resolvedModel = makeModelRef(pref.providerID, mid)
          available.push({
            model: resolvedModel,
            authMethod: "cli_subprocess",
          })
        }
      }
    }
  }

  // Ghost-model audit
  for (const p of available) {
    const provider = (providers as Record<string, unknown>)[p.model.providerID]
    if (!provider) continue
    const modelRecord = (provider as { models?: Record<string, { status?: string; cost?: { input: number; output: number } }> })
      .models?.[p.model.modelID]
    if (modelRecord && modelRecord.status === "deprecated") {
      ghostWarnings.push({
        model: p.model,
        reason: `Model ${p.model.modelID} is deprecated, consider upgrading`,
      })
    }
  }

  if (available.length < 2) {
    return yield* Effect.fail(new InsufficientProvidersError({ available: available.length, required: 2 }))
  }

  log.info("discovered providers", {
    count: available.length,
    providers: available.map((p) => `${p.model.providerID}/${p.model.modelID}`).join(", "),
    ghostWarnings: ghostWarnings.length,
  })

  return { providers: available, ghostWarnings }
})

// --------------------------------------------------------------------------------------
// Public API — includeJudgeInList (pure, sync)
// --------------------------------------------------------------------------------------

/**
 * Prepend a primary judge to an existing provider list without
 * duplicating an entry that already matches the same provider+model.
 * Pure / synchronous; same semantics as legacy includeJudge.
 */
export function includeJudgeInList(
  providers: DiscoveredProvider[],
  judge?: ModelRef,
): DiscoveredProvider[] {
  if (!judge) return providers

  const alreadyIncluded = providers.some(
    (p) => p.model.providerID === judge.providerID && p.model.modelID === judge.modelID,
  )
  if (alreadyIncluded) return providers

  return [
    {
      model: judge,
      role: "judge",
      authMethod: "api_key",
    },
    ...providers,
  ]
}

// --------------------------------------------------------------------------------------
// Public API — selectJudgeFromParticipants
// --------------------------------------------------------------------------------------

/**
 * Pick the judge for a Debate round. Behaviour preserved from legacy
 * selectJudge:
 *   - explicit judge (provider+model) wins if supplied
 *   - else iterate PREFERRED_MODELS in order; first one not already a
 *     participant AND with env-var OR stored auth is selected
 *   - else fallback to the strongest (highest output cost) participant
 *
 * `judge` argument accepts an explicit ModelRef (preferred) — adapter
 * can also pass undefined to defer to the heuristic.
 */
export const selectJudgeFromParticipants = Effect.fn("selectJudgeFromParticipants")(function* (
  participants: DiscoveredProvider[],
  explicitJudge?: ModelRef,
) {
  if (explicitJudge) {
    const entry: DiscoveredProvider = {
      model: explicitJudge,
      authMethod: "api_key",
      role: "judge",
    }
    return entry
  }

  const participantProviders = new Set(participants.map((p) => p.model.providerID))
  const providers = yield* Effect.promise(() => Provider.list())
  const authEntries = yield* Effect.promise(() => Auth.all())

  for (const pref of PREFERRED_MODELS) {
    if (participantProviders.has(pref.providerID)) continue

    const provider = (providers as Record<string, unknown>)[pref.providerID]
    if (!provider) continue

    const hasAuth = !!authEntries[pref.providerID]
    const envVars = (provider as { env?: string[] }).env
    const hasEnvKey = envVars?.some((envVar) => !!process.env[envVar]) ?? false
    if (!hasAuth && !hasEnvKey) continue

    log.info("selected judge", { providerID: pref.providerID, modelID: pref.modelID })
    const entry: DiscoveredProvider = {
      model: makeModelRef(pref.providerID, pref.modelID),
      authMethod: "api_key",
      role: "judge",
    }
    return entry
  }

  const strongest = [...participants].sort((a, b) => {
    const costA = a.cost ? a.cost.output : 10
    const costB = b.cost ? b.cost.output : 10
    return costB - costA
  })
  const fallback = strongest[0]!
  log.info("judge fallback to strongest participant", {
    providerID: fallback.model.providerID,
    modelID: fallback.model.modelID,
  })
  const entry: DiscoveredProvider = { ...fallback, role: "judge" }
  return entry
})

// --------------------------------------------------------------------------------------
// Internal helpers
// --------------------------------------------------------------------------------------

function resolveModelID(provider: unknown, preferredModelID: string): string | undefined {
  const models = (provider as { models?: Record<string, unknown> } | undefined)?.models
  if (!models) return undefined
  if (models[preferredModelID]) return preferredModelID
  const modelIDs = Object.keys(models)
  return modelIDs.length > 0 ? modelIDs[0] : undefined
}

function readCost(provider: unknown, modelID: string): { input: number; output: number } | undefined {
  const models = (provider as { models?: Record<string, { cost?: { input: number; output: number } }> })
    .models
  const cost = models?.[modelID]?.cost
  if (!cost) return undefined
  return { input: cost.input, output: cost.output }
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
      const { execFileSync } = await import("node:child_process")
      execFileSync(binary, args, {
        timeout: 5000,
        stdio: ["pipe", "pipe", "pipe"],
      })
      return true
    },
    catch: (e) => e as Error,
  }).pipe(Effect.catch(() => Effect.succeed(false)))
}
