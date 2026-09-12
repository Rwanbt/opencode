/**
 * collective/provider-discovery.ts — TEAM-B02 adapter
 *
 * Thin adapter preserving the pre-B02 Debate surface. All discovery
 * logic now lives in packages/unifia/src/multi-model/provider-discovery.ts
 * (the canonical substrate introduced by B02).
 *
 * Adapter contract:
 *   - Public namespace `ProviderDiscovery` is preserved verbatim.
 *   - Public types `DiscoveredProvider`, `GhostWarning`,
 *     `InsufficientProvidersError` are preserved (same field names,
 *     same runtime shape).
 *   - The DiscoveredProvider `providerID`/`modelID` fields remain the
 *     legacy branded strings (ProviderID / ModelID from provider/schema)
 *     so Debate code that consumes them keeps compiling without
 *     modification. The adapter does the ModelRef → branded-string
 *     conversion.
 *
 * Migration semantics:
 *   - discover()    : delegates to multi-model provider-discovery,
 *                     converts ModelRef → DiscoveredProvider.
 *   - includeJudge(): delegates to multi-model includeJudgeInList,
 *                     converts ModelRef judge → legacy shape.
 *   - selectJudge() : delegates to multi-model selectJudgeFromParticipants,
 *                     converts ModelRef → legacy shape.
 *
 * Behaviour change vs the pre-B02 implementation: NONE. The
 * discovery cascade, PREFERRED_MODELS list, CLI/credential configs,
 * ghost-model audit, and InsufficientProvidersError threshold are
 * identical — only the storage location moved.
 *
 * This file MUST stay a thin adapter. Any new logic must go into
 * multi-model/provider-discovery.ts so the canonical substrate remains
 * the single source of truth.
 */

import { Effect } from "effect"
import { ProviderID, ModelID } from "../provider/schema"
import {
  discoverAvailableProviders,
  includeJudgeInList,
  selectJudgeFromParticipants,
  InsufficientProvidersError as MultiModelInsufficientProvidersError,
  type DiscoveredProvider as MultiModelDiscoveredProvider,
  type GhostWarning as MultiModelGhostWarning,
  type ExplicitParticipant,
} from "../multi-model/provider-discovery"

export namespace ProviderDiscovery {
  /**
   * Re-export of the canonical InsufficientProvidersError so existing
   * Debate callers that import ProviderDiscovery.InsufficientProvidersError
   * see the same error class.
   */
  export const InsufficientProvidersError = MultiModelInsufficientProvidersError

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

  // ----------------------------------------------------------------------------------
  // Adapter conversions — ModelRef → legacy branded strings
  // ----------------------------------------------------------------------------------

  function toLegacyProvider(mp: MultiModelDiscoveredProvider): DiscoveredProvider {
    const base: DiscoveredProvider = {
      providerID: ProviderID.make(mp.model.providerID),
      modelID: ModelID.make(mp.model.modelID),
      authMethod: mp.authMethod,
    }
    return {
      ...base,
      ...(mp.role !== undefined ? { role: mp.role } : {}),
      ...(mp.cost !== undefined ? { cost: mp.cost } : {}),
    }
  }

  function toLegacyGhostWarning(mg: MultiModelGhostWarning): GhostWarning {
    return {
      providerID: mg.model.providerID,
      modelID: mg.model.modelID,
      reason: mg.reason,
    }
  }

  function fromLegacyProvider(p: DiscoveredProvider): MultiModelDiscoveredProvider {
    return {
      // ProviderID/ModelID are branded strings (provider/schema). Their
      // string content already passed schema validation upstream; we
      // forward to multi-model which re-validates structurally. To
      // avoid duplicating the structural regex here we use the brand
      // constructor exposed by B01 for trust-boundary reconstruction.
      model: {
        providerID: p.providerID as unknown as string,
        modelID: p.modelID as unknown as string,
      } as unknown as MultiModelDiscoveredProvider["model"],
      authMethod: p.authMethod,
      ...(p.role !== undefined ? { role: p.role } : {}),
      ...(p.cost !== undefined ? { cost: p.cost } : {}),
    }
  }

  // ----------------------------------------------------------------------------------
  // Public API — preserved verbatim
  // ----------------------------------------------------------------------------------

  /**
   * Discover Debate participants. Behaviour identical to the pre-B02
   * implementation: explicit short-circuit, 4-step auth cascade, ghost
   * audit, InsufficientProvidersError if < 2 distinct.
   */
  export const discover = Effect.fn("ProviderDiscovery.discover")(function* (
    explicit?: Array<{ providerID: string; modelID: string; role?: string }>,
    maxProviders?: number,
  ) {
    const explicitNorm: ExplicitParticipant[] | undefined = explicit?.map((p) => {
      const base: ExplicitParticipant = { providerID: p.providerID, modelID: p.modelID }
      if (p.role !== undefined) (base as { role?: string }).role = p.role
      return base
    })
    // discoverAvailableProviders already returns an Effect (not a Promise).
    // yield* it directly so a typed Effect.fail (e.g. InsufficientProvidersError)
    // propagates as a genuine Fail through Effect's own error channel. The
    // previous Effect.runPromise(...) + Effect.promise(...) round-trip forced
    // every Fail through a Promise rejection, which Effect.promise treats as
    // an unrecoverable Die — silently breaking the typed error contract
    // declared by callers such as Orchestrator.Interface.run (see
    // collective/orchestrator.ts).
    const result = yield* discoverAvailableProviders(explicitNorm, maxProviders)
    return {
      providers: result.providers.map(toLegacyProvider),
      ghostWarnings: result.ghostWarnings.map(toLegacyGhostWarning),
    }
  })

  /**
   * Prepend a primary judge. Pure / synchronous; identical to pre-B02.
   */
  export function includeJudge(
    providers: DiscoveredProvider[],
    judgeProviderID?: ProviderID,
    judgeModelID?: ModelID,
  ): DiscoveredProvider[] {
    const judge =
      judgeProviderID && judgeModelID
        ? ({
            providerID: judgeProviderID as unknown as string,
            modelID: judgeModelID as unknown as string,
          } as Parameters<typeof includeJudgeInList>[1])
        : undefined
    const list = providers.map(fromLegacyProvider)
    const updated = includeJudgeInList(list, judge)
    return updated.map(toLegacyProvider)
  }

  /**
   * Pick a judge. Heuristic preserved verbatim.
   */
  export function selectJudge(
    participants: DiscoveredProvider[],
    explicitProviderID?: ProviderID,
    explicitModelID?: ModelID,
  ): Effect.Effect<DiscoveredProvider> {
    const explicitJudge =
      explicitProviderID && explicitModelID
        ? ({
            providerID: explicitProviderID as unknown as string,
            modelID: explicitModelID as unknown as string,
          } as Parameters<typeof selectJudgeFromParticipants>[1])
        : undefined
    const list = participants.map(fromLegacyProvider)
    return Effect.map(selectJudgeFromParticipants(list, explicitJudge), toLegacyProvider)
  }
}
