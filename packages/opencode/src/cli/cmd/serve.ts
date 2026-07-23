import { Server } from "../../server/server"
import { cmd } from "./cmd"
import { withNetworkOptions, resolveNetworkOptions } from "../network"
import { Flag } from "../../flag/flag"
import { AuditLog } from "../../session/audit"
import { initAuthStorage } from "../../auth"
import { persistGithubGitConfigForTerminal } from "../../github/credentials"

export const ServeCommand = cmd({
  command: "serve",
  builder: (yargs) => withNetworkOptions(yargs),
  describe: "starts a headless opencode server",
  handler: async (args) => {
    if (!Flag.OPENCODE_SERVER_PASSWORD) {
      console.log("Warning: OPENCODE_SERVER_PASSWORD is not set; server is unsecured.")
    }
    // Sprint 6 item 2 — select auth storage backend at boot.
    //   * OPENCODE_AUTH_STORAGE=keychain + OPENCODE_KEYCHAIN_URL set →
    //     transparently migrates auth.json to the OS keychain via the desktop
    //     sidecar endpoint.
    //   * OPENCODE_AUTH_STORAGE=keychain but URL missing (headless CLI) →
    //     initAuthStorage() detects KeychainStorage.available()===false and
    //     simply no-ops; Auth.layer falls back to FileStorage automatically
    //     (no crash). A warn is emitted from Auth.layer at first access.
    //   * Default (OPENCODE_AUTH_STORAGE=file) → migration rollback path runs
    //     if a prior `auth.json.migrated` exists.
    await initAuthStorage()

    const opts = await resolveNetworkOptions(args)
    const server = Server.listen(opts)
    const scheme = process.env.OPENCODE_TLS_CERT_PATH ? "https" : "http"
    console.log(`opencode server listening on ${scheme}://${server.hostname}:${server.port}`)

    // Mobile only, no-op elsewhere: wire the connected GitHub OAuth session
    // into ~/.gitconfig so the terminal's raw `git push`/`pull` also
    // authenticates, not just the dedicated Git.push()/pull() API. Fire
    // after the server is listening (past all module-init ordering hazards
    // — see mobile-entry.ts's own env-var bootstrap for a bug caused by
    // running similar logic too early).
    await persistGithubGitConfigForTerminal()

    // Kick off audit-log retention purger (24h cron, unref()'d). No-op when
    // experimental.audit.enabled === false. Gated at AuditLog.purgeExpired.
    AuditLog.startRetentionTimer()

    await new Promise(() => {})
    await server.stop()
  },
})
