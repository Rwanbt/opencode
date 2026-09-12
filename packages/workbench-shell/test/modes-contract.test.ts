/* SPDX-License-Identifier: MIT */
import { SPEC_TARGETS } from "@unifia/spec-runtime"
import { SHELL_MODES } from "../src/modes.js"
import { test } from "bun:test"

test('modes-contract.test', async () => {

if (SHELL_MODES.join("\0") !== SPEC_TARGETS.join("\0")) {
  throw new Error(`mode registries diverged: shell=${SHELL_MODES.join(",")} spec=${SPEC_TARGETS.join(",")}`)
}
console.log(`ModeContract: ${SHELL_MODES.length}/${SPEC_TARGETS.length} entries aligned`)
})
