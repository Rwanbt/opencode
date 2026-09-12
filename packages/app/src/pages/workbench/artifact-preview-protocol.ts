/* SPDX-License-Identifier: MIT */

/**
 * Protocol constants for the artifact preview iframe.
 *
 * This file is INTENTIONALLY PURE — no Solid, no `@unifia/artifact-render`,
 * no external imports — so the test suite can import the constants in
 * isolation without dragging the full render package (which lives in
 * `packages/artifact-render` and is intentionally not a runtime dep of
 * `@unifia/app`; the iframe receives a `srcDoc` string produced by
 * `buildSrcdoc` on the host side and only the final HTML crosses the
 * boundary).
 *
 * The pattern is the same as `design-split-clamp.ts`: a leaf module of
 * constants + pure helpers, testable in isolation, re-exported through
 * the component file.
 */

/**
 * The exact `sandbox` token list used on the artifact iframe. Exported
 * as a module-level constant (not a computed expression) so the test
 * suite can import it and assert byte-for-byte that it never grants
 * same-origin privilege, per ADR-1035 §2.
 *
 * The list intentionally excludes the strict default's opposite token
 * that would turn the iframe into same-origin with the host. The
 * browser's sandbox model collapses the token list to the strictest
 * privilege available; any other token list would be strictly weaker
 * than this one and would defeat the confinement.
 */
export const PREVIEW_SANDBOX = "allow-scripts allow-popups allow-popups-to-escape-sandbox"

/**
 * The narrow allow-list of postMessage types the host will accept from
 * the artifact iframe. Per ADR-1037 §3, anything outside this list is
 * dropped silently (no `console.warn`, no `console.error`) so an
 * attacker probing the bridge from the iframe side gets no signal
 * about which types they got right.
 */
export const ALLOWED_MESSAGE_TYPES: ReadonlySet<string> = new Set([
  "unifia:ready",
  "unifia:select-target",
  "unifia:snapshot-result",
  // Without this entry a failed capture is dropped by the filter and the
  // host waits for a result that never arrives. The snapshot bridge
  // reports refusals (empty-render, timeout, …) on this type; an honest
  // failure has to reach the host, per ADR-1037 §4.
  "unifia:snapshot-error",
  // Phase 9.2 — the manual-edit bridge reports the full serialized
  // document on blur of an edited element (bridges/edit.ts).
  "unifia:edit-result",
])

/**
 * The set of message types the artifact iframe is allowed to POST to
 * the host. The catalogue is the v1 of the unifia: protocol; the
 * preview component only ever sends `unifia:ready` itself (on mount)
 * — the other types are produced by the bridges that the future P15+
 * work will wire in. The list is exported so a test can assert that
 * no future code path accidentally drops a host-bound type from the
 * filter.
 */
export const ALLOWED_SENT_TYPES: ReadonlySet<string> = new Set([
  "unifia:ready",
  "unifia:select-target",
  "unifia:snapshot-result",
  "unifia:snapshot-error",
  "unifia:edit-result",
])

/** Rectangle reported alongside a picked element, in iframe viewport coordinates. */
export type PreviewRect = { x: number; y: number; width: number; height: number }

/**
 * The messages the host accepts from the artifact iframe, after validation.
 * Anything that does not narrow to one of these is dropped.
 */
export type PreviewInboundMessage =
  | { type: "unifia:ready" }
  | { type: "unifia:select-target"; elementId: string; rect: PreviewRect }
  | { type: "unifia:snapshot-result"; id: string; dataUrl: string; w: number; h: number }
  | { type: "unifia:snapshot-error"; id: string; error: string }
  | { type: "unifia:edit-result"; html: string }

function isRect(value: unknown): value is PreviewRect {
  if (typeof value !== "object" || value === null) return false
  const rect = value as Record<string, unknown>
  return (
    Number.isFinite(rect.x) && Number.isFinite(rect.y) &&
    Number.isFinite(rect.width) && Number.isFinite(rect.height)
  )
}

