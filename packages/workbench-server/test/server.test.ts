/* SPDX-License-Identifier: MIT */
import { createHash } from "node:crypto"
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { ApprovalBroker, AuditRuntimeDouble, BrowserAutomationBroker, CapabilityRegistry, DesktopAutomationBroker, McpUiControlBroker, FakeRuntimeAdapter, P3_CAPABILITIES, WORKSPACE_MANIFEST_PATH } from "@unifia/contracts"
import { InMemoryMemoryStore, MemoryRuntime } from "@unifia/memory-runtime"
import { ArtifactStore } from "@unifia/artifact-runtime"
import { WorkspaceRuntime } from "@unifia/workspace-runtime"
import { InMemorySkillRegistry, type InstalledSkill, type SkillManifest, type SkillPackage, type SkillRegistry, type SkillTrust } from "@unifia/skill-hub/node"
import { ApprovalCapabilityGate, FixedWindowRateLimiter, HmacTokenAuthenticator, UnauthenticatedPrincipal, WorkbenchServer, sseFrame } from "../src/index.js"
import { PresentLinkSigner } from "../src/present-link.js"
import { WorkflowRuntimeDouble } from "./workflow-double.js"

/**
 * The legacy assertions below predate principal authentication and carry the
 * file-session token in `Authorization`. They run against an explicitly
 * unauthenticated principal; the dedicated auth block at the end of this file
 * exercises the real HMAC authenticator, scopes and rate limiting.
 *
 * SEC-001/C2-3: #checkCapability now requires the calling principal to hold
 * the capability being checked (or for it to be step-up eligible) before it
 * ever reaches the CapabilityGate. This suite exercises the gate's own
 * allow/deny/approval behavior (capabilityDecision below), not per-token
 * scope enforcement — that is capability-scope.test.ts's job — so testAuth
 * is granted every P3 capability plus the two non-P3 scopes
 * (workspace.register/open) legacy assertions below still need.
 */
const testAuth = new UnauthenticatedPrincipal("anonymous", ["workspace.register", "workspace.open", ...P3_CAPABILITIES])

/**
 * WHY: the summary line used to be a hardcoded string. `check()` counts every
 * assertion it guards so the reported number is derived, not asserted.
 * LEGACY_ASSERTIONS is a manual count of the inline `if (...) throw` checks
 * that predate this helper and are still executed below.
 */
