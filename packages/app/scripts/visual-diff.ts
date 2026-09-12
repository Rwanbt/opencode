/* SPDX-License-Identifier: MIT */

// V13 — visual diff driver.
//
// Compares the snapshots in `e2e/visual-snapshots/` against the
// matching baseline under `e2e/visual-snapshots-baseline/`, and
// writes a per-snapshot diff image + a JSON report. The exit code
// is non-zero if any snapshot exceeds the budget.
//
// Usage:
//   bun scripts/visual-diff.ts                     # diff all
//   bun scripts/visual-diff.ts --update           # refresh baseline
//   bun scripts/visual-diff.ts --only light-375   # one snapshot
//
// The diff uses sharp to decode both PNGs, walks the raw RGBA
// buffers, and writes a coloured output (red = past the noise
// floor, green = clean). The unit test under
// `src/scripts/visual-diff.test.ts` pins the math.

import { readdir, writeFile, mkdir, copyFile, stat } from "node:fs/promises"
import { join } from "node:path"
import sharp from "sharp"

const ROOT = join(import.meta.dir, "..")
const SNAPSHOTS = join(ROOT, "e2e", "visual-snapshots")
const BASELINE = join(ROOT, "e2e", "visual-snapshots-baseline")
const DIFFS = join(ROOT, "e2e", "visual-snapshots-diffs")
const REPORT = join(ROOT, "e2e", "visual-snapshots-report.json")

const BUDGET_RATIO = 0.005 // <= 0.5% pixels significantly different
const BUDGET_MEAN = 1.5 / 255 // <= 1.5/255 mean absolute error
const NOISE_FLOOR = 16 // channel delta below this is "anti-aliasing noise"

export type SnapshotDiff = {
  name: string
  width: number
  height: number
  pixelCount: number
  significantCount: number
  significantRatio: number
  meanAbsoluteError: number
  withinBudget: boolean
  reason?: "no-baseline" | "size-mismatch" | "missing"
}

export type Report = {
  generatedAt: string
  total: number
  pass: number
  fail: number
  results: SnapshotDiff[]
}

async function listPngs(dir: string): Promise<string[]> {
  try {
    const entries = await readdir(dir)
    return entries.filter((e) => e.endsWith(".png")).sort()
  } catch {
    return []
  }
}

async function ensureDir(dir: string): Promise<void> {
  await mkdir(dir, { recursive: true })
}

async function readPng(path: string): Promise<{ data: Buffer; width: number; height: number; channels: number }> {
  const img = sharp(path)
  const meta = await img.metadata()
  if (!meta.width || !meta.height) throw new Error(`unreadable image: ${path}`)
  const { data, info } = await img
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true })
  return { data, width: info.width, height: info.height, channels: info.channels }
}

export function diffBuffers(
  a: { data: Buffer; width: number; height: number; channels: number },
  b: { data: Buffer; width: number; height: number; channels: number },
): { significant: number; mae: number; width: number; height: number; out: Buffer } {
  if (a.width !== b.width || a.height !== b.height) {
    throw new Error(`size mismatch: ${a.width}x${a.height} vs ${b.width}x${b.height}`)
  }
  const width = a.width
  const height = a.height
  const channels = a.channels
  const total = width * height
  const out = Buffer.alloc(a.data.length)
  let significant = 0
  let sum = 0
  for (let i = 0; i < a.data.length; i += channels) {
    const dr = Math.abs(a.data[i] - b.data[i])
    const dg = Math.abs(a.data[i + 1] - b.data[i + 1])
    const db = Math.abs(a.data[i + 2] - b.data[i + 2])
    const max = Math.max(dr, dg, db)
    // Differences below the noise floor count toward MAE but
    // not toward the structural "significant" budget. The
    // output buffer encodes the verdict visually: red where
    // the pixel drifted past the floor, green where it is
    // clean. Blue and alpha are kept neutral so the diff
    // overlays read clearly on a white or dark background.
    out[i] = max > NOISE_FLOOR ? 255 : 0
    out[i + 1] = max > NOISE_FLOOR ? 0 : 255
    out[i + 2] = 0
    out[i + 3] = 255
    if (max > NOISE_FLOOR) significant += 1
    sum += dr + dg + db
  }
  return { significant, mae: sum / (total * channels * 255), width, height, out }
}

