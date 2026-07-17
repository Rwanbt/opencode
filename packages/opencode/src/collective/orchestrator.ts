import { Effect, Layer, ServiceMap } from "effect"
import { generateText, generateObject } from "ai"
import { createHash } from "node:crypto"
import z from "zod"
import { NamedError } from "@opencode-ai/util/error"
import { makeRuntime } from "../effect/run-service"
import { Provider } from "../provider/provider"
import { ProviderID, ModelID } from "../provider/schema"
import { Bus } from "../bus"
import { Instance } from "../project/instance"
import { Log } from "../util/log"
import { Collective } from "./types"
import { DebateStore } from "./debate-store"
import { BudgetTracker } from "./budget-tracker"
import { ProviderDiscovery } from "./provider-discovery"
import { ClaimExtractor } from "./claim-extractor"
import { SynthesisJudge } from "./synthesis-judge"
import { RoleAssigner } from "./role-assigner"
import { JargonChecker } from "./jargon-checker"
import { RedTeam } from "./red-team"
import { Metrics } from "./metrics"
import { Canary } from "./canary"
import { TierClassifier } from "./tier-classifier"
import * as Events from "./events"

import PROMPT_DIVERGE from "./prompts/diverge.txt"
import PROMPT_CONVERGENCE from "./prompts/convergence.txt"

export namespace Orchestrator {
  const log = Log.create({ service: "orchestrator" })

  export const OrchestratorError = NamedError.create(
    "OrchestratorError",
    z.object({ message: z.string() }),
  )

  export interface Interface {
    readonly run: (
      config: Collective.DebateConfig,
      // Fired synchronously right after the debate row is created (before any
      // phase runs), so callers can start filtering Bus events for this debate
      // before the first ProviderStarted event is published. Optional and
      // backward compatible — existing callers that don't pass it are unaffected.
      onDebateID?: (id: Collective.DebateID) => void,
    ) => Effect.Effect<
      Collective.DebateReport,
      | InstanceType<typeof OrchestratorError>
      | InstanceType<typeof BudgetTracker.BudgetExceededError>
      | InstanceType<typeof ProviderDiscovery.InsufficientProvidersError>
      | Error
    >
    readonly estimate: (
      config: Collective.DebateConfig,
    ) => Effect.Effect<Collective.BudgetEstimate, Error>
  }

  export class Service extends ServiceMap.Service<Service, Interface>()("@opencode/Orchestrator") {}

  function anonymize(providerID: string, modelID: string, salt: string): string {
    return createHash("sha256")
      .update(`${providerID}:${modelID}:${salt}`)
      .digest("hex")
      .slice(0, 16)
  }