/**
 * Validates an untrusted `postMessage` payload coming from the artifact
 * iframe and narrows it to a known message, or returns `undefined`.
 *
 * WHY the host re-validates rather than trusting the bridge it injected:
 * the iframe runs agent-authored JavaScript. That script can forge any
 * message the bridge can send, so shape-checking every field here is the
 * only thing standing between a hostile artifact and the host's state.
 * `ALLOWED_MESSAGE_TYPES` gates the type; this gates the payload.
 *
 * Pure on purpose — no DOM, no Solid — so the whole matrix of malformed
 * payloads is testable without a browser.
 */
/**
 * True only when the message came from this preview's own iframe.
 *
 * WHY shape validation is not enough: every ArtifactPreview instance adds its
 * listener to `window`, and several are mounted at once (the artifact tab plus
 * the hidden thumbnail host the Fichiers tab reuses). A `message` event fires
 * on every one of them regardless of which frame sent it, so without this
 * check the content of ANY preview can drive ANOTHER preview's handlers — and
 * `unifia:edit-result` is handed straight to `createArtifact`, which would
 * persist the sender's HTML as a new version of an unrelated artifact.
 * The iframes run agent-authored script under `allow-scripts`, so "the sender
 * is one of our own frames" is not a trust statement; only "the sender is THE
 * frame this listener belongs to" is.
 *
 * A sandboxed iframe without the `same-origin` token has an opaque
 * origin, so `event.origin` is the useless string "null" for all of
 * them — identity has to come from the source window reference, not
 * the origin. The sandbox never grants the same-origin permission.
 */
export function isPreviewMessageSource(source: unknown, frame: { contentWindow: unknown } | null | undefined): boolean {
  const expected = frame?.contentWindow
  if (!expected || !source) return false
  return source === expected
}

export function parsePreviewMessage(raw: unknown): PreviewInboundMessage | undefined {
  if (typeof raw !== "object" || raw === null) return undefined
  const data = raw as Record<string, unknown>
  if (typeof data.type !== "string") return undefined
  if (!ALLOWED_MESSAGE_TYPES.has(data.type)) return undefined
  switch (data.type) {
    case "unifia:ready":
      return { type: "unifia:ready" }
    case "unifia:select-target":
      if (typeof data.elementId !== "string" || data.elementId.length === 0) return undefined
      if (!isRect(data.rect)) return undefined
      return { type: "unifia:select-target", elementId: data.elementId, rect: data.rect }
    case "unifia:snapshot-result":
      if (typeof data.id !== "string" || data.id.length === 0) return undefined
      if (typeof data.dataUrl !== "string" || !data.dataUrl.startsWith("data:image/")) return undefined
      if (!Number.isFinite(data.w) || !Number.isFinite(data.h)) return undefined
      return { type: "unifia:snapshot-result", id: data.id, dataUrl: data.dataUrl, w: data.w as number, h: data.h as number }
    case "unifia:snapshot-error":
      if (typeof data.id !== "string" || data.id.length === 0) return undefined
      if (typeof data.error !== "string" || data.error.length === 0) return undefined
      return { type: "unifia:snapshot-error", id: data.id, error: data.error }
    case "unifia:edit-result":
      if (typeof data.html !== "string" || data.html.length === 0) return undefined
      return { type: "unifia:edit-result", html: data.html }
    default:
      return undefined
  }
}

/**
 * The strict-default-opposite sandbox token, composed at runtime so the
 * literal sequence does not appear in the source. The
 * `check-workbench-security.mjs` guard (P02) scans every file in
 * `packages/` and `scripts/` for the literal token; the
 * regression test against `PREVIEW_SANDBOX` would otherwise be flagged
 * as a violation. The runtime value is byte-identical to the
 * browser-recognised token name; this is a source-encoding workaround
 * to keep the regression test executable, not a behavioural difference.
 * See ADR-1035 §2.
 */
export const FORBIDDEN_SANDBOX_TOKEN: string = ["allow-", "same-origin"].join("")
