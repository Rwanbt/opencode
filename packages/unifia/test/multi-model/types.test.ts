/**
 * types.test.ts — TEAM-B01
 *
 * Unit tests for multi-model/types.ts :
 *   - TokenUsage / Modalities / InvocationOptions schema validation
 *   - Brand constructors throw on invalid input
 *   - Shared NamedError types are instantiable
 *   - checkSchemaVersion accepts current + rejects older/newer
 *   - versionCompare (lexical semver ordering)
 *   - makeModelRef / makeEndpointRef / makeInvocationRequestId
 */

import { describe, expect, test } from "bun:test";

import {
  checkSchemaVersion,
  FinishReasonSchema,
  InvocationOptionsSchema,
  makeEndpointRef,
  makeInvocationRequestId,
  makeModelRef,
  ModalitiesSchema,
  ModelInvalidRequestError,
  ModelInvocationError,
  ModelSchemaVersionMismatchError,
  ModelRefValidator,
  MULTIMODEL_SCHEMA_VERSION,
  TokenUsageSchema,
  validateInvocationResult,
  versionCompare,
} from "../../src/multi-model/types";

describe("types — schema validation", () => {
  test("TokenUsageSchema accepts a fully populated object", () => {
    const r = TokenUsageSchema.safeParse({
      inputTokens: 100,
      outputTokens: 200,
      cacheReadTokens: 50,
      cacheWriteTokens: 25,
      reasoningTokens: 10,
    });
    expect(r.success).toBe(true);
  });

  test("TokenUsageSchema applies defaults for omitted fields", () => {
    const r = TokenUsageSchema.safeParse({});
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.inputTokens).toBe(0);
      expect(r.data.outputTokens).toBe(0);
    }
  });

  test("TokenUsageSchema rejects negative values", () => {
    const r = TokenUsageSchema.safeParse({ inputTokens: -1 });
    expect(r.success).toBe(false);
  });

  test("ModalitiesSchema rejects empty input array", () => {
    const r = ModalitiesSchema.safeParse({ input: [], output: ["text"] });
    expect(r.success).toBe(false);
  });

  test("ModalitiesSchema rejects unknown modality", () => {
    const r = ModalitiesSchema.safeParse({ input: ["hologram"], output: ["text"] });
    expect(r.success).toBe(false);
  });

  test("InvocationOptionsSchema rejects temperature > 2", () => {
    const r = InvocationOptionsSchema.safeParse({ temperature: 3.0 });
    expect(r.success).toBe(false);
  });

  test("FinishReasonSchema accepts all known values", () => {
    for (const v of ["stop", "length", "tool_calls", "content_filter", "error", "cancelled"] as const) {
      expect(FinishReasonSchema.safeParse(v).success).toBe(true);
    }
  });
});

describe("types — brand constructors", () => {
  test("makeModelRef accepts a valid (providerID, modelID)", () => {
    const ref = makeModelRef("openai", "gpt-4o");
    expect(ref.providerID).toBe("openai");
    expect(ref.modelID).toBe("gpt-4o");
  });

  test("makeModelRef rejects an empty providerID", () => {
    expect(() => makeModelRef("", "gpt-4o")).toThrow(ModelInvalidRequestError);
  });

  test("makeModelRef rejects a modelID with forbidden characters", () => {
    expect(() => makeModelRef("openai", "gpt 4o (preview)")).toThrow(ModelInvalidRequestError);
  });

  test("makeEndpointRef infers scheme from URL", () => {
    expect(makeEndpointRef("https://api.example.com/v1").scheme).toBe("https");
    expect(makeEndpointRef("http://localhost:11434").scheme).toBe("http");
    expect(makeEndpointRef("wss://stream.example.com").scheme).toBe("wss");
  });

  test("makeEndpointRef throws on unknown scheme", () => {
    expect(() => makeEndpointRef("ftp://example.com")).toThrow(ModelInvalidRequestError);
  });

  test("makeInvocationRequestId accepts a safe id", () => {
    expect(makeInvocationRequestId("req_abc-123").value).toBe("req_abc-123");
  });

  test("makeInvocationRequestId rejects an id with spaces", () => {
    expect(() => makeInvocationRequestId("bad id with spaces")).toThrow(ModelInvalidRequestError);
  });
});

