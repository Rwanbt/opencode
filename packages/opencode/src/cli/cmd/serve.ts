import { Server } from "../../server/server"
import { cmd } from "./cmd"
import { withNetworkOptions, resolveNetworkOptions } from "../network"
import { Flag } from "../../flag/flag"
import { Workspace } from "../../control-plane/workspace"
import { Project } from "../../project/project"
import { Installation } from "../../installation"
import { AuditLog } from "../../session/audit"

export const ServeCommand = cmd({
  command: "serve",
  builder: (yargs) => withNetworkOptions(yargs),
  describe: "starts a headless opencode server",
  handler: async (args) => {
    if (!Flag.OPENCODE_SERVER_PASSWORD) {
      console.log("Warning: OPENCODE_SERVER_PASSWORD is not set; server is unsecured.")
    }
    const opts = await resolveNetworkOptions(args)
    const server = Server.listen(opts)
    const scheme = process.env.OPENCODE_TLS_CERT_PATH ? "https" : "http"
    console.log(`opencode server listening on ${scheme}://${server.hostname}:${server.port}`)

    // Kick off audit-log retention purger (24h cron, unref()'d). No-op when
    // experimental.audit.enabled === false. Gated at AuditLog.purgeExpired.
    AuditLog.startRetentionTimer()

    await new Promise(() => {})
    await server.stop()
  },
})
