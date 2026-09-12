/* SPDX-License-Identifier: MIT */

import { createWorkbenchTaskIdentity } from "../src/identity.js"
import { test } from "bun:test"

test('identity.test', async () => {

const identity = createWorkbenchTaskIdentity({ codeSessionId: "code-1", workbenchSessionId: "wb-1", operationId: "op-1" })
if (identity.codeSessionId !== "code-1" || identity.workbenchSessionId !== "wb-1" || identity.operationId !== "op-1") throw new Error("task identity fields were not preserved")
let failed = false
try { createWorkbenchTaskIdentity({ workbenchSessionId: "" }) } catch { failed = true }
if (!failed) throw new Error("missing workbench identity was accepted")
console.log("WorkbenchIdentity: 2/2 passed")
})
