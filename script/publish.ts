#!/usr/bin/env bun

import { Script } from "@unifia/script"
import { $ } from "bun"
import { fileURLToPath } from "url"

// Upstream's full release: it commits, tags and force-pushes, then hands off to
// packages/unifia/script/publish.ts, which targets registries this fork does
// not own. Unreachable here by workflow gating (.github/workflows/publish.yml
// runs only on `anomalyco/opencode`), and kept byte-compatible so the monthly
// upstream sync stays conflict-free — but a manual run would still fire.
// Unifia releases through .github/workflows/release.yml.
if (!process.env["UNIFIA_ALLOW_UPSTREAM_PUBLISH"]) {
  throw new Error(
    "script/publish.ts is upstream's release path and pushes to infrastructure this fork does not own. " +
      "Unifia releases via .github/workflows/release.yml; npm alone via packages/unifia/script/publish-npm.ts.",
  )
}

const highlightsTemplate = `
<!--
Add highlights before publishing. Delete this section if no highlights.

- For multiple highlights, use multiple <highlight> tags
- Highlights with the same source attribute get grouped together
-->

<!--
<highlight source="SourceName (TUI/Desktop/Web/Core)">
  <h2>Feature title goes here</h2>
  <p short="Short description used for Desktop Recap">
    Full description of the feature or change
  </p>

  https://github.com/user-attachments/assets/uuid-for-video (you will want to drag & drop the video or picture)

  <img
    width="1912"
    height="1164"
    alt="image"
    src="https://github.com/user-attachments/assets/uuid-for-image"
  />
</highlight>
-->

`

console.log("=== publishing ===\n")

const pkgjsons = await Array.fromAsync(
  new Bun.Glob("**/package.json").scan({
    absolute: true,
  }),
).then((arr) => arr.filter((x) => !x.includes("node_modules") && !x.includes("dist")))

for (const file of pkgjsons) {
  let pkg = await Bun.file(file).text()
  pkg = pkg.replaceAll(/"version": "[^"]+"/g, `"version": "${Script.version}"`)
  console.log("updated:", file)
  await Bun.file(file).write(pkg)
}

// The Zed extension is gone from this fork, along with script/sync-zed.ts and
// the release-triggered workflow that submitted it to zed-industries/extensions.
// Its manifest advertised Unifia's version against anomalyco/opencode download
// URLs, and the sync workflow carried no repository gate — a release published
// here would have opened a pull request on a third-party registry.

await $`bun install`
await import(`../packages/sdk/js/script/build.ts`)

if (Script.release) {
  if (!Script.preview) {
    await $`git commit -am "release: v${Script.version}"`
    await $`git tag v${Script.version}`
    await $`git fetch origin`
    await $`git cherry-pick HEAD..origin/dev`.nothrow()
    await $`git push origin HEAD --tags --no-verify --force-with-lease`
    await new Promise((resolve) => setTimeout(resolve, 5_000))
  }

  await import(`../packages/desktop/scripts/finalize-latest-json.ts`)
  await import(`../packages/desktop-electron/scripts/finalize-latest-yml.ts`)

  await $`gh release edit v${Script.version} --draft=false --repo ${process.env.GH_REPO}`
}

console.log("\n=== cli ===\n")
await import(`../packages/unifia/script/publish.ts`)

// Dependency order: sdk-shared depends on sdk, and plugin on both. npm rejects
// nothing here, but a consumer installing an earlier one would hit a 404 on the
// dependency until the later publishes land.
console.log("\n=== sdk ===\n")
await import(`../packages/sdk/js/script/publish.ts`)

console.log("\n=== sdk-shared ===\n")
await import(`../packages/sdk-shared/script/publish.ts`)

console.log("\n=== plugin ===\n")
await import(`../packages/plugin/script/publish.ts`)

const dir = fileURLToPath(new URL("..", import.meta.url))
process.chdir(dir)
