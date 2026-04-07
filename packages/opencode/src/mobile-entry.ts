/**
 * Minimal entry point for the mobile embedded runtime.
 * Only includes the `serve` command — no TUI, no terminal UI dependencies.
 * Bundled with `bun build --target=bun` for the Android APK.
 */

// On Android, /etc/resolv.conf doesn't exist and is read-only.
// Both musl's getaddrinfo and c-ares (used by Bun) need it for DNS resolution.
// Fix: write a resolv.conf to our data dir and set LOCALDOMAIN to help c-ares,
// plus use Node's dns.setServers() which configures c-ares directly.
import { existsSync, writeFileSync, mkdirSync } from "fs"
import dns from "dns"
import path from "path"
if (!existsSync("/etc/resolv.conf")) {
  try {
    // Configure c-ares DNS servers directly (works in Bun)
    dns.setServers(["8.8.8.8", "8.8.4.4", "1.1.1.1"])
  } catch {}
  try {
    // Also write a resolv.conf for any code that reads it directly
    const home = process.env.HOME || "/tmp"
    const resolvPath = path.join(home, "resolv.conf")
    writeFileSync(resolvPath, "nameserver 8.8.8.8\nnameserver 8.8.4.4\nnameserver 1.1.1.1\n")
  } catch {}
}

import yargs from "yargs"
import { hideBin } from "yargs/helpers"
import { ServeCommand } from "./cli/cmd/serve"
import { Log } from "./util/log"
import { Installation } from "./installation"
import { Database } from "./storage/db"
import { JsonMigration } from "./storage/json-migration"
import { Global } from "./global"
import { Filesystem } from "./util/filesystem"
import { errorMessage } from "./util/error"
import path from "path"
import { EOL } from "os"

process.on("unhandledRejection", (e) => {
  Log.Default.error("rejection", { e: errorMessage(e) })
})

process.on("uncaughtException", (e) => {
  Log.Default.error("exception", { e: errorMessage(e) })
})

const args = hideBin(process.argv)

const cli = yargs(args)
  .scriptName("opencode")
  .wrap(100)
  .help("help")
  .version(Installation.VERSION)
  .option("print-logs", { describe: "print logs to stderr", type: "boolean" })
  .option("log-level", { describe: "log level", type: "string", choices: ["DEBUG", "INFO", "WARN", "ERROR"] })
  .middleware(async (opts) => {
    await Log.init({
      print: process.argv.includes("--print-logs"),
      dev: false,
      level: (opts.logLevel as Log.Level) ?? "INFO",
    })

    process.env.AGENT = "1"
    process.env.OPENCODE = "1"
    process.env.OPENCODE_CLIENT = process.env.OPENCODE_CLIENT ?? "mobile-embedded"

    Log.Default.info("opencode-mobile", {
      version: Installation.VERSION,
      args: process.argv.slice(2),
    })

    // Run database migration if needed
    const marker = path.join(Global.Path.data, "opencode.db")
    if (!(await Filesystem.exists(marker))) {
      process.stderr.write("Performing database migration..." + EOL)
      await JsonMigration.run(Database.Client().$client, {})
      process.stderr.write("Database migration complete." + EOL)
    }
  })
  .command(ServeCommand)
  .strict()

try {
  await cli.parseAsync()
} catch (e) {
  Log.Default.error("fatal", { e: errorMessage(e) })
  process.exit(1)
}
