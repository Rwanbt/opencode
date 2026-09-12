#!/usr/bin/env node
// Emits the TypeScript and Rust views of config/identity.json.
//
// Both languages need the same product names, app IDs, protocols and paths, and
// before this they each carried their own copy. The manifest is the one place
// those values are decided; these outputs are derived and must not be edited.

import { readFileSync, writeFileSync, mkdirSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..", "..")
const identity = JSON.parse(readFileSync(join(REPO, "config", "identity.json"), "utf8"))

const HEADER = `Generated from config/identity.json by scripts/identity/generate.mjs.
Do not edit: run \`bun run identity:generate\` after changing the manifest.`

const quote = (value) => JSON.stringify(value)
const list = (values) => values.map(quote).join(", ")

function typescript() {
  const { product, protocols, cli, surfaces, env } = identity
  const surfaceLines = Object.entries(surfaces)
    .map(([key, s]) => `  ${quote(key)}: { displayName: ${quote(s.displayName)}, appId: ${quote(s.appId)} },`)
    .join("\n")
  return `${HEADER.split("\n")
    .map((line) => `// ${line}`)
    .join("\n")}

export const IDENTITY = {
  product: {
    name: ${quote(product.name)},
    vendor: ${quote(product.vendor)},
    dataDirName: ${quote(product.dataDirName)},
    configDirName: ${quote(product.configDirName)},
    databaseFile: ${quote(product.databaseFile)},
  },
  protocols: {
    /** The only scheme Unifia registers with the OS. */
    owned: [${list(protocols.owned)}] as const,
    /** Accepted by the import flow only — never registered, never claimed. */
    parseOnly: [${list(protocols.parseOnly)}] as const,
  },
  cli: {
    command: ${quote(cli.command)},
    windowsBinary: ${quote(cli.windowsBinary)},
    npmPackage: ${quote(cli.npmPackage)},
    scope: ${quote(cli.scope)},
  },
  surfaces: {
${surfaceLines}
  },
  env: {
    prefix: ${quote(env.prefix)},
    legacyPrefix: ${quote(env.legacyPrefix)},
    /** Must never fall back to the legacy prefix: ports, storage, credentials. */
    isolated: [${list(env.classes.isolated)}] as const,
    /** May read the legacy name as a fallback — preferences, not identity. */
    safeDualRead: [${list(env.classes.safeDualRead)}] as const,
    /** Read only by the explicit legacy import. */
    migrationOnly: [${list(env.classes.migrationOnly)}] as const,
  },
} as const

export type IdentitySurface = keyof typeof IDENTITY.surfaces
`
}

function rust() {
  const { product, protocols, cli, surfaces } = identity
  const surfaceConsts = Object.entries(surfaces)
    .map(([key, s]) => {
      const name = key.toUpperCase().replace(/-/g, "_")
      return `pub const ${name}_APP_ID: &str = ${quote(s.appId)};\npub const ${name}_DISPLAY_NAME: &str = ${quote(s.displayName)};`
    })
    .join("\n")
  return `${HEADER.split("\n")
    .map((line) => `// ${line}`)
    .join("\n")}

#![allow(dead_code)]

pub const PRODUCT_NAME: &str = ${quote(product.name)};
pub const VENDOR: &str = ${quote(product.vendor)};
pub const DATA_DIR_NAME: &str = ${quote(product.dataDirName)};
pub const CONFIG_DIR_NAME: &str = ${quote(product.configDirName)};
pub const DATABASE_FILE: &str = ${quote(product.databaseFile)};

pub const CLI_COMMAND: &str = ${quote(cli.command)};
pub const CLI_WINDOWS_BINARY: &str = ${quote(cli.windowsBinary)};

/// The only scheme Unifia registers with the OS.
pub const OWNED_PROTOCOLS: [&str; ${protocols.owned.length}] = [${list(protocols.owned)}];
/// Accepted by the import flow only — never registered, never claimed.
pub const PARSE_ONLY_PROTOCOLS: [&str; ${protocols.parseOnly.length}] = [${list(protocols.parseOnly)}];

${surfaceConsts}
`
}

function emit(relative, contents) {
  const absolute = join(REPO, relative)
  mkdirSync(dirname(absolute), { recursive: true })
  writeFileSync(absolute, contents)
  console.log(`identity: wrote ${relative}`)
}

emit("packages/util/src/identity.generated.ts", typescript())
emit("packages/desktop/src-tauri/src/identity_generated.rs", rust())
