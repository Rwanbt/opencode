import { describe, expect, test } from "bun:test"
import {
  debateLiveParticipants,
  debateParticipantStatusIcon,
} from "../../../src/cli/cmd/tui/routes/session/message-parts.tsx"

describe("debateLiveParticipants (legacy metadata fallback)", () => {
  test("returns the participant map for the new metadata shape", () => {
    const metadata = {
      participants: {
        "a/model-a": { currentPhase: "phase1_diverge", status: "running" },
      },
    }
    const result = debateLiveParticipants(metadata)
    expect(result).toEqual(metadata.participants as any)
  })

  test("returns undefined for legacy metadata with no .participants field (must not throw)", () => {
    const legacyMetadata = {
      debateID: "dbt_legacy",
      tier: "quick",
      providerCount: 3,
      blindSpotCount: 1,
      consensusCount: 2,
      cost: 0.01,
      durationMs: 1200,
    }
    expect(() => debateLiveParticipants(legacyMetadata)).not.toThrow()
    expect(debateLiveParticipants(legacyMetadata)).toBeUndefined()
  })

  test("returns undefined for undefined/null/non-object metadata", () => {
    expect(debateLiveParticipants(undefined)).toBeUndefined()
    expect(debateLiveParticipants(null)).toBeUndefined()
    expect(debateLiveParticipants("not an object")).toBeUndefined()
    expect(debateLiveParticipants(42)).toBeUndefined()
  })

  test("returns undefined when .participants is present but not an object", () => {
    expect(debateLiveParticipants({ participants: "oops" })).toBeUndefined()
    expect(debateLiveParticipants({ participants: null })).toBeUndefined()
  })
})

describe("debateParticipantStatusIcon", () => {
  test("maps every status to a distinct icon", () => {
    expect(debateParticipantStatusIcon("pending")).toBe("·")
    expect(debateParticipantStatusIcon("running")).toBe("…")
    expect(debateParticipantStatusIcon("done")).toBe("✓")
    expect(debateParticipantStatusIcon("failed")).toBe("✗")
  })
})
