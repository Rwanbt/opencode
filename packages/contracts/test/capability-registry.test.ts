/* SPDX-License-Identifier: MIT */
import { strict as assert } from "node:assert"
import { CapabilityRegistry } from "../src/capability-registry.ts"
const registry = new CapabilityRegistry({ verify: (payload, signature) => payload.includes("sha256:signed") && signature === "valid" })
const manifest = { descriptor: { id: "prompt-pack/review", name: "Review", description: "review", version: "1.0.0", author: "Unifia", license: "MIT", schema: {}, tags: ["review"], trustLevel: "verified" as const }, digest: "sha256:signed", signature: "valid", sourceRepo: "local", sourceCommit: "abc", license: "MIT" as const, remoteCode: false }
registry.register(manifest); assert.throws(() => registry.enable(manifest.digest)); registry.approve(manifest.digest); registry.enable(manifest.digest); assert.equal(registry.search({ enabledOnly: true }).length, 1); assert.throws(() => registry.register({ ...manifest, digest: "sha256:bad", signature: "bad" })); assert.throws(() => registry.register({ ...manifest, digest: "sha256:ee", descriptor: { ...manifest.descriptor, id: "plugin/ee" } }))
assert.throws(() => registry.register({ ...manifest, digest: "sha256:prefix-ee", descriptor: { ...manifest.descriptor, id: "ee/enterprise" } }))
assert.throws(() => new CapabilityRegistry().register(manifest)); assert.throws(() => registry.register({ ...manifest, digest: "sha256:remote", remoteCode: true })); console.log("CapabilityRegistry: 6/6 passed")
