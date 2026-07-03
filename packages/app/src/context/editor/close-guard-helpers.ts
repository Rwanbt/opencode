// FORK (Phase 3.4, PLAN-EDITEUR-IDE-DEFINITIF): pure gating helper for the
// dirty-close guard.
//
// Kept in its own file so unit tests can import it WITHOUT pulling in
// `@solidjs/router` (which requires a Router context to even load). The
// Solid provider in `./close-guard.tsx` imports this helper at runtime.

export type DirtyCloseResult = "closed" | "cancelled"

/**
 * Returns true iff the guard should intercept a tab close and show the
 * dialog. System tabs ("context", "review") and unparseable values are
 * never guarded; only a dirty file tab triggers the prompt.
 */
export function shouldGuardDirtyClose(
  tab: string,
  filePath: string | undefined,
  status: string | undefined,
): boolean {
  if (tab === "context" || tab === "review") return false
  if (!filePath) return false
  return status === "dirty"
}