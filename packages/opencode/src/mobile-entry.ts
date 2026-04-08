/**
 * Minimal entry point for the mobile embedded runtime.
 * Only includes the `serve` command — no TUI, no terminal UI dependencies.
 * Bundled with `bun build --target=bun` for the Android APK.
 */
import { existsSync, writeFileSync, mkdirSync, readdirSync, readFileSync } from "fs"
import dns from "dns"
import { join as pathJoin, dirname } from "path"

// ─── Android environment bootstrap ────────────────────────────────────
// The musl dynamic linker doesn't forward env vars from Rust's Command::env().
// Rust writes them to .env_vars; we read and apply them here.
const scriptPath = process.argv[1] || import.meta.path
const runtimeDir = dirname(scriptPath)

// Load env vars written by Rust runtime.rs
const envFile = pathJoin(runtimeDir, ".env_vars")
if (existsSync(envFile)) {
  try {
    const content = readFileSync(envFile, "utf8")
    for (const line of content.split("\n")) {
      const eq = line.indexOf("=")
      if (eq > 0) {
        const key = line.slice(0, eq)
        const val = line.slice(eq + 1)
        if (!process.env[key]) process.env[key] = val
      }
    }
  } catch {}
}

// Fallback: derive from script location if .env_vars was missing
if (!process.env.HOME) process.env.HOME = pathJoin(runtimeDir, "home")
const homeDir = process.env.HOME!

// Ensure HOME dirs exist
try { mkdirSync(pathJoin(homeDir, ".opencode"), { recursive: true }) } catch {}
try { mkdirSync(pathJoin(homeDir, ".config", "opencode"), { recursive: true }) } catch {}
try { mkdirSync(pathJoin(homeDir, ".local", "share"), { recursive: true }) } catch {}
try { mkdirSync(pathJoin(homeDir, ".cache"), { recursive: true }) } catch {}

// XDG dirs
if (!process.env.XDG_DATA_HOME) process.env.XDG_DATA_HOME = pathJoin(homeDir, ".local/share")
if (!process.env.XDG_STATE_HOME) process.env.XDG_STATE_HOME = pathJoin(homeDir, ".local/state")
if (!process.env.XDG_CACHE_HOME) process.env.XDG_CACHE_HOME = pathJoin(homeDir, ".cache")
if (!process.env.XDG_CONFIG_HOME) process.env.XDG_CONFIG_HOME = pathJoin(homeDir, ".config")

// ─── TLS: CA certificate bundle ─────────────────────────────────────
if (!process.env.SSL_CERT_FILE) {
  const caBundlePath = pathJoin(runtimeDir, "ca-certificates.crt")
  if (existsSync(caBundlePath)) {
    process.env.SSL_CERT_FILE = caBundlePath
    process.env.NODE_EXTRA_CA_CERTS = caBundlePath
  } else {
    // Build CA bundle from Android system certs
    const certDirs = ["/system/etc/security/cacerts", "/system/etc/security/cacerts_google"]
    let bundle = ""
    for (const dir of certDirs) {
      try {
        for (const f of readdirSync(dir)) {
          try {
            const content = readFileSync(pathJoin(dir, f), "utf8")
            if (content.includes("BEGIN CERTIFICATE")) {
              bundle += content
              if (!content.endsWith("\n")) bundle += "\n"
            }
          } catch {}
        }
      } catch {}
    }
    if (bundle.length > 0) {
      try {
        writeFileSync(caBundlePath, bundle)
        process.env.SSL_CERT_FILE = caBundlePath
        process.env.NODE_EXTRA_CA_CERTS = caBundlePath
      } catch {}
    }
  }
}

// ─── DNS: Configure c-ares resolver ──────────────────────────────────
if (!existsSync("/etc/resolv.conf")) {
  const servers = ["8.8.8.8", "8.8.4.4", "1.1.1.1"]
  try { dns.setServers(servers) } catch {}
  try {
    const resolvPath = process.env.RESOLV_CONF || pathJoin(runtimeDir, "resolv.conf")
    writeFileSync(resolvPath, servers.map(s => `nameserver ${s}`).join("\n") + "\n")
  } catch {}
}

process.stderr.write(`[BOOT] HOME=${process.env.HOME} proxy=${process.env.HTTPS_PROXY || "none"}\n`)

// ─── Proxy-aware fetch: monkey-patch global fetch to use local CONNECT proxy ──
// musl's getaddrinfo can't resolve DNS on Android (no /etc/resolv.conf).
// Route all external fetch() through our Rust CONNECT proxy which uses Android's DNS.
if (process.env.HTTPS_PROXY) {
  const proxyUrl = new URL(process.env.HTTPS_PROXY)
  const proxyHost = proxyUrl.hostname
  const proxyPort = parseInt(proxyUrl.port, 10)
  const originalFetch = globalThis.fetch

  process.stderr.write(`[PROXY] Patching fetch() to use proxy ${proxyHost}:${proxyPort}\n`)

  ;(globalThis as any).fetch = async (input: any, init?: any): Promise<Response> => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url)

    // Don't proxy local connections
    if (url.hostname === "127.0.0.1" || url.hostname === "localhost") {
      return originalFetch(input, init)
    }

    // Use Bun's proxy support via the proxy option
    return originalFetch(input, {
      ...init,
      proxy: `http://${proxyHost}:${proxyPort}`,
    } as any)
  }
}

// ─── Server startup ──────────────────────────────────────────────────
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
