#!/usr/bin/env node
// Parity gate: every place that names the product must agree with config/identity.json.
//
// The values in the manifest are only authoritative if nothing contradicts them,
// and Tauri configs, the electron-builder config and the generated adapters each
// spell them out separately. This reads the real files and reports every
// disagreement rather than trusting that a past edit reached all of them.

import { execFileSync } from "node:child_process"
import { readFileSync, existsSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..", "..")
const identity = JSON.parse(readFileSync(join(REPO, "config", "identity.json"), "utf8"))
const problems = []

const read = (relative) => readFileSync(join(REPO, relative), "utf8")

/**
 * Source with comments removed.
 *
 * Scanning raw text made the checker flag the comment that explains why a call
 * is absent — the words it looks for appear in the explanation. Only real code
 * should be able to fail a gate.
 */
const readCode = (relative) =>
  read(relative)
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1")

function expect(condition, message) {
  if (!condition) problems.push(message)
}

function checkTauriSurface(key, surface) {
  if (!existsSync(join(REPO, surface.file))) {
    problems.push(`${key}: ${surface.file} is missing`)
    return
  }
  const config = JSON.parse(read(surface.file))
  expect(
    config.identifier === surface.appId,
    `${key}: ${surface.file} identifier is "${config.identifier}", manifest says "${surface.appId}"`,
  )
  expect(
    config.productName === surface.displayName,
    `${key}: ${surface.file} productName is "${config.productName}", manifest says "${surface.displayName}"`,
  )
  if (surface.mainBinaryName) {
    expect(
      config.mainBinaryName === surface.mainBinaryName,
      `${key}: mainBinaryName is "${config.mainBinaryName}", manifest says "${surface.mainBinaryName}"`,
    )
  }
  if (surface.sidecar) {
    const bins = config.bundle?.externalBin ?? []
    expect(bins.includes(surface.sidecar), `${key}: externalBin does not include "${surface.sidecar}"`)
  }
}

function checkElectronSurfaces() {
  const source = readCode("packages/desktop-electron/electron-builder.config.ts")
  const declared = [...source.matchAll(/appId:\s*"([^"]+)"/g)].map((match) => match[1])
  const expected = Object.entries(identity.surfaces)
    .filter(([key]) => key.startsWith("electron-"))
    .map(([, surface]) => surface.appId)
  for (const appId of expected) {
    expect(
      declared.includes(appId),
      `electron-builder.config.ts declares no appId "${appId}" (found: ${declared.join(", ") || "none"})`,
    )
  }
  for (const appId of declared) {
    expect(
      expected.includes(appId),
      `electron-builder.config.ts declares appId "${appId}", which the manifest does not list`,
    )
  }
  const names = [...source.matchAll(/productName:\s*"([^"]+)"/g)].map((match) => match[1])
  for (const [key, surface] of Object.entries(identity.surfaces)) {
    if (!key.startsWith("electron-")) continue
    expect(
      names.includes(surface.displayName),
      `electron-builder.config.ts declares no productName "${surface.displayName}" for ${key}`,
    )
  }
}

// electron-builder decides what the installer registers; src/main/index.ts
// decides what the running process actually uses for its profile directory.
// Checking only the former missed that the runtime still resolved userData under
// ai.opencode.desktop — the official app's profile — while the packaging config
// had already been corrected.
function checkElectronRuntime() {
  const file = "packages/desktop-electron/src/main/index.ts"
  const source = readCode(file)
  const declared = [...source.matchAll(/"(ai\.[a-z0-9.]+)"/g)].map((match) => match[1])
  const expected = Object.entries(identity.surfaces)
    .filter(([key]) => key.startsWith("electron-"))
    .map(([, surface]) => surface.appId)

  for (const appId of expected) {
    expect(declared.includes(appId), `${file} does not use the app id "${appId}"`)
  }
  for (const appId of declared) {
    expect(expected.includes(appId), `${file} uses app id "${appId}", which the manifest does not list`)
  }

  // Preview must not take the protocol association; decision A5 gives it to the
  // stable Tauri desktop.
  for (const scheme of identity.protocols.owned) {
    expect(
      !source.includes(`setAsDefaultProtocolClient("${scheme}")`),
      `${file} registers ${scheme}:// globally — Preview must not claim it`,
    )
    expect(
      !readCode("packages/desktop-electron/electron-builder.config.ts").includes(`schemes: ["${scheme}"]`),
      `electron-builder.config.ts packages a ${scheme}:// association — Preview must not claim it`,
    )
  }
}

// Any app ID under the upstream namespace would make this fork install over the
// official OpenCode app instead of beside it — the whole point of the rebrand.
function checkNoUpstreamNamespace() {
  for (const [key, surface] of Object.entries(identity.surfaces)) {
    expect(!surface.appId.startsWith("ai.opencode."), `${key}: app ID "${surface.appId}" is in the upstream namespace`)
  }
  expect(
    !identity.protocols.owned.includes("opencode"),
    "manifest claims the opencode:// scheme; it must stay parse-only",
  )
}

function checkGeneratedAdaptersAreCurrent() {
  const outputs = ["packages/util/src/identity.generated.ts", "packages/desktop/src-tauri/src/identity_generated.rs"]
  const before = outputs.map((path) => (existsSync(join(REPO, path)) ? read(path) : null))
  execFileSync(process.execPath, [join(REPO, "scripts", "identity", "generate.mjs")], { stdio: "pipe" })
  outputs.forEach((path, index) => {
    expect(before[index] === read(path), `${path} is stale — run: bun run identity:generate`)
  })
}

for (const [key, surface] of Object.entries(identity.surfaces)) {
  if (key.startsWith("tauri-")) checkTauriSurface(key, surface)
}
checkElectronSurfaces()
checkElectronRuntime()
checkNoUpstreamNamespace()
checkGeneratedAdaptersAreCurrent()

if (problems.length > 0) {
  console.error(`identity: ${problems.length} disagreement(s) with config/identity.json\n`)
  for (const problem of problems) console.error(`  ${problem}`)
  process.exit(1)
}
console.log(`identity: ${Object.keys(identity.surfaces).length} surfaces agree with config/identity.json`)
