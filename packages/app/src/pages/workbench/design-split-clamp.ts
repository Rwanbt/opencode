/* SPDX-License-Identifier: MIT */

export const MIN_CHAT_WIDTH = 320
export const MAX_CHAT_WIDTH = 720
export const DEFAULT_CHAT_WIDTH = 460
export const KEYBOARD_STEP = 16
const HANDLE_WIDTH = 8
const MIN_WORKSPACE_WIDTH = 200

export function clampChatWidth(requested: number): number {
  if (Number.isNaN(requested)) return DEFAULT_CHAT_WIDTH
  return Math.max(MIN_CHAT_WIDTH, Math.min(MAX_CHAT_WIDTH, requested))
}

// V05 — the desktop clamp must respect the viewport. The plan's §4
// decision 4 forbids any minimum width from exceeding the viewport.
// Without this, a user can persist 460px chat on a 1024 monitor then
// resize to 600 and the splitter would draw outside the visible area.
export function clampChatWidthForViewport(requested: number, viewport: number): number {
  if (!Number.isFinite(viewport) || viewport <= 0) return clampChatWidth(requested)
  const base = clampChatWidth(requested)
  const max = Math.max(0, viewport - MIN_WORKSPACE_WIDTH - HANDLE_WIDTH)
  return Math.min(base, max)
}
