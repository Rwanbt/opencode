#!/usr/bin/env node
// Verifies the committed brand assets still match brand/unifia/brand-manifest.json.
//
// Node + stdlib only, on purpose: CI must be able to reject brand drift without
// installing Pillow or any image toolchain. Regenerating is scripts/brand/generate.py.

import { createHash } from "node:crypto"
import { readFileSync, existsSync } from "node:fs"
import { join, dirname } from "node:path"
import { fileURLToPath } from "node:url"

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..", "..")
const manifestPath = join(REPO, "brand", "unifia", "brand-manifest.json")

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

// A PNG's IHDR is at a fixed offset, so width and height are readable without an
// image library — which is what keeps this script dependency-free.
function pngSize(bytes) {
  if (bytes.length < 24 || !bytes.subarray(0, 8).equals(PNG_SIGNATURE)) return null
  return [bytes.readUInt32BE(16), bytes.readUInt32BE(20)]
}

function checkEntries(entries, label) {
  const missing = []
  const drifted = []
  const resized = []
  for (const [relative, expected] of entries) {
    const absolute = join(REPO, relative)
    if (!existsSync(absolute)) {
      missing.push(relative)
      continue
    }
    const bytes = readFileSync(absolute)
    const [hash, width, height] = Array.isArray(expected) ? expected : [expected]
    if (createHash("sha256").update(bytes).digest("hex") !== hash) {
      drifted.push(relative)
      continue
    }
    if (width === undefined) continue
    const actual = pngSize(bytes)
    if (!actual || actual[0] !== width || actual[1] !== height) {
      resized.push(`${relative} (expected ${width}x${height}, found ${actual ? actual.join("x") : "no PNG header"})`)
    }
  }
  return { label, total: entries.length, missing, drifted, resized }
}

function masterEntries(manifest) {
  const dir = manifest.sourceDirectory
  return manifest.masters.flatMap((master) => [
    [`${dir}/${master.stem}.svg`, master.svg],
    [`${dir}/${master.stem}.png`, [master.png, ...(master.pngPixels ?? [])]],
  ])
}

function report(result) {
  const bad = result.missing.length + result.drifted.length + result.resized.length
  console.log(`${result.label}: ${result.total - bad}/${result.total} verified`)
  for (const path of result.missing) console.error(`  missing   ${path}`)
  for (const path of result.drifted) console.error(`  drifted   ${path}`)
  for (const path of result.resized) console.error(`  resized   ${path}`)
  return bad
}

function main() {
  if (!existsSync(manifestPath)) {
    console.error("brand-manifest.json not found — run: bun run brand:generate")
    return 1
  }
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"))
  if (manifest.sourceDirectory.includes("external")) {
    console.error(`brand-manifest.json points outside the repo: ${manifest.sourceDirectory}`)
    return 1
  }
  if (!manifest.generated) {
    console.error("brand-manifest.json has no `generated` map — run: bun run brand:generate")
    return 1
  }

  let failures = 0
  failures += report(checkEntries(masterEntries(manifest), "masters"))
  failures += report(checkEntries(Object.entries(manifest.generated), "generated"))

  if (failures > 0) {
    console.error(`\n${failures} brand asset(s) out of date. Run: bun run brand:generate`)
    return 1
  }
  console.log("brand: manifest and assets agree")
  return 0
}

process.exit(main())
