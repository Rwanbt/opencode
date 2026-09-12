/* SPDX-License-Identifier: MIT */

import { adaptDesignFiles, createDesignFilesPanelState, nextSelectedPathAfterRemove, nextSelectedPathAfterRename, renderDesignFileRows } from "../src/design-files.js"
import { test } from "bun:test"

test('design-files.test', async () => {

const page = { entries: [
  { path: "zeta.ts", kind: "file" as const, size: 1, modifiedAt: 2 },
  { path: "assets/logo.svg", kind: "file" as const, size: 2, modifiedAt: 3 },
  { path: "styles/theme.css", kind: "file" as const, size: 3, modifiedAt: 4 },
  { path: "components/Card.tsx", kind: "file" as const, size: 4, modifiedAt: 5 },
  { path: "components", kind: "directory" as const, size: 0, modifiedAt: 5 },
] }
const files = adaptDesignFiles(page)
if (files.length !== 4 || files[0]?.path !== "assets/logo.svg") throw new Error("design file adapter did not filter/sort files")
if (files.find((file) => file.path === "assets/logo.svg")?.kind !== "asset") throw new Error("asset kind was not inferred")
if (files.find((file) => file.path === "components/Card.tsx")?.kind !== "component") throw new Error("component kind was not inferred")
if (createDesignFilesPanelState(page, "missing.ts").selectedPath !== undefined) throw new Error("panel selected an absent file")
const selected = createDesignFilesPanelState(page, "styles/theme.css")
if (selected.selectedPath !== "styles/theme.css") throw new Error("panel did not preserve a valid selection")
if (renderDesignFileRows(selected).find((row) => row.path === "styles/theme.css")?.selected !== true) throw new Error("panel did not render the selected row")

// Phase 7.3 — porte: rename follows the open selection, delete clears it.
if (nextSelectedPathAfterRename("styles/theme.css", "styles/theme.css", "styles/dark.css") !== "styles/dark.css") throw new Error("rename did not follow the selected path")
if (nextSelectedPathAfterRename("components/Card.tsx", "styles/theme.css", "styles/dark.css") !== "components/Card.tsx") throw new Error("rename touched an unrelated selection")
if (nextSelectedPathAfterRename(undefined, "styles/theme.css", "styles/dark.css") !== undefined) throw new Error("rename invented a selection out of nothing")
if (nextSelectedPathAfterRemove("styles/theme.css", ["styles/theme.css"]) !== undefined) throw new Error("delete of the active file did not clear the selection")
if (nextSelectedPathAfterRemove("components/Card.tsx", ["styles/theme.css"]) !== "components/Card.tsx") throw new Error("delete of an unrelated file touched the selection")
if (nextSelectedPathAfterRemove(undefined, ["styles/theme.css"]) !== undefined) throw new Error("delete invented a selection out of nothing")

console.log("DesignFiles: 12/12 passed")
})
