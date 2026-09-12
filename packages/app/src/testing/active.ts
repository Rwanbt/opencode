// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Unifia contributors
//
// Original work. No upstream derivation.

import type { E2EWindow } from "./terminal"

/**
 * True when the page was opened by the e2e harness.
 *
 * The harness installs `__opencode_e2e` from an init script, so this is already
 * decided by the time any component renders. Inert everywhere else: nothing
 * writes the marker outside the harness, so a normal page always reads false.
 */
export function e2eActive() {
  if (typeof window === "undefined") return false
  return !!(window as E2EWindow).__opencode_e2e
}
