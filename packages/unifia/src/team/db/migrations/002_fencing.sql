-- 002_fencing.sql
-- Monotonic fencing token store. The fence_token table is appended-only:
-- each issued token is forever greater than any previous token.
-- Token assignment is transactional with the lease claim.

CREATE TABLE IF NOT EXISTS fence_tokens (
  token       INTEGER PRIMARY KEY AUTOINCREMENT,
  lease_id    TEXT NOT NULL REFERENCES leases(lease_id),
  card_id     TEXT NOT NULL,
  worker_id   TEXT NOT NULL,
  issued_at   TEXT NOT NULL
);

-- Index for fast lookup "what is the current high-water mark?"
CREATE INDEX IF NOT EXISTS idx_fence_tokens_issued_at ON fence_tokens(issued_at);
CREATE INDEX IF NOT EXISTS idx_fence_tokens_lease     ON fence_tokens(lease_id);

-- Process-local monotonic guard. Used to detect non-monotonic DB writes.
CREATE TABLE IF NOT EXISTS fence_meta (
  key         TEXT PRIMARY KEY,
  value       TEXT NOT NULL
);

INSERT OR IGNORE INTO fence_meta (key, value)
  VALUES ('last_issued_token', '0');
