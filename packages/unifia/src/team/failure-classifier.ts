// =============================================================================
// failure-classifier.ts — TEAM-J01
//
// Turns a raw failure into a decision: retry, fall back, or stop.
//
// The classification exists to answer one question — may this be retried? —
// and the expensive way to get it wrong is to retry something permanent. A
// bad API key does not become valid on the third attempt; retrying it burns
// budget, delays the real report, and can trip rate limits that then look
// like a different failure.
//
// Two rules follow, and they pull in opposite directions on purpose:
//
//   Permanent is never retried. Auth, quota exhaustion, invalid request,
//   policy refusal and unsupported capability are terminal for this
//   configuration. Retrying them is not caution, it is waste.
//
//   Unknown blocks rather than retries. An unrecognised failure could be
//   either kind, and guessing "transient" is the dangerous guess: it retries
//   something permanent silently. Guessing "permanent" merely stops and asks.
//   So an unclassified failure is escalated, never retried — which also
//   makes gaps in the matrix visible instead of absorbing them.
//
// Matching is on structured signals (provider error codes, HTTP status)
// before free text, because message wording changes between provider
// versions while codes are part of the contract.
//
// Pure: no LLM, network, clock or filesystem access.
// =============================================================================

export const FAILURE_CLASSIFIER_SCHEMA_VERSION = "1.0.0" as const;

export class FailureClassifierInputError extends TypeError {
  constructor(message: string) {
    super(message);
    this.name = "FailureClassifierInputError";
  }
}

// -----------------------------------------------------------------------
// Taxonomy
// -----------------------------------------------------------------------

export const FAILURE_CATEGORIES = [
  "AUTH",
  "QUOTA_EXCEEDED",
  "RATE_LIMITED",
  "TIMEOUT",
  "NETWORK",
  "PROVIDER_UNAVAILABLE",
  "INVALID_REQUEST",
  "CONTEXT_TOO_LARGE",
  "CONTENT_POLICY",
  "UNSUPPORTED_CAPABILITY",
  "WORKER_CRASH",
  "SCOPE_VIOLATION",
  "LEASE_CONFLICT",
  "UNKNOWN",
] as const;
export type FailureCategory = (typeof FAILURE_CATEGORIES)[number];

/**
 * How a category may be recovered from.
 *
 *   TRANSIENT  the same call can succeed unchanged; retry with backoff.
 *   FALLBACK   this endpoint will keep failing, another may not; switch.
 *   PERMANENT  no retry and no fallback will help under this configuration.
 *   ESCALATE   not understood well enough to act on; a human decides.
 */
export type Recoverability = "TRANSIENT" | "FALLBACK" | "PERMANENT" | "ESCALATE";

const RECOVERABILITY: Readonly<Record<FailureCategory, Recoverability>> = Object.freeze({
  // Retrying these can genuinely succeed.
  RATE_LIMITED: "TRANSIENT",
  TIMEOUT: "TRANSIENT",
  NETWORK: "TRANSIENT",
  // This endpoint is out, another may serve.
  PROVIDER_UNAVAILABLE: "FALLBACK",
  WORKER_CRASH: "FALLBACK",
  // No number of attempts changes the answer.
  AUTH: "PERMANENT",
  QUOTA_EXCEEDED: "PERMANENT",
  INVALID_REQUEST: "PERMANENT",
  CONTEXT_TOO_LARGE: "PERMANENT",
  CONTENT_POLICY: "PERMANENT",
  UNSUPPORTED_CAPABILITY: "PERMANENT",
  SCOPE_VIOLATION: "PERMANENT",
  LEASE_CONFLICT: "PERMANENT",
  // Not understood: stopping is the safe guess, retrying is not.
  UNKNOWN: "ESCALATE",
});

export function recoverabilityOf(category: FailureCategory): Recoverability {
  return RECOVERABILITY[category];
}

export function isRetryable(category: FailureCategory): boolean {
  return RECOVERABILITY[category] === "TRANSIENT";
}

// -----------------------------------------------------------------------
// Input
// -----------------------------------------------------------------------

export interface FailureSignal {
  /** Provider-specific error code, e.g. "insufficient_quota". */
  readonly providerCode?: string | null;
  readonly httpStatus?: number | null;
  readonly message: string;
  /** Where the failure came from — shapes worker-side categories. */
  readonly origin: "provider" | "worker" | "policy";
}

export interface FailureClassification {
  readonly schemaVersion: typeof FAILURE_CLASSIFIER_SCHEMA_VERSION;
  readonly category: FailureCategory;
  readonly recoverability: Recoverability;
  readonly retryable: boolean;
  /** Which signal decided it — code, status or text. Makes the matrix auditable. */
  readonly matchedOn: "providerCode" | "httpStatus" | "message" | "origin" | "none";
  readonly rationale: string;
}

// -----------------------------------------------------------------------
// Matching tables
// -----------------------------------------------------------------------

