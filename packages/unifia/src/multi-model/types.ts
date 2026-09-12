/**
 * multi-model/types.ts — TEAM-B01
 *
 * Canonical multi-model invocation contracts.
 *
 * This module defines the *invocation* layer that consumes the C01
 * model-intelligence registry. We do NOT re-define Model/Provider/registry
 * here — those live exclusively in packages/unifia/src/model-intelligence/
 * (C01, schemaVersion 1.0.0-draft).
 *
 * Responsibilities (plan directeur §26 ligne 1501+):
 *   - ModelRef, EndpointRef      : branded canonical identifiers
 *   - InvocationRequest/Result   : stable contract for invoking any model
 *   - TokenUsage                 : input/output/cache/reasoning accounting
 *   - Modalities                 : input/output modalities subset (text|audio|image|video|pdf)
 *   - shared NamedError types    : invocation-layer errors
 *
 * Compatibility:
 *   - multi-model schema version 1.0.0 (this module)
 *   - C01 schemaVersion 1.0.0-draft (consumed, not redefined)
 *
 * Hard constraints:
 *   - No imports from packages/unifia/src/team/** (G01/G02 figé)
 *   - No imports from packages/unifia/src/collective/** (B0X futur)
 *   - No registry re-definition; consumer-only of model-intelligence/
 */

import { NamedError } from "@unifia/util/error";
import z from "zod";

/**
 * Schema version for this module. Independent from C01's schemaVersion
 * because this layer (invocation contracts) has its own lifecycle.
 */
export const MULTIMODEL_SCHEMA_VERSION = "1.0.0" as const;
export const MULTIMODEL_GENERATOR_VERSION = "multi-model/1.0.0" as const;

/**
 * Compatible prior versions (semver). Consumers MUST accept these.
 * Versions outside this set raise ModelSchemaVersionMismatchError.
 */
export const MULTIMODEL_BACKWARD_COMPAT: ReadonlySet<string> = new Set([
  "1.0.0",
]);
export const MULTIMODEL_LOWER_BOUND = "1.0.0";

// -------------------------------------------------------------------------------------
// Branded ID primitives
// -------------------------------------------------------------------------------------

declare const ModelRefBrand: unique symbol;
declare const EndpointRefBrand: unique symbol;
declare const InvocationRequestIdBrand: unique symbol;

export type ModelRef = {
  readonly [ModelRefBrand]: "ModelRef";
  readonly providerID: string;
  readonly modelID: string;
};

export type EndpointRef = {
  readonly [EndpointRefBrand]: "EndpointRef";
  readonly endpointURL: string;
  readonly scheme: "http" | "https" | "ws" | "wss";
};

export type InvocationRequestId = {
  readonly [InvocationRequestIdBrand]: "InvocationRequestId";
  readonly value: string;
};

// -------------------------------------------------------------------------------------
// Internal branded constructors (kept private to the module)
// -------------------------------------------------------------------------------------

const ID_SAFE_PATTERN = /^[A-Za-z0-9._/:@?#&%=+~-]{1,256}$/;
const PROVIDER_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const MODEL_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:/@-]{0,255}$/;
const REQUEST_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

function brandModelRef(providerID: string, modelID: string): ModelRef {
  return { providerID, modelID } as ModelRef;
}

function brandEndpointRef(endpointURL: string, scheme: EndpointRef["scheme"]): EndpointRef {
  return { endpointURL, scheme } as EndpointRef;
}

function brandInvocationRequestId(value: string): InvocationRequestId {
  return { value } as InvocationRequestId;
}

export const TestModelRefBrand = {
  brandModelRef,
  brandEndpointRef,
  brandInvocationRequestId,
} as const;

// -------------------------------------------------------------------------------------
// Modalities (constrained subset — same set as C01 schema)
// -------------------------------------------------------------------------------------

export const MODALITY_VALUES = ["text", "audio", "image", "video", "pdf"] as const;
export type Modality = (typeof MODALITY_VALUES)[number];

