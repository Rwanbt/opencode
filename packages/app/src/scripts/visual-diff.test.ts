/* SPDX-License-Identifier: MIT */

import { describe, expect, test } from "bun:test"
import sharp from "sharp"
import { BUDGET_MEAN, BUDGET_RATIO, diffBuffers } from "../../scripts/visual-diff"

// V13 — the diff algorithm itself is the only thing we can unit
// test without a running Vite + Playwright. The visual spec and
// the script are covered by structural tests in the spec file
// and the script test respectively. Here we pin the math.
//
// This test file lives under src/scripts/ so the existing
// `bun run test:unit` runner picks it up. The script under test
// lives under `scripts/` (next to the other developer scripts).
// The relative import "../../scripts/visual-diff" reaches the
// production file.
describe("V13 — visual diff math", () => {
  test("two identical buffers produce zero significant pixels and zero MAE", () => {
    const w = 8
    const h = 8
    const channels = 4
    const buf = Buffer.alloc(w * h * channels, 128)
    const a = { data: buf, width: w, height: h, channels }
    const b = { data: Buffer.from(buf), width: w, height: h, channels }
    const result = diffBuffers(a, b)
    expect(result.significant).toBe(0)
    expect(result.mae).toBe(0)
  })

  test("a 100% different buffer exceeds the budget (sanity check on the threshold)", () => {
    const w = 4
    const h = 4
    const channels = 4
    const a = { data: Buffer.alloc(w * h * channels, 0), width: w, height: h, channels }
    const b = { data: Buffer.alloc(w * h * channels, 255), width: w, height: h, channels }
    const result = diffBuffers(a, b)
    const ratio = result.significant / (w * h)
    expect(ratio).toBeGreaterThan(BUDGET_RATIO)
    expect(result.mae).toBeGreaterThan(BUDGET_MEAN)
  })

  test("anti-aliasing noise (channel delta 2) does not count as significant", () => {
    const w = 4
    const h = 4
    const channels = 4
    const a = { data: Buffer.alloc(w * h * channels, 128), width: w, height: h, channels }
    // Shift each pixel by 2 (within the noise floor).
    const bArr = new Uint8Array(w * h * channels)
    for (let i = 0; i < bArr.length; i += channels) {
      bArr[i] = 130
      bArr[i + 1] = 130
      bArr[i + 2] = 130
      bArr[i + 3] = 255
    }
    const b = { data: Buffer.from(bArr), width: w, height: h, channels }
    const result = diffBuffers(a, b)
    expect(result.significant).toBe(0)
    // MAE picks up the 2/255 shift. The plan's budget is
    // "mean error <= 1.5/255", and 2/255 per channel summed
    // across the three RGB channels, normalised by all four
    // channels (RGBA), lands at exactly 1.5/255. The test
    // asserts the noise floor is at-or-under the budget, not
    // strictly under it.
    expect(result.mae).toBeLessThanOrEqual(BUDGET_MEAN)
  })

  test("the output buffer encodes the diff visually (red = significant, green = clean)", () => {
    // First pixel: significant (200 -> 0). Second pixel: clean
    // (128 -> 128). Both channels must be 255 alpha.
    const a = Buffer.from([200, 0, 0, 255, 128, 128, 128, 255])
    const b = Buffer.from([0, 0, 0, 255, 128, 128, 128, 255])
    const result = diffBuffers(
      { data: a, width: 2, height: 1, channels: 4 },
      { data: b, width: 2, height: 1, channels: 4 },
    )
    // Pixel 0: diff > 16, R=255, G=0
    expect(result.out[0]).toBe(255)
    expect(result.out[1]).toBe(0)
    // Pixel 1: clean, R=0, G=255
    expect(result.out[4]).toBe(0)
    expect(result.out[5]).toBe(255)
  })

  test("size mismatch is rejected (no silent crop)", () => {
    const a = { data: Buffer.alloc(16), width: 2, height: 2, channels: 4 }
    const b = { data: Buffer.alloc(64), width: 4, height: 4, channels: 4 }
    expect(() => diffBuffers(a, b)).toThrow(/size mismatch/)
  })
})

describe("V13 — sharp can decode and re-encode the snapshots we generate", () => {
  test("round-trip preserves dimensions and pixel count", async () => {
    const w = 16
    const h = 16
    const raw = Buffer.alloc(w * h * 4)
    for (let i = 0; i < raw.length; i += 4) {
      raw[i] = 64
      raw[i + 1] = 64
      raw[i + 2] = 64
      raw[i + 3] = 255
    }
    const png = await sharp(raw, { raw: { width: w, height: h, channels: 4 } }).png().toBuffer()
    const meta = await sharp(png).metadata()
    expect(meta.width).toBe(w)
    expect(meta.height).toBe(h)
    expect(png[0]).toBe(0x89)
    expect(png[1]).toBe(0x50)
  })
})
