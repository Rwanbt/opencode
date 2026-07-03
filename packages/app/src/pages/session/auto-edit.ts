// Module-level auto-edit set (PLAN-EDITEUR-IDE-DEFINITIF Phase 2.5).
//
// WHY a separate module: the `autoEditPaths` set is mutated by
// `requestAutoEdit` (called from session-side-panel.tsx on double-click) and
// read+cleared by `EditorPanel` when its effect notices a pending path.
// Keeping it in its own file lets both consumers import without circular deps
// and without leaking the state into file-tabs.tsx's module scope.

const autoEditPaths = new Set<string>()

export function requestAutoEdit(path: string) {
  autoEditPaths.add(path)
}

/**
 * Returns true if `path` was pending auto-edit (and removes it from the set).
 * Used by EditorPanel's auto-enter effect on mount/path-change.
 */
export function consumeAutoEdit(path: string): boolean {
  if (!autoEditPaths.has(path)) return false
  autoEditPaths.delete(path)
  return true
}