export const ModalitiesSchema = z.object({
  input: z.array(z.enum(MODALITY_VALUES)).min(1).max(8),
  output: z.array(z.enum(MODALITY_VALUES)).min(1).max(8),
});
export type Modalities = z.infer<typeof ModalitiesSchema>;

// -------------------------------------------------------------------------------------
// Token usage
// -------------------------------------------------------------------------------------

export const TokenUsageSchema = z
  .object({
    inputTokens: z.number().int().nonnegative().default(0),
    outputTokens: z.number().int().nonnegative().default(0),
    cacheReadTokens: z.number().int().nonnegative().nullable().default(null),
    cacheWriteTokens: z.number().int().nonnegative().nullable().default(null),
    reasoningTokens: z.number().int().nonnegative().nullable().default(null),
  })
  .strict();
export type TokenUsage = z.infer<typeof TokenUsageSchema>;

// -------------------------------------------------------------------------------------
// FinishReason
// -------------------------------------------------------------------------------------

export const FINISH_REASON_VALUES = [
  "stop",
  "length",
  "tool_calls",
  "content_filter",
  "error",
  "cancelled",
] as const;
export type FinishReason = (typeof FINISH_REASON_VALUES)[number];

export const FinishReasonSchema = z.enum(FINISH_REASON_VALUES);

// -------------------------------------------------------------------------------------
// Invocation options (forwarded to underlying model)
// -------------------------------------------------------------------------------------

export const InvocationOptionsSchema = z
  .object({
    temperature: z.number().min(0).max(2).nullable().optional(),
    topP: z.number().min(0).max(1).nullable().optional(),
    maxTokens: z.number().int().positive().nullable().optional(),
    stopSequences: z.array(z.string().min(1)).max(16).optional(),
    seed: z.number().int().nonnegative().nullable().optional(),
    timeoutMs: z.number().int().positive().max(600_000).optional(),
    metadata: z.record(z.string(), z.string()).optional(),
    extraHeaders: z.record(z.string(), z.string()).optional(),
    extraBody: z.record(z.string(), z.unknown()).optional(),
  })
  .strict();
export type InvocationOptions = z.infer<typeof InvocationOptionsSchema>;

// -------------------------------------------------------------------------------------
// InvocationRequest / InvocationResult
// -------------------------------------------------------------------------------------

/**
 * Common parameters for an invocation. Input/output are kept generic so
 * downstream layers can choose their encoding (text, structured JSON, multimodal).
 */
export interface InvocationRequest<Input = unknown> {
  readonly requestId: InvocationRequestId;
  readonly model: ModelRef;
  readonly endpoint: EndpointRef | null;
  readonly modalities: Modalities;
  readonly input: Input;
  readonly options?: InvocationOptions;
}

/**
 * Result envelope returned by the invoker. Generic over the output encoding.
 */
export interface InvocationResult<Output = unknown> {
  readonly requestId: InvocationRequestId;
  readonly model: ModelRef;
  readonly output: Output;
  readonly usage: TokenUsage;
  readonly latencyMs: number;
  readonly finishReason: FinishReason;
  /**
   * Raw provider response id (if the underlying provider returns one).
   * Useful for cross-system correlation. Optional.
   */
  readonly providerRequestId?: string;
}

// -------------------------------------------------------------------------------------
// Helpers (parsing + validation wrappers re-exported from model-ref.ts)
// -------------------------------------------------------------------------------------

/**
 * Lightweight model-ref validator usable as a guard before reaching the registry.
 * Does NOT depend on C01 (which is intentionally a peer layer); use this for
 * structural checks only. Pass refs through Registry.getModel() for existence.
 */
export const ModelRefValidator = z
  .object({
    providerID: z.string().regex(PROVIDER_ID_PATTERN, "providerID must match [A-Za-z0-9._-], max 64"),
    modelID: z.string().regex(MODEL_ID_PATTERN, "modelID must match [A-Za-z0-9._:/@-], max 256"),
  })
  .strict();

export const EndpointRefValidator = z
  .object({
    endpointURL: z.string().regex(ID_SAFE_PATTERN, "endpointURL contains forbidden characters"),
    scheme: z.enum(["http", "https", "ws", "wss"]),
  })
  .strict();

