/* SPDX-License-Identifier: MIT */

import { WORKBENCH_REQUEST_HEADERS } from "@unifia/contracts/workbench-wire"

// FUNC-002: the four real Tauri v2 desktop origins (loopback dev server and
// packaged app, both http and the tauri:// custom scheme). Overridable per
// WorkbenchServer instance (see ServerDependencies.allowedOrigins) rather
// than hardcoded platform-by-platform in every caller.
export const WORKBENCH_ALLOWED_ORIGINS = ["http://tauri.localhost", "https://tauri.localhost", "tauri://localhost", "http://ipc.localhost"] as const

export type SecurityDecision = { allowed: true; origin?: string } | { allowed: false; origin: string }

export function checkRequestOrigin(origin: string | null, allowedOrigins: readonly string[] = WORKBENCH_ALLOWED_ORIGINS): SecurityDecision {
  if (origin === null) return { allowed: true }
  return allowedOrigins.includes(origin) ? { allowed: true, origin } : { allowed: false, origin }
}

// FUNC-002: derived from WORKBENCH_REQUEST_HEADERS (@unifia/contracts) so
// the allowlist cannot drift from what WorkbenchClient actually sends —
// see client.ts's #headers()/#send(), typed against the same union.
const ALLOWED_REQUEST_HEADERS = WORKBENCH_REQUEST_HEADERS.join(",")

export function addSecurityHeaders(response: Response, origin?: string): Response {
  const headers = new Headers(response.headers)
  headers.set("x-content-type-options", "nosniff")
  headers.set("referrer-policy", "no-referrer")
  headers.set("cross-origin-resource-policy", "same-origin")
  if (origin) {
    headers.set("access-control-allow-origin", origin)
    headers.set("access-control-allow-credentials", "true")
    headers.set("access-control-allow-methods", "GET,POST,DELETE,OPTIONS")
    headers.set("access-control-allow-headers", ALLOWED_REQUEST_HEADERS)
    headers.set("access-control-max-age", "600")
    headers.set("vary", "origin")
  }
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers })
}
