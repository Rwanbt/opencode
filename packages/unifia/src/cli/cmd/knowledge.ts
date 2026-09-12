/* SPDX-License-Identifier: MIT */
/**
 * `unifia knowledge` — the Sovereign Knowledge Core, reachable from the CLI.
 *
 * This command is what makes the knowledge core part of the product. Before
 * it, the core lived in `bin/unifia-knowledge.ts`, which was neither an
 * entrypoint of `script/build.ts` (that compiles `src/index.ts` alone) nor
 * declared in `package.json`'s `bin`. Nothing outside `src/knowledge/`
 * imported it, so the bundler dropped the whole module: a search of the built
 * 185 MB sidecar returned zero hits for `control-log.jsonl`,
 * `unifia_restrictions` and `egress.decision`. 883 green tests, four
 * counter-reviews, and the feature was not in the shipped binary.
 *
 * The subcommands are dispatched by `runKnowledgeCli` rather than declared to
 * yargs one by one: there are more than forty of them, they already have a
 * usage screen, and duplicating that list here would create a second place to
 * forget one.
 */

import { cmd } from "./cmd"
import { runKnowledgeCli } from "../knowledge/main"

export const KnowledgeCommand = cmd({
  command: "knowledge [args..]",
  describe: "sovereign knowledge core — search, inspect and govern the vault",
  builder: (yargs) =>
    yargs
      .positional("args", { type: "string", array: true, default: [] as string[] })
      .help(false)
      .version(false)
      .strict(false),
  async handler() {
    // Read the raw argv rather than the parsed positionals. The knowledge CLI
    // has its own flag grammar — `--workspace <path>`, `--limit=N`, bare
    // switches — and yargs would consume those before the dispatcher saw
    // them, so a command would silently run against the wrong workspace.
    // Taking everything after the `knowledge` token hands the subcommand
    // exactly what it would have received as a standalone binary.
    const raw = process.argv.slice(2)
    const at = raw.indexOf("knowledge")
    process.exitCode = await runKnowledgeCli(at === -1 ? [] : raw.slice(at + 1))
  },
})
