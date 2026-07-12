import z from "zod"
import { Tool } from "./tool"
import DESCRIPTION from "./debate.txt"
import { DebateSelection, Orchestrator } from "../collective"
import type { Collective } from "../collective/types"

export const DebateTool = Tool.define("debate", async () => {
  return {
    description: DESCRIPTION,
    parameters: z.object({
      question: z.string().describe("The question or topic for the multi-model debate"),
      context: z
        .string()
        .optional()
        .describe("Additional context (code snippets, requirements, constraints) to include in the debate"),
      tier: z
        .enum(["free", "quick", "standard", "deep"])
        .optional()
        .describe(
          "Debate depth tier. 'free'=free models only, 'quick'=2-3 models no convergence, 'standard'=full pipeline with convergence, 'deep'=all features including red team and canary. Default: auto-classified based on question complexity.",
        ),
    }),
    async execute(args, ctx) {
      const selection = await DebateSelection.get(ctx.sessionID)
      const config: Collective.DebateConfig = {
        question: args.question,
        context: args.context,
        tier: args.tier ?? "quick",
        participants: selection?.participants,
        judgeProviderID: selection?.primary.providerID,
        judgeModelID: selection?.primary.modelID,
        redTeam: "auto",
        enableMeta: true,
        enableCanary: args.tier === "deep",
        enableShadowBaseline: true,
        noMemory: false,
        maxRounds: 2,
      }

      const report = await Orchestrator.runPromiseExport(config)

      const summary = [
        `## Debate Complete`,
        ``,
        `**${report.providers.length} models** participated | **${report.blindSpots.length} blind spots** found | **${report.consensus.length} consensus** claims`,
        `**Cost**: $${report.cost.toFixed(4)} | **Duration**: ${(report.durationMs / 1000).toFixed(1)}s`,
        report.meta?.fragility !== undefined && report.meta.fragility > 0.6
          ? `\n> ⚠️ **CONSENSUS FRAGILE** (fragility: ${(report.meta.fragility * 100).toFixed(0)}%)`
          : "",
        report.shadowBaselineDelta
          ? `\n> ${report.shadowBaselineDelta.blindSpotDelta > 0 ? `+${report.shadowBaselineDelta.blindSpotDelta} blind spots vs single-model` : "No additional blind spots vs single-model"}`
          : "",
        ``,
        report.markdown,
      ]
        .filter(Boolean)
        .join("\n")

      return {
        title: `Debate: ${report.blindSpots.length} blind spots, ${report.consensus.length} consensus (${report.providers.length} models)`,
        metadata: {
          debateID: report.id,
          tier: report.tier,
          providerCount: report.providers.length,
          blindSpotCount: report.blindSpots.length,
          consensusCount: report.consensus.length,
          cost: report.cost,
          durationMs: report.durationMs,
        },
        output: summary,
      }
    },
  }
})
