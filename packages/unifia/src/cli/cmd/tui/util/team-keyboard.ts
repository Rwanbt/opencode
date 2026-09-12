// =============================================================================
// tui/util/team-keyboard.ts — TEAM-M05
//
// Keyboard navigation for the Team dialog.
//
// The dialog shipped in TEAM-M02 bound selection to onMouseUp alone, which
// meant a run could not be selected without a mouse. In a terminal that is not
// a minor gap: a terminal is the one surface where a pointer is optional, and
// plenty of the people using it are driving a screen reader or have no mouse
// attached at all.
//
// The movement rules live here rather than in the component so they can be
// tested for what they decide, and so the same rules can be reused by any other
// list the Team surface grows.
// =============================================================================

export type LifecycleKey = "pause" | "resume" | "cancel" | "none"

export function lifecycleKey(event: { name?: string; ctrl?: boolean; meta?: boolean }): LifecycleKey {
  if (event.ctrl || event.meta) return "none"
  if (event.name === "p") return "pause"
  if (event.name === "r") return "resume"
  if (event.name === "c") return "cancel"
  return "none"
}
export type NavigationKey = "up" | "down" | "home" | "end" | "select" | "clear" | "none"

/** Map a terminal key event onto an intent, or onto nothing. */
export function navigationKey(event: { name?: string; ctrl?: boolean; meta?: boolean }): NavigationKey {
  // Modified keys belong to the application, not to list movement: ctrl-c must
  // stay an interrupt rather than becoming a cursor move.
  if (event.ctrl || event.meta) return "none"
  switch (event.name) {
    case "up":
    case "k":
      return "up"
    case "down":
    case "j":
      return "down"
    case "home":
    case "g":
      return "home"
    case "end":
    case "G":
      return "end"
    case "return":
    case "space":
      return "select"
    case "escape":
      return "clear"
    default:
      return "none"
  }
}

/**
 * Where the cursor lands after a movement.
 *
 * Clamps rather than wraps. In a list whose length changes as pages load,
 * wrapping means pressing "down" at what looked like the end silently jumps to
 * the top, and the reader loses their place with no indication anything moved.
 */
export function moveCursor(input: { index: number; count: number; key: NavigationKey }): number {
  if (input.count === 0) return 0
  const clamp = (value: number) => Math.max(0, Math.min(input.count - 1, value))
  switch (input.key) {
    case "up":
      return clamp(input.index - 1)
    case "down":
      return clamp(input.index + 1)
    case "home":
      return 0
    case "end":
      return input.count - 1
    default:
      return clamp(input.index)
  }
}

/**
 * Keep a cursor valid when the list it points into changes.
 *
 * Pages arrive while the user is reading. Growing the list must not move the
 * cursor; shrinking it must not leave the cursor pointing past the end, which
 * would render nothing as selected and make the next keypress jump.
 */
export function reconcileCursor(input: { index: number; count: number }): number {
  if (input.count === 0) return 0
  return Math.max(0, Math.min(input.count - 1, input.index))
}
