/* SPDX-License-Identifier: MIT */

// V05 — pure responsive model for the design workbench.
//
// No DOM reads, no signal access: every function takes a numeric
// viewport width plus the persisted user preference and returns a
// `ResponsiveLayout` describing what the split should render. The
// caller (DesignSplit) is responsible for reading the actual viewport
// from the DOM and feeding it in. The model never reads `window`.
//
// The contract:
//
//   mobile  : width < MOBILE_BREAKPOINT     (one surface + switcher)
//   tablet  : MOBILE_BREAKPOINT..DESKTOP_BREAKPOINT  (assistant + atelier, no third column)
//   desktop : width >= DESKTOP_BREAKPOINT  (current split, resizable)
//
// The plan's §4 decisions 1-4 are encoded here:
//   - Desktop >=1024 : assistant + atelier side by side, splitter resizable
//   - Tablet 768-1023 : assistant + atelier, no third column
//   - Mobile <768 : one surface visible, switcher persisted
//   - No minimum width can exceed the viewport

export const MOBILE_BREAKPOINT = 768
export const DESKTOP_BREAKPOINT = 1024

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

export function classifyViewport(width: number): ViewportKind {
  if (!Number.isFinite(width) || width < 0) return "desktop"
  if (width < MOBILE_BREAKPOINT) return "mobile"
  if (width < DESKTOP_BREAKPOINT) return "tablet"
  return "desktop"
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
export function resolveLayout(viewport: number, persistedChatWidth: number): ResponsiveLayout {
  const kind = classifyViewport(viewport)
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
export function pickMobileSurface(persisted: Surface | undefined, width: number): Surface {
  if (classifyViewport(width) !== "mobile") return "assistant"
  return persisted ?? "assistant"
}
