/**
 * multi-model/model-ref.ts — TEAM-B01
 *
 * Resolution, parsing and validation helpers for ModelRef / EndpointRef.
 *
 * Distinct from C01 (packages/unifia/src/model-intelligence/registry.ts) :
 *   - C01 owns the registry of models (their pricing, capabilities, etc.)
 *   - B01 owns the *invocation* layer. B01 ModelRef parsing is structural
 *     only; semantic resolution (does the model exist? what's its schema?)
 *     is delegated to the C01 registry by upstream callers (B02+).
 *
 * No imports from packages/unifia/src/model-intelligence/** (we don't
 * redefine registry behaviour — we just provide ergonomic helpers).
 * No imports from packages/unifia/src/team/** or collective/**.
 */

import {
  EndpointRefValidator,
  makeEndpointRef,
  makeInvocationRequestId,
  makeModelRef,
  ModelRefValidator,
  type EndpointRef,
  type InvocationRequestId,
  type ModelRef,
} from "./types";

// -------------------------------------------------------------------------------------
// Public API — parsing & formatting
// -------------------------------------------------------------------------------------

/**
 * Parse a single string token into a ModelRef. Supports three common shapes:
 *   - "providerID"           → lookup-only (modelID empty, caller must resolve)
 *   - "providerID:modelID"   → canonical
 *   - "providerID/modelID"   → URL-slash form (e.g. "openai/gpt-4o")
 *
 * Returns `null` if the input does not match any supported shape, or if either
 * side fails structural validation. Use `parseModelRefStrict` for throwing.
 */
export function parseModelRef(input: string): ModelRef | null {
  if (typeof input !== "string" || input.length === 0) return null;

  // Slash form: "openai/gpt-4o" → providerID="openai", modelID="gpt-4o"
  // (modelID allowed to contain slashes via the URL form, e.g. "openai/gpt/4o".)
  if (input.includes("/")) {
    const firstSlash = input.indexOf("/");
    const providerID = input.slice(0, firstSlash);
    const modelID = input.slice(firstSlash + 1);
    if (modelID.length === 0) return null;
    if (modelID.includes("/")) {
      // Treat subsequent slashes as part of modelID (e.g. "openai/gpt/4o").
      const r = ModelRefValidator.safeParse({ providerID, modelID });
      return r.success ? makeModelRef(providerID, modelID) : null;
    }
    return tryConstruct(providerID, modelID);
  }

  // Colon form: "openai:gpt-4o"
  if (input.includes(":")) {
    const firstColon = input.indexOf(":");
    const providerID = input.slice(0, firstColon);
    const modelID = input.slice(firstColon + 1);
    if (modelID.length === 0) return null;
    return tryConstruct(providerID, modelID);
  }

  // Bare providerID form is NOT supported (modelID is required for an
  // unambiguous ModelRef). Use parseModelRef with explicit 'providerID:modelID'.
  return null;
}

/**
 * Strict variant — throws ModelInvalidRequestError on parse failure.
 */
export function parseModelRefStrict(input: string): ModelRef {
  const ref = parseModelRef(input);
  if (!ref) {
    const err = new Error(`unparseable ModelRef: ${JSON.stringify(input)}`);
    err.name = "ModelInvalidRequestError";
    throw err;
  }
  return ref;
}

/**
 * Canonical string form for a ModelRef: "providerID:modelID".
 * If modelID is empty (bare provider form), emits "providerID:".
 */
export function formatModelRef(ref: ModelRef): string {
  return `${ref.providerID}:${ref.modelID}`;
}

/**
 * Parse an EndpointRef from a string. Supported shapes:
 *   - full URL with scheme (http/https/ws/wss) — scheme inferred if missing
 * Throws on invalid input.
 */
export function parseEndpointRef(input: string): EndpointRef {
  return makeEndpointRef(input);
}

/**
 * Stable hash of a ModelRef for use as a map key. Uses SHA-256 of the
 * canonical form (providerID:modelID). Returns 64-char lowercase hex.
 *
 * Synchronous — uses Web Crypto. We keep this synchronous for ergonomic
 * callers and because the input is bounded (≤ 320 chars total).
 */
