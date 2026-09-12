/* SPDX-License-Identifier: MIT */
import type { CapabilityDescriptor } from "./capability.js"
import type { LicenseVerdict } from "./p3.js"
export type CapabilityManifest = { descriptor: CapabilityDescriptor; digest: string; sourceRepo: string; sourceCommit: string; license: LicenseVerdict; attribution?: string; remoteCode: boolean; signature?: string }
export type CapabilityInstallState = "registered" | "approved" | "enabled" | "revoked"
export type CapabilityRecord = { manifest: CapabilityManifest; state: CapabilityInstallState }
export type ManifestVerifier = { verify(payload: string, signature: string): boolean }
export function capabilitySignaturePayload(manifest: CapabilityManifest): string { return `unifia.capability-manifest.v1\n${JSON.stringify({ digest: manifest.digest, sourceRepo: manifest.sourceRepo, sourceCommit: manifest.sourceCommit, license: manifest.license, descriptor: manifest.descriptor, remoteCode: manifest.remoteCode })}` }
export class CapabilityRegistry {
  readonly #records = new Map<string, CapabilityRecord>()
  readonly #verifier?: ManifestVerifier
  constructor(verifier?: ManifestVerifier) { this.#verifier = verifier }
  register(manifest: CapabilityManifest): void {
    if (!manifest.digest || !manifest.sourceCommit || !manifest.sourceRepo) throw new Error("capability provenance is incomplete")
    if (manifest.descriptor.trustLevel !== "untrusted" && (!this.#verifier || !manifest.signature || !this.#verifier.verify(capabilitySignaturePayload(manifest), manifest.signature))) throw new Error("capability signature is invalid")
    if (manifest.descriptor.id.split(/[\\/]+/).includes("ee")) throw new Error("excluded capability path")
    if (manifest.license === "RESTRICTED" || manifest.license === "FSL-1.1-MIT" || manifest.license === "UNKNOWN") throw new Error("capability license is inadmissible")
    if (manifest.license === "Apache-2.0" && !manifest.attribution) throw new Error("Apache attribution is required")
    if (manifest.remoteCode) throw new Error("remote code packages are disabled")
    if (this.#records.has(manifest.digest)) throw new Error("capability digest is already registered")
    this.#records.set(manifest.digest, { manifest: structuredClone(manifest), state: "registered" })
  }
  approve(digest: string): void { const record = this.#record(digest); if (record.state !== "registered") throw new Error("capability is not awaiting approval"); record.state = "approved" }
  enable(digest: string): void { const record = this.#record(digest); if (record.state !== "approved") throw new Error("capability requires approval"); record.state = "enabled" }
  revoke(digest: string): void { this.#record(digest).state = "revoked" }
  search(query: { tag?: string; trustLevel?: CapabilityDescriptor["trustLevel"]; enabledOnly?: boolean }): CapabilityRecord[] { return [...this.#records.values()].filter((record) => (!query.tag || record.manifest.descriptor.tags.includes(query.tag)) && (!query.trustLevel || record.manifest.descriptor.trustLevel === query.trustLevel) && (!query.enabledOnly || record.state === "enabled")).map((record) => structuredClone(record)) }
  get(digest: string): CapabilityRecord | undefined { const record = this.#records.get(digest); return record ? structuredClone(record) : undefined }
  #record(digest: string): CapabilityRecord { const record = this.#records.get(digest); if (!record) throw new Error("capability digest is unknown"); return record }
}
