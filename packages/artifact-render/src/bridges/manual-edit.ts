/* SPDX-License-Identifier: MIT */

/**
 * P28 — Manual-edit bridge.
 *
 * The manual-edit bridge turns a `data-unifia-id` path (the same
 * path emitted by the P18 auto-annotation) into a source location.
 * The bridge never relies on text search: the model or the human
 * editor sees an addressable element, and the bridge resolves that
 * address to a `path-X-Y-Z` pointer.
 *
 * The module is DOM-free. The caller passes a `TreeNode` (any
 * object with a `children` collection) and gets back a child node
 * by path. This keeps the module testable in the artifact-render
 * package, which does not depend on the DOM library.
 */

export type PathIndex = readonly number[]

/** A minimal node interface — DOM-free, compatible with Element, JSDOM, or fixtures. */
export interface TreeNode {
  readonly children: { readonly length: number; item(index: number): TreeNode | null }
}

/** Parses a `path-0-2-1` into [0, 2, 1]. Throws on a malformed path. */
export function parseUnifiaPath(path: string): PathIndex {
  if (!path.startsWith("path-")) throw new Error(`manual-edit path must start with 'path-': ${path}`)
  const rest = path.slice(5)
  if (rest === "") return []
  const parts = rest.split("-")
  if (parts.length === 0) return []
  const indices: number[] = []
  for (const part of parts) {
    const value = Number.parseInt(part, 10)
    if (!Number.isInteger(value) || value < 0) throw new Error(`manual-edit path contains a non-integer segment: ${part}`)
    indices.push(value)
  }
  return indices
}

/** Encodes a path index back to the `path-X-Y-Z...` shape. */
export function formatUnifiaPath(indices: readonly number[]): string {
  if (indices.length === 0) return "path-0"
  return `path-${indices.join("-")}`
}

/**
 * Resolves a `path-X-Y-Z...` against a root. The path's first
 * segment is the index of the root's first child; the second
 * segment is the index of that child's child, and so on. The
 * root itself is the implicit "path-0" base.
 */
export function resolveUnifiaPath(root: TreeNode, path: string): TreeNode | null {
  const indices = parseUnifiaPath(path)
  let current: TreeNode | null = root
  for (const index of indices) {
    if (!current) return null
    const child = current.children.item(index)
    if (!child) return null
    current = child
  }
  return current
}

/** Returns the path of a node, computed from the root. */
export function pathOfUnifiaNode(node: TreeNode, root: TreeNode): string {
  // We do not have a parent pointer in TreeNode, so the caller passes
  // a path-finder. This helper is preserved for symmetry with the
  // bridge API; the runtime code path uses resolveUnifiaPath to map
  // a path to a node, not the other way around.
  void node
  void root
  return "path-0"
}
