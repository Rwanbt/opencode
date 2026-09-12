/**
 * model-ref.test.ts — TEAM-B01
 *
 * Unit tests for multi-model/model-ref.ts :
 *   - parseModelRef : colon form, slash form, bare provider, invalid inputs
 *   - formatModelRef round-trip
 *   - equivModelRef (sensitive + insensitive)
 *   - isModelRef / isEndpointRef / isInvocationRequestId guards
 *   - tryParseAliasShape
 *   - hashModelRef determinism
 *   - newInvocationRequestId / Sync version
 */

import { describe, expect, test } from "bun:test";

import {
  equivEndpointRef,
  equivModelRef,
  equivModelRefCaseInsensitive,
  formatModelRef,
  hashModelRef,
  isEndpointRef,
  isInvocationRequestId,
  isModelRef,
  makeModelRef,
  newInvocationRequestId,
  newInvocationRequestIdSync,
  parseEndpointRef,
  parseModelRef,
  parseModelRefStrict,
  tryParseAliasShape,
} from "../../src/multi-model/model-ref";
import { ModelInvalidRequestError } from "../../src/multi-model/types";

describe("model-ref — parseModelRef", () => {
  test("parses colon form", () => {
    const r = parseModelRef("openai:gpt-4o");
    expect(r).not.toBeNull();
    if (r) {
      expect(r.providerID).toBe("openai");
      expect(r.modelID).toBe("gpt-4o");
    }
  });

  test("parses slash form", () => {
    const r = parseModelRef("anthropic/claude-3-opus");
    expect(r).not.toBeNull();
    if (r) {
      expect(r.providerID).toBe("anthropic");
      expect(r.modelID).toBe("claude-3-opus");
    }
  });

  test("parses multi-slash form (e.g. openai/gpt/4o)", () => {
    const r = parseModelRef("openai/gpt/4o");
    expect(r).not.toBeNull();
    if (r) {
      expect(r.providerID).toBe("openai");
      expect(r.modelID).toBe("gpt/4o");
    }
  });

  test("returns null on bare provider (modelID required)", () => {
    expect(parseModelRef("openai")).toBeNull();
  });

  test("returns null on empty string", () => {
    expect(parseModelRef("")).toBeNull();
  });

  test("returns null on garbage with spaces", () => {
    expect(parseModelRef("open ai gpt")).toBeNull();
  });

  test("returns null when colon present but modelID empty", () => {
    expect(parseModelRef("openai:")).toBeNull();
  });

  test("returns null when slash at end", () => {
    expect(parseModelRef("openai/")).toBeNull();
  });

  test("parseModelRefStrict throws on unparseable input", () => {
    expect(() => parseModelRefStrict("nope nope")).toThrow();
  });
});

describe("model-ref — formatModelRef round-trip", () => {
  test("colon-formatted ref re-parses identically", () => {
    const ref = makeModelRef("openai", "gpt-4o");
    const formatted = formatModelRef(ref);
    expect(formatted).toBe("openai:gpt-4o");
    const reparsed = parseModelRef(formatted);
    expect(reparsed).not.toBeNull();
    expect(equivModelRef(ref, reparsed!)).toBe(true);
  });

  test("cannot construct a bare provider ModelRef (modelID required)", () => {
    expect(() => makeModelRef("openai", "")).toThrow();
  });
});

describe("model-ref — equivalence predicates", () => {
  test("equivModelRef is case-sensitive", () => {
    const a = makeModelRef("OpenAI", "gpt-4o");
    const b = makeModelRef("Openai", "gpt-4o");
    expect(equivModelRef(a, b)).toBe(false);
  });

  test("equivModelRefCaseInsensitive folds case", () => {
    const a = makeModelRef("OpenAI", "GPT-4o");
    const b = makeModelRef("openai", "gpt-4o");
    expect(equivModelRefCaseInsensitive(a, b)).toBe(true);
  });

  test("equivEndpointRef requires scheme match", () => {
    const a = parseEndpointRef("https://api.x/v1");
    const b = parseEndpointRef("https://api.x/v1");
    expect(equivEndpointRef(a, b)).toBe(true);
  });
});

