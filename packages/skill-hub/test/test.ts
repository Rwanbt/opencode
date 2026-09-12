/* SPDX-License-Identifier: MIT */
import { strict as assert } from "node:assert"
import { createHash } from "node:crypto"
import { InMemorySkillRegistry, skillManifestPayload, type SkillManifest } from "../src/index-node.ts"
const artifact = (version: string) => new TextEncoder().encode(`demo-skill:${version}`)
const digest = (version: string) => createHash("sha256").update(artifact(version)).digest("hex")
const manifest = (version: string, trust: SkillManifest["trust"] = "untrusted"): SkillManifest => ({ name: "demo-skill", version, digest: digest(version), trust, tags: ["demo"], capabilities: ["workflow.run"] })
const registry = new InMemorySkillRegistry(() => 123)
await registry.publish({ manifest: manifest("1.0.0"), artifact: artifact("1.0.0") })
assert.equal((await registry.search({ query: "workflow" })).length, 1)
const installed = await registry.install(digest("1.0.0")); assert.equal(installed.installedAt, 123)
const mutation = (await registry.search({ query: "workflow" }))[0]; if (!mutation) throw new Error("missing search result"); assert.throws(() => { (mutation as { trust: string }).trust = "official" }); assert.equal((await registry.search({ query: "workflow" }))[0]?.trust, "untrusted")
await assert.rejects(() => registry.publish({ manifest: { ...manifest("1.1.0", "verified"), signature: "bad" }, artifact: artifact("1.1.0") }))
await assert.rejects(() => registry.publish({ manifest: manifest("2.0.0"), artifact: artifact("different") }))
await assert.rejects(() => registry.publish({ manifest: { ...manifest("2.1.0"), readmeDigest: "0".repeat(64) }, artifact: artifact("2.1.0"), readme: "README" }))
const signed = { ...manifest("1.1.0", "verified") }; const verifier = { verify: (payload: string, signature: string) => payload === skillManifestPayload(signed) && signature === "ok" }
const trusted = new InMemorySkillRegistry(() => 456, verifier); await trusted.publish({ manifest: { ...signed, signature: "ok" }, artifact: artifact("1.1.0") }); await trusted.install(signed.digest)
const downgrade = manifest("9.9.9", "untrusted"); await assert.rejects(() => trusted.publish({ manifest: downgrade, artifact: artifact("9.9.9") })); assert.equal((await trusted.update("demo-skill"))?.manifest.version, "1.1.0")
await trusted.rate(signed.digest, 5); await assert.rejects(() => trusted.rate(signed.digest, 6))
console.log("SkillHubRegistry: 8/8 passed")
