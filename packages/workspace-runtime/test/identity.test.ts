/* SPDX-License-Identifier: MIT */
import { mkdir, mkdtemp, rm, symlink } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { WorkspaceRuntime } from "../src/index.js"

const root = await mkdtemp(path.join(os.tmpdir(), "unifia-identity-"))
const alias = path.join(root, "alias")
try {
  await mkdir(path.join(root, "nested"))
  await symlink(root, alias, "junction")
  const runtime = new WorkspaceRuntime({ now: () => 1_000 })
  const first = await runtime.register({ name: "first", path: root })
  const variants = [
    path.join(root, "."),
    path.join(root, "nested", ".."),
    alias,
  ]
  for (const variant of variants) {
    const same = await runtime.register({ name: "variant", path: variant })
    if (same.id !== first.id) throw new Error(`path variant produced a second workspace: ${variant}`)
  }

  if (process.platform === "win32") {
    const mixed = root.replaceAll(path.sep, path.sep === "\\" ? "/" : "\\")
    const same = await runtime.register({ name: "mixed", path: mixed })
    if (same.id !== first.id) throw new Error("mixed path separators produced a second workspace")
    const caseVariant = root.toUpperCase()
    const caseSame = await runtime.register({ name: "case", path: caseVariant })
    if (caseSame.id !== first.id) throw new Error("case variant produced a second workspace")
  }
  console.log("WorkspaceIdentity: 5/5 passed")
} finally {
  await rm(root, { recursive: true, force: true })
}