export { BUDGET_RATIO, BUDGET_MEAN, NOISE_FLOOR }

async function main(): Promise<void> {
  const args = process.argv.slice(2)
  const update = args.includes("--update")
  const onlyIdx = args.indexOf("--only")
  const only = onlyIdx >= 0 ? args[onlyIdx + 1] : undefined

  await ensureDir(SNAPSHOTS)
  if (update) {
    await ensureDir(BASELINE)
  } else {
    await ensureDir(DIFFS)
  }

  const files = await listPngs(SNAPSHOTS)
  if (files.length === 0) {
    console.error("No snapshots found. Run the Playwright visual spec first.")
    process.exit(1)
  }
  const filtered = only ? files.filter((f) => f.startsWith(only)) : files

  const results: SnapshotDiff[] = []
  let pass = 0
  let fail = 0

  for (const file of filtered) {
    const name = file.replace(/\.png$/, "")
    const snapshotPath = join(SNAPSHOTS, file)
    const baselinePath = join(BASELINE, file)
    const diffPath = join(DIFFS, file)

    if (update) {
      await copyFile(snapshotPath, baselinePath)
      console.log(`baseline updated: ${name}`)
      continue
    }

    let baselineStat
    try {
      baselineStat = await stat(baselinePath)
    } catch {
      results.push({ name, width: 0, height: 0, pixelCount: 0, significantCount: 0, significantRatio: 1, meanAbsoluteError: 1, withinBudget: false, reason: "no-baseline" })
      fail += 1
      console.error(`missing baseline for ${name}; pass --update to seed it`)
      continue
    }
    if (!baselineStat.isFile()) {
      results.push({ name, width: 0, height: 0, pixelCount: 0, significantCount: 0, significantRatio: 1, meanAbsoluteError: 1, withinBudget: false, reason: "missing" })
      fail += 1
      continue
    }

    const a = await readPng(snapshotPath)
    const b = await readPng(baselinePath)
    if (a.width !== b.width || a.height !== b.height) {
      results.push({ name, width: a.width, height: a.height, pixelCount: a.width * a.height, significantCount: 0, significantRatio: 0, meanAbsoluteError: 0, withinBudget: false, reason: "size-mismatch" })
      fail += 1
      console.error(`size mismatch: ${name} (${a.width}x${a.height} vs ${b.width}x${b.height})`)
      continue
    }

    const diff = diffBuffers(a, b)
    const ratio = diff.significant / (diff.width * diff.height)
    const within = ratio <= BUDGET_RATIO && diff.mae <= BUDGET_MEAN
    if (within) pass += 1
    else fail += 1

    await sharp(diff.out, { raw: { width: diff.width, height: diff.height, channels: 4 } })
      .png()
      .toFile(diffPath)

    results.push({
      name,
      width: diff.width,
      height: diff.height,
      pixelCount: diff.width * diff.height,
      significantCount: diff.significant,
      significantRatio: ratio,
      meanAbsoluteError: diff.mae,
      withinBudget: within,
    })
    const tag = within ? "PASS" : "FAIL"
    console.log(`${tag} ${name}: significant=${diff.significant} (${(ratio * 100).toFixed(3)}%), MAE=${diff.mae.toFixed(4)}`)
  }

  const report: Report = {
    generatedAt: new Date().toISOString(),
    total: results.length,
    pass,
    fail,
    results,
  }
  await writeFile(REPORT, JSON.stringify(report, null, 2))

  if (fail > 0 && !update) {
    console.error(`${fail} snapshot(s) exceeded the budget.`)
    process.exit(1)
  }
  console.log(`visual diff: ${pass}/${results.length} within budget`)
}

// Guard: only run the CLI when the script is the entry point.
// The diff helpers (diffBuffers, BUDGET_*) are imported by the
// unit test under src/scripts/visual-diff.test.ts; running
// the CLI in that context would fail looking for snapshots.
if (import.meta.main) {
  main().catch((err: unknown) => {
    console.error(err)
    process.exit(1)
  })
}
