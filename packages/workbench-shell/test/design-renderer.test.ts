/* SPDX-License-Identifier: MIT */

import { parseSpec } from "@unifia/spec-runtime"
import { renderDesignSpecSvg } from "../src/design-renderer.js"
import { test } from "bun:test"

test('design-renderer.test', async () => {

const spec = parseSpec({ id: "render-card", version: "1.0.0", target: "design", title: "<Card>", capabilities: [], rules: [{ id: "safe-copy", statement: "Use & keep it readable" }], tokens: { colors: { primary: "#abcdef", foreground: "#123456" }, spacing: { gutter: 32 } } })
const first = renderDesignSpecSvg(spec, { width: 640, height: 480 })
const second = renderDesignSpecSvg(spec, { width: 640, height: 480 })
if (first !== second) throw new Error("design renderer was not deterministic")
if (!first.startsWith('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 480"')) throw new Error("renderer dimensions were not canonical")
if (!first.includes("&lt;Card&gt;") || !first.includes("Use &amp; keep it readable")) throw new Error("renderer did not escape untrusted text")
if (!first.includes('fill="#abcdef"') || !first.includes('x="32"')) throw new Error("renderer did not apply validated design tokens")
console.log("DesignRenderer: 5/5 passed")
})
