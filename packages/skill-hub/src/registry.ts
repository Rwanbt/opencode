/* SPDX-License-Identifier: MIT */

/**
 * Concrete in-memory `SkillRegistry` — server-side, not browser-safe.
 *
 * WHY split: the `publish` method computes a SHA-256 of the artifact
 * via `node:crypto.createHash` (see `./hash.ts`). Surfacing the class
 * from the main `@unifia/skill-hub` entry would pull `node:crypto` into
 * the web UI bundle and break `vite build`. The class is re-exported
 * from the `./node` sub-export for server-only consumers.
 */
import { hashBytes } from "./hash.js"
import { validateSkillManifest, type InstalledSkill, type SkillManifest, type SkillPackage, type SkillRegistry, type SkillTrust, type SkillVerifier } from "./index.js"

const TRUST_RANK: Readonly<Record<SkillTrust, number>> = { untrusted: 0, verified: 1, official: 2 }
const cloneManifest = (manifest: SkillManifest): SkillManifest => Object.freeze({ ...manifest, tags: Object.freeze([...manifest.tags]), capabilities: Object.freeze([...manifest.capabilities]) })
const clonePackage = (skill: SkillPackage): SkillPackage => ({ manifest: cloneManifest(skill.manifest), artifact: new Uint8Array(skill.artifact), readme: skill.readme })

export class InMemorySkillRegistry implements SkillRegistry {
  readonly #skills = new Map<string, SkillPackage>()
  readonly #installed = new Map<string, InstalledSkill>()
  readonly #ratings = new Map<string, number[]>()
  readonly #now: () => number
  readonly #verifier?: SkillVerifier
  constructor(now: () => number = Date.now, verifier?: SkillVerifier) { this.#now = now; this.#verifier = verifier }
  async publish(skill: SkillPackage): Promise<SkillManifest> {
    const readmeDigest = skill.readme === undefined ? skill.manifest.readmeDigest : hashBytes(skill.readme)
    if (skill.readme !== undefined && skill.manifest.readmeDigest !== readmeDigest) throw new Error("readme digest does not match")
    if (hashBytes(skill.artifact) !== skill.manifest.digest) throw new Error("skill digest does not match artifact")
    const manifest = { ...skill.manifest, readmeDigest }
    validateSkillManifest(manifest, this.#verifier)
    if (this.#skills.has(manifest.digest)) throw new Error("skill digest already published")
    const sameName = [...this.#skills.values()].map((entry) => entry.manifest).filter((entry) => entry.name === manifest.name)
    if (sameName.some((entry) => TRUST_RANK[entry.trust] > TRUST_RANK[manifest.trust])) throw new Error("skill trust downgrade is not publishable")
    this.#skills.set(manifest.digest, clonePackage({ ...skill, manifest }))
    return cloneManifest(manifest)
  }
  async search(input: { query?: string; tags?: readonly string[]; trust?: SkillTrust }): Promise<readonly SkillManifest[]> {
    const query = input.query?.toLowerCase()
    return [...this.#skills.values()].map((skill) => skill.manifest).filter((manifest) => (!query || `${manifest.name} ${manifest.tags.join(" ")} ${manifest.capabilities.join(" ")}`.toLowerCase().includes(query)) && (!input.trust || manifest.trust === input.trust) && (!input.tags || input.tags.every((tag) => manifest.tags.includes(tag)))).map(cloneManifest)
  }
  async install(digest: string): Promise<InstalledSkill> { const skill = this.#skills.get(digest); if (!skill) throw new Error("skill not found"); const installed = { manifest: cloneManifest(skill.manifest), installedAt: this.#now() }; this.#installed.set(skill.manifest.name, installed); return { manifest: cloneManifest(installed.manifest), installedAt: installed.installedAt } }
  async update(name: string): Promise<InstalledSkill | undefined> {
    const installed = this.#installed.get(name)
    const candidates = (await this.search({ query: name })).filter((skill) => skill.name === name && (!installed || TRUST_RANK[skill.trust] >= TRUST_RANK[installed.manifest.trust])).sort((a, b) => b.version.localeCompare(a.version, undefined, { numeric: true }))
    const latest = candidates[0]
    if (!latest || (installed && latest.version <= installed.manifest.version)) return installed ? { manifest: cloneManifest(installed.manifest), installedAt: installed.installedAt } : undefined
    validateSkillManifest(latest, this.#verifier)
    return this.install(latest.digest)
  }
  async rate(digest: string, rating: number): Promise<void> { if (!this.#skills.has(digest) || !Number.isInteger(rating) || rating < 1 || rating > 5) throw new Error("invalid skill rating"); const ratings = this.#ratings.get(digest) ?? []; ratings.push(rating); this.#ratings.set(digest, ratings) }
}
