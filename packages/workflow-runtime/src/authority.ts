/* SPDX-License-Identifier: MIT */
/* Copyright (c) 2026 Unifia contributors */

import type { Database } from "bun:sqlite"

/** The sole durable identity allowed to mutate a WorkflowRun. */
export type AuthorityToken = {
  readonly workflowRunId: string
  readonly generation: number
  readonly authorityOwnerId: string
}

export class AuthorityError extends Error {
  constructor(readonly code: "STALE_AUTHORITY" | "AUTHORITY_NOT_CLAIMED" | "AUTHORITY_TOKEN_REQUIRED", message?: string) {
    super(message ?? code)
    this.name = "AuthorityError"
  }
}

export const WORKFLOW_AUTHORITY_SCHEMA = `
CREATE TABLE IF NOT EXISTS workflow_authority (
  run_id TEXT PRIMARY KEY,
  generation INTEGER NOT NULL,
  owner_id TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);`

export function assertAuthority(db: Database, token: AuthorityToken): void {
  if (!token || !token.workflowRunId || !token.authorityOwnerId || !Number.isSafeInteger(token.generation)) {
    throw new AuthorityError("AUTHORITY_TOKEN_REQUIRED")
  }
  const row = db.query("SELECT generation, owner_id FROM workflow_authority WHERE run_id = ?").get(token.workflowRunId) as { generation: number; owner_id: string } | null
  if (!row) throw new AuthorityError("AUTHORITY_NOT_CLAIMED", `authority not claimed for ${token.workflowRunId}`)
  if (row.generation !== token.generation || row.owner_id !== token.authorityOwnerId) {
    throw new AuthorityError("STALE_AUTHORITY", `stale authority for ${token.workflowRunId}`)
  }
}

export function assertAuthorityForRun(db: Database, token: AuthorityToken, runId: string): void {
  assertTokenForRun(token, runId)
  assertAuthority(db, token)
}

export function assertTokenForRun(token: AuthorityToken, runId: string): void {
  if (!token || !token.authorityOwnerId || !Number.isSafeInteger(token.generation)) {
    throw new AuthorityError("AUTHORITY_TOKEN_REQUIRED", `authority token does not target ${runId}`)
  }
  if (token.workflowRunId !== runId) throw new AuthorityError("STALE_AUTHORITY", `authority token does not target ${runId}`)
}

export function claimAuthority(db: Database, runId: string, ownerId: string, now: number): AuthorityToken {
  db.query("INSERT OR IGNORE INTO workflow_authority (run_id, generation, owner_id, created_at, updated_at) VALUES (?, 1, ?, ?, ?)").run(runId, ownerId, now, now)
  const row = db.query("SELECT generation, owner_id FROM workflow_authority WHERE run_id = ?").get(runId) as { generation: number; owner_id: string } | null
  if (!row || row.owner_id !== ownerId) throw new AuthorityError("STALE_AUTHORITY", `authority owned by another owner: ${runId}`)
  return { workflowRunId: runId, generation: row.generation, authorityOwnerId: row.owner_id }
}

export function takeoverAuthority(db: Database, token: AuthorityToken, newOwnerId: string, now: number): AuthorityToken {
  db.transaction(() => {
    assertAuthority(db, token)
    db.query("UPDATE workflow_authority SET generation = generation + 1, owner_id = ?, updated_at = ? WHERE run_id = ?").run(newOwnerId, now, token.workflowRunId)
  })()
  return { workflowRunId: token.workflowRunId, generation: token.generation + 1, authorityOwnerId: newOwnerId }
}
