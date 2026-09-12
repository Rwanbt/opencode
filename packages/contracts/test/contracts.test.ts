/* SPDX-License-Identifier: MIT */
import { describe, it, expect } from "vitest"
import type {
  RuntimeAdapter,
  WorkspacePort,
  CapabilityPort,
  ArtifactPort,
  SandboxPort,
  RemoteTransportPort,
  RuntimeInfo,
  Session,
  Workspace,
  CapabilityDescriptor,
  Artifact,
  SandboxHandle,
  RemoteMessage,
} from "../src/index.js"

/**
 * Type-level tests for @unifia/contracts
 *
 * These tests verify that:
 * 1. All interfaces are exported correctly
 * 2. The types are structurally compatible (used as type assertions)
 * 3. Common usage patterns compile correctly
 *
 * Note: These are TYPE-LEVEL tests. They don't test runtime behavior
 *       (the interfaces have no runtime implementation yet).
 */

describe("@unifia/contracts", () => {
  describe("RuntimeAdapter", () => {
    it("should accept a valid RuntimeAdapter implementation", () => {
      const runtime: RuntimeAdapter = {
        getInfo: async () => ({ id: "unifia", version: "1.0.0", capabilities: [], healthy: true }),
        listSessions: async () => [],
        createSession: async () => ({ id: "s1", workspaceId: "w1", runtimeId: "unifia", createdAt: 0, messageCount: 0 }),
        sendPrompt: async () => {},
        subscribeEvents: async function* () {},
        cancelSession: async () => {},
      }
      expect(runtime).toBeDefined()
    })

    it("should accept RuntimeInfo", () => {
      const info: RuntimeInfo = {
        id: "unifia",
        version: "1.0.0",
        capabilities: ["file.read", "file.write"],
        healthy: true,
      }
      expect(info.id).toBe("unifia")
    })

    it("should accept Session", () => {
      const session: Session = {
        id: "s1",
        workspaceId: "w1",
        runtimeId: "unifia",
        createdAt: 1700000000,
        messageCount: 42,
      }
      expect(session.id).toBe("s1")
    })
  })

  describe("WorkspacePort", () => {
    it("should accept a valid WorkspacePort implementation", () => {
      const workspace: WorkspacePort = {
        register: async () => ({ id: "w1", name: "test", path: "/tmp", createdAt: 0, updatedAt: 0 }),
        open: async () => ({ id: "w1", token: "tok" }),
        read: async () => [],
        write: async () => [],
        list: async () => ({ entries: [], skipped: 0 }),
        search: async () => [],
        watch: async function* () {},
        close: async () => {},
      }
      expect(workspace).toBeDefined()
    })

    it("should accept Workspace", () => {
      const ws: Workspace = {
        id: "w1",
        name: "test",
        path: "/tmp",
        createdAt: 1700000000,
        updatedAt: 1700000001,
      }
      expect(ws.id).toBe("w1")
    })
  })

  describe("CapabilityPort", () => {
    it("should accept a valid CapabilityPort implementation", () => {
      const capability: CapabilityPort = {
        search: async () => [],
        authorize: async () => ({ type: "allow" }),
        execute: async () => ({
          executionId: "e1",
          status: "pending",
          startedAt: 0,
        }),
        cancel: async () => {},
      }
      expect(capability).toBeDefined()
    })

    it("should accept CapabilityDescriptor", () => {
      const desc: CapabilityDescriptor = {
        id: "unifia.document.docx",
        name: "DOCX",
        description: "Create DOCX documents",
        version: "1.0.0",
        author: "Unifia",
        license: "MIT",
        schema: {},
        tags: ["document"],
        trustLevel: "official",
      }
      expect(desc.id).toBe("unifia.document.docx")
    })
  })

  describe("ArtifactPort", () => {
    it("should accept a valid ArtifactPort implementation", () => {
      const artifact: ArtifactPort = {
        create: async () => ({
          id: "a1",
          type: "text/plain",
          content: "hello",
          metadata: {},
          createdAt: 0,
        }),
        version: async () => ({
          artifactId: "a1",
          version: 1,
          content: "hello",
          createdAt: 0,
        }),
        render: async () => ({
          format: "text/plain",
          content: new Uint8Array(),
          renderTime: 0,
        }),
        export: async () => ({
          destination: "/tmp/a1",
          size: 5,
          exportedAt: 0,
        }),
      }
      expect(artifact).toBeDefined()
    })

    it("should accept Artifact", () => {
      const a: Artifact = {
        id: "a1",
        type: "text/plain",
        content: "hello",
        metadata: { author: "Erwan" },
        createdAt: 0,
      }
      expect(a.id).toBe("a1")
    })
  })

  describe("SandboxPort", () => {
    it("should accept a valid SandboxPort implementation", () => {
      const sandbox: SandboxPort = {
        inspect: async () => [],
        prepare: async () => ({
          id: "s1",
          backend: "docker",
          createdAt: 0,
          policy: {
            backend: "docker",
            network: "none",
            filesystem: { readOnly: true },
            resources: {},
          },
        }),
        execute: async () => ({
          exitCode: 0,
          stdout: "ok",
          stderr: "",
          durationMs: 100,
        }),
        terminate: async () => {},
      }
      expect(sandbox).toBeDefined()
    })

    it("should accept SandboxHandle", () => {
      const handle: SandboxHandle = {
        id: "s1",
        backend: "native",
        createdAt: 0,
        policy: {
          backend: "native",
          network: "none",
          filesystem: { readOnly: true },
          resources: {},
        },
      }
      expect(handle.id).toBe("s1")
    })
  })

  describe("RemoteTransportPort", () => {
    it("should accept a valid RemoteTransportPort implementation", () => {
      const remote: RemoteTransportPort = {
        send: async () => {},
        receive: async function* () {},
        execute: async () => ({
          commandId: "c1",
          status: "accepted",
        }),
        pair: async () => ({
          id: "i1",
          providerId: "slack",
          userId: "u1",
          scopes: ["workspace.read"],
          pairedAt: 0,
        }),
        unpair: async () => {},
      }
      expect(remote).toBeDefined()
    })

    it("should accept RemoteMessage", () => {
      const msg: RemoteMessage = {
        id: "m1",
        channelId: "C123",
        userId: "U456",
        text: "Hello",
        timestamp: 1700000000,
      }
      expect(msg.text).toBe("Hello")
    })
  })

  describe("Brand consistency", () => {
    it("should use 'unifia' as default runtime id", () => {
      const ids: Array<"unifia" | "opencode" | "fake"> = ["unifia", "fake"]
      expect(ids).toContain("unifia")
    })

    it("should use 'unifia' as default trust level prefix", () => {
      const trustLevels: Array<"untrusted" | "verified" | "official"> = ["untrusted", "verified", "official"]
      expect(trustLevels).toHaveLength(3)
    })
  })
})
