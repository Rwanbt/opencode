/* SPDX-License-Identifier: MIT */
/* Copyright (c) 2026 Unifia contributors */

/**
 * Post-M3-R1 EI-01..03 — External Ingress triggers (Plan V2.3.1 §204,
 * ADR-008).
 *
 * The ingress track is the second half of the W2 worker (alongside
 * Network, NW-01..07). Three cards, three schemas, one discriminated
 * union. The regression net is:
 *
 *   EI-01 Webhook (5):
 *     (1) minimal valid parses
 *     (2) all 5 auth methods accepted
 *     (3) rejects bad URL
 *     (4) rejects bad auth method
 *     (5) round-trip
 *
 *   EI-02 Event (5):
 *     (6) minimal valid parses
 *     (7) all 7 sources accepted
 *     (8) rejects empty eventType
 *     (9) accepts optional filter
 *     (10) round-trip
 *
 *   EI-03 Polling (5):
 *     (11) minimal valid parses
 *     (12) rejects intervalMs < 1000 (defense vs hot loop)
 *     (13) rejects intervalMs > 24h
 *     (14) default method is GET, default conditional is true
 *     (15) round-trip
 */
import { describe, expect, test } from "bun:test"
import {
  WebhookTriggerSchema,
  EventTriggerSchema,
  PollingTriggerSchema,
  IngressTriggerSchema,
  parseIngressTrigger,
  WebhookAuthMethodSchema,
  ExternalEventSourceSchema,
  WEBHOOK_URL_MAX_CHARS,
  POLLING_INTERVAL_MIN_MS,
  POLLING_INTERVAL_MAX_MS,
  type WebhookTrigger,
  type EventTrigger,
  type PollingTrigger,
} from "../src/ingress.ts"

/* ================================================================== */
/* EI-01 Webhook                                                        */
/* ================================================================== */

describe("EI-01 WebhookTriggerSchema", () => {
  test("(1) MinimalValid — hmac-sha256 with secretRef parses", () => {
    const parsed = WebhookTriggerSchema.parse({
      kind: "webhook",
      url: "https://example.com/hook",
      auth: "hmac-sha256",
      secretRef: "secrets://tenant/webhook-key",
    })
    expect(parsed.kind).toBe("webhook")
    expect(parsed.url).toBe("https://example.com/hook")
    expect(parsed.auth).toBe("hmac-sha256")
    expect(parsed.secretRef).toBe("secrets://tenant/webhook-key")
  })

  test("(2) AllFiveAuthMethods — hmac-sha256/512 + basic + bearer + none all parse", () => {
    const methods: Array<WebhookTrigger["auth"]> = [
      "hmac-sha256",
      "hmac-sha512",
      "basic",
      "bearer",
      "none",
    ]
    for (const m of methods) {
      const base = { kind: "webhook" as const, url: "https://x.example/hook", auth: m }
      const input =
        m === "hmac-sha256" || m === "hmac-sha512"
          ? { ...base, secretRef: "secrets://x/k" }
          : base
      expect(WebhookTriggerSchema.parse(input).auth).toBe(m)
    }
    expect(WebhookAuthMethodSchema.options).toHaveLength(5)
  })

  test("(2+) HmacRequiresSecretRef — refine rejects hmac-sha256 / sha512 without secretRef", () => {
    expect(() =>
      WebhookTriggerSchema.parse({ kind: "webhook", url: "https://x.example/h", auth: "hmac-sha256" }),
    ).toThrow(/secretRef/)
    expect(() =>
      WebhookTriggerSchema.parse({ kind: "webhook", url: "https://x.example/h", auth: "hmac-sha512" }),
    ).toThrow(/secretRef/)
  })

  test("(3) RejectsBadUrl — not a URL is rejected", () => {
    expect(() =>
      WebhookTriggerSchema.parse({ kind: "webhook", url: "not a url at all", auth: "none" }),
    ).toThrow(/url/)
  })

  test("(3+) RejectsTooLongUrl — URL over WEBHOOK_URL_MAX_CHARS is rejected", () => {
    const tooLong = "https://x.example/" + "a".repeat(WEBHOOK_URL_MAX_CHARS)
    expect(() =>
      WebhookTriggerSchema.parse({ kind: "webhook", url: tooLong, auth: "none" }),
    ).toThrow(/url/)
  })

  test("(4) RejectsBadAuthMethod — 'kerberos' is not a valid auth method", () => {
    expect(() =>
      WebhookTriggerSchema.parse({ kind: "webhook", url: "https://x.example/h", auth: "kerberos" }),
    ).toThrow(/auth/)
  })

  test("(5) RoundTrip — parse → JSON → re-parse is equal", () => {
    const original: WebhookTrigger = {
      kind: "webhook",
      url: "https://api.example.com/hooks/orders",
      auth: "hmac-sha512",
      secretRef: "secrets://tenant/orders-hook",
      signatureHeader: "X-Signature-512",
    }
    const first = WebhookTriggerSchema.parse(original)
    const roundTripped = WebhookTriggerSchema.parse(JSON.parse(JSON.stringify(first)))
    expect(roundTripped).toEqual(first)
    expect(roundTripped.signatureHeader).toBe("X-Signature-512")
  })
})

