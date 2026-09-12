/* SPDX-License-Identifier: MIT */

import { describe, expect, test } from "bun:test"
import {
  createMediaProviderRegistry,
  providersForKind,
  requireProvider,
  type MediaProvider,
} from "../src/provider-adapter"

const stubProvider = (id: string, kind: "image" | "video" | "audio"): MediaProvider => ({
  id,
  supports: [kind],
  async generate(job) {
    return {
      jobId: job.jobId,
      kind,
      bytes: new Uint8Array(),
      mime: kind === "image" ? "image/png" : kind === "video" ? "video/mp4" : "audio/mpeg",
      provenance: { sourceTool: id, capabilityPack: "media-runtime" },
    }
  },
})

describe("createMediaProviderRegistry", () => {
  test("register, get, and unregister", () => {
    const registry = createMediaProviderRegistry()
    const p = stubProvider("kokoro-tts", "audio")
    registry.register(p)
    expect(registry.get("kokoro-tts")).toBe(p)
    expect(registry.list()).toEqual([p])
    registry.unregister("kokoro-tts")
    expect(registry.get("kokoro-tts")).toBeUndefined()
  })

  test("registering the same id twice throws", () => {
    const registry = createMediaProviderRegistry()
    registry.register(stubProvider("kokoro-tts", "audio"))
    expect(() => registry.register(stubProvider("kokoro-tts", "audio"))).toThrow(/already registered/)
  })

  test("requireProvider refuses an unknown id", () => {
    const registry = createMediaProviderRegistry()
    expect(() => requireProvider(registry, "unknown")).toThrow(/unknown media provider/)
  })
})

describe("providersForKind", () => {
  test("returns only providers that support the kind, sorted by id", () => {
    const registry = createMediaProviderRegistry()
    registry.register(stubProvider("zeta-image", "image"))
    registry.register(stubProvider("alpha-image", "image"))
    registry.register(stubProvider("kokoro-tts", "audio"))
    const images = providersForKind(registry, "image")
    expect(images.map((p) => p.id)).toEqual(["alpha-image", "zeta-image"])
    const audios = providersForKind(registry, "audio")
    expect(audios.map((p) => p.id)).toEqual(["kokoro-tts"])
  })

  test("returns an empty list when no provider supports the kind", () => {
    const registry = createMediaProviderRegistry()
    expect(providersForKind(registry, "video")).toEqual([])
  })
})

describe("stubProvider", () => {
  test("generates an empty artifact with the requested kind", async () => {
    const p = stubProvider("kokoro-tts", "audio")
    const artifact = await p.generate({ jobId: "j-1", kind: "audio", prompt: "hello" })
    expect(artifact.kind).toBe("audio")
    expect(artifact.bytes.byteLength).toBe(0)
    expect(artifact.provenance.sourceTool).toBe("kokoro-tts")
    expect(artifact.provenance.capabilityPack).toBe("media-runtime")
  })
})
