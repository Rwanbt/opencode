import { describe, expect, test } from "bun:test"
import { getOptIn, resolveContentCaptureLevel, revokeOptIn, setOptIn, withContentCapture, MAX_TTL_DAYS } from "../../src/observability/capture-content"
import { ObservabilityId } from "../../src/observability/id"
import { Log } from "../../src/util/log"

Log.init({ print: false })

describe("observability capture-content opt-in", () => {
  test("setOptIn then getOptIn returns the same, non-expired opt-in", () => {
    const sessionId = "capture-content-basic-" + ObservabilityId.create()
    const now = 1_000_000
    const optIn = setOptIn({ scope: "session", scopeId: sessionId, level: "local_content_redacted", ttlDays: 3 }, now)

    expect(optIn.level).toBe("local_content_redacted")
    expect(optIn.ttlDays).toBe(3)
    expect(optIn.expiresAtMs).toBe(now + 3 * 86_400_000)

    const found = getOptIn("session", sessionId, now)
    expect(found).toEqual(optIn)
  })

  test("getOptIn returns undefined once now passes expires_at_ms", () => {
    const sessionId = "capture-content-expiry-" + ObservabilityId.create()
    const now = 2_000_000
    setOptIn({ scope: "session", scopeId: sessionId, level: "local_full", ttlDays: 1 }, now)

    expect(getOptIn("session", sessionId, now + 86_400_000 - 1)).toBeDefined()
    expect(getOptIn("session", sessionId, now + 86_400_000 + 1)).toBeUndefined()
  })

  test("re-opting-in overwrites the previous level/TTL instead of stacking", () => {
    const sessionId = "capture-content-overwrite-" + ObservabilityId.create()
    setOptIn({ scope: "session", scopeId: sessionId, level: "local_content_redacted", ttlDays: 1 }, 1000)
    const second = setOptIn({ scope: "session", scopeId: sessionId, level: "local_full", ttlDays: 5 }, 2000)

    const found = getOptIn("session", sessionId, 2000)
    expect(found).toEqual(second)
    expect(found?.level).toBe("local_full")
    expect(found?.ttlDays).toBe(5)
  })

  test("ttlDays is clamped to [1, MAX_TTL_DAYS]", () => {
    const sessionId = "capture-content-clamp-" + ObservabilityId.create()
    const tooLong = setOptIn({ scope: "session", scopeId: sessionId, level: "local_full", ttlDays: 9999 }, 1000)
    expect(tooLong.ttlDays).toBe(MAX_TTL_DAYS)

    const tooShort = setOptIn({ scope: "session", scopeId: sessionId, level: "local_full", ttlDays: 0 }, 1000)
    expect(tooShort.ttlDays).toBe(1)
  })

  test("revokeOptIn immediately stops resolution, no grace period", () => {
    const sessionId = "capture-content-revoke-" + ObservabilityId.create()
    setOptIn({ scope: "session", scopeId: sessionId, level: "local_full", ttlDays: 30 }, 1000)
    expect(getOptIn("session", sessionId, 1000)).toBeDefined()

    revokeOptIn("session", sessionId)
    expect(getOptIn("session", sessionId, 1000)).toBeUndefined()
  })

  test("resolveContentCaptureLevel prefers session over project over workspace", () => {
    const sessionId = "capture-content-precedence-session-" + ObservabilityId.create()
    const projectId = "capture-content-precedence-project-" + ObservabilityId.create()
    const workspaceId = "capture-content-precedence-workspace-" + ObservabilityId.create()
    const now = 5_000_000

    setOptIn({ scope: "workspace", scopeId: workspaceId, level: "local_content_redacted", ttlDays: 1 }, now)
    setOptIn({ scope: "project", scopeId: projectId, level: "local_content_redacted", ttlDays: 1 }, now)
    setOptIn({ scope: "session", scopeId: sessionId, level: "local_full", ttlDays: 1 }, now)

    const resolved = resolveContentCaptureLevel({ sessionId, projectId, workspaceId }, now)
    expect(resolved?.scope).toBe("session")
    expect(resolved?.level).toBe("local_full")
  })

  test("resolveContentCaptureLevel falls back to project, then workspace, when the more specific scope has no opt-in", () => {
    const projectId = "capture-content-fallback-project-" + ObservabilityId.create()
    const workspaceId = "capture-content-fallback-workspace-" + ObservabilityId.create()
    const now = 6_000_000

    setOptIn({ scope: "workspace", scopeId: workspaceId, level: "local_content_redacted", ttlDays: 1 }, now)
    const withOnlyWorkspace = resolveContentCaptureLevel({ projectId, workspaceId }, now)
    expect(withOnlyWorkspace?.scope).toBe("workspace")

    setOptIn({ scope: "project", scopeId: projectId, level: "local_full", ttlDays: 1 }, now)
    const withProjectToo = resolveContentCaptureLevel({ projectId, workspaceId }, now)
    expect(withProjectToo?.scope).toBe("project")
  })

  test("resolveContentCaptureLevel returns undefined when nothing is opted in", () => {
    const sessionId = "capture-content-none-" + ObservabilityId.create()
    expect(resolveContentCaptureLevel({ sessionId })).toBeUndefined()
  })

  test("resolveContentCaptureLevel accepts the explicit local all-projects opt-in", () => {
    const now = 7_000_000
    setOptIn({ scope: "all", scopeId: "local", level: "local_content_redacted", ttlDays: 1 }, now)

    const resolved = resolveContentCaptureLevel({ sessionId: "unknown-session", projectId: "unknown-project" }, now)

    expect(resolved?.scope).toBe("all")
    expect(resolved?.scopeId).toBe("local")
  })
})

describe("withContentCapture", () => {
  const baseOptIn = { scope: "session" as const, scopeId: "s", ttlDays: 1, createdAtMs: 0, expiresAtMs: 999_999_999_999 }

  test("no-ops when optIn is undefined", () => {
    const patch = { status: "started" as const, metadata: {} }
    expect(withContentCapture(patch, undefined, "hello")).toBe(patch)
  })

  test("no-ops when text is empty", () => {
    const patch = { status: "started" as const, metadata: {} }
    expect(withContentCapture(patch, { ...baseOptIn, level: "local_full" }, "")).toBe(patch)
  })

  test("attaches localFull and contentExpiresAtMs at local_full level", () => {
    const patch = { status: "finished" as const, metadata: {} }
    const result = withContentCapture(patch, { ...baseOptIn, level: "local_full" }, "the actual response text")
    expect(result.localFull).toBe("the actual response text")
    expect(result.localContentRedacted).toBeUndefined()
    expect(result.contentExpiresAtMs).toBe(baseOptIn.expiresAtMs)
  })

  test("attaches localContentRedacted (not localFull) at local_content_redacted level", () => {
    const patch = { status: "finished" as const, metadata: {} }
    const result = withContentCapture(patch, { ...baseOptIn, level: "local_content_redacted" }, "contact me at a@b.com")
    expect(result.localFull).toBeUndefined()
    expect(result.localContentRedacted).toContain("[REDACTED:email]")
    expect(result.localContentRedacted).not.toContain("a@b.com")
  })

  test("no-ops when the text is binary-shaped, regardless of level", () => {
    const patch = { status: "finished" as const, metadata: {} }
    const png = String.fromCharCode(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a) + "rest"
    const result = withContentCapture(patch, { ...baseOptIn, level: "local_full" }, png)
    expect(result.localFull).toBeUndefined()
    expect(result.localContentRedacted).toBeUndefined()
  })
})
