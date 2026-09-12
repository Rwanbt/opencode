/* SPDX-License-Identifier: MIT */

import type { GithubStatus } from "./client.js"

/**
 * Phase 17 — read-only view of the GitHub account for the Design surface.
 *
 * Connecting is deliberately NOT offered here: the full Device Flow already
 * lives in the app settings panel (components/settings-github-auth.tsx) and
 * talks to the main sidecar's /github routes. A second entry point would be a
 * second flow to keep correct for no new capability, so Design only reports
 * the state and points at the panel that owns it.
 */
export type GithubConnectionView =
  | { kind: "loading" }
  | { kind: "error" }
  | { kind: "unconfigured" }
  | { kind: "disconnected" }
  | { kind: "connected"; login: string; profileUrl?: string }

export function describeGithubConnection(input: { status?: GithubStatus; loading?: boolean; error?: unknown }): GithubConnectionView {
  if (input.error !== undefined && input.error !== null) return { kind: "error" }
  if (input.loading || !input.status) return { kind: "loading" }
  if (!input.status.configured) return { kind: "unconfigured" }
  // A status can report connected without an identity when the stored session
  // is still valid but the profile fetch failed; treating that as disconnected
  // would invite the user to re-authorize an account that is already linked.
  if (!input.status.connected) return { kind: "disconnected" }
  const identity = input.status.identity
  return { kind: "connected", login: identity?.login ?? "", ...(identity?.profileUrl ? { profileUrl: identity.profileUrl } : {}) }
}
