-- D02 Team durable state. JSON is state metadata only; artifact bytes stay on disk.
PRAGMA journal_mode = WAL;
PRAGMA synchronous = NORMAL;
PRAGMA foreign_keys = ON;
PRAGMA busy_timeout = 5000;

CREATE TABLE IF NOT EXISTS team_store_meta (
  schema_version TEXT PRIMARY KEY,
  migration_id TEXT NOT NULL UNIQUE,
  applied_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS team_runs (
  run_id TEXT PRIMARY KEY,
  schema_version TEXT NOT NULL,
  plan_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending', 'running', 'completed', 'failed', 'aborted')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS team_tasks (
  task_id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES team_runs(run_id) ON DELETE CASCADE,
  status TEXT NOT NULL CHECK (status IN ('pending', 'assigned', 'running', 'completed', 'blocked', 'cancelled')),
  depends_on_json TEXT NOT NULL DEFAULT '[]' CHECK (length(depends_on_json) <= 65536),
  scope_json TEXT NOT NULL CHECK (length(scope_json) <= 65536),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS team_attempts (
  attempt_id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL REFERENCES team_tasks(task_id) ON DELETE CASCADE,
  worker_id TEXT NOT NULL,
  outcome TEXT NOT NULL CHECK (outcome IN ('success', 'failure', 'aborted', 'in_progress')),
  commit_sha TEXT,
  report_json TEXT CHECK (report_json IS NULL OR length(report_json) <= 65536),
  started_at TEXT NOT NULL,
  finished_at TEXT
);

CREATE TABLE IF NOT EXISTS team_locks (
  lease_id TEXT PRIMARY KEY,
  run_id TEXT REFERENCES team_runs(run_id) ON DELETE SET NULL,
  task_id TEXT REFERENCES team_tasks(task_id) ON DELETE SET NULL,
  worker_id TEXT NOT NULL,
  fencing_token INTEGER NOT NULL UNIQUE,
  branch TEXT NOT NULL,
  worktree TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('CLAIMED', 'RELEASED', 'EXPIRED')),
  acquired_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  released_at TEXT,
  release_reason TEXT
);

CREATE TABLE IF NOT EXISTS team_gates (
  gate_id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES team_runs(run_id) ON DELETE CASCADE,
  task_id TEXT REFERENCES team_tasks(task_id) ON DELETE SET NULL,
  verdict TEXT NOT NULL CHECK (verdict IN ('APPROVED', 'APPROVED_WITH_FOLLOWUP', 'CHANGES_REQUESTED')),
  findings_json TEXT NOT NULL CHECK (length(findings_json) <= 65536),
  decided_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS team_events (
  event_id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES team_runs(run_id) ON DELETE CASCADE,
  sequence INTEGER NOT NULL,
  kind TEXT NOT NULL,
  payload_json TEXT NOT NULL CHECK (length(payload_json) <= 16384),
  occurred_at TEXT NOT NULL,
  UNIQUE (run_id, sequence)
);

CREATE TABLE IF NOT EXISTS team_artifacts (
  artifact_id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES team_runs(run_id) ON DELETE CASCADE,
  task_id TEXT REFERENCES team_tasks(task_id) ON DELETE SET NULL,
  relative_path TEXT NOT NULL,
  sha256 TEXT NOT NULL CHECK (length(sha256) = 64),
  byte_length INTEGER NOT NULL CHECK (byte_length >= 0),
  metadata_json TEXT CHECK (metadata_json IS NULL OR length(metadata_json) <= 65536),
  recorded_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS team_checkpoints (
  checkpoint_id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES team_runs(run_id) ON DELETE CASCADE,
  sequence INTEGER NOT NULL,
  state_json TEXT NOT NULL CHECK (length(state_json) <= 65536),
  created_at TEXT NOT NULL,
  UNIQUE (run_id, sequence)
);

CREATE TABLE IF NOT EXISTS team_audit (
  audit_id TEXT PRIMARY KEY,
  run_id TEXT,
  action TEXT NOT NULL,
  target_id TEXT NOT NULL,
  details_json TEXT NOT NULL CHECK (length(details_json) <= 16384),
  recorded_at TEXT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS team_locks_claimed_branch_idx ON team_locks(branch) WHERE status = 'CLAIMED';
CREATE UNIQUE INDEX IF NOT EXISTS team_locks_claimed_worktree_idx ON team_locks(worktree) WHERE status = 'CLAIMED';
CREATE INDEX IF NOT EXISTS team_tasks_run_status_idx ON team_tasks(run_id, status);
CREATE INDEX IF NOT EXISTS team_attempts_task_idx ON team_attempts(task_id, started_at);
CREATE INDEX IF NOT EXISTS team_events_run_time_idx ON team_events(run_id, occurred_at);
CREATE INDEX IF NOT EXISTS team_checkpoints_run_time_idx ON team_checkpoints(run_id, created_at);
CREATE INDEX IF NOT EXISTS team_audit_run_time_idx ON team_audit(run_id, recorded_at);

INSERT OR IGNORE INTO team_store_meta(schema_version, migration_id, applied_at)
VALUES ('1.0.0', '20260726193000_team_store', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));
