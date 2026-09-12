#!/usr/bin/env node
/* SPDX-License-Identifier: MIT */

/**
 * TerminalProvider must sit at directory scope, above BOTH route trees.
 *
 * WHY this guard exists: `useTerminal()` throws outright when no provider is
 * an ancestor (createSimpleContext's `use()` — packages/ui/src/context/helper.tsx).
 * TerminalProvider used to live in `SessionProviders`, which wraps SessionRoute
 * only, while Design's Terminal tab renders TerminalPanel under
 * WorkbenchModeRoute — a sibling route. Clicking "Terminal" in the Design
 * workshop therefore threw the moment the tab mounted, and nothing caught it:
 * this repo unit-tests pure helpers, not Solid component trees, so no suite
 * could have. The failure is a provider-scope mistake, which is exactly the
 * shape a static check can pin.
 */

import { readFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const read = (relative) => readFileSync(path.join(root, relative), "utf8")

const failures = []

const directoryLayout = read("packages/app/src/pages/directory-layout.tsx")
if (!/<TerminalProvider>/.test(directoryLayout)) {
  failures.push("packages/app/src/pages/directory-layout.tsx no longer mounts <TerminalProvider>; every route below it that renders a terminal will throw")
}

const app = read("packages/app/src/app.tsx")
const sessionProviders = app.slice(app.indexOf("function SessionProviders"), app.indexOf("function SessionProviders") + 800)
if (/<TerminalProvider>/.test(sessionProviders)) {
  failures.push("packages/app/src/app.tsx mounts <TerminalProvider> inside SessionProviders again; that wrapper covers SessionRoute only, so WorkbenchModeRoute loses the context")
}

// Any consumer of useTerminal() must be reachable from the directory-scoped
// provider. Both route trees hang off DirectoryLayout, so the only way to break
// this is to mount a terminal consumer outside it entirely.
const consumers = ["packages/app/src/pages/session/terminal-panel.tsx", "packages/app/src/pages/workbench/design-surface.tsx"]
for (const relative of consumers) {
  const source = read(relative)
  if (!/useTerminal\(|TerminalPanel/.test(source)) {
    failures.push(`${relative} no longer references the terminal; update this guard's consumer list or restore the usage`)
  }
}

if (failures.length > 0) {
  for (const failure of failures) process.stderr.write(`TerminalProviderScopeGuard: ${failure}\n`)
  process.exit(1)
}

process.stdout.write("TerminalProviderScopeGuard: TerminalProvider covers both the session and workbench routes\n")
