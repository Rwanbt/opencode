/* SPDX-License-Identifier: MIT */

/**
 * Runner for the real-browser end-to-end proof.
 *
 * It bundles both sides and hands the server side to Node:
 *
 *   browser-entry.ts      --target=browser--> the script the page executes
 *   browser-e2e-impl.ts   --target=node----> the suite Node runs
 *
 * WHY this indirection exists — two independent constraints meet here:
 *
 * 1. Playwright cannot drive Chromium under Bun. Its default transport is
 *    `--remote-debugging-pipe`, which needs stdio file descriptors 3 and 4 that
 *    Bun does not wire on Windows, so the browser starts and the handshake
 *    hangs to the launch timeout. Attaching over a TCP debugging port instead
 *    gets as far as `DevTools listening on ws://...` with `/json/version`
 *    answering 200, and then `connectOverCDP` fails with
 *    `Timeout 30000ms exceeded / <ws connecting>` — playwright-core's websocket
 *    client does not complete a handshake under Bun either. The suite therefore
 *    has to run under Node, which is also the convention already used by
 *    packages/browser-runtime/test/playwright-driver.e2e.ts.
 *
 * 2. Node cannot load the workspace sources directly. Type stripping itself
 *    works through the workspace symlinks, but the packages import siblings
 *    with `.js` specifiers that point at `.ts` files (`./runtime.js` ->
 *    `runtime.ts`). Bun rewrites those; Node's resolver does not and fails with
 *    ERR_MODULE_NOT_FOUND. Bundling with `bun build` resolves them at build
 *    time and emits plain JavaScript Node can run.
 *
 * Playwright stays external: it is a native package that must be required from
 * node_modules, not inlined.
 */

import { spawnSync } from "node:child_process"
import { mkdir, rm } from "node:fs/promises"
import path from "node:path"

const here = import.meta.dirname
// WHY inside the package and not a temp directory: playwright stays external,
// and Node resolves a bare specifier by walking up from the importing file. A
// bundle in the system temp directory finds no node_modules and fails with
// ERR_MODULE_NOT_FOUND — neither cwd nor NODE_PATH applies to ESM resolution.
const outputDirectory = path.join(here, "..", ".e2e-build")
await mkdir(outputDirectory, { recursive: true })

try {
  const browserBundle = await Bun.build({ entrypoints: [path.join(here, "browser-entry.ts")], target: "browser", minify: false })
  if (!browserBundle.success) throw new Error(`browser bundle failed:\n${browserBundle.logs.join("\n")}`)
  const browserBundlePath = path.join(outputDirectory, "page.js")
  await Bun.write(browserBundlePath, await browserBundle.outputs[0].text())

  const suiteBundle = await Bun.build({
    entrypoints: [path.join(here, "browser-e2e-impl.ts")],
    target: "node",
    external: ["playwright"],
    minify: false,
  })
  if (!suiteBundle.success) throw new Error(`suite bundle failed:\n${suiteBundle.logs.join("\n")}`)
  const suitePath = path.join(outputDirectory, "suite.mjs")
  await Bun.write(suitePath, await suiteBundle.outputs[0].text())

  const run = spawnSync("node", [suitePath], {
    stdio: "inherit",
    cwd: path.join(here, ".."),
    env: { ...process.env, UNIFIA_E2E_BROWSER_BUNDLE: browserBundlePath },
  })
  if (run.status !== 0) throw new Error(`browser e2e failed with exit code ${run.status}`)
} finally {
  await rm(outputDirectory, { recursive: true, force: true })
}
