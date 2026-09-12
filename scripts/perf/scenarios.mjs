#!/usr/bin/env node
// SPDX-License-Identifier: MIT
// Canonical scenario registry for the Unifia performance harness (carte A01).
// Each scenario id is referenced by measurement artifacts (see schema.mjs).
// Pure data + lookup helpers; harness scripts (A02-A03) generate the artifacts.
//
// Plan §5 P0-A corpus: répertoire sans marqueur, Rust, monorepo TypeScript,
// gros workspace, répertoire généré, 1 puis 4 workspaces.
// Plan §5 P0-A desktop: Code, Work, Design, Automate, cycles, conversation
// longue, terminal, crash forcé et relance.

export const SCENARIOS = [
  // Startup phases
  { id: "startup.cold", kind: "startup", phase: "cold" },
  { id: "startup.warm", kind: "startup", phase: "warm" },
  { id: "startup.idle-30min", kind: "startup", phase: "idle" },
  // Workspace corpus
  { id: "corpus.no-marker", kind: "corpus", description: "Directory with no marker" },
  { id: "corpus.rust", kind: "corpus", description: "Rust project (Cargo.toml)" },
  { id: "corpus.ts-monorepo", kind: "corpus", description: "TypeScript monorepo" },
  { id: "corpus.large", kind: "corpus", description: "Large workspace" },
  { id: "corpus.generated", kind: "corpus", description: "Generated directory" },
  // Workspace count
  { id: "workspace.1", kind: "workspace-count", workspaces: 1 },
  { id: "workspace.4", kind: "workspace-count", workspaces: 4 },
  // Desktop modes
  { id: "desktop.code", kind: "mode", mode: "Code" },
  { id: "desktop.work", kind: "mode", mode: "Work" },
  { id: "desktop.design", kind: "mode", mode: "Design" },
  { id: "desktop.automate", kind: "mode", mode: "Automate" },
  // Mode cycle
  { id: "desktop.cycle.code-design-work", kind: "cycle", sequence: ["Code", "Design", "Work"] },
  // Long-running features
  { id: "desktop.long-conversation", kind: "duration", description: "100-message conversation" },
  { id: "desktop.terminal", kind: "feature", feature: "terminal" },
  { id: "desktop.crash-relaunch", kind: "lifecycle", description: "Crash + relaunch" },
  // Snapshots
  { id: "snapshot.cold", kind: "snapshot" },
  { id: "snapshot.warm", kind: "snapshot" },
  { id: "snapshot.after-10-mode-changes", kind: "snapshot" },
  { id: "snapshot.after-close-workspaces", kind: "snapshot" },
  { id: "snapshot.30min-idle", kind: "snapshot" },
]

const INDEX = new Map(SCENARIOS.map((s) => [s.id, s]))

export function getScenario(id) {
  return INDEX.get(id) ?? null
}

export function isValidScenarioId(id) {
  return typeof id === "string" && INDEX.has(id)
}
