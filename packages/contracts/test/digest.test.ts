/* SPDX-License-Identifier: MIT */
import { describe, expect, test } from "bun:test"
import {
  ArtifactBytesDigestSchema,
  asDomainDigest,
  DigestDomainSchema,
  DigestEnvelopeSchema,
  WorkflowVersionDigestSchema,
} from "../src/digest.ts"

function envelope(domain: (typeof DigestDomainSchema.options)[number]) {
  return DigestEnvelopeSchema.parse({
    version: 1,
    domain,
    canonicalizationAlgorithm: "JCS-v1",
    hashAlgorithm: "SHA-256",
    value: "0".repeat(64),
  })
}

describe("typed digest envelopes", () => {
  test("accept their matching domain", () => {
    for (const domain of DigestDomainSchema.options) {
      expect(DigestEnvelopeSchema.parse(envelope(domain)).domain).toBe(domain)
    }
    expect(WorkflowVersionDigestSchema.parse(envelope("workflow-version")).domain).toBe(
      "workflow-version",
    )
  })

  test("reject cross-domain values at the parsing boundary", () => {
    expect(() => WorkflowVersionDigestSchema.parse(envelope("policy"))).toThrow(
      /workflow-version/,
    )
    expect(() => ArtifactBytesDigestSchema.parse(envelope("workflow-version"))).toThrow(
      /artifact-bytes/,
    )
  })

  test("preserves the generic and explicit runtime boundaries", () => {
    expect(asDomainDigest(envelope("workflow-version"), "workflow-version").domain).toBe(
      "workflow-version",
    )
    expect(() => asDomainDigest(envelope("policy"), "workflow-version")).toThrow(/mismatch/)
  })
})
