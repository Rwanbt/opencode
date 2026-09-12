import { describe, expect, test } from "bun:test";
import { IndependentReviewRuntime, type ReviewModel, type ReviewRequest, type ReviewModelSelector } from "../../src/team/review-runtime";

const request: ReviewRequest = {
  cardId: "TEAM-I01",
  implementationCommit: "abc123",
  implementerModelId: "model-impl",
  risk: "critical",
  diff: "diff --git a/file b/file",
  tests: ["bun test test/team/review-runtime.test.ts"],
  handoff: "all evidence attached",
};

function selector(model: ReviewModel | null): ReviewModelSelector {
  return { selectIndependent: async () => model };
}

function model(modelId: string, verdict: "APPROVED" | "CHANGES_REQUESTED" = "APPROVED"): ReviewModel {
  return { modelId, review: async () => ({ verdict, findings: [], evidence: ["diff inspected", "tests reproduced"] }) };
}

describe("IndependentReviewRuntime", () => {
  test("selects a model different from the implementer and returns evidence", async () => {
    const result = await new IndependentReviewRuntime().run(request, selector(model("model-review")));
    expect(result.verdict).toBe("APPROVED");
    expect(result.reviewerModelId).toBe("model-review");
    expect(result.evidence).toHaveLength(2);
  });

  test("fails closed when no independent model is available", async () => {
    const result = await new IndependentReviewRuntime().run(request, selector(null));
    expect(result.verdict).toBe("BLOCKED");
    expect(result.findings[0]?.severity).toBe("P1");
  });

  test("fails closed when selector returns the implementer", async () => {
    const result = await new IndependentReviewRuntime().run(request, selector(model("model-impl")));
    expect(result.verdict).toBe("BLOCKED");
  });

  test("requires evidence before approving critical work", async () => {
    const emptyEvidence: ReviewModel = { modelId: "model-review", review: async () => ({ verdict: "APPROVED", findings: [], evidence: [] }) };
    const result = await new IndependentReviewRuntime().run(request, selector(emptyEvidence));
    expect(result.verdict).toBe("BLOCKED");
  });

  test("preserves structured findings for requested changes", async () => {
    const finding: ReviewModel = { modelId: "model-review", review: async () => ({ verdict: "CHANGES_REQUESTED", findings: [{ severity: "P1", title: "Missing case", evidence: "case not covered", remediation: "add a negative test" }], evidence: ["golden case failed"] }) };
    const result = await new IndependentReviewRuntime().run(request, selector(finding));
    expect(result.verdict).toBe("CHANGES_REQUESTED");
    expect(result.findings[0]?.remediation).toBe("add a negative test");
  });

  test("blocks an approval that contains a critical finding", async () => {
    const unsafe: ReviewModel = { modelId: "model-review", review: async () => ({ verdict: "APPROVED", findings: [{ severity: "P1", title: "unsafe", evidence: "critical path", remediation: "fix it" }], evidence: ["diff inspected"] }) };
    const result = await new IndependentReviewRuntime().run(request, selector(unsafe));
    expect(result.verdict).toBe("BLOCKED");
  });

  test("blocks a verdict returned after cancellation", async () => {
    const controller = new AbortController();
    const late: ReviewModel = { modelId: "model-review", review: async () => { controller.abort(); return { verdict: "APPROVED", findings: [], evidence: ["late"] }; } };
    const result = await new IndependentReviewRuntime().run(request, selector(late), controller.signal);
    expect(result.verdict).toBe("BLOCKED");
  });});
