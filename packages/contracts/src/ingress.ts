/* SPDX-License-Identifier: MIT */
/* Copyright (c) 2026 Unifia contributors */

/**
 * External Ingress contracts (Plan V2.3.1 §204, ADR-008).
 *
 * Three ingress channels trigger a workflow from outside the
 * orchestrator. They extend the M1 `TriggerDefinitionSchema` with
 * three new discriminated-union members: webhook, external-event,
 * polling. The runtime dispatches each kind to its own driver.
 *
 * Each trigger lives in the same IR family as the M1 triggers
 * (`kind: "manual" | "schedule" | "webhook" | "external-event" |
 * "polling"`); this file is the family's own validator, applied at
 * the trust boundary via `parseIngressTrigger(input)`. The IR's
 * `TriggerBindingSchema` (workflow-ir.ts) keeps `trigger` as
 * `TriggerDefinitionSchema` so the family-specific shape does not
 * leak into the IR (a new trigger kind cannot break parsing of an
 * existing one).
 *
 * Cross-references documented here, enforced at runtime:
 *   - Webhook `secretRef` (when `auth` is `hmac-*`) MUST resolve
 *     through the Secret Broker (M1-07, ADR-010). The contract
 *     captures the reference; the broker enforces scoping.
 *   - Polling `endpoint` is the only ingress that creates a
 *     long-running egress connection; it is gated by the Network
 *     Authority (NW-01..07, ADR-023) at runtime.
 *   - The IR keeps `Node.config` opaque, so `TriggerDefinitionSchema`
 *     still accepts the M1 `manual` / `schedule` members unchanged
 *     after this addition.
 */
import { z } from "zod"

// EI-01 Webhook
/**
 * Maximum length of a webhook URL. 1024 chars is well above any
 * realistic URL and well below the digest-bloat threshold. RFC 3986
 * does not set a hard upper bound, but most reverse proxies cap
 * URLs at 8 KB; 1024 is a strict contract bound.
 */
export const WEBHOOK_URL_MAX_CHARS = 1024

/**
 * Maximum length of a webhook `secretRef` (HMAC shared secret).
 * The contract stores the *reference*, not the secret itself. The
 * 256-char bound keeps references portable (no full PEM blobs)
 * while leaving room for namespaced URIs (`secrets://tenant/x/key`).
 */
export const WEBHOOK_SECRET_MAX_CHARS = 256

/**
 * Webhook authentication method. The five values cover the realistic
 * HMAC + token surface; `none` is the explicit no-auth choice (the
 * runtime will still validate the signature header shape for `hmac-*`).
 */
export const WebhookAuthMethodSchema = z.enum([
  "hmac-sha256",
  "hmac-sha512",
  "basic",
  "bearer",
  "none",
])
export type WebhookAuthMethod = z.infer<typeof WebhookAuthMethodSchema>

/**
 * Configuration of a `webhook` trigger (Plan V2.3.1 §204, EI-01,
 * ADR-008). Bound to a workflow via `TriggerBinding` (workflow-ir.ts).
 *
 * `secretRef` is required iff `auth` is `hmac-sha256` or `hmac-sha512`:
 * a `refine` enforces the cross-field invariant so a missing secret
 * is caught at the trust boundary, not in production.
 */
export const WebhookTriggerSchema = z
  .object({
    kind: z.literal("webhook"),
    /**
     * Inbound URL the runtime registers as the webhook target. The
     * URL is validated as a real URL (not a free-form string) so a
     * typo fails at the trust boundary.
     */
    url: z
      .string()
      .min(1, "webhook: url must be non-empty")
      .max(
        WEBHOOK_URL_MAX_CHARS,
        `webhook: url must be ≤ ${WEBHOOK_URL_MAX_CHARS} chars`,
      )
      .url(),
    /** Authentication method. */
    auth: WebhookAuthMethodSchema,
    /**
     * HMAC secret reference (not inlined). Required when `auth` is
     * `hmac-sha256` or `hmac-sha512`; optional otherwise. The
     * contract captures the *reference*; the Secret Broker (M1-07)
     * is the single point of resolution.
     */
    secretRef: z
      .string()
      .min(1, "webhook: secretRef must be non-empty when set")
      .max(
        WEBHOOK_SECRET_MAX_CHARS,
        `webhook: secretRef must be ≤ ${WEBHOOK_SECRET_MAX_CHARS} chars`,
      )
      .optional(),
    /**
     * Header carrying the HMAC signature, e.g. `X-Signature` or
     * `X-Hub-Signature-256`. The runtime reads this header to verify
     * the request. Empty / unset is allowed (the runtime falls back
     * to a default per `auth`).
     */
    signatureHeader: z
      .string()
      .min(1, "webhook: signatureHeader must be non-empty when set")
      .max(256, "webhook: signatureHeader must be ≤ 256 chars")
      .optional(),
  })
  .refine(
    (t) => {
      const needsSecret = t.auth === "hmac-sha256" || t.auth === "hmac-sha512"
      return !needsSecret || (t.secretRef !== undefined && t.secretRef.length > 0)
    },
    {
      message: "webhook: secretRef is required for hmac-sha256 / hmac-sha512",
      path: ["secretRef"],
    },
  )
export type WebhookTrigger = z.infer<typeof WebhookTriggerSchema>

// EI-02 External event
/**
 * Maximum length of an external event `eventType` literal
 * (e.g. `payment_intent.succeeded` for Stripe). 256 chars is well
 * above any realistic dotted identifier and well below the digest
 * bloat threshold.
 */
export const EXTERNAL_EVENT_TYPE_MAX_CHARS = 256