const LEGACY_ASSERTIONS = 49
let checks = 0
const check = (condition: boolean, message: string): void => {
  checks += 1
  if (!condition) throw new Error(message)
}
const skillArtifact = (name: string) => new TextEncoder().encode(name)
const skillDigest = (name: string) => createHash("sha256").update(skillArtifact(name)).digest("hex")
const root = await mkdtemp(path.join(os.tmpdir(), "unifia-server-"))
try {
  await writeFile(path.join(root, "README.md"), "hello")
  await mkdir(path.dirname(path.join(root, WORKSPACE_MANIFEST_PATH)), { recursive: true })
  await writeFile(path.join(root, WORKSPACE_MANIFEST_PATH), JSON.stringify({ version: 1, designSystems: [
    { id: "unifia-system", name: "Unifia", version: "1.0.0", source: "workspace://unifia-system", tokens: { colors: { primary: "#ffffff" }, spacing: { gutter: 24 }, typography: { body: "Inter" } } },
    { id: "alpha-system", name: "Alpha", version: "2.0.0", source: "workspace://alpha-system", tokens: { colors: { primary: "#000000" }, spacing: { gutter: 16 }, typography: { body: "Arial" } } },
  ] }))
  const workspace = new WorkspaceRuntime()
  const artifacts = new ArtifactStore(root, () => 1_000)
  const audit = new AuditRuntimeDouble(() => 1_000)
  let capabilityDecision: "allow" | "deny" = "allow"
  const presentLinks = new PresentLinkSigner("x".repeat(32), 5 * 60_000)
  const server = new WorkbenchServer({ auth: testAuth, workspace, artifacts, runtime: new FakeRuntimeAdapter(() => 1_000), audit, capability: { check: async () => capabilityDecision }, presentLinks })
  const registered = await server.fetch(new Request("http://localhost/v1/workspaces/register", { method: "POST", body: JSON.stringify({ name: "fixture", path: root }) }))
  if (registered.status !== 201) throw new Error("workspace register route failed")
  const registeredBody = await registered.json() as { id: string }
  const opened = await server.fetch(new Request(`http://localhost/v1/workspaces/${registeredBody.id}/open`, { method: "POST" }))
  const handle = await opened.json() as { id: string; token: string }
  const designSystems = await server.fetch(new Request(`http://localhost/v1/design-systems?workspaceId=${handle.id}`, { headers: { authorization: `Bearer ${handle.token}` } }))
  if (designSystems.status !== 200 || ((await designSystems.json()) as { designSystems: readonly unknown[] }).designSystems.length !== 2) throw new Error("workspace manifest did not expose both design systems")
  await rm(path.join(root, WORKSPACE_MANIFEST_PATH))
  const missingDesignSystems = await server.fetch(new Request(`http://localhost/v1/design-systems?workspaceId=${handle.id}`, { headers: { authorization: `Bearer ${handle.token}` } }))
  if (missingDesignSystems.status !== 404) throw new Error("design-system route invented a fallback when the manifest was absent")
  const denied = await server.fetch(new Request(`http://localhost/v1/workspaces/${handle.id}/sessions`))
  if (denied.status !== 403) throw new Error("unscoped session request was accepted")
  const listed = await server.fetch(new Request(`http://localhost/v1/workspaces/${handle.id}/sessions`, { headers: { authorization: `Bearer ${handle.token}` } }))
  if (listed.status !== 200) throw new Error("scoped session list failed")
  const read = await server.fetch(new Request("http://localhost/v1/files/read", { method: "POST", headers: { authorization: `Bearer ${handle.token}` }, body: JSON.stringify({ workspaceId: handle.id, paths: ["README.md"] }) }))
  if (read.status !== 200) throw new Error("scoped file read failed")
  const fileList = await server.fetch(new Request(`http://localhost/v1/files/list?workspaceId=${handle.id}`, { headers: { authorization: `Bearer ${handle.token}` } }))
  if (fileList.status !== 200) throw new Error("scoped file list failed")
  const fileListBody = await fileList.json() as { entries: readonly { path: string }[] }
  if (!fileListBody.entries.some((entry) => entry.path === "README.md")) throw new Error("file list did not return README.md")
  const fileSearch = await server.fetch(new Request(`http://localhost/v1/files/search?workspaceId=${handle.id}&query=readme`, { headers: { authorization: `Bearer ${handle.token}` } }))
  if (fileSearch.status !== 200) throw new Error("scoped file search failed")
  const fileSearchBody = await fileSearch.json() as { entries: readonly { path: string }[] }
  if (fileSearchBody.entries.length !== 1 || fileSearchBody.entries[0]?.path !== "README.md") throw new Error("file search did not filter README.md")

  // Phase 7.3 — Design Files tab CRUD, end-to-end through the real HTTP
  // route (not the runtime directly): create → visible in the listing,
  // rename → old path gone / new path present, remove → gone again.
  const createdFile = await server.fetch(new Request("http://localhost/v1/files/create", { method: "POST", headers: { authorization: `Bearer ${handle.token}` }, body: JSON.stringify({ workspaceId: handle.id, writes: [{ path: "notes/created.txt", content: "hi there" }] }) }))
  check(createdFile.status === 200, "file create route failed")
  const listAfterCreateBody = await (await server.fetch(new Request(`http://localhost/v1/files/list?workspaceId=${handle.id}`, { headers: { authorization: `Bearer ${handle.token}` } }))).json() as { entries: readonly { path: string }[] }
  check(listAfterCreateBody.entries.some((entry) => entry.path === "notes/created.txt"), "created file did not appear in the listing")

  const renamed = await server.fetch(new Request("http://localhost/v1/files/rename", { method: "POST", headers: { authorization: `Bearer ${handle.token}` }, body: JSON.stringify({ workspaceId: handle.id, from: "notes/created.txt", to: "notes/renamed.txt" }) }))
  check(renamed.status === 200, "file rename route failed")
  const renamedBody = await renamed.json() as { result: { path: string } }
  check(renamedBody.result.path === "notes/renamed.txt", "rename route did not report the new path")
  const listAfterRenameBody = await (await server.fetch(new Request(`http://localhost/v1/files/list?workspaceId=${handle.id}`, { headers: { authorization: `Bearer ${handle.token}` } }))).json() as { entries: readonly { path: string }[] }
  check(!listAfterRenameBody.entries.some((entry) => entry.path === "notes/created.txt"), "rename left the old path in the listing")
  check(listAfterRenameBody.entries.some((entry) => entry.path === "notes/renamed.txt"), "rename did not add the new path to the listing")

  const removed = await server.fetch(new Request("http://localhost/v1/files/remove", { method: "POST", headers: { authorization: `Bearer ${handle.token}` }, body: JSON.stringify({ workspaceId: handle.id, paths: ["notes/renamed.txt"] }) }))
  check(removed.status === 200, "file remove route failed")
  const removedBody = await removed.json() as { results: readonly { path: string; removed: boolean }[] }
  check(removedBody.results[0]?.removed === true, "remove route did not report the file as removed")
  const listAfterRemoveBody = await (await server.fetch(new Request(`http://localhost/v1/files/list?workspaceId=${handle.id}`, { headers: { authorization: `Bearer ${handle.token}` } }))).json() as { entries: readonly { path: string }[] }
  check(!listAfterRemoveBody.entries.some((entry) => entry.path === "notes/renamed.txt"), "removed file remained in the listing")
  const artifact = await artifacts.create({ kind: "text", filename: "result.txt", content: "artifact result", provenance: { sourceTool: "test" } })
  const artifactList = await server.fetch(new Request(`http://localhost/v1/artifacts?workspaceId=${handle.id}`, { headers: { authorization: `Bearer ${handle.token}` } }))
  if (artifactList.status !== 200 || !((await artifactList.json()) as { artifacts: readonly { artifactId: string }[] }).artifacts.some((entry) => entry.artifactId === artifact.artifactId)) throw new Error("artifact list route failed")
  const artifactDetail = await server.fetch(new Request(`http://localhost/v1/artifacts/${artifact.artifactId}?workspaceId=${handle.id}`, { headers: { authorization: `Bearer ${handle.token}` } }))
  if (artifactDetail.status !== 200 || ((await artifactDetail.json()) as { encoding: string }).encoding !== "base64") throw new Error("artifact detail route failed")
  const artifactHistory = await server.fetch(new Request(`http://localhost/v1/artifacts/${artifact.artifactId}/history?workspaceId=${handle.id}`, { headers: { authorization: `Bearer ${handle.token}` } }))
  if (artifactHistory.status !== 200 || ((await artifactHistory.json()) as { history: readonly { version: number }[] }).history.length !== 1) throw new Error("artifact history route failed")
  const artifactRevision = await server.fetch(new Request("http://localhost/v1/artifacts", { method: "POST", headers: { authorization: `Bearer ${handle.token}` }, body: JSON.stringify({ workspaceId: handle.id, kind: "text", filename: "result.txt", content: "artifact revision", artifactId: artifact.artifactId, provenance: { sourceTool: "server-test" } }) }))
  if (artifactRevision.status !== 201 || ((await artifactRevision.json()) as { artifact: { version: number } }).artifact.version !== 2) throw new Error("artifact revision route failed")
  const artifactExport = await server.fetch(new Request("http://localhost/v1/artifacts/export", { method: "POST", headers: { authorization: `Bearer ${handle.token}` }, body: JSON.stringify({ workspaceId: handle.id, artifactId: artifact.artifactId, outbox: "server-test" }) }))
  if (artifactExport.status !== 200 || !((await artifactExport.json()) as { exported: { relativePath: string } }).exported.relativePath.includes("server-test")) throw new Error("artifact export route failed")

  // P10 raw artifact read: 200 with the right Content-Type for the closed
  // extension table. Each artifact is created with a filename whose
  // extension picks the corresponding Content-Type. The route must also
  // set X-Content-Type-Options: nosniff on every response.
  const htmlArtifact = await artifacts.create({ kind: "text", filename: "page.html", content: "<!doctype html><title>hi</title>", provenance: { sourceTool: "p10-test" } })
  const cssArtifact = await artifacts.create({ kind: "text", filename: "style.css", content: "body { color: red; }", provenance: { sourceTool: "p10-test" } })
  const jsArtifact = await artifacts.create({ kind: "text", filename: "app.js", content: "console.log(1)", provenance: { sourceTool: "p10-test" } })
  const svgArtifact = await artifacts.create({ kind: "text", filename: "icon.svg", content: "<svg></svg>", provenance: { sourceTool: "p10-test" } })
  const pngArtifact = await artifacts.create({ kind: "binary", filename: "pixel.png", content: new Uint8Array([0x89, 0x50, 0x4e, 0x47]), provenance: { sourceTool: "p10-test" } })
  const unknownArtifact = await artifacts.create({ kind: "text", filename: "weird.qzx", content: "unknown", provenance: { sourceTool: "p10-test" } })

  const checkRaw = async (artifactId: string, rawPath: string): Promise<{ status: number; contentType: string; disposition: string; body: string }> => {
    const response = await server.fetch(new Request(`http://localhost/v1/artifacts/${artifactId}/raw/${rawPath}?workspaceId=${handle.id}`, { headers: { authorization: `Bearer ${handle.token}` } }))
    return {
      status: response.status,
      contentType: response.headers.get("content-type") ?? "",
      disposition: response.headers.get("content-disposition") ?? "",
      body: response.status === 200 ? new TextDecoder().decode(await response.arrayBuffer()) : "",
    }
  }
  const checkNosniff = async (artifactId: string, rawPath: string): Promise<boolean> => {
    const response = await server.fetch(new Request(`http://localhost/v1/artifacts/${artifactId}/raw/${rawPath}?workspaceId=${handle.id}`, { headers: { authorization: `Bearer ${handle.token}` } }))
    return response.headers.get("x-content-type-options") === "nosniff"
  }

  const htmlRaw = await checkRaw(htmlArtifact.artifactId, "page.html")
  if (htmlRaw.status !== 200) throw new Error("P10: html raw did not return 200")
  if (!htmlRaw.contentType.startsWith("text/html")) throw new Error(`P10: html raw content-type was ${htmlRaw.contentType}`)
  if (htmlRaw.disposition !== 'inline; filename="page.html"') throw new Error(`P10: html raw disposition was ${htmlRaw.disposition}`)
  if (!htmlRaw.body.includes("<title>hi</title>")) throw new Error("P10: html raw body did not contain the artifact bytes")
  if (!(await checkNosniff(htmlArtifact.artifactId, "page.html"))) throw new Error("P10: html raw missing x-content-type-options: nosniff")

  const cssRaw = await checkRaw(cssArtifact.artifactId, "style.css")
  if (cssRaw.status !== 200 || !cssRaw.contentType.startsWith("text/css")) throw new Error(`P10: css raw ${cssRaw.status} ${cssRaw.contentType}`)

  const jsRaw = await checkRaw(jsArtifact.artifactId, "app.js")
  if (jsRaw.status !== 200 || !jsRaw.contentType.startsWith("text/javascript")) throw new Error(`P10: js raw ${jsRaw.status} ${jsRaw.contentType}`)

  const svgRaw = await checkRaw(svgArtifact.artifactId, "icon.svg")
  if (svgRaw.status !== 200 || !svgRaw.contentType.startsWith("image/svg+xml")) throw new Error(`P10: svg raw ${svgRaw.status} ${svgRaw.contentType}`)

  const pngRaw = await checkRaw(pngArtifact.artifactId, "pixel.png")
  if (pngRaw.status !== 200 || pngRaw.contentType !== "image/png") throw new Error(`P10: png raw ${pngRaw.status} ${pngRaw.contentType}`)

  const unknownRaw = await checkRaw(unknownArtifact.artifactId, "weird.qzx")
  if (unknownRaw.status !== 200) throw new Error(`P10: unknown ext did not return 200, got ${unknownRaw.status}`)
  if (unknownRaw.contentType !== "application/octet-stream") throw new Error(`P10: unknown ext content-type was ${unknownRaw.contentType}`)
  if (!unknownRaw.disposition.startsWith("attachment")) throw new Error(`P10: unknown ext disposition was ${unknownRaw.disposition}`)

  // P10: a path that does not match the artifact's filename is rejected
  // as 403 (not 404) so a caller cannot probe for artifacts they do not
  // already have a token for.
  const wrongPath = await checkRaw(htmlArtifact.artifactId, "wrong.html")
  if (wrongPath.status !== 403) throw new Error(`P10: wrong path was ${wrongPath.status}, expected 403`)

  // P10: .. and absolute paths are rejected as 403. The URL parser
  // collapses literal `..` segments, so the percent-encoded form
  // (`%2E%2E`) is what actually reaches the route — both shapes
  // (literal and encoded) carry the same threat and the same
  // rejection rule.
  const dotdotPath = await checkRaw(htmlArtifact.artifactId, "%2E%2E%2Fetc%2Fpasswd")
  if (dotdotPath.status !== 403) throw new Error(`P10: .. path was ${dotdotPath.status}, expected 403`)
  const absolutePath = await checkRaw(htmlArtifact.artifactId, "%2Fetc%2Fpasswd")
  if (absolutePath.status !== 403) throw new Error(`P10: absolute path was ${absolutePath.status}, expected 403`)

  // P10: capability denied yields 403 even when the path and artifact
  // would otherwise resolve. The denial happens before the artifact
  // lookup, so a denied caller cannot probe for the existence of any
  // artifact by its id either.
  capabilityDecision = "deny"
  const deniedRaw = await checkRaw(htmlArtifact.artifactId, "page.html")
  if (deniedRaw.status !== 403) throw new Error(`P10: denied capability was ${deniedRaw.status}, expected 403`)
  capabilityDecision = "allow"

  // Phase 9.4 — present links: mint (authenticated, capability-gated) then
  // fetch the minted URL with NO Authorization header at all — that's the
  // point of the feature — and confirm it serves the exact artifact bytes.
  const presentLinkMint = await server.fetch(new Request(`http://localhost/v1/artifacts/${htmlArtifact.artifactId}/present`, { method: "POST", headers: { authorization: `Bearer ${handle.token}` }, body: JSON.stringify({ workspaceId: handle.id }) }))
  check(presentLinkMint.status === 200, "present link mint route failed")
  const presentLinkBody = await presentLinkMint.json() as { url: string; expiresAt: number }
  check(presentLinkBody.url.includes("/present?token="), "present link mint did not return a token URL")
  const presentLinkPath = presentLinkBody.url.replace("http://localhost", "")
  const presentedNoAuth = await server.fetch(new Request(`http://localhost${presentLinkPath}`))
  check(presentedNoAuth.status === 200, "present link fetch without any Authorization header failed")
  check((await presentedNoAuth.text()) === "<!doctype html><title>hi</title>", "present link did not serve the artifact's exact content")
  const presentedWrongArtifact = await server.fetch(new Request(`http://localhost/v1/artifacts/${artifact.artifactId}/present?token=${encodeURIComponent(new URL(presentLinkBody.url).searchParams.get("token") ?? "")}`))
  check(presentedWrongArtifact.status === 403, "a present token minted for one artifact was accepted for another")
  const presentedNoToken = await server.fetch(new Request(`http://localhost/v1/artifacts/${htmlArtifact.artifactId}/present`))
  check(presentedNoToken.status === 400, "present route without a token did not refuse")

  const specValidation = await server.fetch(new Request("http://localhost/v1/specs/validate", { method: "POST", headers: { authorization: `Bearer ${handle.token}` }, body: JSON.stringify({ workspaceId: handle.id, spec: { id: "server-spec", version: "1.0.0", target: "design", title: "Server spec", capabilities: ["artifact.export"], rules: [] } }) }))
  if (specValidation.status !== 200 || ((await specValidation.json()) as { capabilities: { granted: readonly string[]; denied: readonly string[] } }).capabilities.denied[0] !== "artifact.export") throw new Error("spec validation route widened capabilities")
  const documents = await server.fetch(new Request(`http://localhost/v1/documents?workspaceId=${handle.id}`, { headers: { authorization: `Bearer ${handle.token}` } }))
  if (documents.status !== 200 || !((await documents.json()) as { documents: readonly { artifactId: string }[] }).documents.some((entry) => entry.artifactId === artifact.artifactId)) throw new Error("document list route failed")
  capabilityDecision = "deny"
  const deniedWrite = await server.fetch(new Request("http://localhost/v1/files/write", { method: "POST", headers: { authorization: `Bearer ${handle.token}` }, body: JSON.stringify({ workspaceId: handle.id, writes: [{ path: "README.md", content: "blocked" }] }) }))
  if (deniedWrite.status !== 403) throw new Error("capability gate did not deny write")
  capabilityDecision = "allow"
  const created = await server.fetch(new Request(`http://localhost/v1/workspaces/${handle.id}/sessions`, { method: "POST", headers: { authorization: `Bearer ${handle.token}` } }))
  const session = (await created.json() as { session: { id: string } }).session
  const events = await server.fetch(new Request(`http://localhost/v1/sessions/${session.id}/events`, { headers: { authorization: `Bearer ${handle.token}` } }))
  if (events.status !== 200 || !events.body) throw new Error("scoped event stream failed")
  const reader = events.body.getReader()
  const openingChunk = await Promise.race([reader.read(), new Promise<never>((_, reject) => setTimeout(() => reject(new Error("opening frame timeout")), 5_000))])
  check(!openingChunk.done && new TextDecoder().decode(openingChunk.value) === ": unifia stream open\n\n", "the stream did not flush an opening comment frame")
  const pendingEvent = reader.read()
  const prompt = await server.fetch(new Request(`http://localhost/v1/sessions/${session.id}/prompt`, { method: "POST", headers: { authorization: `Bearer ${handle.token}` }, body: JSON.stringify({ prompt: "hello" }) }))
  const eventChunk = await Promise.race([pendingEvent, new Promise<never>((_, reject) => setTimeout(() => reject(new Error("event stream timeout")), 5_000))])
  await reader.cancel()
  if (eventChunk.done || !new TextDecoder().decode(eventChunk.value).includes("hello")) throw new Error("runtime event was not streamed")
  const eventFrame = new TextDecoder().decode(eventChunk.value)
  check(!eventFrame.includes("\\n"), "SSE frame contains a literal backslash-n instead of a newline")
  check(eventFrame.endsWith("\n\n"), "SSE frame is not terminated by a blank line")
  const frameLines = eventFrame.split("\n")
  check(frameLines[0].startsWith("id: "), "SSE frame does not start with an id line")
  check(frameLines[1].startsWith("data: "), "SSE frame does not carry a data line")
  check(JSON.parse(frameLines[1].slice(6)).sequence === 1, "SSE data line is not parseable JSON with a sequence")
  check(sseFrame({ sequence: 7 }) === `id: 7\ndata: {"sequence":7}\n\n`, "sseFrame did not emit a wire-format frame")
  check(sseFrame({}) === `data: {}\n\n`, "sseFrame emitted an empty id line when no sequence exists")
  if (prompt.status !== 202) throw new Error("scoped prompt failed")
  const reconnectPrompt = await server.fetch(new Request(`http://localhost/v1/sessions/${session.id}/prompt`, { method: "POST", headers: { authorization: `Bearer ${handle.token}` }, body: JSON.stringify({ prompt: "reconnected" }) }))
  if (reconnectPrompt.status !== 202) throw new Error("second scoped prompt failed")
  const resumed = await server.fetch(new Request(`http://localhost/v1/sessions/${session.id}/events`, { headers: { authorization: `Bearer ${handle.token}`, "last-event-id": "1" } }))
  if (!resumed.body) throw new Error("resumed event stream missing body")
  const resumedReader = resumed.body.getReader()
  await resumedReader.read() // opening comment frame
  const resumedChunk = await Promise.race([resumedReader.read(), new Promise<never>((_, reject) => setTimeout(() => reject(new Error("resumed event timeout")), 5_000))])
  await resumedReader.cancel()
  if (resumedChunk.done || !new TextDecoder().decode(resumedChunk.value).includes("reconnected")) throw new Error("SSE cursor did not resume from sequence")
  if (audit.events().filter((event) => event.decision === "deny").length < 1) throw new Error("denied request was not audited")
  const pending = await new ApprovalCapabilityGate(new ApprovalBroker(() => 1_000)).check("workspace.write", handle.id, "actor")
  if (typeof pending !== "object" || pending.kind !== "approval_required") throw new Error("ApprovalCapabilityGate did not require approval")
  const approvalBroker = new ApprovalBroker(() => 1_000)
  // C2-5: the gate's own clock must match the broker's, or resolvedAt (set
  // from the broker's clock) is compared against a different clock and a
  // freshly granted approval reads as already expired.
  const approvalServer = new WorkbenchServer({ auth: testAuth, workspace, runtime: new FakeRuntimeAdapter(() => 1_000), audit, capability: new ApprovalCapabilityGate(approvalBroker, undefined, undefined, undefined, () => 1_000) })
  const approvalOpen = await approvalServer.fetch(new Request(`http://localhost/v1/workspaces/${handle.id}/open`, { method: "POST" }))
  const approvalHandle = await approvalOpen.json() as { id: string; token: string }
  const approvalRequestResponse = await approvalServer.fetch(new Request("http://localhost/v1/files/write", { method: "POST", headers: { authorization: `Bearer ${approvalHandle.token}` }, body: JSON.stringify({ workspaceId: approvalHandle.id, writes: [{ path: "README.md", content: "approved" }] }) }))
  const approvalRequest = await approvalRequestResponse.json() as { approvalId: string }
  if (approvalRequestResponse.status !== 202 || !approvalRequest.approvalId) throw new Error("server did not return approval_required")
  const pendingApprovals = await approvalServer.fetch(new Request(`http://localhost/v1/approvals?workspaceId=${approvalHandle.id}`, { headers: { authorization: `Bearer ${approvalHandle.token}` } }))
  if (pendingApprovals.status !== 200 || ((await pendingApprovals.json()) as { approvals: readonly { id: string }[] }).approvals[0]?.id !== approvalRequest.approvalId) throw new Error("pending approval list failed")
  const resolved = await approvalServer.fetch(new Request(`http://localhost/v1/approvals/${approvalRequest.approvalId}`, { method: "POST", headers: { authorization: `Bearer ${approvalHandle.token}` }, body: JSON.stringify({ decision: "allow" }) }))
  if (resolved.status !== 200) throw new Error("scoped approval resolve failed")
  const retried = await approvalServer.fetch(new Request("http://localhost/v1/files/write", { method: "POST", headers: { authorization: `Bearer ${approvalHandle.token}` }, body: JSON.stringify({ workspaceId: approvalHandle.id, writes: [{ path: "README.md", content: "approved" }] }) }))
  if (retried.status !== 200) throw new Error("approved write was not retried")
  const trace = await server.fetch(new Request(`http://localhost/v1/trace?workspaceId=${handle.id}&limit=2`, { headers: { authorization: `Bearer ${handle.token}` } }))
  if (trace.status !== 200 || !((await trace.json()) as { events: readonly unknown[] }).events.length) throw new Error("trace pagination failed")
  const browser = new BrowserAutomationBroker({ navigate: async () => {}, snapshot: async () => ({ title: "fixture" }), screenshot: async () => new Uint8Array([1, 2]), quarantineDownload: async () => "quarantine/result" }, ["example.com"])
  const browserServer = new WorkbenchServer({ auth: testAuth, workspace, runtime: new FakeRuntimeAdapter(() => 1_000), audit, capability: { check: async () => "allow" }, browser })
  const browserOpen = await browserServer.fetch(new Request(`http://localhost/v1/workspaces/${handle.id}/open`, { method: "POST" }))
  const browserHandle = await browserOpen.json() as { id: string; token: string }
  const browserNavigate = await browserServer.fetch(new Request("http://localhost/v1/browser/navigate", { method: "POST", headers: { authorization: `Bearer ${browserHandle.token}` }, body: JSON.stringify({ workspaceId: browserHandle.id, url: "https://example.com" }) }))
  if (browserNavigate.status !== 202) throw new Error("browser navigate route failed")
  const browserScreenshot = await browserServer.fetch(new Request("http://localhost/v1/browser/screenshot", { method: "POST", headers: { authorization: `Bearer ${browserHandle.token}` }, body: JSON.stringify({ workspaceId: browserHandle.id }) }))
  if (browserScreenshot.status !== 200) throw new Error("browser screenshot route failed")
  const capabilities = new CapabilityRegistry({ verify: () => true })
  const capabilityServer = new WorkbenchServer({ auth: testAuth, workspace, runtime: new FakeRuntimeAdapter(() => 1_000), audit, capability: { check: async () => "allow" }, capabilities })
  const capabilityOpen = await capabilityServer.fetch(new Request(`http://localhost/v1/workspaces/${handle.id}/open`, { method: "POST" }))
  const capabilityHandle = await capabilityOpen.json() as { id: string; token: string }
  const manifest = { descriptor: { id: "prompt-pack/test", name: "Test", description: "test", version: "1.0.0", author: "Unifia", license: "MIT", schema: {}, tags: ["test"], trustLevel: "verified" }, digest: "sha256:test", sourceRepo: "local", sourceCommit: "abc", license: "MIT", remoteCode: false, signature: "valid" }
  const capabilityRegister = await capabilityServer.fetch(new Request("http://localhost/v1/capabilities/register", { method: "POST", headers: { authorization: `Bearer ${capabilityHandle.token}` }, body: JSON.stringify({ workspaceId: capabilityHandle.id, manifest }) }))
  if (capabilityRegister.status !== 201) throw new Error("capability register route failed")
  await capabilityServer.fetch(new Request("http://localhost/v1/capabilities/approve", { method: "POST", headers: { authorization: `Bearer ${capabilityHandle.token}` }, body: JSON.stringify({ workspaceId: capabilityHandle.id, digest: "sha256:test" }) }))
  const capabilityEnable = await capabilityServer.fetch(new Request("http://localhost/v1/capabilities/enable", { method: "POST", headers: { authorization: `Bearer ${capabilityHandle.token}` }, body: JSON.stringify({ workspaceId: capabilityHandle.id, digest: "sha256:test" }) }))
  if (capabilityEnable.status !== 200) throw new Error("capability enable route failed")
  const capabilitySearch = await capabilityServer.fetch(new Request(`http://localhost/v1/capabilities/search?workspaceId=${capabilityHandle.id}&enabledOnly=true`, { headers: { authorization: `Bearer ${capabilityHandle.token}` } }))
  if (capabilitySearch.status !== 200) throw new Error("capability search route failed")
  const ui = new McpUiControlBroker({ inspect: async (componentId) => ({ componentId }), execute: async () => ({}) }, ["panel-main"], { request: () => ({ id: "ui-approval-1" }) })
  const uiServer = new WorkbenchServer({ auth: testAuth, workspace, runtime: new FakeRuntimeAdapter(() => 1_000), audit, capability: { check: async () => "allow" }, ui, uiAllowedActions: new Set(["ui.inspect"]) })
  const uiOpen = await uiServer.fetch(new Request(`http://localhost/v1/workspaces/${handle.id}/open`, { method: "POST" }))
  const uiHandle = await uiOpen.json() as { id: string; token: string }
  const uiAction = await uiServer.fetch(new Request("http://localhost/v1/ui/actions", { method: "POST", headers: { authorization: `Bearer ${uiHandle.token}` }, body: JSON.stringify({ workspaceId: uiHandle.id, action: { id: "inspect-main", componentId: "panel-main", kind: "inspect" } }) }))
  if (uiAction.status !== 200) throw new Error("MCP UI route failed")
  const renderedUi = await uiServer.fetch(new Request("http://localhost/v1/ui/render", { method: "POST", headers: { authorization: `Bearer ${uiHandle.token}` }, body: JSON.stringify({ workspaceId: uiHandle.id, node: { type: "button", id: "run", props: { label: "Run", actionId: "ui.inspect", onclick: "evil()" } } }) }))
  if (renderedUi.status !== 200) throw new Error("Generative UI render route failed")
  const renderedBody = await renderedUi.json() as { rendered: { props: Record<string, string> } }
  if (renderedBody.rendered.props.onclick !== undefined || renderedBody.rendered.props.actionId !== "ui.inspect") throw new Error("Generative UI renderer did not filter props")
  const blockedUi = await uiServer.fetch(new Request("http://localhost/v1/ui/render", { method: "POST", headers: { authorization: `Bearer ${uiHandle.token}` }, body: JSON.stringify({ workspaceId: uiHandle.id, node: { type: "button", id: "blocked", props: { actionId: "ui.shutdown" } } }) }))
  if (blockedUi.status !== 400) throw new Error("Generative UI renderer accepted an unallowlisted action")
  const missingUi = new WorkbenchServer({ auth: testAuth, workspace, runtime: new FakeRuntimeAdapter(() => 1_000), audit, capability: { check: async () => "allow" } })
  const missingUiOpen = await missingUi.fetch(new Request(`http://localhost/v1/workspaces/${handle.id}/open`, { method: "POST" }))
  const missingUiHandle = await missingUiOpen.json() as { id: string; token: string }
  const unavailableUi = await missingUi.fetch(new Request("http://localhost/v1/ui/render", { method: "POST", headers: { authorization: `Bearer ${missingUiHandle.token}` }, body: JSON.stringify({ workspaceId: missingUiHandle.id, node: { type: "text", id: "x", props: { value: "x" } } }) }))
  if (unavailableUi.status !== 503) throw new Error("Generative UI route did not fail closed when unavailable")
  const memory = new MemoryRuntime(new InMemoryMemoryStore())
  const memoryServer = new WorkbenchServer({ auth: testAuth, workspace, runtime: new FakeRuntimeAdapter(() => 1_000), audit, capability: { check: async () => "allow" }, memory })
  const memoryOpen = await memoryServer.fetch(new Request(`http://localhost/v1/workspaces/${handle.id}/open`, { method: "POST" }))
  const memoryHandle = await memoryOpen.json() as { id: string; token: string }
  const remembered = await memoryServer.fetch(new Request("http://localhost/v1/memory/remember", { method: "POST", headers: { authorization: `Bearer ${memoryHandle.token}` }, body: JSON.stringify({ workspaceId: memoryHandle.id, content: "visible memory", source: "user" }) }))
  if (remembered.status !== 201) throw new Error("memory remember route failed")
  const foundMemory = await memoryServer.fetch(new Request(`http://localhost/v1/memory/search?workspaceId=${memoryHandle.id}&text=visible`, { headers: { authorization: `Bearer ${memoryHandle.token}` } }))
  if (foundMemory.status !== 200) throw new Error("memory search route failed")
  const workflow = new WorkflowRuntimeDouble()
  const workflowServer = new WorkbenchServer({ auth: testAuth, workspace, runtime: new FakeRuntimeAdapter(() => 1_000), audit, capability: { check: async () => "allow" }, workflow })
  const workflowOpen = await workflowServer.fetch(new Request(`http://localhost/v1/workspaces/${handle.id}/open`, { method: "POST" }))
  const workflowHandle = await workflowOpen.json() as { id: string; token: string }
  const workflowStart = await workflowServer.fetch(new Request("http://localhost/v1/workflows/start", { method: "POST", headers: { authorization: `Bearer ${workflowHandle.token}` }, body: JSON.stringify({ workspaceId: workflowHandle.id, definition: { id: "wf-server", version: 1, workspaceId: workflowHandle.id, steps: [] } }) }))
  if (workflowStart.status !== 202) throw new Error("workflow start route failed")
  const workflowState = await workflowStart.json() as { state: { workflowId: string } }
  const workflowCancel = await workflowServer.fetch(new Request("http://localhost/v1/workflows/cancel", { method: "POST", headers: { authorization: `Bearer ${workflowHandle.token}` }, body: JSON.stringify({ workflowId: workflowState.state.workflowId }) }))
  if (workflowCancel.status !== 200) throw new Error("workflow cancel route failed")
  const desktop = new DesktopAutomationBroker({ observe: async () => ({ appId: "allowed-app", redacted: true }), control: async () => {} }, ["allowed-app"])
  const desktopServer = new WorkbenchServer({ auth: testAuth, workspace, runtime: new FakeRuntimeAdapter(() => 1_000), audit, capability: { check: async () => "allow" }, desktop })
  const desktopOpen = await desktopServer.fetch(new Request(`http://localhost/v1/workspaces/${handle.id}/open`, { method: "POST" }))
  const desktopHandle = await desktopOpen.json() as { id: string; token: string }
  const observed = await desktopServer.fetch(new Request("http://localhost/v1/desktop/observe", { method: "POST", headers: { authorization: `Bearer ${desktopHandle.token}` }, body: JSON.stringify({ workspaceId: desktopHandle.id, appId: "allowed-app" }) }))
  if (observed.status !== 200) throw new Error("desktop observe route failed")
  const controlled = await desktopServer.fetch(new Request("http://localhost/v1/desktop/control", { method: "POST", headers: { authorization: `Bearer ${desktopHandle.token}` }, body: JSON.stringify({ workspaceId: desktopHandle.id, appId: "allowed-app", action: "mouse", payload: { x: 1, y: 1 } }) }))
  if (controlled.status !== 202) throw new Error("desktop control route failed")
  const seededRegistry = new InMemorySkillRegistry(() => 1_000)
  await seededRegistry.publish({ manifest: { name: "demo-skill", version: "1.0.0", digest: skillDigest("demo-skill"), trust: "untrusted" as SkillTrust, tags: ["demo"], capabilities: ["workflow.run"] }, artifact: skillArtifact("demo-skill") })
  await seededRegistry.publish({ manifest: { name: "audit-skill", version: "1.0.0", digest: skillDigest("audit-skill"), trust: "untrusted" as SkillTrust, tags: ["audit"], capabilities: ["workspace.read"] }, artifact: skillArtifact("audit-skill") })
  type CallLog = Record<"publish" | "search" | "install" | "update" | "rate" | "exec" | "load" | "run", number>
  const makeRecorder = (registry: SkillRegistry): { registry: SkillRegistry; log: CallLog; throwIfExec: () => void } => {
    const log = { publish: 0, search: 0, install: 0, update: 0, rate: 0, exec: 0, load: 0, run: 0 } as CallLog
    const throwIfExec = () => { if (log.exec > 0 || log.load > 0 || log.run > 0) throw new Error("skill content was executed") }
    const record = { registry: {
      publish: async (pkg: SkillPackage) => { log.publish += 1; return registry.publish(pkg) },
      search: async (input: Parameters<SkillRegistry["search"]>[0]) => { log.search += 1; return registry.search(input) },
      install: async (digest: string) => { log.install += 1; return registry.install(digest) },
      update: async (name: string) => { log.update += 1; return registry.update(name) },
      rate: async (digest: string, rating: number) => { log.rate += 1; return registry.rate(digest, rating) },
    } as SkillRegistry, log, throwIfExec }
    const guarded = record.registry as SkillRegistry & { execute?: () => never; load?: () => never; run?: () => never }
    guarded.execute = () => { log.exec += 1; throw new Error("execute must never be called") }
    guarded.load = () => { log.load += 1; throw new Error("load must never be called") }
    guarded.run = () => { log.run += 1; throw new Error("run must never be called") }
    return record
  }
  const seeded = makeRecorder(seededRegistry)
  const skillHubAudit = new AuditRuntimeDouble(() => 1_000)
  const skillHubServer = new WorkbenchServer({ auth: testAuth, workspace, runtime: new FakeRuntimeAdapter(() => 1_000), audit: skillHubAudit, capability: { check: async () => "allow" }, skillHub: seeded.registry })
  const skillHubOpen = await skillHubServer.fetch(new Request(`http://localhost/v1/workspaces/${handle.id}/open`, { method: "POST" }))
  const skillHubHandle = await skillHubOpen.json() as { id: string; token: string }
  const deniedSearchScope = await skillHubServer.fetch(new Request("http://localhost/v1/skill-hub/search", { method: "POST", headers: { authorization: "Bearer not-a-real-token" }, body: JSON.stringify({ workspaceId: skillHubHandle.id, query: "x" }) }))
  if (deniedSearchScope.status !== 403) throw new Error("skill-hub search with bad token was not denied (expected 403)")
  const deniedInstallScope = await skillHubServer.fetch(new Request("http://localhost/v1/skill-hub/install", { method: "POST", headers: { authorization: `Bearer ${skillHubHandle.token}` }, body: JSON.stringify({ workspaceId: "other-workspace", digest: "a".repeat(64) }) }))
  if (deniedInstallScope.status !== 403) throw new Error("skill-hub install with cross-workspace id was not denied")
  const deniedUpdateScope = await skillHubServer.fetch(new Request("http://localhost/v1/skill-hub/update", { method: "POST", headers: { authorization: `Bearer ${skillHubHandle.token}` }, body: JSON.stringify({ name: "demo-skill" }) }))
  if (deniedUpdateScope.status !== 400) throw new Error("skill-hub update without workspaceId was not 400")
  const missingRegistryServer = new WorkbenchServer({ auth: testAuth, workspace, runtime: new FakeRuntimeAdapter(() => 1_000), audit: skillHubAudit, capability: { check: async () => "allow" } })
  const missingRegistryOpen = await missingRegistryServer.fetch(new Request(`http://localhost/v1/workspaces/${handle.id}/open`, { method: "POST" }))
  const missingRegistryHandle = await missingRegistryOpen.json() as { id: string; token: string }
  const unavailableSearch = await missingRegistryServer.fetch(new Request("http://localhost/v1/skill-hub/search", { method: "POST", headers: { authorization: `Bearer ${missingRegistryHandle.token}` }, body: JSON.stringify({ workspaceId: missingRegistryHandle.id, query: "x" }) }))
  if (unavailableSearch.status !== 503) throw new Error("skill-hub search without registry was not 503")
  const unavailableInstall = await missingRegistryServer.fetch(new Request("http://localhost/v1/skill-hub/install", { method: "POST", headers: { authorization: `Bearer ${missingRegistryHandle.token}` }, body: JSON.stringify({ workspaceId: missingRegistryHandle.id, digest: "0".repeat(64) }) }))
  if (unavailableInstall.status !== 503) throw new Error("skill-hub install without registry was not 503")
  const unavailableUpdate = await missingRegistryServer.fetch(new Request("http://localhost/v1/skill-hub/update", { method: "POST", headers: { authorization: `Bearer ${missingRegistryHandle.token}` }, body: JSON.stringify({ workspaceId: missingRegistryHandle.id, name: "demo-skill" }) }))
  if (unavailableUpdate.status !== 503) throw new Error("skill-hub update without registry was not 503")
  const searchAuditBaseline = skillHubAudit.events().length
  const searchResponse = await skillHubServer.fetch(new Request("http://localhost/v1/skill-hub/search", { method: "POST", headers: { authorization: `Bearer ${skillHubHandle.token}` }, body: JSON.stringify({ workspaceId: skillHubHandle.id, query: "workflow", tags: ["demo"] }) }))
  if (searchResponse.status !== 200) throw new Error("skill-hub search route failed")
  const searchBody = await searchResponse.json() as { manifests: readonly SkillManifest[] }
  if (searchBody.manifests.length !== 1 || searchBody.manifests[0].name !== "demo-skill") throw new Error("skill-hub search did not filter correctly")
  if ((seeded.log.search as number) !== 1) throw new Error("skill-hub search did not call registry.search once")
  seeded.throwIfExec()
  const installResponse = await skillHubServer.fetch(new Request("http://localhost/v1/skill-hub/install", { method: "POST", headers: { authorization: `Bearer ${skillHubHandle.token}` }, body: JSON.stringify({ workspaceId: skillHubHandle.id, digest: skillDigest("demo-skill"), allowlist: ["ui.click", "ui.inspect"], uiActions: ["approve"] }) }))
  if (installResponse.status !== 201) throw new Error("skill-hub install route failed")
  const installBody = await installResponse.json() as { installed: InstalledSkill }
  if (installBody.installed.manifest.digest !== skillDigest("demo-skill")) throw new Error("skill-hub install did not return the installed manifest")
  if ((seeded.log.install as number) !== 1) throw new Error("skill-hub install did not call registry.install once")
  if ((seeded.log.update as number) !== 0) throw new Error("skill-hub install must not trigger registry.update")
  if (((installBody.installed.manifest as unknown) as { allowlist?: unknown }).allowlist !== undefined) throw new Error("install manifest was mutated by payload allowlist")
  seeded.throwIfExec()
  const updateResponse = await skillHubServer.fetch(new Request("http://localhost/v1/skill-hub/update", { method: "POST", headers: { authorization: `Bearer ${skillHubHandle.token}` }, body: JSON.stringify({ workspaceId: skillHubHandle.id, name: "demo-skill", uiActions: ["shutdown"] }) }))
  if (updateResponse.status !== 200) throw new Error("skill-hub update route failed")
  const updateBody = await updateResponse.json() as { updated: InstalledSkill | null }
  if (updateBody.updated?.manifest.name !== "demo-skill") throw new Error("skill-hub update did not return the installed skill")
  if ((seeded.log.update as number) !== 1) throw new Error("skill-hub update did not call registry.update once")
  if ((seeded.log.search as number) === 0) throw new Error("skill-hub update did not call registry.search to resolve latest version")
  seeded.throwIfExec()
  const successCalls = skillHubAudit.events().slice(searchAuditBaseline).filter((event) => event.capability.startsWith("skill-hub."))
  if (successCalls.length < 3) throw new Error("skill-hub success routes were not audited as allow")
  if (successCalls.some((event) => event.decision !== "allow")) throw new Error("skill-hub success routes produced a non-allow audit decision")
  // --- Principal authentication, scopes and rate limiting -------------------
  const clock = { value: 10_000 }
  const now = () => clock.value
  const signer = new HmacTokenAuthenticator("unifia-test-signing-key-0123456789abcdef", "unifia-local", "workbench", now)
  // workspace.read added for the file-read assertion below (line ~312) —
  // SEC-001/C2-3 now requires it in principal.scopes before the capability
  // gate runs; this block tests HMAC signing/expiry/rate-limiting, not
  // per-token scope enforcement (capability-scope.test.ts covers that).
  const admin = { id: "admin", scopes: new Set(["workspace.register", "workspace.open", "workspace.read"]), workspaces: "*" as const }
  const adminToken = signer.sign(admin, clock.value + 60_000)
  const authed = new WorkbenchServer({ auth: signer, workspace, runtime: new FakeRuntimeAdapter(() => 1_000), audit, capability: { check: async () => "allow" } })
  const bearer = (token: string) => ({ authorization: `Bearer ${token}` })

  const anonymous = await authed.fetch(new Request("http://localhost/v1/workspaces/register", { method: "POST", body: JSON.stringify({ name: "anon", path: root }) }))
  check(anonymous.status === 401, "register accepted an anonymous caller")
  const forged = await authed.fetch(new Request("http://localhost/v1/workspaces/register", { method: "POST", headers: bearer(`${adminToken.split(".").slice(0, 2).join(".")}.AAAA`), body: JSON.stringify({ name: "forged", path: root }) }))
  check(forged.status === 401, "register accepted a token with a forged signature")
  const noneAlg = `${Buffer.from(JSON.stringify({ alg: "none", typ: "JWT" })).toString("base64url")}.${adminToken.split(".")[1]}.`
  check((await authed.fetch(new Request("http://localhost/v1/workspaces/register", { method: "POST", headers: bearer(noneAlg), body: JSON.stringify({ name: "none", path: root }) }))).status === 401, "register accepted an alg:none token")

  const authedRegister = await authed.fetch(new Request("http://localhost/v1/workspaces/register", { method: "POST", headers: bearer(adminToken), body: JSON.stringify({ name: "authed", path: root }) }))
  check(authedRegister.status === 201, "authenticated register was rejected")
  const authedWorkspace = await authedRegister.json() as { id: string }

  const reader2 = { id: "reader", scopes: new Set(["workspace.open"]), workspaces: "*" as const }
  const readerToken = signer.sign(reader2, clock.value + 60_000)
  check((await authed.fetch(new Request("http://localhost/v1/workspaces/register", { method: "POST", headers: bearer(readerToken), body: JSON.stringify({ name: "nope", path: root }) }))).status === 403, "register ignored a missing workspace.register scope")

  const scopedPrincipal = { id: "scoped", scopes: new Set(["workspace.open"]), workspaces: new Set(["some-other-workspace"]) }
  const scopedToken = signer.sign(scopedPrincipal, clock.value + 60_000)
  check((await authed.fetch(new Request(`http://localhost/v1/workspaces/${authedWorkspace.id}/open`, { method: "POST", headers: bearer(scopedToken) }))).status === 403, "open ignored the principal workspace allowlist")

  const expired = signer.sign(admin, clock.value + 1_000)
  clock.value += 5_000
  check((await authed.fetch(new Request("http://localhost/v1/workspaces/register", { method: "POST", headers: bearer(expired), body: JSON.stringify({ name: "expired", path: root }) }))).status === 401, "register accepted an expired token")
  const freshToken = signer.sign(admin, clock.value + 60_000)
  const notYetValid = signer.sign(admin, clock.value + 60_000, clock.value + 30_000)
  check((await authed.fetch(new Request("http://localhost/v1/workspaces/register", { method: "POST", headers: bearer(notYetValid), body: JSON.stringify({ name: "early", path: root }) }))).status === 401, "register accepted a not-yet-valid token")

  const openAuthed = await authed.fetch(new Request(`http://localhost/v1/workspaces/${authedWorkspace.id}/open`, { method: "POST", headers: bearer(freshToken) }))
  check(openAuthed.status === 200, "authenticated open was rejected")
  const authedHandle = await openAuthed.json() as { id: string; token: string }
  const scopedRead = await authed.fetch(new Request("http://localhost/v1/files/read", { method: "POST", headers: { ...bearer(freshToken), "x-unifia-file-session": authedHandle.token }, body: JSON.stringify({ workspaceId: authedHandle.id, paths: ["README.md"] }) }))
  check(scopedRead.status === 200, "file read with a separate file-session header failed")
  const missingFileSession = await authed.fetch(new Request("http://localhost/v1/files/read", { method: "POST", headers: bearer(freshToken), body: JSON.stringify({ workspaceId: authedHandle.id, paths: ["README.md"] }) }))
  check(missingFileSession.status === 403, "a principal token was accepted as a file-session token")

  const limited = new WorkbenchServer({ auth: signer, rateLimiter: new FixedWindowRateLimiter(2, 60_000, now), workspace, runtime: new FakeRuntimeAdapter(() => 1_000), audit, capability: { check: async () => "allow" } })
  const burst: number[] = []
  for (let attempt = 0; attempt < 3; attempt += 1) burst.push((await limited.fetch(new Request(`http://localhost/v1/workspaces/${authedWorkspace.id}/open`, { method: "POST", headers: bearer(freshToken) }))).status)
  check(burst[0] === 200 && burst[1] === 200 && burst[2] === 429, `rate limiter did not return 429 on the third request (got ${burst.join(",")})`)
  clock.value += 61_000
  check((await limited.fetch(new Request(`http://localhost/v1/workspaces/${authedWorkspace.id}/open`, { method: "POST", headers: bearer(signer.sign(admin, clock.value + 60_000)) }))).status === 200, "rate limiter did not reopen the window")
  check(audit.events().some((event) => event.capability === "auth.rate-limit" && event.decision === "deny"), "rate limit rejection was not audited")
  check(audit.events().some((event) => event.capability === "auth.principal" && event.decision === "deny"), "authentication failure was not audited")

  console.log(`WorkbenchServer: ${LEGACY_ASSERTIONS + checks}/${LEGACY_ASSERTIONS + checks} passed (${LEGACY_ASSERTIONS} legacy + ${checks} counted)`)
} finally {
  await rm(root, { recursive: true, force: true })
}
