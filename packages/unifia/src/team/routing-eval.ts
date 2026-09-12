export const ROUTING_EVALUATION_VERSION = "1.0.0" as const;
export const ROUTING_POLICIES = ["economy", "balanced", "quality"] as const;

export type RoutingPolicy = (typeof ROUTING_POLICIES)[number];

export interface RoutingEvaluationRecord {
	readonly decisionId: string;
	readonly policy: RoutingPolicy;
	readonly endpointKey: string | null;
	readonly providerID: string | null;
	readonly costUsd: number;
	readonly qualityProbability: number;
	readonly confidence: number;
	readonly blocked: boolean;
}

export interface BenchmarkCase {
	readonly caseId: string;
	readonly records: readonly RoutingEvaluationRecord[];
}

export interface PolicyBenchmarkSummary {
	readonly policy: RoutingPolicy;
	readonly decisionCount: number;
	readonly blockedCount: number;
	readonly averageCostUsd: number;
	readonly averageQualityProbability: number;
	readonly averageConfidence: number;
}

export interface CounterfactualComparison {
	readonly baselineDecisionId: string;
	readonly alternativeDecisionId: string;
	readonly costDeltaUsd: number;
	readonly qualityDelta: number;
	readonly confidenceDelta: number;
	readonly qualityGainPerAdditionalDollar: number | null;
	readonly alternativeImprovesQuality: boolean;
}

export interface ConcentrationMetrics {
	readonly decisionCount: number;
	readonly providerShares: Readonly<Record<string, number>>;
	readonly endpointShares: Readonly<Record<string, number>>;
	readonly providerHerfindahlIndex: number;
	readonly endpointHerfindahlIndex: number;
	readonly topProvider: string | null;
	readonly topProviderShare: number;
}

export interface RoutingEvaluationReport {
	readonly evaluationVersion: typeof ROUTING_EVALUATION_VERSION;
	readonly benchmarkMatrix: readonly PolicyBenchmarkSummary[];
	readonly counterfactuals: readonly CounterfactualComparison[];
	readonly concentration: ConcentrationMetrics;
	readonly explanations: Readonly<Record<string, readonly string[]>>;
}

export interface RoutingEvaluationInput {
	readonly benchmarkCases: readonly BenchmarkCase[];
	readonly counterfactuals?: readonly {
		readonly baseline: RoutingEvaluationRecord;
		readonly alternative: RoutingEvaluationRecord;
	}[];
}

function requireProbability(value: number, field: string): void {
	if (!Number.isFinite(value) || value < 0 || value > 1)
		throw new Error(`invalid ${field}`);
}

function validateRecord(record: RoutingEvaluationRecord): void {
	if (!record.decisionId || !ROUTING_POLICIES.includes(record.policy))
		throw new Error("invalid routing record identity");
	if (record.endpointKey === "" || record.providerID === "")
		throw new Error("invalid routing endpoint identity");
	if (!Number.isFinite(record.costUsd) || record.costUsd < 0)
		throw new Error("invalid costUsd");
	requireProbability(record.qualityProbability, "qualityProbability");
	requireProbability(record.confidence, "confidence");
}

function average(values: readonly number[]): number {
	return values.length === 0
		? 0
		: values.reduce((total, value) => total + value, 0) / values.length;
}

function recordsFromCases(
	cases: readonly BenchmarkCase[],
): RoutingEvaluationRecord[] {
	const records: RoutingEvaluationRecord[] = [];
	for (const benchmarkCase of cases) {
		if (!benchmarkCase.caseId)
			throw new Error("invalid benchmark case identity");
		for (const record of benchmarkCase.records) {
			validateRecord(record);
			records.push(record);
		}
	}
	return records;
}

export function buildBenchmarkMatrix(
	cases: readonly BenchmarkCase[],
): readonly PolicyBenchmarkSummary[] {
	const records = recordsFromCases(cases);
	return ROUTING_POLICIES.map((policy) => {
		const selected = records.filter((record) => record.policy === policy);
		return {
			policy,
			decisionCount: selected.length,
			blockedCount: selected.filter((record) => record.blocked).length,
			averageCostUsd: average(selected.map((record) => record.costUsd)),
			averageQualityProbability: average(
				selected.map((record) => record.qualityProbability),
			),
			averageConfidence: average(selected.map((record) => record.confidence)),
		};
	});
}