/**
 * Validate the structural shape of an InvocationResult. Forwards errors as
 * typed exceptions (below).
 */
export function validateInvocationResult<Output = unknown>(
  candidate: unknown,
): asserts candidate is InvocationResult<Output> {
  const schema = z
    .object({
      requestId: z.object({ value: z.string() }),
      model: ModelRefValidator,
      output: z.unknown(),
      usage: TokenUsageSchema,
      latencyMs: z.number().nonnegative(),
      finishReason: FinishReasonSchema,
      providerRequestId: z.string().optional(),
    })
    .passthrough();
  const r = schema.safeParse(candidate);
  if (!r.success) {
    throw new ModelInvocationError({
      code: "E_INVALID_RESULT",
      message: "InvocationResult failed structural validation",
      issue: r.error.message,
      model: undefined,
    });
  }
}

// -------------------------------------------------------------------------------------
// Shared NamedError types
// -------------------------------------------------------------------------------------

export interface ModelInvocationErrorData {
  code:
    | "E_TIMEOUT"
    | "E_RATE_LIMIT"
    | "E_AUTH"
    | "E_INVALID_INPUT"
    | "E_INVALID_RESULT"
    | "E_UNAVAILABLE"
    | "E_CANCELLED"
    | "E_BUDGET_EXCEEDED"
    | "E_SCHEMA_MISMATCH"
    | "E_INTERNAL";
  message: string;
  /** Origin model (if known at error time) */
  model?: ModelRef;
  /** Free-form issue details (validation message, status code, etc.) */
  issue?: unknown;
  /** HTTP status code if surfaced by provider */
  httpStatus?: number;
  /** Retry-after seconds if applicable */
  retryAfterMs?: number;
}

export const ModelInvocationError = NamedError.create(
  "ModelInvocationError",
  z.object({
    code: z.enum([
      "E_TIMEOUT",
      "E_RATE_LIMIT",
      "E_AUTH",
      "E_INVALID_INPUT",
      "E_INVALID_RESULT",
      "E_UNAVAILABLE",
      "E_CANCELLED",
      "E_BUDGET_EXCEEDED",
      "E_SCHEMA_MISMATCH",
      "E_INTERNAL",
    ]),
    message: z.string(),
    model: ModelRefValidator.optional(),
    issue: z.unknown().optional(),
    httpStatus: z.number().int().nullable().optional(),
    retryAfterMs: z.number().int().nonnegative().nullable().optional(),
  }) as unknown as z.ZodType<ModelInvocationErrorData>,
);

/**
 * Thrown when a caller passes an InvocationRequest that this layer cannot accept
 * structurally (no provider reach, malformed input, etc.).
 */
export const ModelInvalidRequestError = NamedError.create(
  "ModelInvalidRequestError",
  z.object({
    message: z.string(),
    field: z.string().optional(),
    issue: z.unknown().optional(),
  }),
);

/**
 * Thrown when a multi-model schema version mismatch is detected between layers.
 */
export const ModelSchemaVersionMismatchError = NamedError.create(
  "ModelSchemaVersionMismatchError",
  z.object({
    found: z.string(),
    currentVersion: z.string(),
    lowerBound: z.string(),
    message: z.string(),
  }),
);

// -------------------------------------------------------------------------------------
// Convenience factory functions
// -------------------------------------------------------------------------------------

/**
 * Build a new ModelRef. Throws ModelInvalidRequestError on invalid input.
 */
export function makeModelRef(providerID: string, modelID: string): ModelRef {
  const r = ModelRefValidator.safeParse({ providerID, modelID });
  if (!r.success) {
    throw new ModelInvalidRequestError({
      message: "invalid ModelRef",
      issue: r.error.message,
    });
  }
  return brandModelRef(r.data.providerID, r.data.modelID);
}

/**
 * Build a new EndpointRef. Throws ModelInvalidRequestError on invalid input
 * (including unknown schemes like ftp://).
 */
