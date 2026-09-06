/* SPDX-License-Identifier: MIT */
/**
 * Module-level constants and capability matrices.
 *
 * WHY extracted: the rate budgets, the SSE wake sentinel, the artifact MIME
 * table and the step-up capability set are not part of the request flow —
 * they are configuration. Co-locating them makes the security-relevant
 * matrices searchable in one place rather than scattered across the 1k-line
 * route table.
 */
import type { P3Capability } from "@unifia/contracts"

/** Requests per principal per window when the caller injects no limiter. */
export const DEFAULT_RATE_BUDGET = 240
export const DEFAULT_RATE_WINDOW_MS = 60_000

/** How often GET /v1/workspaces/:id/events re-lists sessions to fan new ones into the stream (C2-2/FUNC-001). */
export const DEFAULT_WORKSPACE_EVENTS_POLL_MS = 5_000

/**
 * SEC-001/C2-3 capability matrix, decided 2026-08-17. workspace.read and
 * workspace.watch are granted at connection (READ_CAPABILITIES,
 * provider.tsx) and always in principal.scopes already — they don't need
 * to be listed here. Every capability NOT in principal.scopes and NOT
 * listed here is refused before #checkCapability's gate ever runs:
 * workflow.run, desktop.control, desktop.observe, browser.navigate and
 * package.install have no legitimate caller in this branch (workflow.run
 * in particular: Automate is out of scope, see ADR-1033/C5-4).
 *
 * workspace.write is deliberately NOT step-up eligible either, but it did
 * acquire legitimate callers (Fichiers CRUD, composer uploads, the scoped
 * PTY routes). Those are served by widening the lease the surface requests
 * at connection — SURFACE_LEASE_CAPABILITIES in workbench-shell/routes.ts —
 * so the capability is in principal.scopes and this gate passes it to the
 * broker like any other granted capability. A token that was never issued
 * workspace.write is still refused here without creating an approval.
 *
 * artifact.create and artifact.export remain the only two
 * step-up-eligible capabilities — Design/Work trigger them for real
 * (save/export), so a base-scoped token must still be able to reach the
 * approval gate for these two, not fail closed outright.
 */
export const STEP_UP_ELIGIBLE_CAPABILITIES: ReadonlySet<P3Capability> = new Set(["artifact.create", "artifact.export"])

/**
 * Capabilities the desktop sidecar's gate allows without an approval.
 *
 * WHY it is wider than the connection lease: reaching the gate is not passing
 * it. artifact.create/export are step-up eligible, so a leased token reaches
 * the broker — which answered 202 approvalRequired, and no Design surface has
 * an approval UI able to answer one. WorkbenchClient treats 202 as success (it
 * IS `response.ok`), so callers read `result.artifact` off an approval
 * envelope and threw. artifact.preview is not step-up eligible at all and
 * answered a flat 403, leaving ArtifactPreview unable to fetch bytes.
 *
 * Deliberately absent: package.install, workflow.run, desktop.observe,
 * desktop.control, browser.navigate — those still go through the broker.
 * surface-capability.test.ts pins this list against the route registries the
 * Design/Work surfaces actually call.
 */
export const SURFACE_GRANTED_CAPABILITIES: readonly P3Capability[] = [
  "workspace.read",
  "workspace.write",
  "workspace.watch",
  "artifact.preview",
  "artifact.create",
  "artifact.export",
]

/** Exposed so the surface suite can assert the shell's lease agrees with what this server refuses before the gate. */
export const STEP_UP_ELIGIBLE: readonly P3Capability[] = [...STEP_UP_ELIGIBLE_CAPABILITIES]

/** Sentinel racing every session's next() promise so a newly-discovered session can interrupt an in-flight wait. */
export const WAKE = Symbol("workspace-events-wake")

/**
 * Content-Type by file extension, for the artifact raw read route (P10).
 * Unknown extensions are served as `application/octet-stream` with
 * `Content-Disposition: attachment` so the browser does not try to
 * render arbitrary bytes as HTML or execute them as script.
 *
 * Kept narrow on purpose: every entry here is a content type we
 * expect an agent-authored artifact to legitimately ship. Adding
 * `text/html` to a `Content-Type` for an unknown extension would
 * re-introduce the XSS surface the sandbox is supposed to close.
 */
export const ARTIFACT_RAW_CONTENT_TYPES: Readonly<Record<string, string>> = {
  html: "text/html; charset=utf-8",
  htm: "text/html; charset=utf-8",
  css: "text/css; charset=utf-8",
  js: "text/javascript; charset=utf-8",
  mjs: "text/javascript; charset=utf-8",
  json: "application/json; charset=utf-8",
  svg: "image/svg+xml; charset=utf-8",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  ico: "image/x-icon",
  txt: "text/plain; charset=utf-8",
  md: "text/markdown; charset=utf-8",
}

/**
 * Content-Security-Policy applied to HTML responses from the artifact raw
 * read route. Mirrors ADR-1036 §1 (the iframe's own CSP). The point
 * of setting the header at the route level is defense in depth: even
 * if a caller downloads the bytes to disk and opens the file in a
 * regular browser, the same controls apply.
 */
export const ARTIFACT_RAW_CSP = [
  "default-src 'none'",
  "script-src 'unsafe-inline' 'unsafe-eval'",
  "style-src 'unsafe-inline'",
  "img-src 'self' data:",
  "font-src 'self' data:",
  "media-src 'none'",
  "connect-src 'none'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'none'",
].join("; ")

/** How long a granted decision stays honored before a sensitive operation needs re-approval (C2-5/D-2). Distinct from ttlMs, which only bounds the pending window. */
export const DEFAULT_GRANT_TTL_MS = 5 * 60_000
