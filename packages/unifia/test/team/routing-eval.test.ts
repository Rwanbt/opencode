import { describe, expect, it } from "bun:test";
import {
	type BenchmarkCase,
	buildBenchmarkMatrix,
	buildRoutingEvaluationReport,
	compareRoutingCounterfactuals,
	explainRoutingDecision,
	exportRoutingEvaluation,
	measureRoutingConcentration,
	type RoutingEvaluationRecord,
} from "../../src/team/routing-eval";

function record(
	overrides: Partial<RoutingEvaluationRecord> = {},
): RoutingEvaluationRecord {
	return {
		decisionId: "decision-1",
		policy: "balanced",
		endpointKey: "anthropic::sonnet",
		providerID: "anthropic",
		costUsd: 1,
		qualityProbability: 0.85,
		confidence: 0.9,
		blocked: false,
		...overrides,
	};
}

function benchmarkCases(): BenchmarkCase[] {
	return [
		{
			caseId: "case-1",
			records: [
				record({
					decisionId: "economy-1",
					policy: "economy",
					endpointKey: "openai::mini",
					providerID: "openai",
					costUsd: 0.2,
					qualityProbability: 0.7,
				}),
				record({ decisionId: "balanced-1" }),
				record({
					decisionId: "quality-1",
					policy: "quality",
					endpointKey: "anthropic::opus",
					costUsd: 2,
					qualityProbability: 0.95,
				}),
			],
		},
	];
}

describe("routing evaluation — explicit and exportable", () => {
	it("builds Economy, Balanced, and Quality baselines without hidden scores", () => {
		const matrix = buildBenchmarkMatrix(benchmarkCases());
		expect(matrix.map((row) => row.policy)).toEqual([
			"economy",
			"balanced",
			"quality",
		]);
		expect(matrix[0]?.averageCostUsd).toBe(0.2);
		expect(matrix[2]?.averageQualityProbability).toBe(0.95);
	});

	it("reports blocked decisions and preserves zero-sized policy rows", () => {
		const matrix = buildBenchmarkMatrix([
			{
				caseId: "case-2",
				records: [
					record({ blocked: true, endpointKey: null, providerID: null }),
				],
			},
		]);
		expect(matrix.find((row) => row.policy === "balanced")?.blockedCount).toBe(
			1,
		);
		expect(matrix.find((row) => row.policy === "economy")?.decisionCount).toBe(
			0,
		);
	});

	it("computes counterfactual cost, quality, and confidence deltas", () => {
		const result = compareRoutingCounterfactuals([
			{
				baseline: record({
					decisionId: "base",
					costUsd: 1,
					qualityProbability: 0.8,
				}),
				alternative: record({
					decisionId: "alt",
					costUsd: 2,
					qualityProbability: 0.9,
					confidence: 0.95,
				}),
			},
		]);
		expect(result[0]?.baselineDecisionId).toBe("base");
		expect(result[0]?.alternativeDecisionId).toBe("alt");
		expect(result[0]?.costDeltaUsd).toBe(1);
		expect(result[0]?.qualityDelta).toBeCloseTo(0.1);
		expect(result[0]?.confidenceDelta).toBeCloseTo(0.05);
		expect(result[0]?.qualityGainPerAdditionalDollar).toBeCloseTo(0.1);
		expect(result[0]?.alternativeImprovesQuality).toBe(true);
	});

	it("measures provider and endpoint concentration deterministically", () => {
		const metrics = measureRoutingConcentration([
			record({
				decisionId: "a",
				providerID: "openai",
				endpointKey: "openai::mini",
			}),
			record({
				decisionId: "b",
				providerID: "openai",
				endpointKey: "openai::mini",
			}),
			record({
				decisionId: "c",
				providerID: "anthropic",
				endpointKey: "anthropic::sonnet",
			}),
		]);
		expect(metrics.topProvider).toBe("openai");
		expect(metrics.topProviderShare).toBeCloseTo(2 / 3);
		expect(metrics.providerHerfindahlIndex).toBeCloseTo(5 / 9);
	});

	it("explains every decision with explicit policy and observable metrics", () => {
		const explanation = explainRoutingDecision(
			record({ blocked: true, endpointKey: null, providerID: null }),
		);
		expect(explanation).toContain("policy=balanced");
		expect(explanation).toContain("decision=blocked");
		expect(explanation.some((item) => item.includes("quality="))).toBe(true);
	});

	it("builds a stable JSON-exportable report", () => {
		const report = buildRoutingEvaluationReport({
			benchmarkCases: benchmarkCases(),
			counterfactuals: [],
		});
		const exported = exportRoutingEvaluation(report);
		expect(JSON.parse(exported)).toEqual(report);
		expect(report.evaluationVersion).toBe("1.0.0");
	});

	it("rejects invalid boundary metrics", () => {
		expect(() =>
			buildBenchmarkMatrix([
				{ caseId: "bad", records: [record({ confidence: 2 })] },
			]),
		).toThrow("confidence");
	});
});