export function makeEndpointRef(endpointURL: string, scheme?: EndpointRef["scheme"]): EndpointRef {
  const inferredScheme = ((): EndpointRef["scheme"] | null => {
    if (scheme) return scheme;
    if (endpointURL.startsWith("https://")) return "https";
    if (endpointURL.startsWith("http://")) return "http";
    if (endpointURL.startsWith("wss://")) return "wss";
    if (endpointURL.startsWith("ws://")) return "ws";
    return null;
  })();

  if (inferredScheme === null) {
    throw new ModelInvalidRequestError({
      message: "invalid EndpointRef: cannot infer scheme from URL (provide explicit scheme)",
      field: "scheme",
    });
  }

  const r = EndpointRefValidator.safeParse({ endpointURL, scheme: inferredScheme });
  if (!r.success) {
    throw new ModelInvalidRequestError({
      message: "invalid EndpointRef",
      issue: r.error.message,
    });
  }
  return brandEndpointRef(r.data.endpointURL, r.data.scheme);
}

/**
 * Build a new InvocationRequestId from a string. Throws on invalid characters.
 */
export function makeInvocationRequestId(value: string): InvocationRequestId {
  if (!REQUEST_ID_PATTERN.test(value)) {
    throw new ModelInvalidRequestError({
      message: "invalid InvocationRequestId (allowed: [A-Za-z0-9._-], max 128)",
      field: "value",
    });
  }
  return brandInvocationRequestId(value);
}

// -------------------------------------------------------------------------------------
// Compatibility check (C01-equivalent schemaVersion + multi-model schemaVersion)
// -------------------------------------------------------------------------------------

/**
 * Verify the multi-model schemaVersion is within backward-compat range.
 * Returns `true` on success, throws ModelSchemaVersionMismatchError otherwise.
 */
export function checkSchemaVersion(version: string): true {
  if (MULTIMODEL_BACKWARD_COMPAT.has(version)) return true;
  // Compare to lower bound (lexical semver equivalent for our 1.0.x range).
  if (versionCompare(version, MULTIMODEL_LOWER_BOUND) < 0) {
    throw new ModelSchemaVersionMismatchError({
      found: version,
      currentVersion: MULTIMODEL_SCHEMA_VERSION,
      lowerBound: MULTIMODEL_LOWER_BOUND,
      message: `schemaVersion ${version} is below lower bound ${MULTIMODEL_LOWER_BOUND}`,
    });
  }
  // Future versions (above current) require explicit opt-in; reject by default.
  throw new ModelSchemaVersionMismatchError({
    found: version,
    currentVersion: MULTIMODEL_SCHEMA_VERSION,
    lowerBound: MULTIMODEL_LOWER_BOUND,
    message: `schemaVersion ${version} is above current ${MULTIMODEL_SCHEMA_VERSION} (no forward-compat guarantee)`,
  });
}

/**
 * Lexical semver compare for x.y.z versions. Returns -1, 0, +1.
 * Pre-release tags (-alpha) are ignored for ordering.
 */
export function versionCompare(a: string, b: string): -1 | 0 | 1 {
  const stripPrerelease = (s: string) => s.split(/[-+]/)[0]!;
  const pa = stripPrerelease(a).split(".").map((s) => Number.parseInt(s, 10));
  const pb = stripPrerelease(b).split(".").map((s) => Number.parseInt(s, 10));
  if (pa.length !== 3 || pb.length !== 3) return 0;
  for (let i = 0; i < 3; i++) {
    const na = pa[i]!;
    const nb = pb[i]!;
    if (Number.isNaN(na) || Number.isNaN(nb)) return 0;
    if (na < nb) return -1;
    if (na > nb) return 1;
  }
  return 0;
}

// -------------------------------------------------------------------------------------
// Constants re-export
// -------------------------------------------------------------------------------------

export const MultiModelConstants = {
  SCHEMA_VERSION: MULTIMODEL_SCHEMA_VERSION,
  GENERATOR_VERSION: MULTIMODEL_GENERATOR_VERSION,
  LOWER_BOUND: MULTIMODEL_LOWER_BOUND,
  BACKWARD_COMPAT: MULTIMODEL_BACKWARD_COMPAT,
  MODALITY_VALUES,
  FINISH_REASON_VALUES,
} as const;
