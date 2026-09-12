/* SPDX-License-Identifier: MIT */
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { ArtifactRejectedError, ArtifactStore } from "../src/index.js"

let checks = 0
const check = (condition: boolean, message: string): void => {
  checks += 1
  if (!condition) throw new Error(message)
}
const rejects = async (run: () => Promise<unknown>, message: string): Promise<void> => {
  checks += 1
  try {
    await run()
  } catch {
    return
  }
  throw new Error(message)
}

const root = await mkdtemp(path.join(os.tmpdir(), "unifia-artifact-"))
try {
  const store = new ArtifactStore(root, () => 4_000, 100)

  // --- A single revision ------------------------------------------------------
  const artifact = await store.create({ kind: "text", filename: "result.txt", content: "hello", metadata: { source: "test", secret: "do-not-export" } })
  check(artifact.version === 1, `first revision reported version ${artifact.version}`)
  check(artifact.sha256.length === 64 && !artifact.relativePath.includes(".."), "artifact manifest is invalid")
  check(new TextDecoder().decode(await store.read(artifact)) === "hello", "artifact read/hash validation failed")
  check((await store.pending()).length === 1, "artifact was not published to outbox")

  // --- Lineage ----------------------------------------------------------------
  const second = await store.create({ artifactId: artifact.artifactId, kind: "text", filename: "result.txt", content: "hello again" })
  check(second.version === 2, `second revision reported version ${second.version}`)
  check(second.artifactId === artifact.artifactId, "a revision started a new lineage instead of extending one")
  check(second.sha256 !== artifact.sha256, "the second revision reused the first hash")

  const history = await store.history(artifact.artifactId)
  check(history.length === 2 && history[0].version === 1 && history[1].version === 2, `history reported ${history.map((entry) => entry.version).join(",")}`)
  check((await store.latest(artifact.artifactId))?.version === 2, "latest did not return the head")
  check((await store.list()).some((entry) => entry.artifactId === artifact.artifactId && entry.version === 2), "artifact list did not return the latest lineage head")

  // Both revisions remain readable: a new version must not destroy its predecessor.
  check(new TextDecoder().decode(await store.read(history[0])) === "hello", "the first revision was lost when the second was written")
  check(new TextDecoder().decode(await store.read(history[1])) === "hello again", "the second revision did not round trip")

  // Re-storing the head's content adds no revision.
  const unchanged = await store.create({ artifactId: artifact.artifactId, kind: "text", filename: "result.txt", content: "hello again" })
  check(unchanged.version === 2, `re-storing identical content created version ${unchanged.version}`)
  check((await store.history(artifact.artifactId)).length === 2, "re-storing identical content grew the history")

  // Identical content in a *different* lineage is legitimate and must be stored.
  const twin = await store.create({ kind: "text", filename: "result.txt", content: "hello" })
  check(twin.artifactId !== artifact.artifactId, "two distinct artefacts collided on the same id")
  check(twin.sha256 === artifact.sha256, "the twin artefact did not keep the same content hash")
  check(new TextDecoder().decode(await store.read(twin)) === "hello", "the twin artefact is not readable")

  await rejects(() => store.create({ artifactId: "artifact-000000000000000000000000", kind: "text", filename: "x.txt", content: "x" }), "a revision was accepted for an unknown lineage")
  await rejects(() => store.history("../escape"), "history accepted a traversal id")
  check((await store.history("artifact-000000000000000000000000")).length === 0, "history invented entries for an unknown lineage")

  // --- Export and metadata policy ---------------------------------------------
  const stripped = await store.export(artifact)
  check(Object.keys(stripped.metadata).length === 0, "the default export policy did not strip metadata")
  check(new TextDecoder().decode(await readFile(path.join(root, stripped.relativePath))) === "hello", "the exported file content is wrong")
  check(!stripped.relativePath.includes(".."), "the export path escaped the workspace")

  const kept = await store.export(artifact, { metadata: "keep" })
  check(kept.metadata.secret === "do-not-export", "the keep policy dropped metadata")

  const allowed = await store.export(artifact, { metadata: { allow: ["source"] } })
  check(allowed.metadata.source === "test" && allowed.metadata.secret === undefined, "the allowlist policy leaked a key outside the allowlist")

  await rejects(() => store.export(artifact, { outbox: "../escape" }), "the export accepted a traversal outbox name")

  // --- Safety -----------------------------------------------------------------
  await rejects(() => store.create({ kind: "text", filename: "../escape.txt", content: "no" }), "artifact traversal filename was accepted")
  await rejects(() => store.create({ kind: "text", filename: "large.txt", content: "x".repeat(101) }), "artifact quota was not enforced")
  await rejects(() => store.create({ kind: "svg", filename: "unsafe.svg", content: '<svg><script>alert(1)</script></svg>' }), "unsafe SVG was accepted")
  const safeSvg = await store.create({ kind: "svg", filename: "safe.svg", content: '<svg xmlns="http://www.w3.org/2000/svg"><text>safe</text></svg>' })
  check(safeSvg.kind === "svg", "safe SVG did not keep its render kind")


  // --- Provenance and the optional scanner (§26) ---------------------------------
  // "La source et les outils de génération sont visibles" and "lien à une action
  // remote ou computer-use": an artefact whose origin is unstated is the one
  // nobody can account for later.
  const traced = await store.create({
    kind: "text",
    filename: "traced.txt",
    content: "from a remote command",
    provenance: { sourceTool: "browser-capture", capabilityPack: "pack.browser", remoteActionId: "cmd-42", computerUseReceiptId: "obs-7" },
  })
  check(traced.provenance?.sourceTool === "browser-capture", "the source tool was not recorded")
  check(traced.provenance?.remoteActionId === "cmd-42", "the remote action link was not recorded")
  check(traced.provenance?.computerUseReceiptId === "obs-7", "the computer-use receipt link was not recorded")
  check(traced.provenance?.capabilityPack === "pack.browser", "the capability pack was not recorded")
  const tracedManifest = JSON.parse(await readFile(path.join(root, traced.relativePath, "..", "version.json"), "utf8"))
  check(tracedManifest.provenance?.remoteActionId === "cmd-42", "provenance did not survive into the manifest")

  // An artefact created without provenance says so rather than leaving a blank.
  const untraced = await store.create({ kind: "text", filename: "untraced.txt", content: "no origin" })
  check(untraced.provenance?.sourceTool === "unknown", "a missing origin was left empty instead of stated")

  // No scanner configured: the version says "unscanned", never "clean".
  check(untraced.scan === "unscanned", `an unscanned artefact reported ${untraced.scan}`)

  // A configured scanner is not advisory: a rejection stops the write, and it
  // must leave nothing behind for a later reader to find.
  const scanned = new ArtifactStore(root, () => 1000, 1024, {
    scan: async (content) => {
      const text = new TextDecoder().decode(content)
      return text.includes("EICAR") ? { clean: false, detail: "test signature" } : { clean: true }
    },
  })
  const clean = await scanned.create({ kind: "text", filename: "clean.txt", content: "harmless" })
  check(clean.scan === "clean", "a scanned artefact was not marked clean")
  let rejected = false
  try {
    await scanned.create({ kind: "text", filename: "infected.txt", content: "EICAR sample" })
  } catch (error) {
    rejected = error instanceof ArtifactRejectedError
  }
  check(rejected, "a scanner rejection did not stop the write")
  const lineages = await readdir(path.join(root, ".unifia", "artifacts"))
  const filenames = (await Promise.all(lineages.map(async (id) => (await scanned.latest(id))?.filename))).filter(Boolean)
  check(!filenames.includes("infected.txt"), "a rejected artefact left a version behind")

  console.log(`ArtifactStore: ${checks}/${checks} passed`)
} finally {
  await rm(root, { recursive: true, force: true })
}
