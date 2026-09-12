-- 001_leases.sql
-- Lease registry: one row per active lease.
-- Uniqueness constraints: lease_id PRIMARY KEY, branch UNIQUE WHERE CLAIMED, worktree UNIQUE WHERE CLAIMED.
-- A "released" lease keeps its row for audit, but is no longer blocking.

CREATE TABLE IF NOT EXISTS leases (
  lease_id                 TEXT PRIMARY KEY,
  card_id                  TEXT NOT NULL,
  worker_id                TEXT NOT NULL,
  fencing_token            INTEGER NOT NULL UNIQUE,
  branch                   TEXT NOT NULL,
  worktree                 TEXT NOT NULL,
  base_sha                 TEXT NOT NULL,
  scope_manifest_hash      TEXT NOT NULL,
  allowed_files_json       TEXT NOT NULL,
  protected_files_json     TEXT NOT NULL,
  scope_mode               TEXT NOT NULL CHECK(scope_mode IN ('OPEN', 'E2_REQUIRED')),
  status                   TEXT NOT NULL CHECK(status IN ('CLAIMED', 'RELEASED', 'EXPIRED')),
  acquired_at              TEXT NOT NULL,
  last_heartbeat_at        TEXT NOT NULL,
  expires_at               TEXT NOT NULL,
  released_at              TEXT,
  release_reason           TEXT,
  released_by              TEXT,
  parent_lease_id          TEXT REFERENCES leases(lease_id)
);

-- Uniqueness of branch and worktree ACTIVE state, via partial unique indexes.
-- A released/expired lease keeps the row but frees the slot.
CREATE UNIQUE INDEX IF NOT EXISTS idx_leases_branch_active
  ON leases(branch) WHERE status = 'CLAIMED';
CREATE UNIQUE INDEX IF NOT EXISTS idx_leases_worktree_active
  ON leases(worktree) WHERE status = 'CLAIMED';

CREATE INDEX IF NOT EXISTS idx_leases_card    ON leases(card_id);
CREATE INDEX IF NOT EXISTS idx_leases_worker  ON leases(worker_id);
CREATE INDEX IF NOT EXISTS idx_leases_status  ON leases(status);
CREATE INDEX IF NOT EXISTS idx_leases_heartbeat ON leases(last_heartbeat_at);
CREATE INDEX IF NOT EXISTS idx_leases_expires    ON leases(expires_at);
