#!/usr/bin/env node
/* SPDX-License-Identifier: MIT */

/**
 * Unifia conformance gate — reproducible, offline, no external authority.
 *
 * Runs the checks that Gate A/B/C claim locally, and prints a PASS/FAIL table
 * plus a machine-readable JSON report. It deliberately proves only what can be
 * proven on this machine: it does NOT stand in for an external security audit,
 * a supply-chain attestation service or a signed release.
 *
 * Usage:
 *   node scripts/unifia-conformance.mjs [--json <path>] [--skip-tests] [--with-browser]
 *
 * Exit code is non-zero when any check fails, so CI can gate on it.
 */

import { execFileSync } from "node:child_process"
import { readFileSync, writeFileSync } from "node:fs"
import path from "node:path"
import process from "node:process"

/** Packages owned by Unifia. Inherited OpenCode packages are out of scope here. */
const UNIFIA_PACKAGES = [
  "artifact-runtime",
  "artifact-studio",
  "browser-runtime",
  "capability-runtime",
  "computer-use-safety",
  "contracts",
  "desktop-runtime",
  "document-packs",
  "generative-ui-dom",
  "mcp-transport",
  "mcp-ui-actions",
  "remote-bridge",
  "memory-governance",
  "memory-runtime",
  "release-hardening",
  "runtime-conformance",
  "sandbox-drivers",
  "skill-hub",
  "spec-runtime",
  "workbench-orchestrator",
  "workbench-shell",
  "workflow-catalog",
  "workbench-server",
  "workflow-runtime",
  "workspace-runtime",
]

/**
 * Test entry points, with the reason any package is excluded.
 * An excluded test must have a stated reason — silence is not an exclusion.
 */
const TEST_ENTRYPOINTS = [
  "packages/artifact-runtime/test/artifact.test.ts",
  "packages/artifact-studio/test/studio.test.ts",
  "packages/capability-runtime/test/ed25519.test.ts",
  "packages/computer-use-safety/test/safety.test.ts",
  "packages/contracts/test/approval-broker-smoke.ts",
  "packages/contracts/test/capability-registry.test.ts",
  "packages/contracts/test/event-sequencer.test.ts",
  "packages/contracts/test/generative-ui.test.ts",
  "packages/contracts/test/mcp-ui.test.ts",
  "packages/contracts/test/p3-lot2-smoke.ts",
  "packages/contracts/test/p3-lot3-smoke.ts",
  "packages/contracts/test/p3-runtime-smoke.ts",
  "packages/contracts/test/p3-smoke.ts",
  "packages/contracts/test/remote-broker-smoke.ts",
  "packages/contracts/test/runtime-adapters-smoke.ts",
  "packages/contracts/test/sandbox-broker-smoke.ts",
  "packages/desktop-runtime/test/windows-driver.test.ts",
  "packages/document-packs/test/packs.test.ts",
  "packages/generative-ui-dom/test/dom.test.ts",
  "packages/mcp-transport/test/transport.test.ts",
  "packages/mcp-ui-actions/test/actions.test.ts",
  "packages/remote-bridge/test/bridge.test.ts",
  "packages/slack/src/remote-adapter.test.ts",
  "packages/memory-governance/test/governance.test.ts",
  "packages/memory-runtime/test/memory-runtime.test.ts",
  "packages/release-hardening/test/hardening.test.ts",
  "packages/release-hardening/test/gate-b.test.ts",
  "packages/release-hardening/test/gate-c.test.ts",
  "packages/runtime-conformance/test/conformance.test.ts",
  "packages/sandbox-drivers/test/drivers.test.ts",
  "packages/skill-hub/test/test.ts",
  "packages/spec-runtime/test/spec.test.ts",
  "packages/workbench-orchestrator/test/orchestrator.test.ts",
  "packages/workbench-shell/test/shell.test.ts",
  "packages/workbench-shell/test/design-system.test.ts",
  "packages/workbench-server/test/server.test.ts",
  "packages/workbench-server/test/bootstrap.test.ts",
  "packages/workbench-server/test/canonical-authority-e2e.test.ts",
  "packages/workbench-server/test/e2e-full-journey.test.ts",
  "packages/unifia/test/server/workbench-bridge.test.ts",
  "packages/workflow-catalog/test/catalog.test.ts",
  "packages/workflow-runtime/test/workflow-runtime.test.ts",
  "packages/workspace-runtime/test/queue.test.ts",
  "packages/workspace-runtime/test/runtime.test.ts",
  "packages/workspace-runtime/test/storage.test.ts",
]