/* ================================================================== */
/* EI-02 Event                                                          */
/* ================================================================== */

describe("EI-02 EventTriggerSchema", () => {
  test("(6) MinimalValid — stripe + eventType parses", () => {
    const parsed = EventTriggerSchema.parse({
      kind: "external-event",
      source: "stripe",
      eventType: "payment_intent.succeeded",
    })
    expect(parsed.kind).toBe("external-event")
    expect(parsed.source).toBe("stripe")
    expect(parsed.eventType).toBe("payment_intent.succeeded")
    expect(parsed.filter).toBeUndefined()
  })

  test("(7) AllSevenSources — stripe, github, slack, google-workspace, aws-eventbridge, azure-eventgrid, custom all parse", () => {
    const sources: Array<EventTrigger["source"]> = [
      "stripe",
      "github",
      "slack",
      "google-workspace",
      "aws-eventbridge",
      "azure-eventgrid",
      "custom",
    ]
    for (const s of sources) {
      expect(
        EventTriggerSchema.parse({ kind: "external-event", source: s, eventType: "some.event.v1" }).source,
      ).toBe(s)
    }
    expect(ExternalEventSourceSchema.options).toHaveLength(7)
  })

  test("(8) RejectsEmptyEventType — '' is rejected by .min(1)", () => {
    expect(() =>
      EventTriggerSchema.parse({ kind: "external-event", source: "stripe", eventType: "" }),
    ).toThrow(/eventType/)
  })

  test("(8+) RejectsBadSource — 'twitter' is not a valid source", () => {
    expect(() =>
      EventTriggerSchema.parse({ kind: "external-event", source: "twitter", eventType: "tweet.created" }),
    ).toThrow(/source/)
  })

  test("(9) AcceptsOptionalFilter — filter ≤ 1024 chars is accepted", () => {
    const parsed = EventTriggerSchema.parse({
      kind: "external-event",
      source: "github",
      eventType: "push",
      filter: "ref == 'refs/heads/main'",
    })
    expect(parsed.filter).toBe("ref == 'refs/heads/main'")
  })

  test("(10) RoundTrip — parse → JSON → re-parse is equal", () => {
    const original: EventTrigger = {
      kind: "external-event",
      source: "aws-eventbridge",
      eventType: "order.placed",
      filter: "detail.amount > 100",
    }
    const first = EventTriggerSchema.parse(original)
    const roundTripped = EventTriggerSchema.parse(JSON.parse(JSON.stringify(first)))
    expect(roundTripped).toEqual(first)
    expect(roundTripped.filter).toBe("detail.amount > 100")
  })
})

/* ================================================================== */
/* EI-03 Polling                                                        */
/* ================================================================== */

