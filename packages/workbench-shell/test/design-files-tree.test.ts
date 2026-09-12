/* SPDX-License-Identifier: MIT */

import {
  buildFileTree,
  deserializeTreeExpansion,
  designFilesTreeStorageKey,
  EMPTY_TREE_EXPANSION,
  serializeTreeExpansion,
  toggleTreeDirectory,
} from "../src/design-files-tree.js"
import { test } from "bun:test"

test('design-files-tree.test', async () => {

const entries = [
  { path: "zeta.ts", kind: "file" as const, size: 1, modifiedAt: 1 },
  { path: "components", kind: "directory" as const, size: 0, modifiedAt: 1 },
  { path: "components/Card.tsx", kind: "file" as const, size: 4, modifiedAt: 1 },
  { path: "components/nested", kind: "directory" as const, size: 0, modifiedAt: 1 },
  { path: "components/nested/Deep.tsx", kind: "file" as const, size: 5, modifiedAt: 1 },
  { path: "assets/logo.svg", kind: "file" as const, size: 2, modifiedAt: 1 },
  { path: "empty-dir", kind: "directory" as const, size: 0, modifiedAt: 1 },
]

const tree = buildFileTree(entries)
if (tree.length !== 4) throw new Error(`expected 4 top-level nodes, got ${tree.length}`)
// Directories sort before files, then alphabetically: assets, components, empty-dir, zeta.ts
if (tree.map((n) => n.name).join(",") !== "assets,components,empty-dir,zeta.ts") {
  throw new Error(`unexpected top-level order: ${tree.map((n) => n.name).join(",")}`)
}
const componentsNode = tree.find((n) => n.name === "components")
if (!componentsNode || componentsNode.type !== "directory") throw new Error("components did not become a directory node")
if (componentsNode.children.length !== 2) throw new Error("components should have Card.tsx and nested/")
const nested = componentsNode.children.find((n) => n.name === "nested")
if (!nested || nested.type !== "directory" || nested.children.length !== 1) throw new Error("nested directory was not reconstructed")
if (nested.children[0]?.path !== "components/nested/Deep.tsx") throw new Error("deep file path was not preserved")
const emptyDir = tree.find((n) => n.name === "empty-dir")
if (!emptyDir || emptyDir.type !== "directory" || emptyDir.children.length !== 0) throw new Error("empty directory did not survive with zero children")

// Order-independence: shuffling entries must produce the identical tree shape.
const shuffled = [...entries].reverse()
const treeFromShuffled = buildFileTree(shuffled)
if (JSON.stringify(treeFromShuffled) !== JSON.stringify(tree)) throw new Error("tree shape depends on entry order")

// Missing an explicit directory entry (paginated apart from its children) must still reconstruct it.
const withoutDirEntry = entries.filter((e) => e.path !== "components")
const treeWithoutDirEntry = buildFileTree(withoutDirEntry)
const componentsInferred = treeWithoutDirEntry.find((n) => n.name === "components")
if (!componentsInferred || componentsInferred.type !== "directory" || componentsInferred.children.length !== 2) {
  throw new Error("directory was not inferred from a file's parent segment")
}

// Expansion state.
if (EMPTY_TREE_EXPANSION.size !== 0) throw new Error("default expansion state must be empty")
const expanded = toggleTreeDirectory(EMPTY_TREE_EXPANSION, "components")
if (!expanded.has("components")) throw new Error("toggle did not expand")
const collapsed = toggleTreeDirectory(expanded, "components")
if (collapsed.has("components")) throw new Error("toggle did not collapse back")
if (expanded.has("components") !== true || EMPTY_TREE_EXPANSION.has("components")) throw new Error("toggle mutated the input set")

if (designFilesTreeStorageKey("ws-1") !== "unifia:design-files-tree:v1:ws-1") throw new Error("storage key format changed")

const serialized = serializeTreeExpansion(expanded)
const roundtripped = deserializeTreeExpansion(serialized)
if (!roundtripped || !roundtripped.has("components") || roundtripped.size !== 1) throw new Error("expansion state did not round-trip")

if (deserializeTreeExpansion("not json") !== null) throw new Error("malformed JSON must deserialize to null")
if (deserializeTreeExpansion('{"a":1}') !== null) throw new Error("non-array JSON must deserialize to null")
if (deserializeTreeExpansion('["ok", 1]') !== null) throw new Error("array with a non-string entry must deserialize to null")

console.log("DesignFilesTree: 16/16 passed")
})
