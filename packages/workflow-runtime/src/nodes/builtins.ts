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
