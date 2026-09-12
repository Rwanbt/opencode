/* SPDX-License-Identifier: MIT */

// V05 — pure responsive model for the design workbench.
//
// No DOM reads, no signal access: every function takes a numeric
// viewport width plus the persisted user preference and returns a
// `ResponsiveLayout` describing what the split should render. The
// caller (DesignSplit) is responsible for reading the actual viewport size
// from the DOM and feeding it in. The model never reads `window`.
//
// The contract:
//
//   mobile  : v110 overlay                 (one surface + switcher)
//   tablet  : v110 compact/split           (assistant + atelier, no third column)
//   desktop : v110 desktop-wide            (current split, resizable)
//
// The plan's §4 decisions 1-4 are encoded here:
//   - Desktop-wide >=1200 : assistant + atelier side by side, splitter resizable
//   - Desktop-compact / compact-landscape : assistant + atelier, no third column
//   - Overlay portrait : one surface visible, switcher persisted
//   - No minimum width can exceed the viewport

import { TABLET, WIDE, classify } from "@/tokens/viewport"

export const MOBILE_BREAKPOINT = TABLET
export const DESKTOP_BREAKPOINT = WIDE

export type ViewportKind = "mobile" | "tablet" | "desktop"

export type Surface = "assistant" | "atelier"

export type ResponsiveLayout = {
  kind: ViewportKind
  /** Visible surface on mobile. Always "assistant" on tablet/desktop. */
  surface: Surface
  /** Clamped chat width (px). 0 on mobile (the surface is full-width). */
  chatWidth: number
  /** Available workspace width (px). Mobile = full width. */
  workspaceWidth: number
  /** True on mobile: a switcher picks which surface is visible. */
  switcher: boolean
  /** True only on desktop: the splitter is interactive. */
  resizable: boolean
}

export function classifyViewport(width: number, height: number): ViewportKind {
  const viewport = classify(width, height)
  if (viewport === "desktop-wide") return "desktop"
  if (viewport === "desktop-compact" || viewport === "compact-landscape") return "tablet"
  return "mobile"
}

const TABLET_CHAT_WIDTH = 280
const HANDLE_WIDTH = 8
const MIN_WORKSPACE_WIDTH = 200

/**
 * Resolve the full layout for one viewport. Pure: same inputs give
 * the same outputs. The persisted chat width is the user's desktop
 * preference; on smaller viewports the function downgrades it
 * gracefully instead of letting it overflow.
 */
export function resolveLayout(viewport: number, height: number, persistedChatWidth: number): ResponsiveLayout {
  const kind = classifyViewport(viewport, height)
  if (kind === "mobile") {
    return {
      kind,
      surface: "assistant",
      chatWidth: 0,
      workspaceWidth: viewport,
      switcher: true,
      resizable: false,
    }
  }
  if (kind === "tablet") {
    const chatWidth = Math.max(0, Math.min(TABLET_CHAT_WIDTH, viewport - MIN_WORKSPACE_WIDTH - HANDLE_WIDTH))
    return {
      kind,
      surface: "assistant",
      chatWidth,
      workspaceWidth: Math.max(MIN_WORKSPACE_WIDTH, viewport - chatWidth - HANDLE_WIDTH),
      switcher: false,
      resizable: false,
    }
  }
  // Desktop
  const requested = Number.isFinite(persistedChatWidth) ? persistedChatWidth : 0
  const chatWidth = Math.max(0, Math.min(viewport - MIN_WORKSPACE_WIDTH - HANDLE_WIDTH, requested))
  return {
    kind,
    surface: "assistant",
    chatWidth,
    workspaceWidth: Math.max(MIN_WORKSPACE_WIDTH, viewport - chatWidth - HANDLE_WIDTH),
    switcher: false,
    resizable: true,
  }
}

/**
 * Pick a layout surface for mobile given a persisted choice and the
 * current viewport. Tablet/desktop always return the input untouched.
 * Used by the surface switcher to restore the user's last selection
 * without overwriting it on a resize that crossed a breakpoint.
 */
export function pickMobileSurface(persisted: Surface | undefined, width: number, height: number): Surface {
  if (classifyViewport(width, height) !== "mobile") return "assistant"
  return persisted ?? "assistant"
}
