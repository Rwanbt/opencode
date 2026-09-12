#!/usr/bin/env bun
/* SPDX-License-Identifier: MIT */
/**
 * Direct launcher for the knowledge CLI.
 *
 * The implementation moved to `src/cli/knowledge/` so the main binary can
 * reach it — `src/` must not import `bin/`, and while it lived here the whole
 * Sovereign Knowledge Core was absent from the built sidecar. This file stays
 * so `bun bin/unifia-knowledge.ts <subcommand>` keeps working for anyone with
 * that in their fingers or in a script.
 *
 * Prefer `unifia knowledge <subcommand>`: that path is the one that ships.
 */

import { runKnowledgeCli } from "../src/cli/knowledge/main.js"

await runKnowledgeCli(process.argv.slice(2))
  .then((code) => process.exit(code))
  .catch((err) => {
    process.stderr.write(`error: ${(err as Error).message}\n`)
    process.exit(1)
  })