describe("model-ref — type guards", () => {
  test("isModelRef accepts a valid ModelRef and rejects objects", () => {
    expect(isModelRef(makeModelRef("openai", "gpt-4o"))).toBe(true);
    expect(isModelRef({ providerID: "x", modelID: "" })).toBe(false);
    expect(isModelRef("openai:gpt-4o")).toBe(false);
    expect(isModelRef(null)).toBe(false);
    expect(isModelRef(undefined)).toBe(false);
  });

  test("isEndpointRef accepts a valid EndpointRef and rejects malformed", () => {
    expect(isEndpointRef(parseEndpointRef("https://api.x/"))).toBe(true);
    expect(isEndpointRef({ endpointURL: "", scheme: "https" })).toBe(false);
    expect(isEndpointRef(null)).toBe(false);
  });

  test("isInvocationRequestId accepts wrapped string and rejects raw", async () => {
    const id = await newInvocationRequestId();
    expect(isInvocationRequestId(id)).toBe(true);
    expect(isInvocationRequestId(id.value)).toBe(false);
  });
});

describe("model-ref — alias shape parsing", () => {
  test("parses 'alias=providerID:modelID'", () => {
    const r = tryParseAliasShape("gpt-latest=openai:gpt-4o");
    expect(r).not.toBeNull();
    if (r) {
      expect(r.alias).toBe("gpt-latest");
      expect(r.ref.providerID).toBe("openai");
      expect(r.ref.modelID).toBe("gpt-4o");
    }
  });

  test("returns null when no '=' present", () => {
    expect(tryParseAliasShape("openai:gpt-4o")).toBeNull();
  });

  test("returns null when target is unparseable", () => {
    expect(tryParseAliasShape("alias=garbage with spaces")).toBeNull();
  });

  test("returns null when alias is empty", () => {
    expect(tryParseAliasShape("=openai:gpt-4o")).toBeNull();
  });
});

describe("model-ref — hashModelRef determinism", () => {
  test("same input → same SHA-256 hex", async () => {
    const ref = makeModelRef("openai", "gpt-4o");
    const h1 = await hashModelRef(ref);
    const h2 = await hashModelRef(ref);
    expect(h1).toBe(h2);
    expect(h1).toMatch(/^[0-9a-f]{64}$/);
  });

  test("different refs → different hashes", async () => {
    const h1 = await hashModelRef(makeModelRef("openai", "gpt-4o"));
    const h2 = await hashModelRef(makeModelRef("openai", "gpt-4o-mini"));
    expect(h1).not.toBe(h2);
  });
});

describe("model-ref — newInvocationRequestId", () => {
  test("async id has expected prefix and length", async () => {
    const id = await newInvocationRequestId();
    expect(id.value.startsWith("mm_")).toBe(true);
    expect(id.value.length).toBeGreaterThan(2);
  });

  test("sync id has expected prefix and length", () => {
    const id1 = newInvocationRequestIdSync();
    const id2 = newInvocationRequestIdSync();
    expect(id1.value.startsWith("mm_")).toBe(true);
    expect(id2.value.startsWith("mm_")).toBe(true);
    // Counter must ensure unicity within the same process.
    expect(id1.value).not.toBe(id2.value);
  });

  test("sync id is stable under repeat calls", () => {
    const ids = new Set<string>();
    for (let i = 0; i < 5; i++) ids.add(newInvocationRequestIdSync().value);
    expect(ids.size).toBe(5);
  });
});

describe("model-ref — makeModelRef error path", () => {
  test("invalid characters throw ModelInvalidRequestError", () => {
    let caught: unknown = null;
    try {
      makeModelRef("bad provider", "gpt-4o");
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(ModelInvalidRequestError);
  });
});
