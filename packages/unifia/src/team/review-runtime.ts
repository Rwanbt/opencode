export const REVIEW_RUNTIME_SCHEMA_VERSION = "1.0.0" as const;

export type ReviewRisk = "low" | "medium" | "high" | "critical";
export type ReviewVerdict = "APPROVED" | "CHANGES_REQUESTED" | "BLOCKED";

export interface ReviewRequest {
  readonly cardId: string;
  readonly implementationCommit: string;
  readonly implementerModelId: string;
  readonly risk: ReviewRisk;
  readonly diff: string;
  readonly tests: readonly string[];
  readonly handoff: string;
}

export interface ReviewModel {
  readonly modelId: string;
  review(input: {
    readonly prompt: string;
    readonly request: ReviewRequest;
    readonly signal: AbortSignal;
  }): Promise<ReviewModelResult>;
}

export interface ReviewModelResult {
  readonly verdict: ReviewVerdict;
  readonly findings: readonly ReviewFinding[];
  readonly evidence: readonly string[];
}

export interface ReviewFinding {
  readonly severity: "P0" | "P1" | "P2" | "P3";
  readonly title: string;
  readonly evidence: string;
  readonly remediation: string;
}

export interface ReviewModelSelector {
  selectIndependent(input: { readonly excludedModelId: string; readonly risk: ReviewRisk }): Promise<ReviewModel | null>;
}

export interface ReviewResult {
  readonly schemaVersion: typeof REVIEW_RUNTIME_SCHEMA_VERSION;
  readonly cardId: string;
  readonly reviewerModelId: string;
  readonly verdict: ReviewVerdict;
  readonly findings: readonly ReviewFinding[];
  readonly evidence: readonly string[];
}

const REVIEW_PROMPT = "You are an independent semantic reviewer. You have read-only evidence and must return a structured verdict.";

export class IndependentReviewRuntime {
  async run(request: ReviewRequest, selector: ReviewModelSelector, signal = new AbortController().signal): Promise<ReviewResult> {
    validateRequest(request);
    if (signal.aborted) throw new Error("review aborted before model selection");
    const model = await selector.selectIndependent({ excludedModelId: request.implementerModelId, risk: request.risk });
    if (!model || model.modelId === request.implementerModelId) {
      return blocked(request, "no independent reviewer model available");
    }
    const result = await model.review({ prompt: REVIEW_PROMPT, request, signal });
    validateModelResult(result);
    if (signal.aborted) return blocked(request, "review aborted before verdict");
    if ((request.risk === "high" || request.risk === "critical") && result.verdict === "APPROVED" && (result.evidence.length === 0 || result.findings.some((finding) => finding.severity === "P0" || finding.severity === "P1"))) {
      return blocked(request, "high/critical review has no evidence");
    }
    return {
      schemaVersion: REVIEW_RUNTIME_SCHEMA_VERSION,
      cardId: request.cardId,
      reviewerModelId: model.modelId,
      verdict: result.verdict,
      findings: result.findings,
      evidence: result.evidence,
    };
  }
}

function blocked(request: ReviewRequest, reason: string): ReviewResult {
  return {
    schemaVersion: REVIEW_RUNTIME_SCHEMA_VERSION,
    cardId: request.cardId,
    reviewerModelId: "UNAVAILABLE",
    verdict: "BLOCKED",
    findings: [{ severity: "P1", title: "Independent review unavailable", evidence: reason, remediation: "Select a model different from the implementer and rerun the review." }],
    evidence: [],
  };
}

function validateRequest(request: ReviewRequest): void {
  for (const [name, value] of [["cardId", request.cardId], ["implementationCommit", request.implementationCommit], ["implementerModelId", request.implementerModelId]] as const) {
    if (!value.trim()) throw new TypeError(`${name} must not be empty`);
  }
  if (!request.diff.trim() || !request.handoff.trim()) throw new TypeError("diff and handoff are required review evidence");
  if (request.tests.length === 0) throw new TypeError("at least one test command is required");
}

function validateModelResult(result: ReviewModelResult): void {
  if (!["APPROVED", "CHANGES_REQUESTED", "BLOCKED"].includes(result.verdict)) throw new TypeError("invalid review verdict");
  for (const finding of result.findings) {
    if (!finding.title.trim() || !finding.evidence.trim() || !finding.remediation.trim()) throw new TypeError("review findings require title, evidence and remediation");
  }
}