export async function hashModelRef(ref: ModelRef): Promise<string> {
  const data = new TextEncoder().encode(formatModelRef(ref));
  const buf = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * Canonical equality for ModelRef: case-sensitive on both fields.
 * Use `equivModelRefCaseInsensitive` for case-insensitive variant.
 */
export function equivModelRef(a: ModelRef, b: ModelRef): boolean {
  return a.providerID === b.providerID && a.modelID === b.modelID;
}

export function equivModelRefCaseInsensitive(a: ModelRef, b: ModelRef): boolean {
  return (
    a.providerID.toLowerCase() === b.providerID.toLowerCase() &&
    a.modelID.toLowerCase() === b.modelID.toLowerCase()
  );
}

/**
 * Canonical equality for EndpointRef.
 */
export function equivEndpointRef(a: EndpointRef, b: EndpointRef): boolean {
  return a.endpointURL === b.endpointURL && a.scheme === b.scheme;
}

// -------------------------------------------------------------------------------------
// Alias / variant resolution (structural only — does NOT touch C01 registry)
// -------------------------------------------------------------------------------------

/**
 * Resolve an alias shape "alias=providerID:modelID" or "alias=providerID/modelID"
 * into a pair (alias, ModelRef). Returns null if the input is not an alias shape.
 *
 * Note: this only handles *structural* alias forms. The actual registry-aware
 * alias→canonical resolution lives in C01 (model-intelligence/aliases.ts).
 * Use `Registry.resolveAlias()` from C01 when you need semantic resolution.
 */
export function tryParseAliasShape(input: string): { alias: string; ref: ModelRef } | null {
  const eq = input.indexOf("=");
  if (eq <= 0) return null;
  const alias = input.slice(0, eq).trim();
  const target = input.slice(eq + 1).trim();
  if (alias.length === 0 || target.length === 0) return null;
  const ref = parseModelRef(target);
  if (!ref) return null;
  return { alias, ref };
}

/**
 * Validate that an arbitrary unknown is structurally a ModelRef. Used at
 * trust boundaries (IPC, JSON.parse of untrusted input).
 */
export function isModelRef(value: unknown): value is ModelRef {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.providerID === "string" &&
    typeof v.modelID === "string" &&
    ModelRefValidator.safeParse({ providerID: v.providerID, modelID: v.modelID }).success
  );
}

export function isEndpointRef(value: unknown): value is EndpointRef {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.endpointURL === "string" &&
    typeof v.scheme === "string" &&
    EndpointRefValidator.safeParse({ endpointURL: v.endpointURL, scheme: v.scheme }).success
  );
}

export function isInvocationRequestId(value: unknown): value is InvocationRequestId {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as InvocationRequestId).value === "string"
  );
}

// -------------------------------------------------------------------------------------
// ID generation (Bun runtime required — uses Web Crypto)
// -------------------------------------------------------------------------------------

/**
 * Generate a new InvocationRequestId with reasonable entropy.
 * Format: "mm_<16-hex>" — short, log-friendly.
 */
export async function newInvocationRequestId(): Promise<InvocationRequestId> {
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  const hex = Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  return makeInvocationRequestId(`mm_${hex}`);
}

/**
 * Synchronous variant using a non-CSPRNG-grade fallback (timestamp counter).
 * Use only when Web Crypto is unavailable (rare).
 */
let _syncCounter = 0;
export function newInvocationRequestIdSync(): InvocationRequestId {
  _syncCounter = (_syncCounter + 1) | 0;
  const ts = Date.now().toString(36);
  return makeInvocationRequestId(`mm_${ts}_${_syncCounter.toString(36)}`);
}

// -------------------------------------------------------------------------------------
// Internal helpers
// -------------------------------------------------------------------------------------

function tryConstruct(providerID: string, modelID: string): ModelRef | null {
  const r = ModelRefValidator.safeParse({ providerID, modelID });
  if (!r.success) return null;
  return makeModelRef(providerID, modelID);
}

// -------------------------------------------------------------------------------------
// Re-export of the type-only surface
// -------------------------------------------------------------------------------------

export { makeModelRef, makeEndpointRef, makeInvocationRequestId };
export type { ModelRef, EndpointRef, InvocationRequestId };
