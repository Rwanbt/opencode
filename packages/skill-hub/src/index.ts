/* SPDX-License-Identifier: MIT */

/**
 * Browser-safe surface of `@unifia/skill-hub`.
 *
 * WHY no `InMemorySkillRegistry` here: the registry uses `node:crypto`
 * (see `./hash.ts`) and would not survive the web UI bundle. Consumers
 * that need the concrete registry (server routes, hardening tests,
 * scripts) import it through the `./node` sub-export instead.
 */

export { SKILL_MODES, SKILL_SCENARIOS, buildDesignSkillContext, canSkillRun, parseDesignSkillManifest, type DesignSkillFrontmatter, type DesignSkillManifest, type SkillMode, type SkillScenario } from "./skill-manifest.js"

export type SkillTrust = "untrusted" | "verified" | "official"
export type SkillManifest = { name: string; version: string; digest: string; trust: SkillTrust; tags: readonly string[]; capabilities: readonly string[]; readmeDigest?: string; signature?: string }
export type SkillPackage = { manifest: SkillManifest; artifact: Uint8Array; readme?: string }
export type InstalledSkill = { manifest: SkillManifest; installedAt: number }
export type SkillVerifier = { verify(payload: string, signature: string): boolean }
export type SkillRegistry = { publish(skill: SkillPackage): Promise<SkillManifest>; search(input: { query?: string; tags?: readonly string[]; trust?: SkillTrust }): Promise<readonly SkillManifest[]>; install(digest: string): Promise<InstalledSkill>; update(name: string): Promise<InstalledSkill | undefined>; rate(digest: string, rating: number): Promise<void> }

const DIGEST = /^[a-f0-9]{64}$/
const NAME = /^[a-z][a-z0-9-]{2,63}$/
const VERSION = /^\d+\.\d+\.\d+$/
const TRUST: readonly SkillTrust[] = ["untrusted", "verified", "official"]

export function skillManifestPayload(manifest: SkillManifest): string {
  return `unifia.skill-manifest.v1\n${JSON.stringify({ name: manifest.name, version: manifest.version, digest: manifest.digest, trust: manifest.trust, readmeDigest: manifest.readmeDigest ?? null, tags: [...manifest.tags].sort(), capabilities: [...manifest.capabilities].sort() })}`
}

export function validateSkillManifest(manifest: SkillManifest, verifier?: SkillVerifier): void {
  if (!NAME.test(manifest.name) || !VERSION.test(manifest.version) || !DIGEST.test(manifest.digest) || (manifest.readmeDigest !== undefined && !DIGEST.test(manifest.readmeDigest)) || !TRUST.includes(manifest.trust) || manifest.tags.some((tag) => !/^[a-z0-9-]{1,32}$/.test(tag)) || manifest.capabilities.some((capability) => !/^[a-z][a-z0-9._-]{1,63}$/.test(capability))) throw new Error("invalid skill manifest")
  if (manifest.trust !== "untrusted" && (!manifest.signature || !verifier?.verify(skillManifestPayload(manifest), manifest.signature))) throw new Error("trusted skill signature required")
}