describe("types — named errors", () => {
  test("ModelInvocationError is constructible with full payload", () => {
    const err = new ModelInvocationError({
      code: "E_TIMEOUT",
      message: "request timed out after 30s",
      model: makeModelRef("openai", "gpt-4o"),
      httpStatus: 408,
      retryAfterMs: 5000,
    });
    const data = err.data as {
      code: string;
      message: string;
      model?: { providerID: string; modelID: string };
    };
    expect(data.code).toBe("E_TIMEOUT");
    expect(data.message).toMatch(/timed out/);
    expect(data.model?.providerID).toBe("openai");
  });

  test("ModelSchemaVersionMismatchError captures all fields", () => {
    const err = new ModelSchemaVersionMismatchError({
      found: "2.0.0",
      currentVersion: MULTIMODEL_SCHEMA_VERSION,
      lowerBound: "1.0.0",
      message: "test",
    });
    const data = err.data as { found: string; currentVersion: string; lowerBound: string };
    expect(data.found).toBe("2.0.0");
    expect(data.currentVersion).toBe(MULTIMODEL_SCHEMA_VERSION);
  });

  test("ModelInvalidRequestError accepts optional fields", () => {
    const err = new ModelInvalidRequestError({
      message: "missing field",
      field: "modelID",
    });
    expect(err.data.field).toBe("modelID");
  });
});

describe("types — schema version compatibility", () => {
  test("checkSchemaVersion accepts current version", () => {
    expect(checkSchemaVersion(MULTIMODEL_SCHEMA_VERSION)).toBe(true);
  });

  test("checkSchemaVersion rejects future version (above current)", () => {
    expect(() => checkSchemaVersion("2.0.0")).toThrow(ModelSchemaVersionMismatchError);
  });

  test("checkSchemaVersion rejects version below lower bound", () => {
    expect(() => checkSchemaVersion("0.9.0")).toThrow(ModelSchemaVersionMismatchError);
  });

  test("versionCompare orders lexicographically (semver-like)", () => {
    expect(versionCompare("1.0.0", "1.0.1")).toBe(-1);
    expect(versionCompare("1.0.1", "1.0.0")).toBe(1);
    expect(versionCompare("1.0.0", "1.0.0")).toBe(0);
    expect(versionCompare("2.0.0", "1.99.99")).toBe(1);
  });

  test("versionCompare ignores pre-release tags", () => {
    expect(versionCompare("1.0.0-alpha", "1.0.0")).toBe(0);
  });
});

describe("types — validateInvocationResult", () => {
  test("valid result passes structural validation", () => {
    const result = {
      requestId: { value: "mm_abc" },
      model: { providerID: "openai", modelID: "gpt-4o" },
      output: "hello",
      usage: { inputTokens: 10, outputTokens: 5 },
      latencyMs: 123,
      finishReason: "stop",
    };
    expect(() => validateInvocationResult(result)).not.toThrow();
  });

  test("invalid finishReason rejected", () => {
    const result = {
      requestId: { value: "mm_abc" },
      model: { providerID: "openai", modelID: "gpt-4o" },
      output: "hello",
      usage: {},
      latencyMs: 123,
      finishReason: "unknown_reason",
    };
    expect(() => validateInvocationResult(result)).toThrow(ModelInvocationError);
  });

  test("missing usage block rejected", () => {
    const result = {
      requestId: { value: "mm_abc" },
      model: { providerID: "openai", modelID: "gpt-4o" },
      output: "hello",
      latencyMs: 123,
      finishReason: "stop",
    };
    expect(() => validateInvocationResult(result)).toThrow(ModelInvocationError);
  });
});

describe("types — ModelRefValidator", () => {
  test("accepts alphanumeric providerID", () => {
    expect(ModelRefValidator.safeParse({ providerID: "openai", modelID: "gpt-4o" }).success).toBe(true);
  });

  test("rejects providerID starting with a hyphen", () => {
    expect(ModelRefValidator.safeParse({ providerID: "-openai", modelID: "gpt-4o" }).success).toBe(false);
  });

  test("rejects modelID > 256 chars", () => {
    const tooLong = "a".repeat(257);
    expect(ModelRefValidator.safeParse({ providerID: "openai", modelID: tooLong }).success).toBe(false);
  });
});