export function compareRoutingCounterfactuals(
	pairs: readonly {
		baseline: RoutingEvaluationRecord;
		alternative: RoutingEvaluationRecord;
	}[],
): readonly CounterfactualComparison[] {
	return pairs.map(({ baseline, alternative }) => {
		validateRecord(baseline);
		validateRecord(alternative);
		const costDeltaUsd = alternative.costUsd - baseline.costUsd;
		const qualityDelta =
			alternative.qualityProbability - baseline.qualityProbability;
		return {
			baselineDecisionId: baseline.decisionId,
			alternativeDecisionId: alternative.decisionId,
			costDeltaUsd,
			qualityDelta,
			confidenceDelta: alternative.confidence - baseline.confidence,
			qualityGainPerAdditionalDollar:
				costDeltaUsd > 0 ? qualityDelta / costDeltaUsd : null,
			alternativeImprovesQuality: qualityDelta > 0,
		};
	});
}

function shares(values: readonly string[]): Readonly<Record<string, number>> {
	const counts = new Map<string, number>();
	for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
	const total = values.length;
	return Object.fromEntries(
		[...counts.entries()]
			.sort(([left], [right]) => left.localeCompare(right))
			.map(([key, count]) => [key, count / total]),
	);
}

function herfindahl(values: Readonly<Record<string, number>>): number {
	return Object.values(values).reduce(
		(total, share) => total + share * share,
		0,
	);
}

export function measureRoutingConcentration(
	records: readonly RoutingEvaluationRecord[],
): ConcentrationMetrics {
	for (const record of records) validateRecord(record);
	const providerValues = records.flatMap((record) =>
		record.providerID ? [record.providerID] : [],
	);
	const endpointValues = records.flatMap((record) =>
		record.endpointKey ? [record.endpointKey] : [],
	);
	const providerShares = shares(providerValues);
	const endpointShares = shares(endpointValues);
	const topProviderEntry = Object.entries(providerShares).sort(
		([, left], [, right]) => right - left,
	)[0];
	return {
		decisionCount: records.length,
		providerShares,
		endpointShares,
		providerHerfindahlIndex: herfindahl(providerShares),
		endpointHerfindahlIndex: herfindahl(endpointShares),
		topProvider: topProviderEntry?.[0] ?? null,
		topProviderShare: topProviderEntry?.[1] ?? 0,
	};
}

export function explainRoutingDecision(
	record: RoutingEvaluationRecord,
): readonly string[] {
	validateRecord(record);
	const explanation = [
		`policy=${record.policy}`,
		`confidence=${record.confidence}`,
		`quality=${record.qualityProbability}`,
		`costUsd=${record.costUsd}`,
	];
	explanation.push(
		record.blocked
			? "decision=blocked"
			: `selected=${record.endpointKey ?? "none"}`,
	);
	if (record.providerID) explanation.push(`provider=${record.providerID}`);
	return explanation;
}

export function buildRoutingEvaluationReport(
	input: RoutingEvaluationInput,
): RoutingEvaluationReport {
	const records = recordsFromCases(input.benchmarkCases);
	const pairs = input.counterfactuals ?? [];
	const explanations = Object.fromEntries(
		records.map((record) => [
			record.decisionId,
			explainRoutingDecision(record),
		]),
	);
	return {
		evaluationVersion: ROUTING_EVALUATION_VERSION,
		benchmarkMatrix: buildBenchmarkMatrix(input.benchmarkCases),
		counterfactuals: compareRoutingCounterfactuals(pairs),
		concentration: measureRoutingConcentration(records),
		explanations,
	};
}

export function exportRoutingEvaluation(
	report: RoutingEvaluationReport,
): string {
	return JSON.stringify(report);
}