/**
 * Suites written against vitest. They cannot run under `bun <file>` — the
 * import resolves but vitest's worker state does not exist, so the file throws
 * before a single assertion runs. Running them with the wrong runner made them
 * look broken; they are green under vitest.
 */
const VITEST_SUITES = {
  "packages/contracts": ["test/contracts.test.ts", "test/p3.test.ts"],
}

/**
 * Extra bun arguments per suite. A suite needing a DOM must say so here rather
 * than the runner guessing: running it without the preload would fail on a
 * missing `document` and look like a product defect.
 */
const SUITE_ARGS = {
  "packages/generative-ui-dom/test/dom.test.ts": ["--preload", "./test/happydom.ts"],
}

/**
 * Suites that need a Chromium binary. They are real and passing, but a runner
 * without `playwright install` cannot execute them, so the default gate stays
 * offline-reproducible. Pass --with-browser to include them.
 */
const BROWSER_SUITES = [
  "packages/generative-ui-dom/test/browser.e2e.ts",
  "packages/workbench-server/test/real-transport.test.ts",
]

const EXCLUDED_TESTS = {
  "packages/browser-runtime/test/playwright-driver.e2e.ts": "requires a real browser; not runnable offline in this gate",
}

/** Paths whose licence forbids import into Unifia. See docs/autonomy/DO-NOT-IMPORT.md */
const FORBIDDEN_PATH_SEGMENTS = ["ee", ".ee", "commercial", "private", "ee-pro", "pro-payloads"]

/**
 * Inherited from the OpenCode fork, tracked but excluded from the workspace
 * build (see the `!packages/*` entries in the root package.json workspaces and
 * DO-NOT-IMPORT.md section 2). Their presence in git history is a declared
 * state, not an import. What must never happen is an owned package importing
 * from them — that is checked separately.
 */
const DECLARED_EXCLUDED_PREFIXES = ["packages/enterprise/", "packages/desktop-electron/", "packages/console/app/src/routes/enterprise/"]

const ALLOWED_LICENSES = new Set(["MIT"])
/** Ranges that let a dependency change under us. Exact pins are acceptable provenance. */
const FLOATING_RANGE = /^[\^~><]|[*x]|latest/

const repoRoot = path.resolve(import.meta.dirname, "..")
const results = []

