// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Unifia contributors
//
// Original work. No upstream derivation.
//
// Enforces the security policy declared in:
//   docs/adr/1035-untrusted-artifact-rendering.md  (sandbox contract)
//   docs/adr/1036-csp-artifact-frame.md             (CSP for the artifact frame)
//
// Run from the repository root:
//   node scripts/check-workbench-security.mjs
//
// Test-only mode (used by scripts/tests/check-workbench-security.Tests.ps1):
//   node scripts/check-workbench-security.mjs --assert-csp "<csp-string>" <config-name>

import { readdir, readFile } from "node:fs/promises"
import { fileURLToPath } from "node:url"
import { join, relative } from "node:path"

const SELF_PATH = relative(process.cwd(), fileURLToPath(import.meta.url)).replace(/\\/g, "/")
// Files in the guard's own neighbourhood. The guard's source contains the
// literal string in its regex and error messages, and its test file
// constructs fixtures that contain it. Both are by design and are not policy
// violations; any *other* file in the worktree containing the string is.
const SELF_RELATED_PATHS = new Set([
  SELF_PATH,
  "scripts/tests/check-workbench-security.Tests.ps1",
])

const FILES = {
  server: "packages/workbench-server/src/security.ts",
  desktop: "packages/desktop/src-tauri/tauri.conf.json",
  mobile: "packages/mobile/src-tauri/tauri.conf.json",
}
const REQUIRED_ORIGINS = ["https://tauri.localhost", "http://ipc.localhost"]
const ALLOW_SAME_ORIGIN_REGEX = /allow-same-origin/
const WORKTREE_SCAN_DIRS = ["packages", "scripts"]
const SKIP_DIRS = new Set([
  "node_modules",
  ".git",
  "dist",
  "build",
  "target",
  ".next",
  ".turbo",
  ".unifia",
  ".opencode",
  ".gstack",
  "test-results",
  "QA_RESULTS",
])

function parseDirectives(csp) {
  return new Map(
    csp.split(";").map((part) => {
      const tokens = part.trim().split(/\s+/)
      return [tokens[0], tokens.slice(1)]
    })
  )
}

function directiveHas(directives, name, token) {
  return Boolean(directives.get(name)?.includes(token))
}

function assertCsp(name, csp) {
  if (typeof csp !== "string") {
    throw new Error(`${name} has no extractable CSP`)
  }
  const directives = parseDirectives(csp)
  if (!directiveHas(directives, "connect-src", "http://127.0.0.1:*")) {
    throw new Error(`${name} is missing loopback connect-src`)
  }
  if (!directiveHas(directives, "img-src", "data:")) {
    throw new Error(`${name} is missing data image source`)
  }
  if (directives.get("object-src")?.join(" ") !== "'none'") {
    throw new Error(`${name} has an unsafe object-src`)
  }
  if (directives.get("frame-ancestors")?.join(" ") !== "'none'") {
    throw new Error(`${name} has an unsafe frame-ancestors policy`)
  }
  if (!directiveHas(directives, "frame-src", "'self'") || !directiveHas(directives, "frame-src", "data:")) {
    throw new Error(`${name} is missing frame-src 'self' data:`)
  }
  if (!directiveHas(directives, "child-src", "'self'") || !directiveHas(directives, "child-src", "data:")) {
    throw new Error(`${name} is missing child-src 'self' data:`)
  }
}

async function* walk(dir) {
  for await (const entry of await readdir(dir, { withFileTypes: true })) {
    if (SKIP_DIRS.has(entry.name)) continue
    const full = join(dir, entry.name)
    if (entry.isDirectory()) {
      yield* walk(full)
    } else {
      yield full
    }
  }
}

function isBinaryContent(content) {
  // A null byte in the first 4KB is a strong binary indicator. Source code
  // never contains \0; bundled executables, images, fonts, wasm, etc. do.
  return content.includes("\0", 0)
}

async function assertNoAllowSameOrigin() {
  for (const dir of WORKTREE_SCAN_DIRS) {
    for await (const file of walk(dir)) {
      if (SELF_RELATED_PATHS.has(file.replace(/\\/g, "/"))) continue
      let content
      try {
        content = await readFile(file, "utf8")
      } catch {
        continue
      }
      if (isBinaryContent(content.slice(0, 4096))) continue
      if (ALLOW_SAME_ORIGIN_REGEX.test(content)) {
        throw new Error(
          `'allow-same-origin' found in ${relative(process.cwd(), file)} — sandbox must never grant same-origin access (see ADR-1035)`
        )
      }
    }
  }
}

async function runAssertions() {
  const contents = Object.fromEntries(
    await Promise.all(
      Object.entries(FILES).map(async ([key, file]) => [key, await readFile(file, "utf8")])
    )
  )

  for (const origin of REQUIRED_ORIGINS) {
    for (const [name, source] of Object.entries(contents)) {
      if (!source.includes(origin)) {
        throw new Error(`${name} is missing ${origin}`)
      }
    }
  }
  if (/access-control-allow-origin["']?\s*[:=]\s*["']\*["']/i.test(contents.server)) {
    throw new Error("server contains wildcard credential CORS")
  }
  for (const name of ["desktop", "mobile"]) {
    const config = JSON.parse(contents[name])
    assertCsp(name, config.app?.security?.csp)
  }
  await assertNoAllowSameOrigin()
}

async function main() {
  if (process.argv[2] === "--assert-csp") {
    const csp = process.argv[3]
    const name = process.argv[4] ?? "test"
    try {
      assertCsp(name, csp)
      console.log(`assertCsp OK for ${name}`)
    } catch (e) {
      console.error(e.message)
      process.exit(1)
    }
    return
  }

  try {
    await runAssertions()
  } catch (e) {
    console.error(e.message)
    process.exit(1)
  }
  console.log(
    "WorkbenchSecurityGuard: source and packaged CSPs enforce explicit origins, data images, object-src none, frame-ancestors none, frame-src self data, child-src self data, no allow-same-origin in packages/ or scripts/"
  )
}

main()
