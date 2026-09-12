/* SPDX-License-Identifier: MIT */

// The artifact routes all authorize a workspaceId, but ArtifactStore.list()
// reads one directory and takes no workspace. Wiring a single store for the
// whole sidecar would therefore have let workspace A enumerate and read
// workspace B's artifacts while every authorization check still passed —
// the storage layer has to honour the same boundary the routes do.

import { describe, expect, it } from "vitest"
import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { artifactStoreResolver, createWorkbenchApp } from "../src/bootstrap.js"
import { SURFACE_GRANTED_CAPABILITIES } from "../src/index.js"
import { SURFACE_LEASE_CAPABILITIES } from "@unifia/workbench-shell"

function makeApp(root: string) {
  return createWorkbenchApp({
    signingKey: "k".repeat(48), issuer: "unifia-local", audience: "workbench",
    host: "127.0.0.1", port: 0, runtime: "fake",
    auditLogPath: path.join(root, "audit.jsonl"), rateBudget: 500, rateWindowMs: 60_000,
    allowlistedCapabilities: new Set(SURFACE_GRANTED_CAPABILITIES),
    artifactRoot: root, presentLinkTtlMs: 60_000,
  })
}

describe("artifact lineage is scoped to its workspace", () => {
  it("one workspace can neither list nor read another's artifacts", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "unifia-isolation-"))
    const app = makeApp(root)
    const alpha = await app.workspace.register({ name: "alpha", path: mkdtempSync(path.join(tmpdir(), "alpha-")) })
    const beta = await app.workspace.register({ name: "beta", path: mkdtempSync(path.join(tmpdir(), "beta-")) })
    const tokenFor = async (workspaceId: string) =>
      (await app.server.issueNativeScopedToken({ principalId: "p", workspaceId, capabilities: [...SURFACE_LEASE_CAPABILITIES] })).token
    const alphaToken = await tokenFor(alpha.id)
    const betaToken = await tokenFor(beta.id)

    const created = await app.server.fetch(new Request("http://localhost/v1/artifacts", {
      method: "POST",
      headers: { authorization: `Bearer ${alphaToken}`, "content-type": "application/json" },
      body: JSON.stringify({ workspaceId: alpha.id, kind: "design/render", filename: "secret.html", content: "<html>alpha</html>" }),
    }))
    expect(created.status).toBe(201)
    const artifactId = ((await created.json()) as { artifact: { artifactId: string } }).artifact.artifactId

    const ownList = await app.server.fetch(new Request(`http://localhost/v1/artifacts?workspaceId=${alpha.id}`, { headers: { authorization: `Bearer ${alphaToken}` } }))
    expect(((await ownList.json()) as { artifacts: unknown[] }).artifacts).toHaveLength(1)

    const foreignList = await app.server.fetch(new Request(`http://localhost/v1/artifacts?workspaceId=${beta.id}`, { headers: { authorization: `Bearer ${betaToken}` } }))
    expect(((await foreignList.json()) as { artifacts: unknown[] }).artifacts).toHaveLength(0)

    const foreignRead = await app.server.fetch(new Request(`http://localhost/v1/artifacts/${artifactId}?workspaceId=${beta.id}`, { headers: { authorization: `Bearer ${betaToken}` } }))
    expect(foreignRead.status).toBe(404)

    const foreignRaw = await app.server.fetch(new Request(`http://localhost/v1/artifacts/${artifactId}/raw/secret.html?workspaceId=${beta.id}`, { headers: { authorization: `Bearer ${betaToken}` } }))
    expect(foreignRaw.status).toBe(403)
  })

  it("refuses a workspace id that would climb out of the artifact root", () => {
    const resolve = artifactStoreResolver(mkdtempSync(path.join(tmpdir(), "unifia-root-")))
    expect(() => resolve("..")).toThrow()
    expect(() => resolve("../../etc")).toThrow()
    expect(() => resolve("a/b")).toThrow()
    expect(() => resolve("")).toThrow()
  })

  it("reuses one store per workspace", () => {
    const resolve = artifactStoreResolver(mkdtempSync(path.join(tmpdir(), "unifia-root-")))
    expect(resolve("ws-1")).toBe(resolve("ws-1"))
    expect(resolve("ws-1")).not.toBe(resolve("ws-2"))
  })
})
