/* SPDX-License-Identifier: MIT */

/**
 * Browser entry point for the end-to-end proof.
 *
 * It imports the real consumer rather than reimplementing it, so the browser
 * runs exactly the code the unit suite exercises. It holds no credentials: the
 * harness origin owns the tokens and forwards to the workbench.
 */

import { mountGenerativeUi, type DispatchedAction } from "../src/index.js"

declare global {
  interface Window {
    __unifiaLastResult?: { status: number; body: unknown }
  }
}

const ALLOWED_ACTIONS = new Set(["ui.run"])

const dispatcher = {
  async dispatch(action: DispatchedAction): Promise<void> {
    const response = await fetch("/action", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(action) })
    window.__unifiaLastResult = { status: response.status, body: await response.json() }
  },
}

const container = document.getElementById("root")
if (!container) throw new Error("mount container is missing")

const description = await (await fetch("/ui")).json() as { rendered: unknown }
mountGenerativeUi(description.rendered, container, { allowedActions: ALLOWED_ACTIONS, dispatcher, document })
