/* SPDX-License-Identifier: MIT */
import { describe, it, expect } from "bun:test"
import {
  PersonalSource,
  ProjectSource,
  ExternalSource,
  SessionSource,
  SourceRegistry,
  type KnowledgeSource,
  type ListOptions,
  type ListedNote,
  type SourceEvent,
} from "../../../src/knowledge/source/index.js"
import { PERSONAL_ROOT_LOCATOR, PROJECT_ROOT_LOCATOR } from "@unifia/contracts/knowledge"

const fakeNote: ListedNote = {
  ref: {
    id: "0190d2c0-7b00-7000-8000-000000000001",
    locator: "memory/decisions/x.md",
  },
  type: "decision",
  lifecycle: "active",
  updatedAt: "2026-08-29T00:00:00Z",
}

function fakeSource(spaceKind: "personal" | "project" | "external" | "session"): KnowledgeSource {
  const id = spaceKind === "personal" ? "p" : spaceKind === "project" ? "pr" : spaceKind === "external" ? "ex" : "se"
  return {
    space: {
      kind: spaceKind,
      id,
      label: id,
    },
    list: async (_opts: ListOptions) => [fakeNote],
    read: async () => null,
    watch: (_onChange) => () => undefined,
  }
}

describe("PersonalSource", () => {
  it("defaults the root locator to UnifiaVault/", () => {
    const s = new PersonalSource({ spaceId: "p1" }, fakeSource("personal"))
    expect(s.space.kind).toBe("personal")
    expect(s.space.rootLocator).toBe(PERSONAL_ROOT_LOCATOR)
  })

  it("accepts a custom root locator", () => {
    const s = new PersonalSource({ spaceId: "p1", rootLocator: "custom/root/" }, fakeSource("personal"))
    expect(s.space.rootLocator).toBe("custom/root/")
  })

  it("delegates list to the underlying implementation", async () => {
    const s = new PersonalSource({ spaceId: "p1" }, fakeSource("personal"))
    const out = await s.list({})
    expect(out).toEqual([fakeNote])
  })
})

describe("ProjectSource", () => {
  it("defaults the root locator to ./", () => {
    const s = new ProjectSource({ projectRef: "unifia" }, fakeSource("project"))
    expect(s.space.kind).toBe("project")
    expect(s.space.rootLocator).toBe(PROJECT_ROOT_LOCATOR)
    expect(s.space.id).toBe("unifia")
  })
})

describe("ExternalSource", () => {
  it("defaults capabilities to [read] only", () => {
    const s = new ExternalSource({ mountId: "m1", label: "Mount" }, fakeSource("external"))
    expect(s.space.kind).toBe("external")
    expect(s.space.capabilities).toEqual(["read"])
    expect(s.canRead).toBe(true)
    expect(s.canWatch).toBe(false)
    expect(s.canWrite).toBe(false)
    expect(s.canMetadataWrite).toBe(false)
  })

  it("reports capabilities accurately", () => {
    const s = new ExternalSource(
      { mountId: "m2", label: "Mount", capabilities: ["read", "watch", "write"] },
      fakeSource("external"),
    )
    expect(s.canRead).toBe(true)
    expect(s.canWatch).toBe(true)
    expect(s.canWrite).toBe(true)
    expect(s.canMetadataWrite).toBe(false)
  })
})

describe("SessionSource", () => {
  it("exposes a session space with the session id", () => {
    const s = new SessionSource({ sessionId: "s-42" }, fakeSource("session"))
    expect(s.space.kind).toBe("session")
    expect(s.space.id).toBe("s-42")
    expect(s.space.rootLocator).toBeUndefined()
  })
})

describe("SourceRegistry", () => {
  it("registers and queries sources by kind", () => {
    const reg = new SourceRegistry()
    const p = new PersonalSource({ spaceId: "p" }, fakeSource("personal"))
    const pr = new ProjectSource({ projectRef: "unifia" }, fakeSource("project"))
    reg.register(p)
    reg.register(pr)
    expect(reg.byKind("personal")).toBe(p)
    expect(reg.byKind("project")).toBe(pr)
    expect(reg.byKind("external")).toBeUndefined()
    expect(reg.all()).toHaveLength(2)
  })

  it("forwards watch events with the space kind attached", () => {
    const reg = new SourceRegistry()
    const listeners: Array<(e: SourceEvent) => void> = []
    const personalImpl: KnowledgeSource = {
      space: { kind: "personal", id: "p", label: "p" },
      list: async () => [],
      read: async () => null,
      watch: (onChange) => {
        listeners.push(onChange)
        return () => {
          const i = listeners.indexOf(onChange)
          if (i >= 0) listeners.splice(i, 1)
        }
      },
    }
    const p = new PersonalSource({ spaceId: "p" }, personalImpl)
    reg.register(p)

    const received: Array<SourceEvent & { space: string }> = []
    reg.watchAll((e) => {
      received.push(e)
    })

    expect(listeners).toHaveLength(1)
    const listener = listeners[0]
    if (listener === undefined) throw new Error("expected one listener")
    listener({
      kind: "added",
      locator: "x.md",
      id: "0190d2c0-7b00-7000-8000-000000000001",
    })
    expect(received).toHaveLength(1)
    expect(received[0]?.kind).toBe("added")
    expect(received[0]?.space).toBe("personal")
  })

  it("disposes all watchers on dispose()", () => {
    const reg = new SourceRegistry()
    let n = 0
    const impl: KnowledgeSource = {
      space: { kind: "personal", id: "p", label: "p" },
      list: async () => [],
      read: async () => null,
      watch: () => {
        n++
        return () => {
          n--
        }
      },
    }
    reg.register(new PersonalSource({ spaceId: "p" }, impl))
    reg.register(new PersonalSource({ spaceId: "p2" }, impl))
    reg.watchAll(() => undefined)
    expect(n).toBe(2)
    reg.dispose()
    expect(n).toBe(0)
  })
})
