/* SPDX-License-Identifier: MIT */

import { createDesignPreviewPanelState } from "../src/design-preview.js"
import { createDesignSpecPanelState } from "../src/design-spec.js"
import { test } from "bun:test"

test('design-preview.test', async () => {

const valid = createDesignSpecPanelState({ kind: "inline", value: JSON.stringify({ id: "preview-card", version: "1.0.0", target: "design", title: "Preview", rules: [] }) })
const preview = createDesignPreviewPanelState(valid)
if (preview.previews.length !== 3) throw new Error("preview did not create mobile/tablet/desktop widths")
if (preview.previews[0]?.label !== "mobile" || preview.previews[2]?.width !== 1440) throw new Error("preview widths were not canonical")
if (!preview.previews.every((item) => item.src.startsWith("data:image/svg+xml,"))) throw new Error("preview did not use SVG image sources")

const invalid = createDesignSpecPanelState({ kind: "inline", value: "{}" })
const blocked = createDesignPreviewPanelState(invalid)
if (blocked.previews.length !== 0 || blocked.diagnostics.length !== 1) throw new Error("invalid spec was rendered")
console.log("DesignPreviewPanel: 4/4 passed")
})
