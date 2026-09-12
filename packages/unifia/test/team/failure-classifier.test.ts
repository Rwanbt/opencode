import { describe, expect, test } from "bun:test";
import {
  FAILURE_CATEGORIES,
  FailureClassifier,
  FailureClassifierInputError,
  isRetryable,
  recoverabilityOf,
  type FailureCategory,
  type FailureSignal,
} from "../../src/team/failure-classifier";

const classifier = new FailureClassifier();

function signal(overrides: Partial<FailureSignal> = {}): FailureSignal {
  return { message: "something went wrong", origin: "provider", ...overrides };
}

// ---------------------------------------------------------------------
// Acceptance: fixture matrix
// ---------------------------------------------------------------------

const CODE_FIXTURES: readonly (readonly [string, FailureCategory])[] = [
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
];

const STATUS_FIXTURES: readonly (readonly [number, FailureCategory])[] = [
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
];

const MESSAGE_FIXTURES: readonly (readonly [string, FailureCategory])[] = [
  ["connect ECONNREFUSED 127.0.0.1:443", "NETWORK"],
  ["getaddrinfo ENOTFOUND api.example.test", "NETWORK"],
  ["socket hang up", "NETWORK"],
  ["request ETIMEDOUT after 30s", "TIMEOUT"],
  ["worker process killed", "WORKER_CRASH"],
  ["fatal: out of memory", "WORKER_CRASH"],
  ["scope violation: wrote outside the manifest", "SCOPE_VIOLATION"],
  ["lease expired: fencing token stale", "LEASE_CONFLICT"],
];

describe("FailureClassifier — acceptance: fixture matrix", () => {
  test("classifies every provider code fixture", () => {
    for (const [providerCode, expected] of CODE_FIXTURES) {
      const result = classifier.classify(signal({ providerCode }));
      expect(result.category).toBe(expected);
      expect(result.matchedOn).toBe("providerCode");
    }
  });

  test("classifies every HTTP status fixture", () => {
    for (const [httpStatus, expected] of STATUS_FIXTURES) {
      const result = classifier.classify(signal({ httpStatus }));
      expect(result.category).toBe(expected);
      expect(result.matchedOn).toBe("httpStatus");
    }
  });

  test("classifies every message fixture", () => {
    for (const [message, expected] of MESSAGE_FIXTURES) {
      const result = classifier.classify(signal({ message }));
      expect(result.category).toBe(expected);
      expect(result.matchedOn).toBe("message");
    }
  });

  test("every category in the taxonomy has a recoverability", () => {
    // Guards against a category being added without deciding whether it may
    // be retried — the one decision this module exists to make.
    for (const category of FAILURE_CATEGORIES) {
      expect(["TRANSIENT", "FALLBACK", "PERMANENT", "ESCALATE"]).toContain(recoverabilityOf(category));
    }
  });

  test("maps any unlisted 5xx to a provider outage", () => {
    for (const httpStatus of [501, 507, 599]) {
      expect(classifier.classify(signal({ httpStatus })).category).toBe("PROVIDER_UNAVAILABLE");
    }
  });
});

// ---------------------------------------------------------------------
// Acceptance: no retry of a permanent failure
// ---------------------------------------------------------------------

describe("FailureClassifier — acceptance: permanent failures are never retried", () => {
  const permanent: readonly FailureCategory[] = [
    "AUTH",
    "QUOTA_EXCEEDED",
    "INVALID_REQUEST",
    "CONTEXT_TOO_LARGE",
    "CONTENT_POLICY",
    "UNSUPPORTED_CAPABILITY",
    "SCOPE_VIOLATION",
    "LEASE_CONFLICT",
  ];

  test("marks each permanent category non-retryable", () => {
    for (const category of permanent) {
      expect(recoverabilityOf(category)).toBe("PERMANENT");
      expect(isRetryable(category)).toBe(false);
    }
  });

  test("a bad key is not retryable however it arrives", () => {
    // A bad API key does not become valid on the third attempt.
    for (const input of [
      signal({ providerCode: "invalid_api_key" }),
      signal({ httpStatus: 401 }),
      signal({ httpStatus: 403 }),
    ]) {
      const result = classifier.classify(input);
      expect(result.category).toBe("AUTH");
      expect(result.retryable).toBe(false);
    }
  });

  test("exhausted quota is permanent, not merely rate limited", () => {
    const quota = classifier.classify(signal({ providerCode: "insufficient_quota" }));
    const rate = classifier.classify(signal({ providerCode: "rate_limit_exceeded" }));

    expect(quota.retryable).toBe(false);
    expect(rate.retryable).toBe(true);
  });

  test("only the genuinely transient categories are retryable", () => {
    const retryable = FAILURE_CATEGORIES.filter(isRetryable);

    expect([...retryable].sort()).toEqual(["NETWORK", "RATE_LIMITED", "TIMEOUT"]);
  });

  test("a provider outage falls back rather than retrying the same endpoint", () => {
    const result = classifier.classify(signal({ providerCode: "overloaded_error" }));

    expect(result.recoverability).toBe("FALLBACK");
    expect(result.retryable).toBe(false);
  });
});

