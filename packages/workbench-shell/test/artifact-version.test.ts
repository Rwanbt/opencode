/* SPDX-License-Identifier: MIT */

import { createArtifactVersionPanelState, diffArtifactVersions, type ArtifactVersionSummary } from "../src/artifact-version.js"
import { test } from "bun:test"

test('artifact-version.test', async () => {

const base: ArtifactVersionSummary = { artifactId: "artifact-123", version: 1, kind: "text", filename: "design.md", bytes: 10, createdAt: 1, metadata: { owner: "user" }, provenance: { sourceTool: "editor" }, relativePath: ".unifia/artifacts/artifact-123/v1/design.md", sha256: "a", scan: "clean" }
const next = { ...base, version: 2, bytes: 11, sha256: "b" }
const panel = createArtifactVersionPanelState([next, base], 2)
if (panel.history[0]?.version !== 1 || panel.selectedVersion !== 2 || panel.provenance?.sourceTool !== "editor") throw new Error("artifact version panel lost ordering/provenance")
if (panel.export.approved) throw new Error("artifact export was approved without a result")
const diff = diffArtifactVersions(base, next)
if (!diff.changed.includes("bytes") || !diff.changed.includes("sha256")) throw new Error("artifact structural diff missed changed fields")
if (diffArtifactVersions(undefined, next).added[0] !== "artifact") throw new Error("artifact diff did not report an addition")
console.log("ArtifactVersionPanel: 4/4 passed")
})
