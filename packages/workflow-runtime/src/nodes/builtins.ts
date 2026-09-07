/* SPDX-License-Identifier: MIT */
/* Copyright (c) 2026 Unifia contributors */

/**
 * Built-in node definitions (Phase 1). Registered once per process
 * via `registerBuiltins()`. Versions are immutable: a behavior change
 * ships as a new version, never an edit.
 */
import type { NodeDefinition } from "./registry.js"

export const HTTP_NODE_V1: NodeDefinition = {
  type: "tool.http",
  version: "v1",
  metadata: {
    displayName: "HTTP Request",
    description: "Perform an HTTP request with timeout, redirect budget and bounded response.",
    category: "action",
  },
  inputSchema: { type: "object" },
  outputSchema: { type: "object" },
  configSchema: { type: "object" },
  capabilities: ["network.request"],
  effects: ["network.connect"],
  executor: "http",
}

export const TRANSFORM_NODE_V1: NodeDefinition = {
  type: "tool.transform",
  version: "v1",
  metadata: {
    displayName: "Transform",
    description: "Deterministic field mapping over prior node outputs (no code).",
    category: "transform",
  },
  inputSchema: { type: "object" },
  outputSchema: { type: "object" },
  configSchema: { type: "object" },
  capabilities: [],
  effects: [],
  executor: "transform",
}

export const BUILTIN_NODE_DEFINITIONS: readonly NodeDefinition[] = [HTTP_NODE_V1, TRANSFORM_NODE_V1]
function manifest(
  type: string,
  displayName: string,
  description: string,
  category: "trigger" | "action" | "transform" | "logic" | "human",
  executor: "http" | "transform" | "internal" | "external",
): NodeDefinition {
  return {
    type,
    version: "v1",
    metadata: { displayName, description, category },
    // Phase 1: structural placeholders. Per-family JSON Schemas rich enough
    // for an inspector/AI builder are Phase 2 contract work, not this slice.
    inputSchema: { type: "object" },
    outputSchema: { type: "object" },
    configSchema: { type: "object" },
    capabilities: [],
    effects: [],
    executor,
  }
}

export const TRIGGER_NODES_V1: readonly NodeDefinition[] = [
  manifest("trigger.manual", "Manual Trigger", "Start a run explicitly (API call).", "trigger", "external"),
  manifest("trigger.schedule", "Schedule Trigger", "Start runs on a cron schedule (worker pending).", "trigger", "external"),
]

export const CONTROL_NODES_V1: readonly NodeDefinition[] = [
  manifest("control.if", "If", "Branch on a condition.", "logic", "internal"),
  manifest("control.switch", "Switch", "Multi-way branch.", "logic", "internal"),
  manifest("control.parallel", "Parallel", "Fan out branches.", "logic", "internal"),
  manifest("control.merge", "Merge", "Join branches.", "logic", "internal"),
  manifest("control.map", "Map", "Fan out over a list.", "logic", "internal"),
  manifest("control.repeat", "Repeat", "Bounded loop.", "logic", "internal"),
  manifest("control.while", "While", "Conditional loop.", "logic", "internal"),
  manifest("control.child", "Sub-workflow", "Dispatch a child workflow.", "logic", "internal"),
]

export const HUMAN_NODES_V1: readonly NodeDefinition[] = [
  manifest("human.approval", "Approval", "Pause for human allow/deny.", "human", "external"),
  manifest("wait", "Wait", "Pause until a timer fires or approval arrives.", "human", "external"),
]

/** Every family the IR schema admits, so `registry.list()` is the full
 * canvas/picker/builder source (executable or not). */
export const ALL_FAMILY_MANIFESTS_V1: readonly NodeDefinition[] = [...TRIGGER_NODES_V1, ...CONTROL_NODES_V1, ...HUMAN_NODES_V1]