  export const layer = Layer.effect(
    Service,
    Effect.gen(function* () {
      const store = yield* DebateStore.Service
      const bus = yield* Bus.Service

      const run = Effect.fn("Orchestrator.run")(function* (
        config: Collective.DebateConfig,
        onDebateID?: (id: Collective.DebateID) => void,
      ) {
        const startTime = Date.now()
        const salt = crypto.randomUUID()
        let directory: string
        try {
          directory = Instance.current.directory
        } catch {
          directory = process.cwd()
        }

        // ── Auto-tier classification (P6) ───────────────────────────
        if (!config.participants && config.tier === "quick") {
          const recommendation = TierClassifier.classifyHeuristic(config.question)
          if (recommendation.tier !== config.tier) {
            log.info("auto-tier reclassified", {
              from: config.tier,
              to: recommendation.tier,
              score: recommendation.score,
              reason: recommendation.reason,
            })
            config = { ...config, tier: recommendation.tier }
          }
        }

        const tierCfg = Collective.TIER_CONFIG[config.tier]

        // ── A/B mode (silent 10% split on Tier 2+) ──────────────────
        let abVariant: "control" | "variant" | undefined
        const isAbEligible =
          config.tier === "standard" || config.tier === "deep"
        if (isAbEligible) {
          const roll = Math.random()
          if (roll < 0.1) {
            abVariant = "variant"
            log.info("A/B mode: variant selected", { tier: config.tier })
          } else {
            abVariant = "control"
          }
        }

        // ── Discover providers ─────────────────────────────────────
        const { providers: discoveredParticipants, ghostWarnings } = yield* ProviderDiscovery.discover(
          config.participants,
        )
        const discovered = ProviderDiscovery.includeJudge(
          discoveredParticipants,
          config.judgeProviderID,
          config.judgeModelID,
        )
        if (ghostWarnings.length > 0) {
          log.info("ghost model warnings", { warnings: ghostWarnings })
        }

        const debateID = yield* store.create(config, discovered.length, directory)
        // Must fire immediately after store.create(), before any other step —
        // callers (e.g. DebateTool) rely on this to start filtering Bus events
        // for this debate before Phase 1 publishes its first ProviderStarted.
        onDebateID?.(debateID)
        const budgetCfg = config.budget ?? BudgetTracker.unlimited()
        const budget = BudgetTracker.create(budgetCfg)
        const failedProviders: Array<{ provider: string; error: string }> = []

        const describeError = (error: unknown): string => {
          if (error instanceof Error) {
            const cause = "cause" in error && error.cause ? `; cause: ${describeError(error.cause)}` : ""
            return `${error.name}: ${error.message}${cause}`
          }
          return String(error)
        }

        try {
          // ── Role assignment ───────────────────────────────────────
          const roles = yield* RoleAssigner.assign(
            config.question,
            discovered.length,
            discovered[0]!.providerID,
            discovered[0]!.modelID,
            config.roles,
          )

          const participants: Collective.Participant[] = discovered.map((d, i) => ({
            providerID: d.providerID,
            modelID: d.modelID,
            role: roles[i],
            anonymousHash: anonymize(d.providerID, d.modelID, salt),
            authMethod: d.authMethod,
          }))

          // ── Seed from memory ──────────────────────────────────────
          let seeds: Collective.Claim[] = []
          if (!config.noMemory) {
            seeds = yield* store.seedWithPastBlindSpots(config.question, directory, 3)
          }

          yield* bus.publish(Events.DebateStarted, {
            debateID,
            tier: config.tier,
            providers: participants.map((p) => `${p.providerID}/${p.modelID}`),
          })

          // ── Canary injection (Tier 3 / Deep) ───────────────────────
          let canaryBug: Canary.CanaryBug | undefined
          let effectiveContext = config.context
          if (tierCfg.enableCanary && config.enableCanary) {
            const cheapP = discovered[0]!
            const { canary, tokenUsage: canaryTokens } = yield* Canary.generate(
              config.question,
              config.context,
              cheapP.providerID,
              cheapP.modelID,
              bus,
              debateID,
            )
            canaryBug = canary
            effectiveContext = Canary.injectIntoContext(config.context, canary)
            budget.record("canary_gen", cheapP.providerID, canaryTokens.input, canaryTokens.output)
            log.info("canary injected", { category: canary.category })
          }

          // ════════════════════════════════════════════════════════════
          // PHASE 1: DIVERGE
          // ════════════════════════════════════════════════════════════
          yield* store.updateStatus(debateID, "phase1_diverge")
          yield* bus.publish(Events.DebatePhaseChanged, { debateID, phase: "phase1_diverge" })
          log.info("phase 1: diverge", { participantCount: participants.length })

          const phase1Responses = yield* Effect.all(
            participants.map((p) =>
              runParticipant(p, config.question, effectiveContext, seeds, bus, debateID).pipe(
                Effect.catch((error) => {
                  const provider = `${p.providerID}/${p.modelID}`
                  const message = describeError(error)
                  failedProviders.push({ provider, error: message })
                  log.warn("provider unavailable during divergence", { provider, error: message })
                  return Effect.gen(function* () {
                    yield* bus.publish(Events.ProviderFailed, { debateID, provider, error: message, phase: "phase1_diverge" })
                    return null as Collective.PhaseOneResponse | null
                  })
                }),
              ),
            ),
            { concurrency: "unbounded" },
          )

          const validResponses: Collective.PhaseOneResponse[] = []
          for (const r of phase1Responses) {
            if (r !== null) validResponses.push(r)
          }

          if (validResponses.length < 2) {
            return yield* Effect.fail(
              new OrchestratorError({
                message: [
                  `Only ${validResponses.length} model(s) responded. Need at least 2.`,
                  ...failedProviders.map((p) => `Unavailable: ${p.provider} — ${p.error}`),
                ].join("\n"),
              }),
            )
          }

          for (const r of validResponses) {
            budget.record("phase1_diverge", r.providerID, r.tokenUsage.input, r.tokenUsage.output)
          }
          const activeProviders = discovered.filter((p) =>
            validResponses.some((r) => r.providerID === p.providerID && r.modelID === p.modelID),
          )
          yield* budget.check()
          yield* emitCostUpdate(bus, debateID, budget, budgetCfg)

          // ════════════════════════════════════════════════════════════
          // PHASE 2: EXTRACT + VERIFY + JARGON + CLASSIFY
          // ════════════════════════════════════════════════════════════
          let claims: Collective.Claim[] = []
          if (tierCfg.phases.includes("phase2_extract")) {
            yield* store.updateStatus(debateID, "phase2_extract")
            yield* bus.publish(Events.DebatePhaseChanged, { debateID, phase: "phase2_extract" })
            log.info("phase 2: extract", { responseCount: validResponses.length })

            const extractorP = activeProviders[0]!
            const { claims: rawClaims, tokenUsage: extractTokens } = yield* ClaimExtractor.extract(
              validResponses,
              config.question,
              extractorP.providerID,
              extractorP.modelID,
              bus,
              debateID,
            )

            budget.record("phase2_extract", extractorP.providerID, extractTokens.input, extractTokens.output)
            yield* budget.check()

            // Phase 2c — Jargon checker
            const { updatedClaims } = yield* JargonChecker.check(rawClaims, directory)
            claims = updatedClaims

            for (const claim of claims) {
              yield* bus.publish(Events.ClaimExtracted, {
                debateID,
                claimId: claim.claimId,
                category: claim.category,
                novelty: claim.noveltyMarker,
              })
            }

            yield* store.saveClaims(debateID, claims)
            yield* emitCostUpdate(bus, debateID, budget, budgetCfg)
          } else {
            claims = validResponses.flatMap((r) =>
              r.content.split("\n").filter((l) => l.trim().length > 20).map((line) => ({
                claimId: Collective.ClaimID.make(),
                sourceId: r.participantHash,
                sourceProvider: "anonymous",
                category: "other" as const,
                content: line.trim(),
                confidenceSelf: 0.5,
                noveltyMarker: "unique" as const,
                isActionable: false,
                supportedBy: [r.participantHash],
                contradictedBy: [],
              })),
            )
          }

          // ════════════════════════════════════════════════════════════
          // PHASE 3: CONVERGENCE (Standard/Deep only)
          // ════════════════════════════════════════════════════════════
          let convergenceResults: Collective.ConvergenceResponse[] = []
          let initialDisagreements = 0

          if (tierCfg.phases.includes("phase3_converge")) {
            yield* store.updateStatus(debateID, "phase3_converge")
            yield* bus.publish(Events.DebatePhaseChanged, { debateID, phase: "phase3_converge" })

            const targetClaims = claims.filter(
              (c) => c.noveltyMarker === "unique" || c.noveltyMarker === "minority",
            )
            log.info("phase 3: converge", { targetClaimCount: targetClaims.length })

            let prevCritiqueCount = 0
            for (let round = 0; round < tierCfg.maxConvergenceRounds; round++) {
              yield* bus.publish(Events.ConvergenceRound, {
                debateID,
                round: round + 1,
                claimsResubmitted: targetClaims.length,
              })

              const roundResults = yield* Effect.all(
                participants.map((p) =>
                  runConvergence(p, targetClaims, config.question, bus, debateID).pipe(
                    Effect.catch(() =>
                      Effect.succeed(null as Collective.ConvergenceResponse | null),
                    ),
                  ),
                ),
                { concurrency: "unbounded" },
              )

              for (const cr of roundResults) {
                if (cr) {
                  convergenceResults.push(cr)
                  budget.record(
                    "phase3_converge",
                    "convergence",
                    cr.tokenUsage.input,
                    cr.tokenUsage.output,
                  )
                }
              }

              yield* budget.check()
              yield* emitCostUpdate(bus, debateID, budget, budgetCfg)

              // Adaptive halting — measure new critiques per round, not claims
              const totalCritiques = convergenceResults.reduce(
                (sum, cr) => sum + cr.critiques.length,
                0,
              )
              const newCritiques = totalCritiques - prevCritiqueCount
              const marginalGain = prevCritiqueCount > 0 ? newCritiques / prevCritiqueCount : 1
              const snap = budget.snapshot()
              const marginalCost =
                budgetCfg.maxCostUsd > 0 ? snap.costUsd / budgetCfg.maxCostUsd : 0

              if (marginalGain < 0.1 && marginalCost > 0.2) {
                yield* bus.publish(Events.HaltingDecision, {
                  debateID,
                  reason: "Adaptive halt: low marginal gain vs cost",
                  marginalGain,
                  marginalCost,
                })
                log.info("adaptive halt", { round: round + 1, marginalGain, marginalCost })
                break
              }
              prevCritiqueCount = totalCritiques
            }

            initialDisagreements = convergenceResults.reduce(
              (sum, cr) => sum + cr.critiques.filter((c) => c.verdict === "disagree").length,
              0,
            )
          }

          // ── Red Team (conditional) ────────────────────────────────
          let _redTeamAttacks: RedTeam.Attack[] = []
          const consensusRatio = RedTeam.computeConsensusRatio(claims)
          const redTeamSetting = config.redTeam ?? tierCfg.redTeam

          if (RedTeam.shouldActivate(config.tier, redTeamSetting, consensusRatio)) {
            yield* bus.publish(Events.RedTeamActivated, {
              debateID,
              reason: `Consensus ratio ${(consensusRatio * 100).toFixed(0)}% ≥ threshold`,
            })

            const cheapestP = [...discovered].sort((a, b) => {
              const ca = "cost" in a && a.cost ? a.cost.output : 10
              const cb = "cost" in b && b.cost ? b.cost.output : 10
              return ca - cb
            })[0]!

            const { attacks, tokenUsage: rtTokens } = yield* RedTeam.run({
              claims,
              synthesis: "",
              attackerProviderID: cheapestP.providerID,
              attackerModelID: cheapestP.modelID,
              bus,
              debateID,
            })
            _redTeamAttacks = attacks
            budget.record("red_team", cheapestP.providerID, rtTokens.input, rtTokens.output)
          }

          // ════════════════════════════════════════════════════════════
          // PHASE 4: SYNTHESIZE
          // ════════════════════════════════════════════════════════════
          yield* store.updateStatus(debateID, "phase4_synthesize")
          yield* bus.publish(Events.DebatePhaseChanged, { debateID, phase: "phase4_synthesize" })

          const requestedJudge =
            config.judgeProviderID && config.judgeModelID
              ? activeProviders.find(
                  (provider) =>
                    provider.providerID === config.judgeProviderID && provider.modelID === config.judgeModelID,
                )
              : undefined
          const judge = requestedJudge ?? { ...activeProviders[0]!, role: "judge" as const }

          log.info("phase 4: synthesize", {
            claimCount: claims.length,
            judge: `${judge.providerID}/${judge.modelID}`,
          })

          const {
            markdown,
            adjustedClaims,
            unresolvedConflicts,
            traceability,
            meta,
            tokenUsage: synthTokens,
          } = yield* SynthesisJudge.synthesize({
            question: config.question,
            claims,
            participants,
            judgeProviderID: judge.providerID,
            judgeModelID: judge.modelID,
            tier: config.tier,
            initialDisagreements,
            convergenceResults,
            bus,
            debateID,
          })

          budget.record("phase4_synthesize", judge.providerID, synthTokens.input, synthTokens.output)

          // ── Canary verification (Deep only) ─────────────────────────
          if (canaryBug) {
            const canaryResult = Canary.checkDetection(validResponses, canaryBug)
            if (meta) {
              meta.canaryDetected = canaryResult.detected
              if (!canaryResult.detected) {
                meta.fragility = Math.min(1, (meta.fragility ?? 0) + 0.2)
              }
            }
            yield* bus.publish(Events.CanaryResult, {
              debateID,
              detected: canaryResult.detected,
            })
            log.info("canary verification", {
              detected: canaryResult.detected,
              detectedBy: canaryResult.detectedBy.length,
              missedBy: canaryResult.missedBy.length,
            })
          }

          // ── Shadow baseline (background) ──────────────────────────
          let shadowDelta: { blindSpotDelta: number; coverageDelta: number } | undefined
          if (config.enableShadowBaseline && config.tier !== "free") {
            const strongest = [...discovered].sort((a, b) => {
              const ca = "cost" in a && a.cost ? a.cost.output : 10
              const cb = "cost" in b && b.cost ? b.cost.output : 10
              return cb - ca
            })[0]!

            const shadowResult = yield* Metrics.runShadowBaseline({
              question: config.question,
              context: config.context,
              bestProviderID: strongest.providerID,
              bestModelID: strongest.modelID,
              collectiveClaims: adjustedClaims,
            }).pipe(Effect.orElseSucceed(() => null))

            if (shadowResult) {
              budget.record(
                "shadow_baseline",
                strongest.providerID,
                shadowResult.tokenUsage.input,
                shadowResult.tokenUsage.output,
              )
              shadowDelta = {
                blindSpotDelta: shadowResult.blindSpotDelta,
                coverageDelta: shadowResult.coverageDelta,
              }
            }
          }

          // ── Build report ──────────────────────────────────────────
          const snap = budget.snapshot()
          const durationMs = Date.now() - startTime

          const valueMetrics = Metrics.computeValueMetrics(adjustedClaims, snap.costUsd)

          const rolesMap: Record<string, string> = {}
          for (const p of participants) {
            if (p.role) rolesMap[`${p.providerID}/${p.modelID}`] = p.role
          }

          const report: Collective.DebateReport = {
            id: debateID,
            prompt: config.question,
            timestamp: new Date(startTime).toISOString(),
            tier: config.tier,
            providers: participants.map((p) => `${p.providerID}/${p.modelID}`),
            failedProviders,
            roles: rolesMap,
            cost: snap.costUsd,
            durationMs,
            consensus: adjustedClaims.filter((c) => c.noveltyMarker === "consensus"),
            blindSpots: adjustedClaims.filter((c) => c.noveltyMarker === "unique"),
            unresolvedConflicts,
            traceability,
            meta,
            valueMetrics,
            tokenUsage: {
              total: snap.tokensUsed,
              byPhase: snap.byPhase,
              byProvider: snap.byProvider,
            },
            markdown,
            shadowBaselineDelta: shadowDelta,
          }

          if (abVariant) {
            log.info("A/B result", { debateID, variant: abVariant, blindSpots: report.blindSpots.length })
          }

          yield* store.saveReport(debateID, report)

          yield* bus.publish(Events.DebateCompleted, {
            debateID,
            blindSpotCount: report.blindSpots.length,
            cost: snap.costUsd,
            durationMs,
          })

          log.info("debate complete", {
            id: debateID,
            claims: adjustedClaims.length,
            blindSpots: report.blindSpots.length,
            conflicts: unresolvedConflicts.length,
            durationMs,
            cost: snap.costUsd,
          })

          return report
        } catch (error) {
          const msg = error instanceof Error ? error.message : String(error)
          yield* store.setError(debateID, msg)
          yield* bus.publish(Events.DebateFailed, { debateID, error: msg })
          throw error
        }
      })

      const estimate = Effect.fn("Orchestrator.estimate")(function* (config: Collective.DebateConfig) {
        const { providers: discovered } = yield* ProviderDiscovery.discover(
          config.participants,
          Collective.TIER_CONFIG[config.tier].maxProviders,
        )
        return BudgetTracker.estimate(config, discovered)
      })

      return Service.of({ run, estimate })
    }),
  )