/**
 * External event source. The seven values cover the documented
 * V2.3.1 ingress sources. `custom` is the catch-all for any
 * provider that does not have a first-class enumeration.
 */
export const ExternalEventSourceSchema = z.enum([
  "stripe",
  "github",
  "slack",
  "google-workspace",
  "aws-eventbridge",
  "azure-eventgrid",
  "custom",
])
export type ExternalEventSource = z.infer<typeof ExternalEventSourceSchema>

/**
 * Configuration of an `external-event` trigger (Plan V2.3.1 §204,
 * EI-02, ADR-008). The runtime subscribes to `source` and matches
 * incoming events against `eventType` (and the optional `filter`
 * expression).
 */
export const EventTriggerSchema = z.object({
  kind: z.literal("external-event"),
  /** External event source. */
  source: ExternalEventSourceSchema,
  /**
   * The event type literal to match. Format is source-specific
   * (e.g. `payment_intent.succeeded` for Stripe,
   * `push` / `pull_request` for GitHub). The contract bounds the
   * shape; the source-specific semantics are owned by the source
   * driver.
   */
  eventType: z
    .string()
    .min(1, "external-event: eventType must be non-empty")
    .max(
      EXTERNAL_EVENT_TYPE_MAX_CHARS,
      `external-event: eventType must be ≤ ${EXTERNAL_EVENT_TYPE_MAX_CHARS} chars`,
    ),
  /**
   * Optional filter expression evaluated against the event payload.
   * Bounded by 1024 chars to keep the expression-language surface
   * (ADR-003) consistent with `control.if` / `control.switch`.
   * The contract captures the expression; the runtime evaluates it.
   */
  filter: z
    .string()
    .max(1024, "external-event: filter must be ≤ 1024 chars")
    .optional(),
})
export type EventTrigger = z.infer<typeof EventTriggerSchema>

// EI-03 Polling
/**
 * Minimum polling interval. 1 second is a defense against a hot
 * loop: a misconfigured `intervalMs: 0` would otherwise spin a
 * worker as fast as the upstream allows. 1 s matches the typical
 * rate-limiter floor for public REST APIs.
 */
export const POLLING_INTERVAL_MIN_MS = 1000

/**
 * Maximum polling interval. 24 hours is well above any realistic
 * cadence (most polls are seconds to minutes) and prevents an
 * honest typo (`intervalMs: 24 * 60 * 60 * 1000 * 365`) from
 * disabling a trigger for a year.
 */
export const POLLING_INTERVAL_MAX_MS = 24 * 60 * 60 * 1000

/**
 * Configuration of a `polling` trigger (Plan V2.3.1 §204, EI-03,
 * ADR-008). The runtime fires the trigger every `intervalMs` and
 * invokes `endpoint` with `method` (default `GET`). The optional
 * `conditional` flag enables ETag / Last-Modified conditional
 * requests so an empty 304 saves a payload round-trip.
 */
export const PollingTriggerSchema = z.object({
  kind: z.literal("polling"),
  /**
   * Endpoint URL the runtime polls on a fixed interval. Validated
   * as a real URL (not a free-form string) so a typo fails at the
   * trust boundary.
   */
  endpoint: z
    .string()
    .min(1, "polling: endpoint must be non-empty")
    .max(
      WEBHOOK_URL_MAX_CHARS,
      `polling: endpoint must be ≤ ${WEBHOOK_URL_MAX_CHARS} chars`,
    )
    .url(),
  /**
   * Interval between polls in milliseconds. Bounded below by
   * `POLLING_INTERVAL_MIN_MS` (defense vs hot loop) and above by
   * `POLLING_INTERVAL_MAX_MS` (24 h).
   */
  intervalMs: z
    .number()
    .int("polling: intervalMs must be an integer")
    .min(
      POLLING_INTERVAL_MIN_MS,
      `polling: intervalMs must be ≥ ${POLLING_INTERVAL_MIN_MS} ms (1 s, defense vs hot loop)`,
    )
    .max(
      POLLING_INTERVAL_MAX_MS,
      `polling: intervalMs must be ≤ ${POLLING_INTERVAL_MAX_MS} ms (24 h)`,
    ),
  /** HTTP method. Default `GET`. */
  method: z.enum(["GET", "POST"]).default("GET"),
  /**
   * Conditional request via ETag / Last-Modified. Default `true`
   * so a polling workflow that just wants a fresh view of a
   * resource does not pull a full payload on every tick. Set to
   * `false` when the body itself is the signal (e.g. webhook
   * delivery via long-polling).
   */
  conditional: z.boolean().default(true),
})
export type PollingTrigger = z.infer<typeof PollingTriggerSchema>

// Discriminated union of all ingress triggers
/**
 * Discriminated union of the three ingress trigger kinds. This is
 * the *ingress* half; the M1 `manual` / `schedule` triggers live
 * in `TriggerDefinitionSchema` (workflow-ir.ts). A future round
 * may union these into a single `TriggerDefinitionSchema` — for
 * now the contract is split to keep the ingress scope bounded and
 * the IR stable (ADR-002: extending a family is additive, not
 * breaking).
 */
export const IngressTriggerSchema = z.discriminatedUnion("kind", [
  WebhookTriggerSchema,
  EventTriggerSchema,
  PollingTriggerSchema,
])
export type IngressTrigger = z.infer<typeof IngressTriggerSchema>

/**
 * Validate an unknown input as an `IngressTrigger`. Thin
 * throw-on-failure wrapper around `IngressTriggerSchema.parse` —
 * the trust boundary uses this so an inbound webhook / event /
 * polling config cannot smuggle a malformed shape past the IR.
 */
export function parseIngressTrigger(input: unknown): IngressTrigger {
  return IngressTriggerSchema.parse(input)
}
