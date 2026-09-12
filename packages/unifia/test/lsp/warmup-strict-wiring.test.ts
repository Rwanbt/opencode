/* SPDX-License-Identifier: MIT */

import { describe, expect, test } from "bun:test"
import { LSPServer } from "../../src/lsp/server"
import { NearestRoot } from "../../src/lsp/server-shared"

// WHY this file exists, and why it tests the REGISTRY rather than the helper:
//
// `StrictNearestRoot` was written, unit-tested and left with zero production
// consumers. Every server definition kept using the lenient `NearestRoot`, so
// `LSP.warmup()` behaved exactly as before — measured: 15 language servers
// pre-spawned on a directory containing nothing but CSS and HTML. A test of
// the strict helper in isolation passed the whole time.
//
// The lesson: the defect was never in the helper, it was in the wiring. So the
// guard has to assert the wiring — that the servers the app actually registers
// can answer "does this project contain my language?" — not that a helper
// behaves correctly when called directly.

const servers = Object.values(LSPServer).filter(
  (value): value is LSPServer.Info =>
    typeof value === "object" && value !== null && "id" in value && "root" in value,
)

/**
 * Servers that cannot prove their language is present, and are therefore never
 * pre-spawned. They still start normally through `touchFile` when one of their
 * files is opened, so the only cost is first-save latency for that language.
 *
 * Each entry is a decision with a reason, not a convenience:
 *
 * - `bash`, `dockerfile` — `root: async () => Instance.directory`. Unconditional
 *   by design; there is no marker to look for, so no strict form can exist.
 * - `nixd` — deliberately falls back to the git worktree and then the project
 *   directory when no `flake.nix` is found. Making it strict would change what
 *   it considers a Nix project, which is a semantic call, not a perf one.
 * - `kotlin-ls` — a four-probe composite in the shape of `jdtls`. A strict twin
 *   is mechanical but unwritten; until then Kotlin pays a cold start on first
 *   save instead of being pre-spawned in projects that contain no Kotlin.
 *
 * Adding to this list must be a conscious choice. The test below refuses stale
 * entries so it cannot quietly rot.
 */
const WARMUP_EXEMPT = new Set(["bash", "dockerfile", "nixd", "kotlin-ls"])

describe("LSP warmup strict wiring", () => {
  test("the registry is non-empty (a passing suite over zero servers proves nothing)", () => {
    expect(servers.length).toBeGreaterThan(20)
  })

  test("NearestRoot always carries its strict twin", () => {
    const resolver = NearestRoot(["Cargo.toml"])
    expect(typeof resolver).toBe("function")
    expect(typeof resolver.strict).toBe("function")
  })

  // The regression that matters: a server that warmup is supposed to pre-spawn
  // must be able to prove its language is present.
  test("every non-exempt registered server exposes a strict root", () => {
    const missing = servers
      .filter((server) => !WARMUP_EXEMPT.has(server.id))
      .filter((server) => typeof server.root.strict !== "function")
      .map((server) => server.id)
    expect(missing).toEqual([])
  })

  // Rust is why warmup exists at all (commit 7d1e08a7b0: a cold rust-analyzer
  // blocked the first save by ~49 s). If it ever loses its strict twin, warmup
  // silently skips it and that stall comes back.
  test("rust keeps a strict root, so warmup still pre-spawns it on a real crate", () => {
    const rust = servers.find((server) => server.id === "rust")
    expect(rust).toBeDefined()
    expect(typeof rust?.root.strict).toBe("function")
  })

  test("the exempt list only names servers that are actually registered", () => {
    const ids = new Set(servers.map((server) => server.id))
    const stale = [...WARMUP_EXEMPT].filter((id) => !ids.has(id))
    expect(stale).toEqual([])
  })
})