/** Provider error codes are part of the contract; wording is not. */
const CODE_TABLE: ReadonlyMap<string, FailureCategory> = new Map([
  ["invalid_api_key", "AUTH"],
  ["authentication_error", "AUTH"],
  ["permission_denied", "AUTH"],
  ["insufficient_quota", "QUOTA_EXCEEDED"],
  ["billing_hard_limit_reached", "QUOTA_EXCEEDED"],
  ["rate_limit_exceeded", "RATE_LIMITED"],
  ["overloaded_error", "PROVIDER_UNAVAILABLE"],
  ["service_unavailable", "PROVIDER_UNAVAILABLE"],
  ["context_length_exceeded", "CONTEXT_TOO_LARGE"],
  ["content_policy_violation", "CONTENT_POLICY"],
  ["invalid_request_error", "INVALID_REQUEST"],
  ["model_not_found", "UNSUPPORTED_CAPABILITY"],
  ["timeout", "TIMEOUT"],
]);

const STATUS_TABLE: ReadonlyMap<number, FailureCategory> = new Map([
  [400, "INVALID_REQUEST"],
  [401, "AUTH"],
  [403, "AUTH"],
  [404, "UNSUPPORTED_CAPABILITY"],
  [408, "TIMEOUT"],
  [413, "CONTEXT_TOO_LARGE"],
  [422, "INVALID_REQUEST"],
  [429, "RATE_LIMITED"],
  [500, "PROVIDER_UNAVAILABLE"],
  [502, "PROVIDER_UNAVAILABLE"],
  [503, "PROVIDER_UNAVAILABLE"],
  [504, "TIMEOUT"],
]);

/**
 * Text matching is the last resort, and deliberately narrow: broad patterns
 * over free text are how an unrelated failure gets confidently mislabelled.
 * A phrase only appears here when no code or status conveys it.
 */
const MESSAGE_TABLE: readonly (readonly [RegExp, FailureCategory])[] = [
  [/\b(econnrefused|enotfound|econnreset|socket hang up|network)\b/i, "NETWORK"],
  [/\b(etimedout|timed? ?out)\b/i, "TIMEOUT"],
  [/\bout of memory\b|\bsegmentation fault\b|\bkilled\b/i, "WORKER_CRASH"],
  [/\bscope violation\b|\bwrote outside\b|\bout of scope\b/i, "SCOPE_VIOLATION"],
  [/\blease\b.*\b(conflict|expired|stale|fencing)\b/i, "LEASE_CONFLICT"],
];

// -----------------------------------------------------------------------
// Classifier
// -----------------------------------------------------------------------

export class FailureClassifier {
  /**
   * Classify a failure.
   *
   * Never throws for an unrecognised failure — that is a normal result and
   * becomes UNKNOWN/ESCALATE. It throws only for a malformed signal, since
   * classifying nothing would silently produce a decision with no basis.
   */
  classify(signal: FailureSignal): FailureClassification {
    if (!signal.message.trim()) {
      throw new FailureClassifierInputError("failure message must not be empty");
    }

    const code = signal.providerCode?.trim().toLowerCase();
    if (code) {
      const category = CODE_TABLE.get(code);
      if (category) return build(category, "providerCode", `provider code "${code}"`);
    }

    if (signal.httpStatus !== null && signal.httpStatus !== undefined) {
      if (!Number.isInteger(signal.httpStatus)) {
        throw new FailureClassifierInputError("httpStatus must be an integer when supplied");
      }
      const category = STATUS_TABLE.get(signal.httpStatus);
      if (category) return build(category, "httpStatus", `HTTP status ${signal.httpStatus}`);
      // Any other 5xx is the provider's side failing.
      if (signal.httpStatus >= 500 && signal.httpStatus <= 599) {
        return build("PROVIDER_UNAVAILABLE", "httpStatus", `HTTP status ${signal.httpStatus} (server-side)`);
      }
    }

    for (const [pattern, category] of MESSAGE_TABLE) {
      if (pattern.test(signal.message)) {
        return build(category, "message", `message matched ${pattern.source}`);
      }
    }

    // A policy refusal is terminal by definition: the policy will refuse the
    // same request again.
    if (signal.origin === "policy") {
      return build("CONTENT_POLICY", "origin", "policy-origin failure is terminal for this request");
    }

    return build(
      "UNKNOWN",
      "none",
      "no provider code, HTTP status or known message pattern matched; escalated rather than retried because guessing transient would silently retry something permanent",
    );
  }
}

function build(
  category: FailureCategory,
  matchedOn: FailureClassification["matchedOn"],
  rationale: string,
): FailureClassification {
  const recoverability = RECOVERABILITY[category];
  return {
    schemaVersion: FAILURE_CLASSIFIER_SCHEMA_VERSION,
    category,
    recoverability,
    retryable: recoverability === "TRANSIENT",
    matchedOn,
    rationale,
  };
}