// ---------------------------------------------------------------------
// Acceptance: unknown blocks
// ---------------------------------------------------------------------

describe("FailureClassifier — acceptance: an unknown failure blocks", () => {
  test("escalates rather than retrying when nothing matches", () => {
    // Guessing "transient" would silently retry something permanent;
    // guessing "permanent" merely stops and asks.
    const result = classifier.classify(signal({ message: "the flux capacitor desynchronised" }));

    expect(result.category).toBe("UNKNOWN");
    expect(result.recoverability).toBe("ESCALATE");
    expect(result.retryable).toBe(false);
  });

  test("escalates an unrecognised provider code rather than falling through to text", () => {
    const result = classifier.classify(signal({ providerCode: "never_seen_before", message: "opaque" }));

    expect(result.category).toBe("UNKNOWN");
  });

  test("escalates an unmapped 4xx instead of assuming it is retryable", () => {
    const result = classifier.classify(signal({ httpStatus: 418, message: "opaque" }));

    expect(result.category).toBe("UNKNOWN");
    expect(result.retryable).toBe(false);
  });

  test("states why it escalated, so a gap in the matrix is visible", () => {
    const result = classifier.classify(signal({ message: "opaque" }));

    expect(result.rationale).toContain("escalated rather than retried");
  });
});

// ---------------------------------------------------------------------
// Precedence and origin
// ---------------------------------------------------------------------

describe("FailureClassifier — precedence", () => {
  test("prefers the provider code over the HTTP status", () => {
    // Codes are part of the contract; a status can be reused across meanings.
    const result = classifier.classify(signal({ providerCode: "insufficient_quota", httpStatus: 429 }));

    expect(result.category).toBe("QUOTA_EXCEEDED");
    expect(result.matchedOn).toBe("providerCode");
  });

  test("prefers the HTTP status over the message text", () => {
    // Wording changes between provider versions; status does not.
    const result = classifier.classify(signal({ httpStatus: 429, message: "connect ECONNREFUSED" }));

    expect(result.category).toBe("RATE_LIMITED");
    expect(result.matchedOn).toBe("httpStatus");
  });

  test("treats a policy-origin failure as terminal", () => {
    const result = classifier.classify(signal({ origin: "policy", message: "refused by policy" }));

    expect(result.category).toBe("CONTENT_POLICY");
    expect(result.retryable).toBe(false);
  });

  test("does not let origin override a matched signal", () => {
    const result = classifier.classify(signal({ origin: "policy", httpStatus: 429, message: "x" }));

    expect(result.category).toBe("RATE_LIMITED");
  });

  test("ignores case and padding in a provider code", () => {
    const result = classifier.classify(signal({ providerCode: "  INVALID_API_KEY  " }));

    expect(result.category).toBe("AUTH");
  });
});

describe("FailureClassifier — input integrity and determinism", () => {
  test("rejects an empty message, since classifying nothing has no basis", () => {
    expect(() => classifier.classify(signal({ message: "   " }))).toThrow(FailureClassifierInputError);
  });

  test("rejects a non-integer HTTP status", () => {
    expect(() => classifier.classify(signal({ httpStatus: 4.04 }))).toThrow(FailureClassifierInputError);
  });

  test("tolerates a null code and status", () => {
    const result = classifier.classify(signal({ providerCode: null, httpStatus: null, message: "opaque" }));

    expect(result.category).toBe("UNKNOWN");
  });

  test("is deterministic", () => {
    const input = signal({ providerCode: "rate_limit_exceeded", httpStatus: 429 });

    expect(classifier.classify(input)).toEqual(classifier.classify(input));
  });
});