  export const defaultLayer = layer.pipe(
    Layer.provide(DebateStore.layer),
    Layer.provide(Bus.layer),
  )

  const { runPromise } = makeRuntime(Service, defaultLayer)

  export async function runPromiseExport(
    config: Collective.DebateConfig,
    onDebateID?: (id: Collective.DebateID) => void,
  ) {
    return runPromise((svc) => svc.run(config, onDebateID))
  }

  export async function estimatePromise(config: Collective.DebateConfig) {
    return runPromise((svc) => svc.estimate(config))
  }

  // ── Phase 1 participant runner ──────────────────────────────────────

  function runParticipant(
    participant: Collective.Participant,
    question: string,
    context: string | undefined,
    seeds: Collective.Claim[],
    bus: Bus.Interface,
    debateID: Collective.DebateID,
  ): Effect.Effect<Collective.PhaseOneResponse, Error> {
    return Effect.gen(function* () {
      yield* bus.publish(Events.ProviderStarted, {
        debateID,
        provider: `${participant.providerID}/${participant.modelID}`,
        role: participant.role,
        phase: "phase1_diverge",
      })

      const start = Date.now()
      const catalogModel = yield* Effect.promise(() => Provider.getModel(participant.providerID, participant.modelID))
      const model = yield* Effect.promise(() => Provider.getLanguage(catalogModel))

      const systemPrompt = PROMPT_DIVERGE.replace("{{ROLE}}", participant.role ?? "General analyst")
      let userPrompt = context
        ? `## Context\n${context}\n\n## Question\n${question}`
        : question

      if (seeds.length > 0) {
        userPrompt += `\n\n## Hypotheses from past analyses (verify, do not assume true)\n`
        for (const seed of seeds) {
          userPrompt += `- [${seed.category}] ${seed.content}\n`
        }
      }

      const result = yield* Effect.tryPromise({
        try: () =>
          generateText({
            model,
            system: systemPrompt,
            prompt: userPrompt,
            temperature: catalogModel.capabilities.temperature ? 0.7 : undefined,
            maxOutputTokens: 4096,
          }),
        catch: (e) => {
          const body = (e as any)?.responseBody
          const err = new Error(`Model ${participant.anonymousHash} failed: ${e}${body ? ` — ${body}` : ""}`)
          Effect.runFork(
            bus.publish(Events.ProviderFailed, {
              debateID,
              provider: `${participant.providerID}/${participant.modelID}`,
              error: body ? `${e} — ${body}` : String(e),
              phase: "phase1_diverge",
            }),
          )
          return err
        },
      })

      const outOfRoleInsights: string[] = []
      for (const line of result.text.split("\n")) {
        if (line.includes("[OUT_OF_ROLE]")) {
          outOfRoleInsights.push(line.replace("[OUT_OF_ROLE]", "").trim())
        }
      }

      const durationMs = Date.now() - start
      const tokenUsage = {
        input: result.usage?.inputTokens ?? 0,
        output: result.usage?.outputTokens ?? 0,
      }

      yield* bus.publish(Events.ProviderCompleted, {
        debateID,
        provider: `${participant.providerID}/${participant.modelID}`,
        tokens: tokenUsage.input + tokenUsage.output,
        durationMs,
        phase: "phase1_diverge",
      })

      return {
        participantHash: participant.anonymousHash,
        providerID: participant.providerID,
        modelID: participant.modelID,
        role: participant.role,
        content: result.text,
        outOfRoleInsights,
        tokenUsage,
        durationMs,
      }
    })
  }