describe("EI-03 PollingTriggerSchema", () => {
  test("(11) MinimalValid — endpoint + intervalMs(60_000) parses", () => {
    const parsed = PollingTriggerSchema.parse({
      kind: "polling",
      endpoint: "https://api.example.com/feed",
      intervalMs: 60_000,
    })
    expect(parsed.kind).toBe("polling")
    expect(parsed.intervalMs).toBe(60_000)
  })

  test("(12) RejectsIntervalBelowMinimum — intervalMs < POLLING_INTERVAL_MIN_MS is rejected", () => {
    expect(() =>
      PollingTriggerSchema.parse({
        kind: "polling",
        endpoint: "https://x.example/feed",
        intervalMs: POLLING_INTERVAL_MIN_MS - 1,
      }),
    ).toThrow(/intervalMs/)
  })

  test("(12+) AcceptsBoundaryMinimum — intervalMs === POLLING_INTERVAL_MIN_MS is accepted", () => {
    const parsed = PollingTriggerSchema.parse({
      kind: "polling",
      endpoint: "https://x.example/feed",
      intervalMs: POLLING_INTERVAL_MIN_MS,
    })
    expect(parsed.intervalMs).toBe(POLLING_INTERVAL_MIN_MS)
  })

  test("(13) RejectsIntervalAboveMaximum — intervalMs > POLLING_INTERVAL_MAX_MS is rejected", () => {
    expect(() =>
      PollingTriggerSchema.parse({
        kind: "polling",
        endpoint: "https://x.example/feed",
        intervalMs: POLLING_INTERVAL_MAX_MS + 1,
      }),
    ).toThrow(/intervalMs/)
  })

  test("(14) DefaultMethodIsGet + DefaultConditionalTrue — both defaults apply", () => {
    const parsed = PollingTriggerSchema.parse({
      kind: "polling",
      endpoint: "https://x.example/feed",
      intervalMs: 60_000,
    })
    expect(parsed.method).toBe("GET")
    expect(parsed.conditional).toBe(true)
  })

  test("(15) RoundTrip — parse → JSON → re-parse is equal (explicit method: POST, conditional: false)", () => {
    const original: PollingTrigger = {
      kind: "polling",
      endpoint: "https://api.example.com/orders/stream",
      intervalMs: 5_000,
      method: "POST",
      conditional: false,
    }
    const first = PollingTriggerSchema.parse(original)
    const roundTripped = PollingTriggerSchema.parse(JSON.parse(JSON.stringify(first)))
    expect(roundTripped).toEqual(first)
    expect(roundTripped.method).toBe("POST")
    expect(roundTripped.conditional).toBe(false)
  })
})

/* ================================================================== */
/* Cross-cut: IngressTriggerSchema discriminated union                  */
/* ================================================================== */

describe("IngressTriggerSchema — discriminated union", () => {
  test("DispatchesAllThreeKinds — webhook / external-event / polling each dispatch correctly", () => {
    expect(
      IngressTriggerSchema.parse({
        kind: "webhook",
        url: "https://x.example/h",
        auth: "hmac-sha256",
        secretRef: "k",
      }).kind,
    ).toBe("webhook")
    expect(
      IngressTriggerSchema.parse({
        kind: "external-event",
        source: "slack",
        eventType: "m",
      }).kind,
    ).toBe("external-event")
    expect(
      IngressTriggerSchema.parse({
        kind: "polling",
        endpoint: "https://x.example/feed",
        intervalMs: 60_000,
      }).kind,
    ).toBe("polling")
  })

  test("RejectsUnknownDiscriminator — kind: 'queue' is not a valid trigger", () => {
    expect(() =>
      IngressTriggerSchema.parse({ kind: "queue", queueName: "x" }),
    ).toThrow(/kind/)
  })

  test("parseIngressTrigger_HelperRoundTrips — helper round-trips a webhook trigger", () => {
    const original = { kind: "webhook" as const, url: "https://x.example/hook", auth: "bearer" as const }
    const first = parseIngressTrigger(original)
    const roundTripped = parseIngressTrigger(JSON.parse(JSON.stringify(first)))
    expect(roundTripped).toEqual(first)
  })
})
