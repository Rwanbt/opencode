import type { FinalValidationResult, RollbackStatus } from "./final-validator";

// =============================================================================
// report-builder.ts — TEAM-I05
//
// Renders a run's outcome as a report a reader can check rather than has to
// trust.
//
// The builder cannot upgrade a verdict. It takes the FinalValidator's result
// as given and renders it — including, prominently, everything that did not
// happen. A report generator that can present an incomplete run as a
// successful one is worse than no report, because it launders an unverified
// claim into a document that looks authoritative.
//
// So: the not-run inventory is always rendered when non-empty, proof links
// are always shown next to the claims they support, and the rollback status
// always appears — including "UNTESTED", which is the one a reader most
// needs and a summariser is most tempted to omit.
//
// Pure: no LLM, network, clock or filesystem access. The caller stamps the
// report when persisting it, so the same run always renders identically.
// =============================================================================

export const REPORT_BUILDER_SCHEMA_VERSION = "1.0.0" as const;

export interface CostSummary {
  readonly totalCostUsd: number;
  readonly inputTokens: number;
  readonly outputTokens: number;
}

export interface FallbackRecord {
  readonly from: string;
  readonly to: string;
  readonly reason: string;
}

export interface OpenRisk {
  readonly id: string;
  readonly description: string;
  readonly severity: "low" | "medium" | "high" | "critical";
}

export interface ReportInput {
  readonly validation: FinalValidationResult;
  readonly objective: string;
  readonly cost: CostSummary;
  readonly fallbacks: readonly FallbackRecord[];
  readonly openRisks: readonly OpenRisk[];
  /** Proof references for the run as a whole, e.g. the test command output. */
  readonly proofRefs: readonly string[];
}

export interface RunReport {
  readonly schemaVersion: typeof REPORT_BUILDER_SCHEMA_VERSION;
  readonly runId: string;
  readonly verdict: FinalValidationResult["verdict"];
  /** One-line summary that never overstates the verdict. */
  readonly headline: string;
  readonly markdown: string;
  readonly rollbackStatus: RollbackStatus;
  readonly notRunTaskIds: readonly string[];
  readonly openRiskCount: number;
}

/**
 * Headlines are fixed per verdict rather than composed, so no wording path
 * can produce a success-sounding line for a run that did not succeed.
 */
const HEADLINES: Readonly<Record<FinalValidationResult["verdict"], string>> = Object.freeze({
  COMPLETE: "Objective achieved: every required task passed with proof.",
  INCOMPLETE: "Objective NOT achieved: required work is missing or unproven.",
  FAILED: "Objective NOT achieved: required work failed.",
});

function bullet(lines: readonly string[]): string {
  return lines.length === 0 ? "_none_" : lines.map((line) => `- ${line}`).join("\n");
}

export class ReportBuilder {
  build(input: ReportInput): RunReport {
    const { validation } = input;

    const sections: string[] = [
      `# Run report — ${validation.runId}`,
      "",
      `**${HEADLINES[validation.verdict]}**`,
      "",
      `- Verdict: \`${validation.verdict}\``,
      `- Objective: ${input.objective}`,
      `- Required tasks passed: ${validation.passedRequiredTaskCount}/${validation.requiredTaskCount}`,
      `- Rollback: \`${validation.rollbackStatus}\``,
      "",
    ];

    // Rendered before anything positive: a reader must meet what is missing
    // before meeting what went well.
    if (validation.blockingReasons.length > 0) {
      sections.push(
        "## Why this run is not complete",
        "",
        bullet(
          validation.blockingReasons.map((reason) => `\`${reason.kind}\` **${reason.subjectId}** — ${reason.detail}`),
        ),
        "",
      );
    }

    if (validation.notRunTaskIds.length > 0) {
      sections.push(
        "## Required tasks that did not demonstrably run",
        "",
        bullet(validation.notRunTaskIds.map((id) => `\`${id}\``)),
        "",
      );
    }

    if (validation.unprovenTaskIds.length > 0) {
      sections.push(
        "## Tasks claimed passed without proof",
        "",
        "These were reported as passing but carried no proof reference, so they are counted as not run.",
        "",
        bullet(validation.unprovenTaskIds.map((id) => `\`${id}\``)),
        "",
      );
    }

    sections.push(
      "## Proof",
      "",
      bullet(input.proofRefs),
      "",
      "## Cost",
      "",
      `- Total: ${input.cost.totalCostUsd.toFixed(4)} USD`,
      `- Tokens: ${input.cost.inputTokens} in / ${input.cost.outputTokens} out`,
      "",
      "## Fallbacks",
      "",
      bullet(input.fallbacks.map((item) => `${item.from} → ${item.to}: ${item.reason}`)),
      "",
      "## Open risks",
      "",
      bullet(input.openRisks.map((risk) => `\`${risk.severity}\` **${risk.id}** — ${risk.description}`)),
      "",
    );

    if (validation.rollbackStatus === "UNTESTED") {
      sections.push(
        "> Rollback has not been exercised. Its status is unverified, not proven working.",
        "",
      );
    }

    return {
      schemaVersion: REPORT_BUILDER_SCHEMA_VERSION,
      runId: validation.runId,
      verdict: validation.verdict,
      headline: HEADLINES[validation.verdict],
      markdown: sections.join("\n"),
      rollbackStatus: validation.rollbackStatus,
      notRunTaskIds: validation.notRunTaskIds,
      openRiskCount: input.openRisks.length,
    };
  }
}
