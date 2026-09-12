/* SPDX-License-Identifier: MIT */

import { $ } from "bun"
import fs from "fs/promises"
import path from "path"

function tarballs(dir: string) {
  return Array.fromAsync(new Bun.Glob("*.tgz").scan({ cwd: dir }))
}

export type ExportMap = { [subpath: string]: string | ExportMap }

/**
 * The workspace consumes every package straight from its TypeScript sources, so
 * the checked-in `exports` maps point at `./src/*.ts`. npm consumers only ever
 * receive `dist/` (see the `files` field), so publishing the checked-in map
 * yields a tarball whose every entry point is missing.
 *
 * `types` is emitted before `import` on purpose: TypeScript resolves the first
 * matching condition, and a map that leads with `import` makes it fall back to
 * guessing a sibling declaration file.
 */
export function toDistExports(exports: ExportMap): ExportMap {
  const result: ExportMap = {}
  for (const [subpath, target] of Object.entries(exports)) {
    if (typeof target !== "string") {
      result[subpath] = toDistExports(target)
      continue
    }
    const base = target.replace(/^\.\/src\//, "./dist/").replace(/\.ts$/, "")
    result[subpath] = { types: `${base}.d.ts`, import: `${base}.js` }
  }
  return result
}

export type PublishInput = {
  /** Package directory — the one holding the package.json to publish. */
  dir: string
  /** npm dist-tag, e.g. `latest`. */
  channel: string
  /** Pack and report only, never contacting the registry. Defaults to `UNIFIA_NPM_DRY_RUN=1`. */
  dryRun?: boolean
}

/**
 * Compiles, packs and publishes one workspace package.
 *
 * `bun pm pack` is what resolves `workspace:` and `catalog:` specifiers into
 * real versions, so the tarball — never the directory — is what gets published.
 */
export async function publish(input: PublishInput) {
  const dryRun = input.dryRun ?? process.env["UNIFIA_NPM_DRY_RUN"] === "1"
  const manifestPath = path.join(input.dir, "package.json")
  const original = await Bun.file(manifestPath).text()
  const manifest = JSON.parse(original)

  await $`bun run compile`.cwd(input.dir)

  manifest.exports = toDistExports(manifest.exports)
  await Bun.write(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`)
  try {
    // A tarball left behind by an earlier run would otherwise be indistinguishable
    // from the one built below, and could be the one that gets published.
    for (const stale of await tarballs(input.dir)) await fs.rm(path.join(input.dir, stale))
    await $`bun pm pack`.cwd(input.dir)

    const packed = await tarballs(input.dir)
    if (packed.length !== 1) throw new Error(`expected exactly one tarball in ${input.dir}, found ${packed.length}`)
    if (dryRun) {
      console.log(`dry run — ${manifest.name}@${manifest.version} packed as ${packed[0]}, not published`)
      return
    }
    await $`npm publish ${packed[0]} --tag ${input.channel} --access public`.cwd(input.dir)
  } finally {
    // Byte-for-byte, so a failed publish cannot leave the workspace pointing at
    // a dist/ that only exists after a build.
    await Bun.write(manifestPath, original)
  }
}
