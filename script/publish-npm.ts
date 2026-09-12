#!/usr/bin/env bun
/* SPDX-License-Identifier: MIT */

/**
 * Publishes the three `@unifia/*` library packages to npm, and nothing else.
 *
 * `script/publish.ts` is the full release: it bumps every manifest, tags, pushes,
 * builds containers and updates AUR/Homebrew. This entry point exists for the
 * npm surface on its own — the CLI injects `@unifia/plugin@<cli version>` into
 * the package.json of every config directory it manages, so the scope has to be
 * resolvable independently of a full release.
 *
 *   UNIFIA_VERSION=1.3.15 UNIFIA_CHANNEL=latest UNIFIA_NPM_DRY_RUN=1 bun script/publish-npm.ts
 *
 * `UNIFIA_VERSION` is required: without it `@unifia/script` derives a version by
 * querying the registry, which is not what a manual publish should depend on.
 * Drop `UNIFIA_NPM_DRY_RUN` to publish for real.
 */

import { Script } from "@unifia/script"
import { publish } from "@unifia/script/npm"
import { fileURLToPath } from "url"

if (!process.env["UNIFIA_VERSION"]) throw new Error("UNIFIA_VERSION is required")

// Publish order is the dependency order: sdk-shared depends on sdk, plugin on
// both. A consumer installing an earlier package before the later ones exist
// resolves its dependency to a 404.
const packages = ["packages/sdk/js", "packages/sdk-shared", "packages/plugin"]

for (const pkg of packages) {
  const dir = fileURLToPath(new URL(`../${pkg}`, import.meta.url))
  console.log(`\n=== ${pkg} ===\n`)
  await publish({ dir, channel: Script.channel })
}
