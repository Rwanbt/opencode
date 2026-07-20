import { Plugin } from "../plugin"
import { Format } from "../format"
import { LSP } from "../lsp"
import { File } from "../file"
import { FileWatcher } from "../file/watcher"
import { Snapshot } from "../snapshot"
import { Project } from "./project"
import { Vcs } from "./vcs"
import { Bus } from "../bus"
import { Command } from "../command"
import { Instance } from "./instance"
import { Log } from "@/util/log"
import { ShareNext } from "@/share/share-next"

export async function InstanceBootstrap() {
  Log.Default.info("bootstrapping", { directory: Instance.directory })
  await Plugin.init()
  ShareNext.init()
  Format.init()
  await LSP.init()
  // FORK (LSP-SAVE-LATENCY, P2): fire-and-forget — must never delay project open.
  // init() only prepares config-aware server state (no spawn); warmup() is what
  // actually starts the project's dominant-language server(s) in the background,
  // so a first save doesn't pay the full cold-spawn+initialize cost.
  // FORK (LSP-TEST-SUITE-REGRESSION): see test/preload.ts — the test suite
  // disables this by default (thousands of short-lived Instance.provide()
  // calls would otherwise each spawn a real language-server process).
  if (process.env["OPENCODE_DISABLE_LSP_WARMUP"] !== "true") {
    void LSP.warmup().catch((err) => Log.Default.warn("LSP warmup failed", { error: err }))
  }
  File.init()
  FileWatcher.init()
  Vcs.init()
  Snapshot.init()

  Bus.subscribe(Command.Event.Executed, async (payload) => {
    if (payload.properties.name === Command.Default.INIT) {
      Project.setInitialized(Instance.project.id)
    }
  })

}
