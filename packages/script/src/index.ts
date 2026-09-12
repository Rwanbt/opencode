import { $ } from "bun"
import semver from "semver"
import path from "path"

const rootPkgPath = path.resolve(import.meta.dir, "../../../package.json")
const rootPkg = await Bun.file(rootPkgPath).json()
const expectedBunVersion = rootPkg.packageManager?.split("@")[1]

if (!expectedBunVersion) {
  throw new Error("packageManager field not found in root package.json")
}

// relax version requirement
const expectedBunVersionRange = `^${expectedBunVersion}`

if (!semver.satisfies(process.versions.bun, expectedBunVersionRange)) {
  throw new Error(`This script requires bun@${expectedBunVersionRange}, but you are using bun@${process.versions.bun}`)
}

const env = {
  UNIFIA_CHANNEL: process.env["UNIFIA_CHANNEL"],
  UNIFIA_BUMP: process.env["UNIFIA_BUMP"],
  UNIFIA_VERSION: process.env["UNIFIA_VERSION"],
  UNIFIA_RELEASE: process.env["UNIFIA_RELEASE"],
}
const CHANNEL = await (async () => {
  if (env.UNIFIA_CHANNEL) return env.UNIFIA_CHANNEL
  if (env.UNIFIA_BUMP) return "latest"
  if (env.UNIFIA_VERSION && !env.UNIFIA_VERSION.startsWith("0.0.0-")) return "latest"
  return await $`git branch --show-current`.text().then((x) => x.trim())
})()
const IS_PREVIEW = CHANNEL !== "latest"

// Kept in step with NPM_PACKAGE in packages/unifia/src/installation/index.ts:
// the version a release is cut from and the package the CLI upgrades itself
// through have to be the same product.
const NPM_PACKAGE = "unifia-ai"

const VERSION = await (async () => {
  if (env.UNIFIA_VERSION) return env.UNIFIA_VERSION
  if (IS_PREVIEW) return `0.0.0-${CHANNEL}-${new Date().toISOString().slice(0, 16).replace(/[-:T]/g, "")}`
  // This fork's own package. It read upstream's `opencode-ai`, so a release cut
  // without UNIFIA_VERSION took upstream's latest and bumped that — 1.18.16
  // against this product's 1.3.x. The 404 before the first `unifia-ai` publish
  // is deliberate: guessing a version from an empty registry is how a release
  // silently lands on the wrong number.
  const version = await fetch(`https://registry.npmjs.org/${NPM_PACKAGE}/latest`)
    .then((res) => {
      if (!res.ok) throw new Error(`${NPM_PACKAGE}: ${res.statusText} — pass UNIFIA_VERSION to set it explicitly`)
      return res.json()
    })
    .then((data: any) => data.version)
  const [major, minor, patch] = version.split(".").map((x: string) => Number(x) || 0)
  const t = env.UNIFIA_BUMP?.toLowerCase()
  if (t === "major") return `${major + 1}.0.0`
  if (t === "minor") return `${major}.${minor + 1}.0`
  return `${major}.${minor}.${patch + 1}`
})()

const bot = ["actions-user", "unifia", "unifia-agent[bot]"]
const teamPath = path.resolve(import.meta.dir, "../../../.github/TEAM_MEMBERS")
const team = [
  ...(await Bun.file(teamPath)
    .text()
    .then((x) => x.split(/\r?\n/).map((x) => x.trim()))
    .then((x) => x.filter((x) => x && !x.startsWith("#")))),
  ...bot,
]

export const Script = {
  get channel() {
    return CHANNEL
  },
  get version() {
    return VERSION
  },
  get preview() {
    return IS_PREVIEW
  },
  get release(): boolean {
    return !!env.UNIFIA_RELEASE
  },
  get team() {
    return team
  },
}
console.log(`unifia script`, JSON.stringify(Script, null, 2))
