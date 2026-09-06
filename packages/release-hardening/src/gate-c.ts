/* SPDX-License-Identifier: MIT */

/**
 * Gate C — Plan V3 §31, "Plateforme extensible stabilisée".
 *
 * Ten GO conditions and no NO-GO list, so it reuses the Gate B runner.
 *
 * The reason this exists is that Gate C's recorded verdict had gone stale. It
 * read `NO-GO` with five blockers — "Phase 11 absente, cœur Phase 12 absent,
 * pas de consommateur DOM, pas de bootstrap serveur, audit externe absent" —
 * and four of those five had since been delivered. A gate whose verdict is a
 * remembered opinion drifts in both directions: it blocks on work already done,
 * and it stops naming the thing that actually blocks.
 *
 * Running it produces a verdict with the *current* blockers named. It is still
 * NO-GO, and now for two reasons instead of five stale ones.
 */

import type { GateEntry } from "./gate-b.js"

const assert = (condition: boolean, message: string): void => {
  if (!condition) throw new Error(message)
}

/** The ten GO conditions of §31, in the plan's order. */
export const GATE_C_CONDITIONS: readonly GateEntry[] = [
  {
    kind: "go",
    condition: "Manifest typé",
    evidence: "executed",
    run: async () => {
      const { validateSkillManifest } = await import("@unifia/skill-hub")
      // A manifest is "typed" only if a malformed one is refused; a type that
      // nothing enforces at the boundary is a comment.
      let refused = false
      try {
        validateSkillManifest({ name: "", version: "", digest: "", trust: "unknown" as never, tags: [], capabilities: [] })
      } catch {
        refused = true
      }
      assert(refused, "an invalid skill manifest was accepted")
    },
  },
  { kind: "go", condition: "Registry canonique", evidence: "covered", by: "@unifia/document-packs + @unifia/skill-hub + contracts/capability-registry", note: "DocumentPackRegistry, SkillHubRegistry, CapabilityRegistry — one registry per domain, no second source" },
  {
    kind: "go",
    condition: "Marketplace content-first",
    evidence: "blocked",
    reason: "no remote marketplace exists; §29's local half (signed manifests, trust levels, install refusal on digest mismatch) is proven by SkillHubRegistry, but content-first distribution needs a service outside this machine",
  },
  { kind: "go", condition: "Packages importés traçables", evidence: "covered", by: "scripts/unifia-conformance.mjs", note: "supply-chain/forbidden-paths, excluded-imports, spdx-headers, manifest-licenses and dependency-provenance all pass over 103 owned source files" },
  {
    kind: "go",
    condition: "UI actions déclaratives",
    evidence: "executed",
    run: async () => {
      const { V1_ACTIONS, CRITICAL_ACTIONS, generativeUiAllowlist } = await import("@unifia/mcp-ui-actions")
      // Declarative means the action set is data something can disagree with,
      // not prose in a document.
      assert(V1_ACTIONS.length === 11 && CRITICAL_ACTIONS.length === 7, "the §30 action lists changed shape")
      const allowlist = generativeUiAllowlist()
      for (const action of CRITICAL_ACTIONS) assert(!allowlist.has(action), `generated markup can name the critical action ${action}`)
    },
  },
  {
    kind: "go",
    condition: "Workflows reprenables",
    evidence: "executed",
    run: async () => {
      const { FileBackedDurableHistoryAuthority } = await import("@unifia/workflow-runtime")
      assert(typeof FileBackedDurableHistoryAuthority.prototype.getRun === "function", "durable workflow state cannot be read after restart")
      assert(typeof FileBackedDurableHistoryAuthority.prototype.transition === "function", "durable workflow state cannot resume through transitions")
      assert(typeof FileBackedDurableHistoryAuthority.prototype.getMaterializedProjection === "function", "workflow state has no restart-safe projection")
    },
  },
  {
    kind: "go",
    condition: "Mémoire visible et supprimable",
    evidence: "executed",
    run: async () => {
      const { MemoryGovernance } = await import("@unifia/memory-governance")
      // "Visible" was already true via recall. "Supprimable" was not: the
      // governed layer had no deletion at all, so forgetting meant reaching
      // past compartment scoping into MemoryRuntime.
      assert(typeof MemoryGovernance.prototype.recall === "function", "governed memory is not readable")
      assert(typeof MemoryGovernance.prototype.forget === "function", "governed memory cannot be deleted")
      assert(typeof MemoryGovernance.prototype.forgetCompartment === "function", "governed memory cannot be deleted in bulk")
    },
  },
  { kind: "go", condition: "Artefacts versionnés", evidence: "covered", by: "@unifia/artifact-runtime", note: "ArtifactStore — the id names a lineage independent of content, every revision owns its manifest, history/latest" },
  {
    kind: "go",
    condition: "Computer use et remote bridges restent révocables",
    evidence: "executed",
    run: async () => {
      const { RemoteBridge } = await import("@unifia/remote-bridge")
      const { ComputerUseGuard } = await import("@unifia/computer-use-safety")
      // Revocable means there is a way back, not just a way in.
      assert(typeof RemoteBridge.prototype.revoke === "function", "a paired remote identity cannot be revoked")
      assert(typeof ComputerUseGuard.prototype.consume === "function", "an observation receipt cannot be spent")
      const { KillSwitchRegistry } = await import("@unifia/contracts")
      const switches = new KillSwitchRegistry()
      switches.engage("global")
      assert(switches.isEngaged("all-remote") && switches.isEngaged("computer-use"), "the global kill switch does not reach both surfaces")
      switches.release("global")
      assert(!switches.isEngaged("all-remote"), "the global kill switch is not reversible")
    },
  },
  {
    kind: "go",
    condition: "Aucun P0/P1 sécurité",
    evidence: "blocked",
    reason: "this condition cannot be self-certified — 'no P0/P1' is the claim a third-party audit exists to test, and §18's targeted computer-use/remote audit has not run. Four real defects were found by this project's own gates on 2026-08-05 alone, which is evidence the gates work, not evidence the list is now empty",
  },
]

/** §31, transcribed. Changing the plan must break the matrix, not slip past it. */
export const PLAN_SECTION_31_CONDITIONS: readonly string[] = [
  "Manifest typé",
  "Registry canonique",
  "Marketplace content-first",
  "Packages importés traçables",
  "UI actions déclaratives",
  "Workflows reprenables",
  "Mémoire visible et supprimable",
  "Artefacts versionnés",
  "Computer use et remote bridges restent révocables",
  "Aucun P0/P1 sécurité",
]