  // ── Phase 3 convergence runner ──────────────────────────────────────

  const ConvergenceCritiqueSchema = z.object({
    critiques: z.array(
      z.object({
        claimId: z.string(),
        verdict: z.enum(["agree", "disagree", "nuance"]),
        argument: z.string(),
      }),
    ),
  })

  function runConvergence(
    participant: Collective.Participant,
    targetClaims: Collective.Claim[],
    question: string,
    bus: Bus.Interface,
    debateID: Collective.DebateID,
  ): Effect.Effect<Collective.ConvergenceResponse, Error> {
    return Effect.gen(function* () {
      const provider = `${participant.providerID}/${participant.modelID}`
      yield* bus.publish(Events.ProviderStarted, {
        debateID,
        provider,
        role: participant.role,
        phase: "phase3_converge",
      })
      const start = Date.now()
      const catalogModel = yield* Effect.promise(() => Provider.getModel(participant.providerID, participant.modelID))
      const model = yield* Effect.promise(() => Provider.getLanguage(catalogModel))

      const claimsText = targetClaims
        .map((c) => `[${c.claimId}] [${c.category}] ${c.content}`)
        .join("\n")

      const result = yield* Effect.tryPromise({
        try: () =>
          generateObject({
            model,
            schema: ConvergenceCritiqueSchema,
            system: PROMPT_CONVERGENCE,
            prompt: `## Question\n${question}\n\n## Claims to review\n${claimsText}`,
            temperature: catalogModel.capabilities.temperature ? 0.5 : undefined,
          }),
        catch: (e) => {
          const err = new Error(`Convergence failed for ${participant.anonymousHash}: ${e}`)
          Effect.runFork(
            bus.publish(Events.ProviderFailed, {
              debateID,
              provider,
              error: String(e),
              phase: "phase3_converge",
            }),
          )
          return err
        },
      })

      const tokenUsage = {
        input: result.usage?.inputTokens ?? 0,
        output: result.usage?.outputTokens ?? 0,
      }

      yield* bus.publish(Events.ProviderCompleted, {
        debateID,
        provider,
        tokens: tokenUsage.input + tokenUsage.output,
        durationMs: Date.now() - start,
        phase: "phase3_converge",
      })

      return {
        participantHash: participant.anonymousHash,
        critiques: result.object.critiques,
        tokenUsage,
      }
    })
  }

  // ── Canary detection ────────────────────────────────────────────────

  // ── Cost update helper ──────────────────────────────────────────────

  function emitCostUpdate(
    bus: Bus.Interface,
    debateID: Collective.DebateID,
    budget: BudgetTracker.Tracker,
    budgetCfg: Collective.BudgetConfig,
  ) {
    const snap = budget.snapshot()
    return bus.publish(Events.CostUpdate, {
      debateID,
      spent: snap.costUsd,
      budget: budgetCfg.maxCostUsd,
      percent: snap.percentUsed,
    })
  }
}
