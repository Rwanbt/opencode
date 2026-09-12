#!/usr/bin/env bun
/* SPDX-License-Identifier: MIT */

/**
 * Publishes the Unifia CLI to npm: one package per platform, plus the
 * `unifia-ai` stub that resolves to whichever of them fits the host.
 *
 * Separate from `script/publish.ts` on purpose. That file is upstream's, still
 * reachable only from `.github/workflows/publish.yml` (gated on
 * `anomalyco/opencode`, so dead in this fork), and it also pushes a container
 * to upstream's registry and rewrites upstream's AUR and Homebrew packages.
 * Keeping it untouched keeps the monthly upstream sync conflict-free; this file
 * is the fork's own path and owns only npm.
 *
 *   UNIFIA_VERSION=1.3.16 UNIFIA_CHANNEL=latest UNIFIA_NPM_DRY_RUN=1 \
 *     bun packages/unifia/script/publish-npm.ts
 *
 * Expects `script/build.ts --all` to have populated dist/ first.
 */

import { $ } from "bun"
import fs from "fs/promises"
import path from "path"
import { fileURLToPath } from "url"
import { Script } from "@unifia/script"

const dir = fileURLToPath(new URL("..", import.meta.url))
process.chdir(dir)

const DRY_RUN = process.env["UNIFIA_NPM_DRY_RUN"] === "1"
const STUB_PACKAGE = "unifia-ai"
const REPOSITORY = "https://github.com/Rwanbt/unifia"

const pkg = await Bun.file("package.json").json()

// The stub is assembled into dist/ further down, so a previous run leaves a
// directory the glob below cannot tell apart from a platform package. Left in
// place it lands in the stub's own optionalDependencies — the package depends
// on itself, and the next run tries to publish it twice.
await fs.rm(`./dist/${STUB_PACKAGE}`, { recursive: true, force: true })

// Each platform directory carries the manifest script/build.ts generated for
// it: name, version, os and cpu. Reading them back is what makes the stub's
// optionalDependencies match exactly what was built — a hand-written list goes
// stale the moment the target matrix changes.
const binaries: Record<string, string> = {}
for (const manifest of new Bun.Glob("*/package.json").scanSync({ cwd: "./dist" })) {
  const parsed = await Bun.file(`./dist/${manifest}`).json()
  if (parsed.name === STUB_PACKAGE) continue
  binaries[parsed.name] = parsed.version
}

const names = Object.keys(binaries)
if (names.length === 0) throw new Error("dist/ holds no platform packages — run script/build.ts --all first")

const version = Object.values(binaries)[0]
if (new Set(Object.values(binaries)).size !== 1) {
  throw new Error(`platform packages disagree on version: ${JSON.stringify(binaries)}`)
}
console.log(`publishing ${STUB_PACKAGE}@${version} over ${names.length} platform packages`)

const license = await Bun.file("../../LICENSE").text()

async function enrich(target: string, extra: Record<string, unknown>) {
  const file = `./dist/${target}/package.json`
  const manifest = await Bun.file(file).json()
  await Bun.write(
    file,
    `${JSON.stringify(
      {
        // Defaulted, not imposed: the stub sets its own description below, and
        // overwriting it would put "platform binary" on the npm page users
        // actually land on.
        description: `${manifest.name} — platform binary for the Unifia CLI.`,
        ...manifest,
        license: pkg.license,
        homepage: REPOSITORY,
        repository: { type: "git", url: `git+${REPOSITORY}.git` },
        bugs: { url: `${REPOSITORY}/issues` },
        ...extra,
      },
      null,
      2,
    )}\n`,
  )
  await Bun.file(`./dist/${target}/LICENSE`).write(license)
}

async function publish(target: string) {
  const cwd = `./dist/${target}`
  // A tarball from an earlier run would be indistinguishable from the one built
  // below, and could be the one that gets published.
  for (const stale of await Array.fromAsync(new Bun.Glob("*.tgz").scan({ cwd }))) {
    await fs.rm(path.join(cwd, stale))
  }
  await $`bun pm pack`.cwd(cwd)
  const packed = await Array.fromAsync(new Bun.Glob("*.tgz").scan({ cwd }))
  if (packed.length !== 1) throw new Error(`expected exactly one tarball in ${cwd}, found ${packed.length}`)
  if (DRY_RUN) {
    console.log(`dry run — ${target} packed as ${packed[0]}, not published`)
    return
  }
  await $`npm publish ${packed[0]} --access public --tag ${Script.channel}`.cwd(cwd)
}

// Platform packages first: the stub declares them as optionalDependencies, so
// installing it before they exist resolves to a CLI with no binary.
for (const name of names) {
  await enrich(name, {})
  if (process.platform !== "win32") await $`chmod -R 755 .`.cwd(`./dist/${name}`)
  await publish(name)
}

const stubDir = `./dist/${STUB_PACKAGE}`
// fs, not the shell: bun's built-in `cp` rejects `-r` on Windows, so a shell
// copy here only works on the CI runner and fails for anyone testing locally.
await fs.mkdir(stubDir, { recursive: true })
await fs.cp("./bin", path.join(stubDir, "bin"), { recursive: true })
await fs.copyFile("./script/postinstall.mjs", path.join(stubDir, "postinstall.mjs"))
await Bun.file(`${stubDir}/package.json`).write(
  `${JSON.stringify(
    {
      name: STUB_PACKAGE,
      version,
      description: "Unifia — the AI coding agent for the terminal.",
      keywords: ["unifia", "ai", "agent", "cli", "coding"],
      bin: { [pkg.name]: `./bin/${pkg.name}` },
      scripts: { postinstall: "bun ./postinstall.mjs || node ./postinstall.mjs" },
      license: pkg.license,
      // Resolution, not download weight: npm installs only the entry whose
      // `os`/`cpu` match the host, and skips the rest without failing.
      optionalDependencies: binaries,
    },
    null,
    2,
  )}\n`,
)
await enrich(STUB_PACKAGE, {})
await publish(STUB_PACKAGE)

// The release workflow builds with UNIFIA_CHANNEL=fork, and the CLI's update
// check reads that same dist-tag (Installation.latest queries
// `<registry>/unifia-ai/<channel>`). Publishing under `fork` alone would leave
// `npm i -g unifia-ai` — which resolves `latest` — with nothing to install, so
// the release carries both tags. Only the fork's own build line exists, so
// there is no other candidate for `latest`.
if (Script.channel !== "latest") {
  if (DRY_RUN) {
    console.log(`dry run — would tag ${STUB_PACKAGE}@${version} as latest`)
  } else {
    await $`npm dist-tag add ${STUB_PACKAGE}@${version} latest`
  }
}

console.log(DRY_RUN ? "\ndry run complete — nothing was published" : `\npublished ${STUB_PACKAGE}@${version}`)
