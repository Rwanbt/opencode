/* SPDX-License-Identifier: MIT */
/**
 * NativeKnowledgePort — TS/Rust split, all calls bounded.
 *
 * See ADR-KNOW-0007. The TS layer decides WHAT to do; the Rust
 * layer guarantees that the operation is correctly bounded.
 *
 * All methods are async, all parameters are validated, all
 * responses are bounded. The default bounds are exported as
 * constants for tests and adapters.
 */

import type {
  RetrievalRequest,
  RetrievalResponse,
} from "./retrieval.js"
import type { MutationIntent, MutationResult } from "./mutation.js"

export interface GetKnowledgeRequest {
  id?: string
  locator?: string
  maxBytes: number
  deadlineMs: number
}

export interface GetKnowledgeResponse {
  found: boolean
  body?: string
  bodyBytes: number
  versionHash?: string
}

export interface BacklinkRequest {
  /** Resolve backlinks TO this target. */
  targetId?: string
  targetLocator?: string
  limit: number
  cursor?: string
  deadlineMs: number
}

export interface BacklinkResponse {
  sources: Array<{
    id: string
    locator: string
    snippet: string
  }>
  nextCursor?: string
}

export interface AdminTask {
  kind: "rebuild" | "doctor" | "gc" | "migrate"
  params?: Record<string, unknown>
}

export interface AdminTaskHandle {
  id: string
  startedAt: number
}

export interface SubscribeOptions {
  /** Hard upper bound on event bytes. */
  maxEventBytes: number
  /** Max events per coalesced batch. */
  maxEventsPerInterval: number
  /** Coalesce events within an interval. */
  coalescing: boolean
}

export type KnowledgeEvent =
  | { kind: "file.changed"; locator: string; versionHash: string }
  | { kind: "file.moved"; from: string; to: string }
  | { kind: "file.deleted"; locator: string }
  | { kind: "decision.created"; id: string; locator: string }
  | { kind: "tool.executed"; toolId: string; success: boolean }
  | { kind: "git.commit"; sha: string; summary: string }
  | { kind: "session.started"; sessionId: string }
  | { kind: "session.ended"; sessionId: string }
  | { kind: "project.opened"; projectRef: string }
  | { kind: "egress.decision"; id: string; decision: "allow" | "deny"; destination: string }
  | { kind: "mutation.applied"; id: string; mutationKind: string; auditId: string }

/**
 * The single surface Rust → TS of the Knowledge Core.
 *
 * One implementation per platform. No singleton, owner
 * identifiable, injected.
 */
export interface NativeKnowledgePort {
  retrieve(request: RetrievalRequest): Promise<RetrievalResponse>
  get(request: GetKnowledgeRequest): Promise<GetKnowledgeResponse>
  backlinks(request: BacklinkRequest): Promise<BacklinkResponse>
  executeMutation(intent: MutationIntent): Promise<MutationResult>
  startAdminTask(task: AdminTask): Promise<AdminTaskHandle>
  cancelAdminTask(id: string): Promise<void>
  subscribe(options: SubscribeOptions): AsyncIterable<KnowledgeEvent>
}
