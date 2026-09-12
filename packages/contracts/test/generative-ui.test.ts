/* SPDX-License-Identifier: MIT */
import { strict as assert } from "node:assert"
import { renderGenerativeUi } from "../src/generative-ui.ts"
const view = renderGenerativeUi({ type: "panel", id: "main", props: { title: "Safe" }, children: [{ type: "button", id: "run", props: { label: "Run", actionId: "run-action", onClick: "javascript:bad" } }] }, new Set(["run-action"]))
assert.equal(view.children[0]?.props.actionId, "run-action"); assert.equal("onClick" in (view.children[0]?.props ?? {}), false)
assert.throws(() => renderGenerativeUi({ type: "button", id: "bad.id" }, new Set()))
assert.throws(() => renderGenerativeUi({ type: "button", id: "bad", props: { actionId: "not-allowed" } }, new Set()))
console.log("GenerativeUiRenderer: 3/3 passed")