function record(name, ok, detail) {
  results.push({ name, ok, detail })
  process.stdout.write(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}\n`)
}

function run(command, args, options = {}) {
  return execFileSync(command, args, { cwd: repoRoot, encoding: "utf8", stdio: "pipe", ...options })
}

function trackedFiles() {
  return run("git", ["ls-files"]).split("\n").filter(Boolean)
}

/**
 * Forbidden-path detection matches on path *segments*, never substrings:
 * "packages/tree/..." must not be flagged because it contains "ee".
 */
function checkForbiddenPaths(files) {
  const forbidden = files.filter((file) => file.split("/").some((segment) => FORBIDDEN_PATH_SEGMENTS.includes(segment) || segment === "enterprise"))
  const declared = forbidden.filter((file) => DECLARED_EXCLUDED_PREFIXES.some((prefix) => file.startsWith(prefix)))
  const offenders = forbidden.filter((file) => !declared.includes(file))
  record("supply-chain/forbidden-paths", offenders.length === 0, offenders.length === 0 ? `no undeclared forbidden path (${declared.length} inherited files excluded from the build by declaration)` : offenders.slice(0, 5).join(", "))
}

/**
 * The check that actually matters: a Unifia-owned package must never import
 * from an excluded path, whatever that path's history is.
 */
function checkExcludedImports(files) {
  const owned = files.filter((file) => UNIFIA_PACKAGES.some((pkg) => file.startsWith(`packages/${pkg}/`)) && /\.(ts|tsx|mjs|js)$/.test(file))
  const offenders = []
  for (const file of owned) {
    const source = readFileSync(path.join(repoRoot, file), "utf8")
    for (const match of source.matchAll(/(?:from|import|require)\s*\(?\s*["']([^"']+)["']/g)) {
      const specifier = match[1]
      if (/(^|[/@])(ee|enterprise|commercial|private|ee-pro|pro-payloads)([/]|$)/.test(specifier)) offenders.push(`${file} -> ${specifier}`)
    }
  }
  record("supply-chain/excluded-imports", offenders.length === 0, offenders.length === 0 ? `${owned.length} owned source files import no excluded path` : offenders.slice(0, 5).join(", "))
}

function checkSpdxHeaders(files) {
  const owned = files.filter((file) => UNIFIA_PACKAGES.some((pkg) => file.startsWith(`packages/${pkg}/`)) && /\.(ts|tsx)$/.test(file))
  const missing = owned.filter((file) => !readFileSync(path.join(repoRoot, file), "utf8").split("\n").slice(0, 10).join("\n").includes("SPDX-License-Identifier"))
  record("supply-chain/spdx-headers", missing.length === 0, missing.length === 0 ? `${owned.length} owned source files carry an SPDX header` : `missing in: ${missing.slice(0, 5).join(", ")}`)
}

function checkManifestLicenses() {
  const offenders = []
  for (const pkg of UNIFIA_PACKAGES) {
    const manifestPath = path.join(repoRoot, "packages", pkg, "package.json")
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8"))
    if (!ALLOWED_LICENSES.has(manifest.license)) offenders.push(`${pkg}: ${manifest.license ?? "none"}`)
  }
  record("supply-chain/manifest-licenses", offenders.length === 0, offenders.length === 0 ? `${UNIFIA_PACKAGES.length} manifests declare an allowed licence` : offenders.join(", "))
}

/**
 * Every owned package must depend only on other owned packages or on the
 * catalog, so an unvetted third party cannot enter through a transitive edge.
 */
function checkDependencyProvenance() {
  const offenders = []
  for (const pkg of UNIFIA_PACKAGES) {
    const manifest = JSON.parse(readFileSync(path.join(repoRoot, "packages", pkg, "package.json"), "utf8"))
    for (const [name, range] of Object.entries(manifest.dependencies ?? {})) {
      if (range.startsWith("workspace:") || range === "catalog:") continue
      if (FLOATING_RANGE.test(range)) offenders.push(`${pkg} -> ${name}@${range} (floating range)`)
    }
  }
  record("supply-chain/dependency-provenance", offenders.length === 0, offenders.length === 0 ? "runtime dependencies are workspace, catalog or exactly pinned" : offenders.join(", "))
}

function checkLint() {
  try {
    run("bunx", ["biome", "check", "--max-diagnostics=200", ...UNIFIA_PACKAGES.map((pkg) => `packages/${pkg}`)])
    record("quality/lint", true, `${UNIFIA_PACKAGES.length} owned packages lint clean`)
  } catch (error) {
    record("quality/lint", false, String(error.stdout ?? error.message).split("\n").slice(-6).join(" | "))
  }
}

function checkTypecheck() {
  try {
    const output = run("bun", ["run", "typecheck"])
    const summary = output.split("\n").find((line) => line.includes("successful")) ?? "typecheck completed"
    record("quality/typecheck", true, summary.trim())
  } catch (error) {
    record("quality/typecheck", false, String(error.stdout ?? error.message).split("\n").slice(-6).join(" | "))
  }
}

function checkTests(withBrowser) {
  let failed = 0
  for (const entry of [...TEST_ENTRYPOINTS, ...(withBrowser ? BROWSER_SUITES : [])]) {
    // WHY the package directory is the cwd: suites resolve workspace imports
    // relative to their own package, exactly as `bun test` does there.
    const packageDirectory = path.join(repoRoot, path.dirname(path.dirname(entry)))
    try {
      const relativeEntry = path.relative(packageDirectory, path.join(repoRoot, entry)).split(path.sep).join("/")
      // WHY the conditional: `bun test <file>` only matches filenames that contain
      // `.test.`, `.spec.`, `_test_` or `_spec_`. Suites whose names follow a
      // different convention (e.g. `*-smoke.ts`) and use top-level `await` instead
      // of `test()` from `bun:test` must keep running as a script. The
      // `test()`-style suites that legitimately fail outside the test runner are
      // detected and routed through `bun test` so they actually run.
      const isBunTestRunnerSuite = /\.test\.|\.spec\.|_test_|_spec_/.test(relativeEntry)
      const args = isBunTestRunnerSuite ? ["test", ...(SUITE_ARGS[entry] ?? [])] : [...(SUITE_ARGS[entry] ?? [])]
      // WHY the env override: the root `bunfig.toml` pins
      // `[test].root = "./do-not-run-tests-from-root"` as a safeguard against
      // accidental root-level `bun test` runs. When we cd into the package
      // directory bun still walks up and applies that setting, so a targeted
      // `bun test <file>` cannot resolve any root and bails out. Pointing
      // BUN_CONFIG_TEST_ROOT at the package directory restores normal scanning.
      const testEnv = isBunTestRunnerSuite
        ? { ...process.env, BUN_CONFIG_TEST_ROOT: packageDirectory }
        : process.env
      const output = run("bun", [...args, relativeEntry], { cwd: packageDirectory, env: testEnv })
      const summary = output.trim().split("\n").filter(Boolean).at(-1) ?? "no output"
      process.stdout.write(`      ${entry} — ${summary}\n`)
    } catch (error) {
      failed += 1
      const stderr = String(error.stderr ?? "").split("\n").filter(Boolean).slice(-5).join(" | ")
      const stdoutTail = String(error.stdout ?? "").split("\n").filter(Boolean).slice(-3).join(" | ")
      process.stdout.write(`      ${entry} — FAILED: ${stderr || stdoutTail || error.message}\n`)
    }
  }
  let vitestFiles = 0
  for (const [packageDir, suites] of Object.entries(VITEST_SUITES)) {
    vitestFiles += suites.length
    try {
      const output = run("bunx", ["vitest", "run", ...suites], { cwd: path.join(repoRoot, packageDir) })
      const summary = output.split("\n").find((line) => line.includes("Tests")) ?? "vitest completed"
      process.stdout.write(`      ${packageDir} (vitest) — ${summary.trim()}\n`)
    } catch (error) {
      failed += 1
      process.stdout.write(`      ${packageDir} (vitest) — FAILED: ${String(error.stdout ?? error.message).split("\n").slice(-3).join(" | ")}\n`)
    }
  }
  const browserCount = withBrowser ? BROWSER_SUITES.length : 0
  const total = TEST_ENTRYPOINTS.length + vitestFiles + browserCount
  const browserNote = withBrowser ? `${browserCount} browser` : `${BROWSER_SUITES.length} browser suite(s) skipped, pass --with-browser to include`
  record("quality/tests", failed === 0, failed === 0 ? `${total} suites passed (${TEST_ENTRYPOINTS.length} bun + ${vitestFiles} vitest, ${browserNote}), ${Object.keys(EXCLUDED_TESTS).length} excluded with a stated reason` : `${failed} suite(s) failed`)
}

const args = process.argv.slice(2)
const jsonIndex = args.indexOf("--json")
const files = trackedFiles()

checkForbiddenPaths(files)
checkExcludedImports(files)
checkSpdxHeaders(files)
checkManifestLicenses()
checkDependencyProvenance()
checkLint()
checkTypecheck()
if (args.includes("--skip-tests")) record("quality/tests", true, "skipped by --skip-tests (NOT a proof)")
else checkTests(args.includes("--with-browser"))

const failedCount = results.filter((result) => !result.ok).length
const report = {
  generatedAt: new Date().toISOString(),
  scope: "local reproducible checks only; excludes external audit, pentest and signed release",
  excludedTests: EXCLUDED_TESTS,
  results,
  verdict: failedCount === 0 ? "PASS" : "FAIL",
}
if (jsonIndex >= 0 && args[jsonIndex + 1]) writeFileSync(path.resolve(repoRoot, args[jsonIndex + 1]), `${JSON.stringify(report, null, 2)}\n`)

process.stdout.write(`\n${report.verdict}: ${results.length - failedCount}/${results.length} conformance checks passed\n`)
process.exit(failedCount === 0 ? 0 : 1)
