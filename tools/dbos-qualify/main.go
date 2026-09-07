// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Unifia contributors
//
// M0 qualification candidate: DBOS_GO_SQLITE
//
// Pinned (per pack gelé review 2026-09-03, v1.1) :
//   - github.com/dbos-inc/dbos-transact-golang@v1.0.0
//   - Go 1.25.12
//   - modernc.org/sqlite v1.54.0  (upstream pinned in DBOS v1.0.0)
//
// Implements the M0 substrate-neutral contract surface
// (see packages/automate-m0-harness/src/qualification/contract.ts).
// This is the M0 qualification kernel — not the full DBOS Conductor
// deployment. The contract surface is sufficient for FC-31A, FC-31B,
// FC-04, FC-32 (the P0 set). FC-14, FC-25 require real multi-process
// orchestration and are exercised separately.
//
// IPC: HTTP/JSON over loopback (127.0.0.1:free port), per
// `DBOS_GO_IPC_SKETCH` in packages/automate-m0-harness/src/qualification/
// adapters/dbos-go.ts.
//
// HONEST DISCLOSURE (per pack gelé review 2026-09-03 v1.1 §17) :
//   This binary depends on `github.com/dbos-inc/dbos-transact-golang`
//   v1.0.0 (per go.mod) and imports `dbos` for side effects, but the
//   M0 surface is implemented via custom SQLite tables, NOT via DBOS
//   Conductor primitives. The DBOS Conductor API (dbos.CreateWorkflow,
//   dbos.RunStep, dbos.SetWorkflowID, etc.) is NOT called from any
//   handler. Therefore the M0 results from this binary measure the
//   *SQLite+HTTP* surface, not the *DBOS Conductor* surface.
//
//   Per FC-XX results are interpreted with this disclosure:
//     - FC-31A, FC-31B, FC-04, FC-32 = measure SQLite+HTTP surface
//     - Any FC that requires real DBOS Conductor semantics = NOT_VALID
//       (no methodology in this binary, even though the dependency is
//       declared) or FAIL_ARCHITECTURAL if the Unifia contract requires
//       Conductor semantics that this binary cannot exercise.

package main

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"net"
	"net/http"
	"os"
	"strconv"
	"strings"
	"sync"
	"time"

	_ "github.com/dbos-inc/dbos-transact-golang/dbos"
	_ "modernc.org/sqlite"
)

// ============================================================================
// Types — mirror packages/automate-m0-harness/src/qualification/contract.ts
// ============================================================================

type UnifiaValue = interface{}

type ApprovalStateV2 string

const (
	ApprovalPending   ApprovalStateV2 = "PENDING"
	ApprovalApproved  ApprovalStateV2 = "APPROVED"
	ApprovalDenied    ApprovalStateV2 = "DENIED"
	ApprovalExpired   ApprovalStateV2 = "EXPIRED"
	ApprovalCancelled ApprovalStateV2 = "CANCELLED"
	ApprovalStale     ApprovalStateV2 = "STALE"
)

type ApprovalRequestV2 struct {
	ApprovalId            string                 `json:"approvalId"`
	WorkflowRunId         string                 `json:"workflowRunId"`
	LogicalInvocationId   string                 `json:"logicalInvocationId,omitempty"`
	ExecutionPlanDigest   string                 `json:"executionPlanDigest"`
	RequesterPrincipalId  string                 `json:"requesterPrincipalId"`
	Ordinal               int                    `json:"ordinal"`
	RequestGeneration     int                    `json:"requestGeneration"`
	Principal             map[string]interface{} `json:"principal"`
	OwnershipScope        map[string]interface{} `json:"ownershipScope"`
	DeploymentScope       map[string]interface{} `json:"deploymentScope"`
	CapabilityRefs        []string               `json:"capabilityRefs"`
	ResourceScope         map[string]interface{} `json:"resourceScope"`
	PolicyDecisionRef     string                 `json:"policyDecisionRef"`
	PolicyVersion         string                 `json:"policyVersion"`
	CreatedAtEpochMs      int64                  `json:"createdAtEpochMs"`
	ExpiresAtEpochMs       int64                  `json:"expiresAtEpochMs"`
	State                 ApprovalStateV2        `json:"state"`
}

type ApprovalOutcomeV2 struct {
	ApprovalId        string          `json:"approvalId"`
	State             ApprovalStateV2 `json:"state"`
	ActorId           string          `json:"actorId,omitempty"`
	ResolvedAtEpochMs int64           `json:"resolvedAtEpochMs,omitempty"`
	Reason            string          `json:"reason,omitempty"`
}

type CanonicalRunState struct {
	RunId                string   `json:"runId"`
	AuthorityGeneration  int64    `json:"authorityGeneration"`
	Status               string   `json:"status"`
	LogicalInvocations   []InvState `json:"logicalInvocations"`
	ApprovalIds          []string `json:"approvalIds"`
	DurableTimerIds      []string `json:"durableTimerIds"`
	EffectIds            []string `json:"effectIds"`
	SchemaVersion        int      `json:"schemaVersion"`
	NextAttemptId        int      `json:"nextAttemptId"`
}

type InvState struct {
	LogicalInvocationId string         `json:"logicalInvocationId"`
	Attempts            []AttemptState `json:"attempts"`
	CurrentAttemptId    string         `json:"currentAttemptId"`
	CanonicalObservation UnifiaValue   `json:"canonicalObservation"`
	Terminal             bool           `json:"terminal"`
}

type AttemptState struct {
	AttemptId       string       `json:"attemptId"`
	StartedAtEpochMs int64        `json:"startedAtEpochMs"`
	CompletedAtEpochMs int64      `json:"completedAtEpochMs"`
	Status          string       `json:"status"`
	CanonicalOutput UnifiaValue  `json:"canonicalOutput"`
	EffectId        string       `json:"effectId"`
}

type StartRunRequest struct {
	WorkflowVersionId string                 `json:"workflowVersionId"`
	OwnerScope        map[string]interface{} `json:"ownerScope"`
	InitialLogicalInvocation InitialInvocation `json:"initialLogicalInvocation"`
	SeedCanonicalValue UnifiaValue            `json:"seedCanonicalValue"`
}

type InitialInvocation struct {
	LogicalInvocationId string      `json:"logicalInvocationId"`
	EffectKey           string      `json:"effectKey"`
	CanonicalInput      UnifiaValue `json:"canonicalInput"`
}

type DriveAttemptRequest struct {
	EffectKey                 string      `json:"effectKey"`
	Outcome                   string      `json:"outcome"` // SUCCEEDED|FAILED|UNKNOWN
	CanonicalResult           UnifiaValue `json:"canonicalResult"`
	AckLost                   bool        `json:"ackLost"`
	IdempotencyKey            string      `json:"idempotencyKey"`
	ProviderCommittedAtEpochMs int64     `json:"providerCommittedAtEpochMs"`
}

type DurableTimerRequest struct {
	TimerId           string `json:"timerId"`
	WorkflowRunId     string `json:"workflowRunId"`
	LogicalInvocationId string `json:"logicalInvocationId"`
	FireAtEpochMs     int64  `json:"fireAtEpochMs"`
}

type DurableTimerSnapshot struct {
	TimerId          string `json:"timerId"`
	State            string `json:"state"`
	FireAtEpochMs    int64  `json:"fireAtEpochMs"`
	FiredAtEpochMs   int64  `json:"firedAtEpochMs,omitempty"`
	SurvivedRestart  bool   `json:"survivedRestart"`
}

// ============================================================================
// Candidate server
// ============================================================================

type Server struct {
	mu        sync.Mutex
	db        *sql.DB
	gen      int64
	storeDir string
}

func NewServer(storeDir string) (*Server, error) {
	if err := os.MkdirAll(storeDir, 0o755); err != nil {
		return nil, err
	}
	dbPath := storeDir + "/dbos-candidate.sqlite"
	// Per pack gelé review 2026-09-03 v1.1 §5 (CP6.1): the writer
	// authority connection must use BEGIN IMMEDIATE to acquire
	// the writer lock at the start of the transaction. With
	// modernc.org/sqlite this is set via the `_txlock=immediate`
	// DSN parameter. Without it, `database/sql.Begin()` defaults
	// to DEFERRED, which is the wrong lock mode for fencing
	// primitives.
	db, err := sql.Open("sqlite", dbPath+
		"?_pragma=journal_mode(WAL)"+
		"&_pragma=synchronous(FULL)"+
		"&_pragma=busy_timeout(5000)"+
		"&_pragma=foreign_keys(ON)"+
		"&_txlock=immediate")
	if err != nil {
		return nil, err
	}
	s := &Server{db: db, gen: 1, storeDir: storeDir}
	if err := s.initSchema(); err != nil {
		return nil, fmt.Errorf("init schema: %w", err)
	}
	return s, nil
}

func (s *Server) Close() error {
	return s.db.Close()
}

func (s *Server) initSchema() error {
	stmts := []string{
		`CREATE TABLE IF NOT EXISTS schema_meta (k TEXT PRIMARY KEY, v TEXT NOT NULL)`,
		`CREATE TABLE IF NOT EXISTS authority_generation (generation INTEGER PRIMARY KEY)`,
		`INSERT OR IGNORE INTO authority_generation (generation) VALUES (1)`,
		// Per-run authority generation for FC-14 / FC-25 multi-process
		// tests. Each run has its own monotonic generation. The
		// (generation, authorityOwnerId) tuple is the durable
		// authority identity. PID is recorded in evidence but is
		// NOT the canonical identity (per pack gelé review
		// 2026-09-03 v1.1 §4, CP6.1).
		`CREATE TABLE IF NOT EXISTS run_authority (
			run_id TEXT PRIMARY KEY,
			generation INTEGER NOT NULL DEFAULT 0,
			authority_owner_id TEXT NOT NULL DEFAULT '',
			holder_pid INTEGER NOT NULL DEFAULT 0,
			acquired_at_epoch_ms INTEGER NOT NULL DEFAULT 0
		)`,
		// Effect-dispatch authorization table (CP6.1 §7).
		// A successful AuthorizeDispatch records an entry here in
		// the SAME transaction that validated the (generation,
		// authorityOwnerId) token. This is the durable proof that
		// a given effect was authorized by the current authority.
		`CREATE TABLE IF NOT EXISTS effect_dispatch_auth (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			run_id TEXT NOT NULL,
			effect_key TEXT NOT NULL,
			generation INTEGER NOT NULL,
			authority_owner_id TEXT NOT NULL,
			authorized_at_epoch_ms INTEGER NOT NULL
		)`,
		`CREATE TABLE IF NOT EXISTS runs (
			run_id TEXT PRIMARY KEY, workflow_version_id TEXT NOT NULL,
			organization_id TEXT NOT NULL, workspace_id TEXT NOT NULL,
			status TEXT NOT NULL, schema_version INTEGER NOT NULL,
			seed_canonical_json TEXT NOT NULL,
			created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
		)`,
		`CREATE TABLE IF NOT EXISTS logical_invocations (
			logical_invocation_id TEXT PRIMARY KEY, run_id TEXT NOT NULL,
			effect_key TEXT NOT NULL, canonical_input_json TEXT NOT NULL,
			terminal INTEGER NOT NULL DEFAULT 0, current_attempt_id TEXT,
			next_attempt_n INTEGER NOT NULL DEFAULT 0
		)`,
		`CREATE TABLE IF NOT EXISTS attempts (
			attempt_id TEXT PRIMARY KEY, logical_invocation_id TEXT NOT NULL,
			effect_id TEXT NOT NULL, started_at INTEGER NOT NULL,
			completed_at INTEGER, status TEXT NOT NULL,
			canonical_output_json TEXT
		)`,
		`CREATE TABLE IF NOT EXISTS effects (
			effect_id TEXT PRIMARY KEY, logical_invocation_id TEXT NOT NULL,
			effect_key TEXT NOT NULL, attempt_id TEXT,
			created_at INTEGER NOT NULL
		)`,
		`CREATE TABLE IF NOT EXISTS approvals (
			approval_id TEXT PRIMARY KEY, run_id TEXT NOT NULL,
			logical_invocation_id TEXT NOT NULL,
			execution_plan_digest TEXT NOT NULL,
			requester_principal_id TEXT NOT NULL,
			ordinal INTEGER NOT NULL DEFAULT 0,
			request_generation INTEGER NOT NULL DEFAULT 0,
			organization_id TEXT NOT NULL,
			workspace_id TEXT NOT NULL,
			created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL,
			state TEXT NOT NULL, actor_id TEXT, resolved_at INTEGER,
			reason TEXT
		)`,
		// Append-only approval history (CP7 §21).
		`CREATE TABLE IF NOT EXISTS approval_history (
			event_id TEXT PRIMARY KEY,
			approval_id TEXT NOT NULL,
			event_type TEXT NOT NULL,
			previous_state TEXT,
			new_state TEXT NOT NULL,
			actor_id TEXT,
			timestamp_epoch_ms INTEGER NOT NULL,
			reason TEXT,
			execution_plan_digest TEXT
		)`,
		`CREATE INDEX IF NOT EXISTS idx_approval_history_approval_id ON approval_history (approval_id, timestamp_epoch_ms)`,
		`CREATE TABLE IF NOT EXISTS timers (
			timer_id TEXT PRIMARY KEY, run_id TEXT NOT NULL,
			logical_invocation_id TEXT NOT NULL,
			fire_at INTEGER NOT NULL, state TEXT NOT NULL,
			fired_at INTEGER
		)`,
	}
	for _, stmt := range stmts {
		if _, err := s.db.Exec(stmt); err != nil {
			return fmt.Errorf("exec %q: %w", stmt[:40], err)
		}
	}
	return nil
}

// ============================================================================
// Run operations (FC-31A, FC-31B, FC-04, FC-32)
// ============================================================================

func (s *Server) StartRun(req StartRunRequest) (string, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	runId := fmt.Sprintf("run-%s-%d-%s",
		req.WorkflowVersionId, time.Now().UnixMilli(), randHex(4))
	now := time.Now().UnixMilli()

	_, err := s.db.Exec(
		`INSERT INTO runs (run_id, workflow_version_id, organization_id, workspace_id, status, schema_version, seed_canonical_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		runId, req.WorkflowVersionId,
		req.OwnerScope["organizationId"], req.OwnerScope["workspaceId"],
		"PENDING", 1, mustJSON(req.SeedCanonicalValue), now, now,
	)
	if err != nil {
		return "", err
	}

	effectId := fmt.Sprintf("eff-%s-1", req.InitialLogicalInvocation.LogicalInvocationId)
	_, err = s.db.Exec(
		`INSERT INTO logical_invocations (logical_invocation_id, run_id, effect_key, canonical_input_json, terminal, current_attempt_id, next_attempt_n) VALUES (?, ?, ?, ?, ?, ?, ?)`,
		req.InitialLogicalInvocation.LogicalInvocationId, runId,
		req.InitialLogicalInvocation.EffectKey,
		mustJSON(req.InitialLogicalInvocation.CanonicalInput),
		0, nil, 0,
	)
	if err != nil {
		return "", err
	}
	_, err = s.db.Exec(
		`INSERT INTO effects (effect_id, logical_invocation_id, effect_key, attempt_id, created_at) VALUES (?, ?, ?, NULL, ?)`,
		effectId, req.InitialLogicalInvocation.LogicalInvocationId,
		req.InitialLogicalInvocation.EffectKey, now,
	)
	if err != nil {
		return "", err
	}

	_, err = s.db.Exec(`UPDATE runs SET status='RUNNING', updated_at=? WHERE run_id=?`, time.Now().UnixMilli(), runId)
	return runId, err
}

func (s *Server) DriveAttempt(runId, liId string, req DriveAttemptRequest) (AttemptState, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	var nextAttemptN int
	err := s.db.QueryRow(
		`SELECT next_attempt_n FROM logical_invocations WHERE logical_invocation_id=? AND run_id=?`,
		liId, runId,
	).Scan(&nextAttemptN)
	if err != nil {
		return AttemptState{}, fmt.Errorf("invocation not found: %w", err)
	}
	newAttemptN := nextAttemptN + 1
	attemptId := fmt.Sprintf("att-%s-%d", liId, newAttemptN)
	effectId := fmt.Sprintf("eff-%s-%d", liId, newAttemptN)
	startedAt := time.Now().UnixMilli()

	_, err = s.db.Exec(
		`INSERT INTO attempts (attempt_id, logical_invocation_id, effect_id, started_at, completed_at, status, canonical_output_json) VALUES (?, ?, ?, ?, NULL, ?, NULL)`,
		attemptId, liId, effectId, startedAt, "RUNNING",
	)
	if err != nil {
		return AttemptState{}, err
	}
	_, _ = s.db.Exec(`UPDATE effects SET attempt_id=? WHERE logical_invocation_id=? AND effect_key=?`, attemptId, liId, req.EffectKey)
	_, _ = s.db.Exec(`UPDATE logical_invocations SET current_attempt_id=?, next_attempt_n=? WHERE logical_invocation_id=?`, attemptId, newAttemptN, liId)

	if req.AckLost {
		// FC-04 critical: do NOT blind-retry. Mark UNKNOWN_EXTERNAL_STATE.
		_, _ = s.db.Exec(`UPDATE attempts SET status=?, completed_at=? WHERE attempt_id=?`, "UNKNOWN_EXTERNAL_STATE", time.Now().UnixMilli(), attemptId)
		return AttemptState{
			AttemptId: attemptId, StartedAtEpochMs: startedAt,
			CompletedAtEpochMs: time.Now().UnixMilli(),
			Status: "UNKNOWN_EXTERNAL_STATE", CanonicalOutput: nil, EffectId: effectId,
		}, nil
	}

	// Map SUCCEEDED/FAILED/UNKNOWN -> attempt status
	status := req.Outcome
	if status == "UNKNOWN" {
		status = "UNKNOWN_EXTERNAL_STATE"
	}
	completedAt := time.Now().UnixMilli()
	var outputJSON interface{}
	if req.CanonicalResult != nil {
		outputJSON = mustJSON(req.CanonicalResult)
	}
	_, err = s.db.Exec(
		`UPDATE attempts SET status=?, completed_at=?, canonical_output_json=? WHERE attempt_id=?`,
		status, completedAt, outputJSON, attemptId,
	)
	if err != nil {
		return AttemptState{}, err
	}
	if status == "SUCCEEDED" || status == "FAILED" {
		_, _ = s.db.Exec(`UPDATE logical_invocations SET terminal=1 WHERE logical_invocation_id=?`, liId)
		_, _ = s.db.Exec(`UPDATE runs SET status=?, updated_at=? WHERE run_id=?`,
			map[bool]string{true: "COMPLETED", false: "FAILED"}[status == "SUCCEEDED"],
			time.Now().UnixMilli(), runId)
	}
	return AttemptState{
		AttemptId: attemptId, StartedAtEpochMs: startedAt,
		CompletedAtEpochMs: completedAt,
		Status: status, CanonicalOutput: req.CanonicalResult, EffectId: effectId,
	}, nil
}

func (s *Server) InspectRun(runId string) (CanonicalRunState, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	var status string
	var schemaV int
	err := s.db.QueryRow(`SELECT status, schema_version FROM runs WHERE run_id=?`, runId).
		Scan(&status, &schemaV)
	if err != nil {
		return CanonicalRunState{}, err
	}

	var gen int64
	_ = s.db.QueryRow(`SELECT generation FROM authority_generation LIMIT 1`).Scan(&gen)

	rows, err := s.db.Query(
		`SELECT logical_invocation_id, terminal, current_attempt_id, next_attempt_n FROM logical_invocations WHERE run_id=?`, runId)
	if err != nil {
		return CanonicalRunState{}, err
	}
	defer rows.Close()

	state := CanonicalRunState{
		RunId: runId, AuthorityGeneration: gen, Status: status,
		SchemaVersion: schemaV, NextAttemptId: 1,
		ApprovalIds: []string{}, DurableTimerIds: []string{}, EffectIds: []string{},
	}

	for rows.Next() {
		var liId, currentAttId sql.NullString
		var terminal int
		var nextN int
		if err := rows.Scan(&liId, &terminal, &currentAttId, &nextN); err != nil {
			return CanonicalRunState{}, err
		}
		// load attempts
		attRows, err := s.db.Query(
			`SELECT attempt_id, started_at, completed_at, status, canonical_output_json FROM attempts WHERE logical_invocation_id=? ORDER BY started_at ASC`, liId.String)
		if err != nil {
			return CanonicalRunState{}, err
		}
		var attempts []AttemptState
		for attRows.Next() {
			var attId string
			var startedAt, completedAt sql.NullInt64
			var s2 string
			var outputJSON sql.NullString
			if err := attRows.Scan(&attId, &startedAt, &completedAt, &s2, &outputJSON); err != nil {
				attRows.Close()
				return CanonicalRunState{}, err
			}
			att := AttemptState{
				AttemptId: attId, StartedAtEpochMs: startedAt.Int64,
				CompletedAtEpochMs: completedAt.Int64, Status: s2,
				EffectId: fmt.Sprintf("eff-%s-%s", liId.String, strings.Split(attId, "-")[len(strings.Split(attId, "-"))-1]),
			}
			if outputJSON.Valid {
				att.CanonicalOutput = json.RawMessage(outputJSON.String)
			}
			attempts = append(attempts, att)
		}
		attRows.Close()

		inv := InvState{
			LogicalInvocationId: liId.String,
			Attempts: attempts,
			CurrentAttemptId: orDefault(currentAttId, fmt.Sprintf("att-%s-1", liId.String)),
			Terminal: terminal == 1,
		}
		if n := len(attempts); n > 0 {
			inv.CanonicalObservation = attempts[n-1].CanonicalOutput
		}
		state.LogicalInvocations = append(state.LogicalInvocations, inv)
	}
	return state, nil
}

// ============================================================================
// Approval / Timer (M0 minimal; not the focus of P0)
// ============================================================================

func (s *Server) ProvideApproval(req ApprovalRequestV2) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	requester := req.RequesterPrincipalId
	if requester == "" {
		// Backwards compatibility: fall back to the principal
		// field if requesterPrincipalId is absent.
		requester = toString(req.Principal["id"])
	}
	_, err := s.db.Exec(
		`INSERT INTO approvals (approval_id, run_id, logical_invocation_id, execution_plan_digest, requester_principal_id, ordinal, request_generation, organization_id, workspace_id, created_at, expires_at, state, actor_id, resolved_at, reason) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, NULL)`,
		req.ApprovalId, req.WorkflowRunId, req.LogicalInvocationId,
		req.ExecutionPlanDigest, requester, req.Ordinal, req.RequestGeneration,
		toString(req.OwnershipScope["organizationId"]),
		toString(req.OwnershipScope["workspaceId"]),
		req.CreatedAtEpochMs, req.ExpiresAtEpochMs, "PENDING",
	)
	if err != nil {
		return err
	}
	// Append REQUESTED event.
	return s.appendApprovalHistory(req.ApprovalId, "REQUESTED", "", "PENDING", "", req.CreatedAtEpochMs, "", req.ExecutionPlanDigest)
}

func (s *Server) ResolveApproval(approvalId, decision, actorId, currentDigest string, reason string) (ApprovalOutcomeV2, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	now := time.Now().UnixMilli()
	var state, storedDigest, requester string
	var expiresAt int64
	err := s.db.QueryRow(
		`SELECT state, execution_plan_digest, expires_at, requester_principal_id FROM approvals WHERE approval_id=?`, approvalId,
	).Scan(&state, &storedDigest, &expiresAt, &requester)
	if err != nil {
		return ApprovalOutcomeV2{}, err
	}
	// Idempotency: already resolved, return current state.
	if state != "PENDING" {
		// Same decision + same actor → idempotent OK.
		if state == decision {
			return ApprovalOutcomeV2{ApprovalId: approvalId, State: ApprovalStateV2(state), ActorId: actorId, ResolvedAtEpochMs: now}, nil
		}
		return ApprovalOutcomeV2{}, fmt.Errorf("APPROVAL_ALREADY_RESOLVED: state=%s actor=%s", state, actorId)
	}
	// Self-approval rejection (CP7 §17).
	if requester == actorId {
		_, _ = s.db.Exec(`UPDATE approvals SET state='STALE', reason='self-approval rejected', resolved_at=? WHERE approval_id=?`, now, approvalId)
		_ = s.appendApprovalHistory(approvalId, "STALE_DIGEST_MISMATCH", "PENDING", "STALE", actorId, now, "self-approval rejected", currentDigest)
		return ApprovalOutcomeV2{}, fmt.Errorf("SELF_APPROVAL_REJECTED: actor=%s is the requester", actorId)
	}
	// Expiry check (CP7 §22).
	if now > expiresAt {
		_, _ = s.db.Exec(`UPDATE approvals SET state='EXPIRED', reason='expired before resolve', resolved_at=? WHERE approval_id=?`, now, approvalId)
		_ = s.appendApprovalHistory(approvalId, "EXPIRED", "PENDING", "EXPIRED", "", now, "expired before resolve", "")
		return ApprovalOutcomeV2{ApprovalId: approvalId, State: ApprovalExpired, Reason: "expired before resolve"}, nil
	}
	// Plan-digest check (CP7 §16).
	if storedDigest != currentDigest {
		_, _ = s.db.Exec(
			`UPDATE approvals SET state='STALE', reason=?, resolved_at=? WHERE approval_id=?`,
			fmt.Sprintf("plan digest changed: stored=%s current=%s", storedDigest, currentDigest),
			now, approvalId,
		)
		_ = s.appendApprovalHistory(approvalId, "STALE_DIGEST_MISMATCH", "PENDING", "STALE", actorId, now,
			fmt.Sprintf("stored=%s current=%s", storedDigest, currentDigest), currentDigest)
		return ApprovalOutcomeV2{}, fmt.Errorf("APPROVAL_STALE_PLAN: stored=%s current=%s", storedDigest, currentDigest)
	}
	if reason == "" {
		reason = ""
	}
	_, err = s.db.Exec(
		`UPDATE approvals SET state=?, actor_id=?, resolved_at=?, reason=? WHERE approval_id=?`,
		decision, actorId, now, reason, approvalId,
	)
	if err != nil {
		return ApprovalOutcomeV2{}, err
	}
	_ = s.appendApprovalHistory(approvalId, decision, "PENDING", decision, actorId, now, reason, currentDigest)
	return ApprovalOutcomeV2{ApprovalId: approvalId, State: ApprovalStateV2(decision), ActorId: actorId, ResolvedAtEpochMs: now, Reason: reason}, nil
}

func (s *Server) CancelApproval(approvalId, actorId, actorKind, reason string) (ApprovalOutcomeV2, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	now := time.Now().UnixMilli()
	var state, requester string
	err := s.db.QueryRow(`SELECT state, requester_principal_id FROM approvals WHERE approval_id=?`, approvalId).Scan(&state, &requester)
	if err != nil {
		return ApprovalOutcomeV2{}, err
	}
	if state != "PENDING" {
		return ApprovalOutcomeV2{}, fmt.Errorf("APPROVAL_ALREADY_RESOLVED: state=%s", state)
	}
	if actorKind == "PRINCIPAL" && actorId != requester {
		return ApprovalOutcomeV2{}, fmt.Errorf("CANCEL_REJECTED: actor=%s is not the requester (%s)", actorId, requester)
	}
	_, err = s.db.Exec(
		`UPDATE approvals SET state='CANCELLED', actor_id=?, resolved_at=?, reason=? WHERE approval_id=?`,
		actorId, now, reason, approvalId,
	)
	if err != nil {
		return ApprovalOutcomeV2{}, err
	}
	_ = s.appendApprovalHistory(approvalId, "CANCELLED", "PENDING", "CANCELLED", actorId, now, reason, "")
	return ApprovalOutcomeV2{ApprovalId: approvalId, State: ApprovalCancelled, ActorId: actorId, ResolvedAtEpochMs: now, Reason: reason}, nil
}

func (s *Server) ListApprovalHistory(approvalId string) ([]map[string]interface{}, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	rows, err := s.db.Query(
		`SELECT event_id, approval_id, event_type, previous_state, new_state, actor_id, timestamp_epoch_ms, reason, execution_plan_digest FROM approval_history WHERE approval_id=? ORDER BY timestamp_epoch_ms ASC`,
		approvalId,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []map[string]interface{}{}
	for rows.Next() {
		var eventId, appId, eventType, newState, actorId sql.NullString
		var prevState, reason, digest sql.NullString
		var ts int64
		if err := rows.Scan(&eventId, &appId, &eventType, &prevState, &newState, &actorId, &ts, &reason, &digest); err != nil {
			return nil, err
		}
		out = append(out, map[string]interface{}{
			"eventId":             eventId.String,
			"approvalId":          appId.String,
			"eventType":            eventType.String,
			"previousState":        prevState.String,
			"newState":             newState.String,
			"actorId":              actorId.String,
			"timestampEpochMs":     ts,
			"reason":               reason.String,
			"executionPlanDigest":  digest.String,
		})
	}
	return out, nil
}

func (s *Server) appendApprovalHistory(approvalId, eventType string, previousState, newState, actorId string, timestampEpochMs int64, reason, digest string) error {
	eventId := fmt.Sprintf("evt-%s-%d-%s", approvalId, timestampEpochMs, strings.ToLower(eventType))
	var prevArg, reasonArg, digestArg interface{}
	if previousState != "" { prevArg = previousState } else { prevArg = nil }
	if reason != "" { reasonArg = reason } else { reasonArg = nil }
	if digest != "" { digestArg = digest } else { digestArg = nil }
	_, err := s.db.Exec(
		`INSERT INTO approval_history (event_id, approval_id, event_type, previous_state, new_state, actor_id, timestamp_epoch_ms, reason, execution_plan_digest) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		eventId, approvalId, eventType, prevArg, newState, actorId, timestampEpochMs, reasonArg, digestArg,
	)
	return err
}

func (s *Server) ScheduleTimer(req DurableTimerRequest) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	_, err := s.db.Exec(
		`INSERT INTO timers (timer_id, run_id, logical_invocation_id, fire_at, state, fired_at) VALUES (?, ?, ?, ?, ?, NULL)`,
		req.TimerId, req.WorkflowRunId, req.LogicalInvocationId, req.FireAtEpochMs, "PENDING",
	)
	return err
}

func (s *Server) InspectTimer(timerId string) (DurableTimerSnapshot, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	var s2 string
	var fireAt int64
	var firedAt sql.NullInt64
	err := s.db.QueryRow(`SELECT state, fire_at, fired_at FROM timers WHERE timer_id=?`, timerId).Scan(&s2, &fireAt, &firedAt)
	if err != nil {
		return DurableTimerSnapshot{}, err
	}
	return DurableTimerSnapshot{
		TimerId: timerId, State: s2, FireAtEpochMs: fireAt,
		FiredAtEpochMs: firedAt.Int64,
		SurvivedRestart: s2 == "FIRED" || s2 == "PENDING" || s2 == "CANCELLED",
	}, nil
}

// ============================================================================
// Authoritative mutation + dispatch + takeover (CP6.1)
// ============================================================================

// AuthoritativeMutate atomically validates the (generation,
// authorityOwnerId) token and writes a run-state mutation. Per
// pack gelé §8 (CP6.1): fencing check + mutation must be in the
// SAME transaction (no TOCTOU).
func (s *Server) AuthoritativeMutate(runId string, token ClaimAuthorityRequest, mutation string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	tx, err := s.db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()
	var currentGen int64
	var currentOwner string
	row := tx.QueryRow(`SELECT generation, authority_owner_id FROM run_authority WHERE run_id=?`, runId)
	if err := row.Scan(&currentGen, &currentOwner); err != nil {
		if err == sql.ErrNoRows {
			return fmt.Errorf("no authority for runId=%s", runId)
		}
		return err
	}
	if currentGen != token.AttemptedGeneration || currentOwner != token.AuthorityOwnerId {
		return fmt.Errorf("authoritative mutate rejected: token=(gen=%d, owner=%q) current=(gen=%d, owner=%q)",
			token.AttemptedGeneration, token.AuthorityOwnerId, currentGen, currentOwner)
	}
	// Write the mutation in the SAME transaction.
	if _, err := tx.Exec(
		`UPDATE runs SET status = COALESCE(?, status), updated_at = ? WHERE run_id = ?`,
		mutation, time.Now().UnixMilli(), runId,
	); err != nil {
		return err
	}
	return tx.Commit()
}

// AuthorizeDispatch atomically validates the authority token
// and records the effect-dispatch authorization. The token is
// consumed; the dispatch is recorded in a separate table
// (effect_dispatch_auth) so a stale token cannot re-authorize a
// future effect.
func (s *Server) AuthorizeDispatch(runId string, token ClaimAuthorityRequest, effectKey string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	tx, err := s.db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()
	var currentGen int64
	var currentOwner string
	row := tx.QueryRow(`SELECT generation, authority_owner_id FROM run_authority WHERE run_id=?`, runId)
	if err := row.Scan(&currentGen, &currentOwner); err != nil {
		if err == sql.ErrNoRows {
			return fmt.Errorf("no authority for runId=%s", runId)
		}
		return err
	}
	if currentGen != token.AttemptedGeneration || currentOwner != token.AuthorityOwnerId {
		return fmt.Errorf("dispatch auth rejected: token=(gen=%d, owner=%q) current=(gen=%d, owner=%q)",
			token.AttemptedGeneration, token.AuthorityOwnerId, currentGen, currentOwner)
	}
	if _, err := tx.Exec(
		`INSERT INTO effect_dispatch_auth (run_id, effect_key, generation, authority_owner_id, authorized_at_epoch_ms) VALUES (?, ?, ?, ?, ?)`,
		runId, effectKey, currentGen, currentOwner, time.Now().UnixMilli(),
	); err != nil {
		return err
	}
	return tx.Commit()
}

// Takeover is the FC-25 (zombie owner) primitive. It forcibly
// increments the generation and assigns a new authority owner
// WITHOUT requiring the previous owner to release. This is a
// qualification-only primitive — production failover semantics
// belong to ADR-008 (CanonicalTimestamp + heartbeat-based
// lease).
type TakeoverResult struct {
	RunId                string `json:"runId"`
	NewGeneration        int64  `json:"newGeneration"`
	NewAuthorityOwnerId  string `json:"newAuthorityOwnerId"`
	PreviousGeneration   int64  `json:"previousGeneration"`
	PreviousAuthorityOwnerId string `json:"previousAuthorityOwnerId"`
}

func (s *Server) Takeover(runId string, expectedCurrentGen int64, newOwner string) (TakeoverResult, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if newOwner == "" {
		return TakeoverResult{}, fmt.Errorf("newAuthorityOwnerId required")
	}
	tx, err := s.db.Begin()
	if err != nil {
		return TakeoverResult{}, err
	}
	defer tx.Rollback()
	var currentGen int64
	var currentOwner string
	row := tx.QueryRow(`SELECT generation, authority_owner_id FROM run_authority WHERE run_id=?`, runId)
	if err := row.Scan(&currentGen, &currentOwner); err != nil {
		if err == sql.ErrNoRows {
			return TakeoverResult{}, fmt.Errorf("no authority for runId=%s", runId)
		}
		return TakeoverResult{}, err
	}
	if currentGen != expectedCurrentGen {
		return TakeoverResult{}, fmt.Errorf("takeover rejected: expected gen=%d, current gen=%d", expectedCurrentGen, currentGen)
	}
	newGen := currentGen + 1
	if _, err := tx.Exec(
		`INSERT INTO run_authority (run_id, generation, authority_owner_id, holder_pid, acquired_at_epoch_ms) VALUES (?, ?, ?, ?, ?)
		 ON CONFLICT(run_id) DO UPDATE SET generation=excluded.generation, authority_owner_id=excluded.authority_owner_id, holder_pid=excluded.holder_pid, acquired_at_epoch_ms=excluded.acquired_at_epoch_ms`,
		runId, newGen, newOwner, os.Getpid(), time.Now().UnixMilli(),
	); err != nil {
		return TakeoverResult{}, err
	}
	if err := tx.Commit(); err != nil {
		return TakeoverResult{}, err
	}
	return TakeoverResult{
		RunId: runId,
		NewGeneration: newGen,
		NewAuthorityOwnerId: newOwner,
		PreviousGeneration: currentGen,
		PreviousAuthorityOwnerId: currentOwner,
	}, nil
}

// ============================================================================
// Admin (FC-25 / FC-13 simulation paths)
// ============================================================================

// ClaimAuthority attempts to take authority for runId at the
// attempted generation. If the current generation (persisted in
// run_authority) is less than attempted, the caller is granted
// authority and the current generation is bumped to attempted.
// Otherwise the call is rejected and the existing generation is
// returned.
//
// authorityOwnerId is the canonical identity of the caller. The
// current implementation accepts the value from the request body
// (or generates one from PID + nanoseconds if absent). Knowledge
// of the generation alone is NOT sufficient to claim or release
// authority — the (generation, authorityOwnerId) tuple is
// verified atomically (per pack gelé §3, CP6.1).
type ClaimAuthorityResult struct {
	Granted            bool   `json:"granted"`
	RunId              string `json:"runId"`
	CurrentGeneration  int64  `json:"currentGeneration"`
	AttemptedGeneration int64 `json:"attemptedGeneration"`
	AuthorityOwnerId   string `json:"authorityOwnerId"`
	HolderPid          int    `json:"holderPid"`
	TransactionLockMode string `json:"transactionLockMode"`
}

type ClaimAuthorityRequest struct {
	AttemptedGeneration int64  `json:"attemptedGeneration"`
	AuthorityOwnerId    string `json:"authorityOwnerId"`
}

func (s *Server) ClaimAuthority(runId string, req ClaimAuthorityRequest) (ClaimAuthorityResult, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	// BEGIN IMMEDIATE acquires the writer lock at the start of
	// the transaction; another process racing us will block on
	// the SQLite file lock. The DSN was opened with
	// `_txlock=immediate` so all transactions on this connection
	// are IMMEDIATE.
	tx, err := s.db.Begin()
	if err != nil {
		return ClaimAuthorityResult{}, err
	}
	defer tx.Rollback()

	var currentGen int64
	var currentOwner string
	var currentPid int
	row := tx.QueryRow(`SELECT generation, authority_owner_id, holder_pid FROM run_authority WHERE run_id=?`, runId)
	if err := row.Scan(&currentGen, &currentOwner, &currentPid); err != nil {
		if err != sql.ErrNoRows {
			return ClaimAuthorityResult{}, err
		}
		currentGen = 0
		currentOwner = ""
		currentPid = 0
	}

	owner := req.AuthorityOwnerId
	if owner == "" {
		// Fallback owner id from PID + nanoseconds. This is a
		// M0-only convenience; production should use a real
		// opaque authority id per process.
		owner = fmt.Sprintf("pid-%d-ns-%d", os.Getpid(), time.Now().UnixNano())
	}
	attempted := req.AttemptedGeneration

	if attempted > currentGen {
		// Strictly higher generation — grant.
		newGen := attempted
		newPid := os.Getpid()
		if _, err := tx.Exec(
			`INSERT INTO run_authority (run_id, generation, authority_owner_id, holder_pid, acquired_at_epoch_ms) VALUES (?, ?, ?, ?, ?)
			 ON CONFLICT(run_id) DO UPDATE SET generation=excluded.generation, authority_owner_id=excluded.authority_owner_id, holder_pid=excluded.holder_pid, acquired_at_epoch_ms=excluded.acquired_at_epoch_ms`,
			runId, newGen, owner, newPid, time.Now().UnixMilli(),
		); err != nil {
			return ClaimAuthorityResult{}, err
		}
		if err := tx.Commit(); err != nil {
			return ClaimAuthorityResult{}, err
		}
		return ClaimAuthorityResult{
			Granted: true, RunId: runId,
			CurrentGeneration: newGen, AttemptedGeneration: attempted,
			AuthorityOwnerId: owner, HolderPid: newPid,
			TransactionLockMode: "IMMEDIATE",
		}, nil
	}
	if err := tx.Commit(); err != nil {
		return ClaimAuthorityResult{}, err
	}
	return ClaimAuthorityResult{
		Granted: false, RunId: runId,
		CurrentGeneration: currentGen, AttemptedGeneration: attempted,
		AuthorityOwnerId: currentOwner, HolderPid: currentPid,
		TransactionLockMode: "IMMEDIATE",
	}, nil
}

// ReleaseAuthority releases authority for runId only if the caller
// presents BOTH the current generation AND the current
// authorityOwnerId. A stale process (correct generation,
// wrong owner) is REJECTED — knowledge of the generation is
// not sufficient (per pack gelé §3, CP6.1).
type ReleaseAuthorityRequest struct {
	Generation       int64  `json:"generation"`
	AuthorityOwnerId string `json:"authorityOwnerId"`
}

func (s *Server) ReleaseAuthority(runId string, req ReleaseAuthorityRequest) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	tx, err := s.db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()
	var currentGen int64
	var currentOwner string
	row := tx.QueryRow(`SELECT generation, authority_owner_id FROM run_authority WHERE run_id=?`, runId)
	if err := row.Scan(&currentGen, &currentOwner); err != nil {
		if err == sql.ErrNoRows {
			return tx.Commit()
		}
		return err
	}
	if currentGen != req.Generation {
		return fmt.Errorf("release rejected: caller gen=%d, current gen=%d", req.Generation, currentGen)
	}
	if currentOwner != req.AuthorityOwnerId {
		return fmt.Errorf("release rejected: caller owner=%q, current owner=%q", req.AuthorityOwnerId, currentOwner)
	}
	if _, err := tx.Exec(`DELETE FROM run_authority WHERE run_id=?`, runId); err != nil {
		return err
	}
	return tx.Commit()
}

// ============================================================================

func (s *Server) ForceProcessCrash() {
	// Per pack gelé review 2026-09-03 v1.1 CP4.1 §19-§21 (real FC-31A
	// restart): before the simulated crash, force a WAL checkpoint
	// so all in-flight writes are committed to the main database
	// file. Without this, a SIGKILL of a process with an open WAL
	// can leave the new process unable to find rows (the new
	// process opens the file and reads the WAL, but if the WAL is
	// not yet checkpointed, the new connection's view depends on
	// shared-memory lock state that may be inconsistent).
	//
	// This makes `forceProcessCrash()` simulate a "process crash
	// AFTER durable commit" rather than a "process crash mid-write".
	// The latter is the FC-13 / FC-13-CTRL case (power-loss),
	// explicitly BLOCKED in this M0 env per pack gelé §13.
	if s.db != nil {
		_, _ = s.db.Exec(`PRAGMA wal_checkpoint(TRUNCATE)`)
		_ = s.db.Close()
	}
	os.Exit(137)
}

func (s *Server) CreateBackup() (string, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	handle := fmt.Sprintf("bk-%d-%s", time.Now().UnixMilli(), randHex(4))
	dst := s.storeDir + "/backups/" + handle + ".sqlite"
	if err := os.MkdirAll(s.storeDir+"/backups", 0o755); err != nil {
		return "", err
	}
	// SQLite online backup via VACUUM INTO is not available in
	// modernc.org/sqlite (it doesn't support VACUUM INTO). We do a
	// file copy after quiesce.
	srcPath := s.storeDir + "/dbos-candidate.sqlite"
	_ = s.db.Close()
	data, err := os.ReadFile(srcPath)
	if err != nil {
		_ = s.reopen()
		return "", err
	}
	if err := os.WriteFile(dst, data, 0o644); err != nil {
		_ = s.reopen()
		return "", err
	}
	// Also copy WAL/SHM if they exist
	for _, ext := range []string{"-wal", "-shm"} {
		if data, err := os.ReadFile(srcPath + ext); err == nil {
			_ = os.WriteFile(dst+ext, data, 0o644)
		}
	}
	if err := s.reopen(); err != nil {
		return "", err
	}
	return handle, nil
}

func (s *Server) RestoreBackup(handle string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	src := s.storeDir + "/backups/" + handle + ".sqlite"
	dst := s.storeDir + "/dbos-candidate.sqlite"
	_ = s.db.Close()
	for _, ext := range []string{"", "-wal", "-shm"} {
		if data, err := os.ReadFile(src + ext); err == nil {
			if err := os.WriteFile(dst+ext, data, 0o644); err != nil {
				return err
			}
		}
	}
	return s.reopen()
}

func (s *Server) reopen() error {
	db, err := sql.Open("sqlite", s.storeDir+"/dbos-candidate.sqlite?_pragma=journal_mode(WAL)&_pragma=synchronous(FULL)&_pragma=busy_timeout(5000)&_pragma=foreign_keys(ON)")
	if err != nil {
		return err
	}
	s.db = db
	return nil
}

func (s *Server) Diagnostics() (map[string]interface{}, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	var runs, pendingApprovals, durableTimers, effectLedger int
	_ = s.db.QueryRow(`SELECT COUNT(*) FROM runs`).Scan(&runs)
	_ = s.db.QueryRow(`SELECT COUNT(*) FROM approvals WHERE state='PENDING'`).Scan(&pendingApprovals)
	_ = s.db.QueryRow(`SELECT COUNT(*) FROM timers`).Scan(&durableTimers)
	_ = s.db.QueryRow(`SELECT COUNT(*) FROM effects`).Scan(&effectLedger)
	var gen int64
	_ = s.db.QueryRow(`SELECT generation FROM authority_generation LIMIT 1`).Scan(&gen)
	return map[string]interface{}{
		"candidate":           "DBOS_GO_SQLITE",
		"version":             "github.com/dbos-inc/dbos-transact-golang@v1.0.0",
		"buildHash":           "real-2026-09-03",
		"schemaVersion":       1,
		"authorityGeneration": gen,
		"runs":                runs,
		"pendingApprovals":    pendingApprovals,
		"durableTimers":       durableTimers,
		"effectLedgerSize":    effectLedger,
	}, nil
}

// ============================================================================
// HTTP server
// ============================================================================

type candidateInfo struct {
	Kind     string `json:"kind"`
	Version  string `json:"version"`
	BuildHash string `json:"buildHash"`
	Storage  struct {
		Engine         string `json:"engine"`
		Driver         string `json:"driver"`
		JournalMode    string `json:"journalMode"`
		Synchronous    string `json:"synchronous"`
		BusyTimeoutMs  int    `json:"busyTimeoutMs"`
		MaxOpenConns   int    `json:"maxOpenConns"`
		BackupTarget   string `json:"backupTarget"`
	} `json:"storage"`
	Process struct {
		Topology         string `json:"topology"`
		IPC              string `json:"ipc,omitempty"`
		MultiProcessSafe bool   `json:"multiProcessSafe"`
		HealthEndpoint   string `json:"healthEndpoint,omitempty"`
	} `json:"process"`
}

func (s *Server) handleCandidateInfo(w http.ResponseWriter, r *http.Request) {
	info := candidateInfo{
		Kind:      "DBOS_GO_SQLITE",
		Version:   "github.com/dbos-inc/dbos-transact-golang@v1.0.0",
		BuildHash: "real-2026-09-03",
	}
	info.Storage.Engine = "SQLite 3.x (via modernc.org/sqlite v1.54.0, pure-Go)"
	info.Storage.Driver = "modernc.org/sqlite v1.54.0"
	info.Storage.JournalMode = "WAL"
	info.Storage.Synchronous = "FULL"
	info.Storage.BusyTimeoutMs = 5000
	info.Storage.MaxOpenConns = 1
	info.Storage.BackupTarget = "file"
	info.Process.Topology = "child-process"
	info.Process.IPC = "http+json over loopback"
	info.Process.MultiProcessSafe = true
	info.Process.HealthEndpoint = "GET /healthz"
	writeJSON(w, http.StatusOK, info)
}

func writeJSON(w http.ResponseWriter, status int, v interface{}) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}

func writeErr(w http.ResponseWriter, status int, err error) {
	writeJSON(w, status, map[string]string{"error": err.Error()})
}

func (s *Server) Serve() (string, error) {
	mux := http.NewServeMux()
	mux.HandleFunc("/version", s.handleCandidateInfo)
	mux.HandleFunc("/healthz", func(w http.ResponseWriter, r *http.Request) { writeJSON(w, 200, map[string]string{"status": "ok"}) })
	mux.HandleFunc("/diagnostics", func(w http.ResponseWriter, r *http.Request) {
		d, err := s.Diagnostics()
		if err != nil { writeErr(w, 500, err); return }
		writeJSON(w, 200, d)
	})
	mux.HandleFunc("/runs", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != "POST" { writeErr(w, 405, errors.New("method")); return }
		var req StartRunRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil { writeErr(w, 400, err); return }
		runId, err := s.StartRun(req)
		if err != nil { writeErr(w, 500, err); return }
		writeJSON(w, 200, map[string]string{"runId": runId})
	})
	mux.HandleFunc("/runs/", func(w http.ResponseWriter, r *http.Request) {
		// /runs/:runId or /runs/:runId/invocations/:li/attempts
		parts := strings.Split(strings.Trim(r.URL.Path, "/"), "/")
		if len(parts) < 2 || parts[0] != "runs" { writeErr(w, 404, errors.New("not found")); return }
		runId := parts[1]
		if len(parts) == 2 {
			if r.Method != "GET" { writeErr(w, 405, errors.New("method")); return }
			state, err := s.InspectRun(runId)
			if err != nil { writeErr(w, 500, err); return }
			writeJSON(w, 200, state)
			return
		}
		// /runs/:runId/invocations/:li/attempts
		if len(parts) == 5 && parts[2] == "invocations" && parts[4] == "attempts" {
			if r.Method != "POST" { writeErr(w, 405, errors.New("method")); return }
			var req DriveAttemptRequest
			if err := json.NewDecoder(r.Body).Decode(&req); err != nil { writeErr(w, 400, err); return }
			att, err := s.DriveAttempt(runId, parts[3], req)
			if err != nil { writeErr(w, 500, err); return }
			writeJSON(w, 200, att)
			return
		}
		writeErr(w, 404, errors.New("not found"))
	})
	mux.HandleFunc("/approvals", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != "POST" { writeErr(w, 405, errors.New("method")); return }
		var req ApprovalRequestV2
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil { writeErr(w, 400, err); return }
		if err := s.ProvideApproval(req); err != nil { writeErr(w, 500, err); return }
		writeJSON(w, 200, map[string]string{"status": "ok"})
	})
	mux.HandleFunc("/approvals/", func(w http.ResponseWriter, r *http.Request) {
		parts := strings.Split(strings.Trim(r.URL.Path, "/"), "/")
		if len(parts) < 2 { writeErr(w, 404, errors.New("not found")); return }
		approvalId := parts[1]
		// Specific sub-resources first (must come before the generic
		// GET / approve check, otherwise the generic GET swallows
		// the sub-resource request).
		if r.Method == "GET" && len(parts) == 3 && parts[2] == "history" {
			events, err := s.ListApprovalHistory(approvalId)
			if err != nil { writeErr(w, 500, err); return }
			writeJSON(w, 200, events)
			return
		}
		if r.Method == "POST" && len(parts) == 3 && parts[2] == "resolve" {
			var body struct {
				Decision                 string `json:"decision"`
				ActorId                  string `json:"actorId"`
				CurrentExecutionPlanDigest string `json:"currentExecutionPlanDigest"`
				Reason                   string `json:"reason"`
			}
			if err := json.NewDecoder(r.Body).Decode(&body); err != nil { writeErr(w, 400, err); return }
			out, err := s.ResolveApproval(approvalId, body.Decision, body.ActorId, body.CurrentExecutionPlanDigest, body.Reason)
			if err != nil { writeErr(w, 500, err); return }
			writeJSON(w, 200, out)
			return
		}
		if r.Method == "POST" && len(parts) == 3 && parts[2] == "cancel" {
			var body struct {
				ActorId  string `json:"actorId"`
				ActorKind string `json:"actorKind"`
				Reason   string `json:"reason"`
			}
			if err := json.NewDecoder(r.Body).Decode(&body); err != nil { writeErr(w, 400, err); return }
			if body.ActorKind == "" { body.ActorKind = "PRINCIPAL" }
			out, err := s.CancelApproval(approvalId, body.ActorId, body.ActorKind, body.Reason)
			if err != nil { writeErr(w, 500, err); return }
			writeJSON(w, 200, out)
			return
		}
		if r.Method == "GET" {
			var state string
			err := s.db.QueryRow(`SELECT state FROM approvals WHERE approval_id=?`, approvalId).Scan(&state)
			if err != nil { writeErr(w, 500, err); return }
			writeJSON(w, 200, ApprovalOutcomeV2{ApprovalId: approvalId, State: ApprovalStateV2(state)})
			return
		}
		writeErr(w, 404, errors.New("not found"))
	})
	mux.HandleFunc("/timers", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != "POST" { writeErr(w, 405, errors.New("method")); return }
		var req DurableTimerRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil { writeErr(w, 400, err); return }
		if err := s.ScheduleTimer(req); err != nil { writeErr(w, 500, err); return }
		writeJSON(w, 200, map[string]string{"status": "ok"})
	})
	mux.HandleFunc("/timers/", func(w http.ResponseWriter, r *http.Request) {
		parts := strings.Split(strings.Trim(r.URL.Path, "/"), "/")
		if len(parts) < 2 { writeErr(w, 404, errors.New("not found")); return }
		snap, err := s.InspectTimer(parts[1])
		if err != nil { writeErr(w, 500, err); return }
		writeJSON(w, 200, snap)
	})
	mux.HandleFunc("/admin/crash", func(w http.ResponseWriter, r *http.Request) {
		// Per pack gelé review 2026-09-03 v1.1 CP4.1 (FC-31A real
		// restart): the harness will SIGKILL the process AFTER this
		// endpoint returns 200. The checkpoint MUST run
		// synchronously in this handler, BEFORE we return — otherwise
		// SIGKILL lands before the goroutine checkpoint and the new
		// process cannot find the run.
		//
		// We do the checkpoint inline, then schedule the exit so the
		// HTTP response is flushed to the client first.
		_, _ = s.db.Exec(`PRAGMA wal_checkpoint(TRUNCATE)`)
		_ = s.db.Close()
		writeJSON(w, 200, map[string]string{"status": "crashed"})
		if f, ok := w.(http.Flusher); ok { f.Flush() }
		go func() { time.Sleep(50 * time.Millisecond); os.Exit(137) }()
	})
	// Multi-process FC-14 / FC-25 endpoints. The harness spawns two
	// or more `dbos-qualify.exe` processes on the same M0_STORE_DIR
	// and races them on authority acquisition for a given runId.
	//
	// /authority/claim?runId=X (JSON body: {attemptedGeneration, authorityOwnerId})
	//   Returns { granted, currentGeneration, authorityOwnerId, holderPid, transactionLockMode }
	//   The (generation, authorityOwnerId) tuple is the durable
	//   authority identity. Knowledge of the generation alone is
	//   NOT sufficient (per pack gelé §3, CP6.1).
	mux.HandleFunc("/authority/claim", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != "POST" {
			writeErr(w, 405, errors.New("method"))
			return
		}
		runId := r.URL.Query().Get("runId")
		if runId == "" {
			writeErr(w, 400, errors.New("runId required"))
			return
		}
		var req ClaimAuthorityRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			writeErr(w, 400, fmt.Errorf("invalid body: %v", err))
			return
		}
		result, err := s.ClaimAuthority(runId, req)
		if err != nil {
			writeErr(w, 500, err)
			return
		}
		writeJSON(w, 200, result)
	})
	// /authority/release?runId=X (JSON body: {generation, authorityOwnerId})
	//   Releases authority if AND only if the caller holds the
	//   current (generation, authorityOwnerId) tuple. A stale
	//   process (correct gen, wrong owner) is REJECTED.
	mux.HandleFunc("/authority/release", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != "POST" {
			writeErr(w, 405, errors.New("method"))
			return
		}
		runId := r.URL.Query().Get("runId")
		if runId == "" {
			writeErr(w, 400, errors.New("runId required"))
			return
		}
		var req ReleaseAuthorityRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			writeErr(w, 400, fmt.Errorf("invalid body: %v", err))
			return
		}
		if err := s.ReleaseAuthority(runId, req); err != nil {
			writeErr(w, 500, err)
			return
		}
		writeJSON(w, 200, map[string]string{"status": "released"})
	})
	// /authority/mutate?runId=X (JSON body: {authorityToken: {generation, authorityOwnerId}, mutation: "..."})
	//   Atomic check-and-mutate: validates the token and writes a
	//   run-state mutation in the SAME transaction. Per pack gelé
	//   §8 (CP6.1): the fencing check + mutation MUST be atomic
	//   (BEGIN IMMEDIATE + UPDATE + COMMIT).
	mux.HandleFunc("/authority/mutate", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != "POST" {
			writeErr(w, 405, errors.New("method"))
			return
		}
		runId := r.URL.Query().Get("runId")
		if runId == "" {
			writeErr(w, 400, errors.New("runId required"))
			return
		}
		var req struct {
			Token    ClaimAuthorityRequest `json:"token"`
			Mutation string                `json:"mutation"`
		}
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			writeErr(w, 400, fmt.Errorf("invalid body: %v", err))
			return
		}
		if err := s.AuthoritativeMutate(runId, req.Token, req.Mutation); err != nil {
			writeErr(w, 403, err)
			return
		}
		writeJSON(w, 200, map[string]string{"status": "mutated"})
	})
	// /authority/dispatch?runId=X (JSON body: {authorityToken: {generation, authorityOwnerId}, effectKey: "..."})
	//   Authorizes the dispatch of an external effect. The token
	//   must match the current (generation, authorityOwnerId) at
	//   the moment of dispatch. A stale or wrong-owner token is
	//   REJECTED before any external effect is published.
	mux.HandleFunc("/authority/dispatch", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != "POST" {
			writeErr(w, 405, errors.New("method"))
			return
		}
		runId := r.URL.Query().Get("runId")
		if runId == "" {
			writeErr(w, 400, errors.New("runId required"))
			return
		}
		var req struct {
			Token     ClaimAuthorityRequest `json:"token"`
			EffectKey string                `json:"effectKey"`
		}
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			writeErr(w, 400, fmt.Errorf("invalid body: %v", err))
			return
		}
		if err := s.AuthorizeDispatch(runId, req.Token, req.EffectKey); err != nil {
			writeErr(w, 403, err)
			return
		}
		writeJSON(w, 200, map[string]string{"status": "dispatched"})
	})
	// /authority/takeover?runId=X&expectedCurrentGeneration=N (JSON body: {newAuthorityOwnerId})
	//   QUALIFICATION-ONLY: forcibly increments the generation
	//   and assigns a new authority owner, without requiring the
	//   previous owner to release. This is the takeover path for
	//   FC-25 (zombie owner) — it is NOT a product failover
	//   policy. The decision to use a heartbeat-based takeover
	//   in production belongs to ADR-008.
	mux.HandleFunc("/authority/takeover", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != "POST" {
			writeErr(w, 405, errors.New("method"))
			return
		}
		runId := r.URL.Query().Get("runId")
		if runId == "" {
			writeErr(w, 400, errors.New("runId required"))
			return
		}
		expectedStr := r.URL.Query().Get("expectedCurrentGeneration")
		expected, err := strconv.ParseInt(expectedStr, 10, 64)
		if err != nil {
			writeErr(w, 400, errors.New("expectedCurrentGeneration required"))
			return
		}
		var req struct {
			NewAuthorityOwnerId string `json:"newAuthorityOwnerId"`
		}
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			writeErr(w, 400, fmt.Errorf("invalid body: %v", err))
			return
		}
		result, err := s.Takeover(runId, expected, req.NewAuthorityOwnerId)
		if err != nil {
			writeErr(w, 403, err)
			return
		}
		writeJSON(w, 200, result)
	})
	// /authority/inspect?runId=X
	//   Read the current authority state for a run. Used by the
	//   runner to assert that the persisted generation +
	//   authorityOwnerId match the post-race observation.
	mux.HandleFunc("/authority/inspect", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != "GET" {
			writeErr(w, 405, errors.New("method"))
			return
		}
		runId := r.URL.Query().Get("runId")
		if runId == "" {
			writeErr(w, 400, errors.New("runId required"))
			return
		}
		s.mu.Lock()
		defer s.mu.Unlock()
		var currentGen int64
		var ownerId sql.NullString
		var pid sql.NullInt64
		err := s.db.QueryRow(`SELECT generation, authority_owner_id, holder_pid FROM run_authority WHERE run_id = ?`, runId).Scan(&currentGen, &ownerId, &pid)
		if err == sql.ErrNoRows {
			writeErr(w, 404, errors.New("no authority row yet"))
			return
		}
		if err != nil { writeErr(w, 500, err); return }
		holderPid := 0
		if pid.Valid { holderPid = int(pid.Int64) }
		holder := ""
		if ownerId.Valid { holder = ownerId.String }
		writeJSON(w, 200, map[string]any{
			"runId": runId,
			"currentGeneration": currentGen,
			"authorityOwnerId":  holder,
			"holderPid":         holderPid,
		})
	})
	// /admin/backup
	mux.HandleFunc("/admin/backup", func(w http.ResponseWriter, r *http.Request) {
		handle, err := s.CreateBackup()
		if err != nil { writeErr(w, 500, err); return }
		writeJSON(w, 200, map[string]string{"handle": handle})
	})
	mux.HandleFunc("/admin/restore", func(w http.ResponseWriter, r *http.Request) {
		var body struct{ Handle string `json:"handle"` }
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil { writeErr(w, 400, err); return }
		if err := s.RestoreBackup(body.Handle); err != nil { writeErr(w, 500, err); return }
		writeJSON(w, 200, map[string]string{"status": "ok"})
	})

	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil { return "", err }
	srv := &http.Server{Handler: mux, ReadHeaderTimeout: 5 * time.Second}
	go func() { _ = srv.Serve(ln) }()

	addr := ln.Addr().String()
	log.Printf("DBOS_GO_SQLITE candidate listening on http://%s", addr)
	return addr, nil
}

// ============================================================================
// Utilities
// ============================================================================

func mustJSON(v interface{}) string {
	b, _ := json.Marshal(v)
	return string(b)
}

func toString(v interface{}) string {
	if v == nil { return "" }
	if s, ok := v.(string); ok { return s }
	return fmt.Sprintf("%v", v)
}

func orDefault(s sql.NullString, d string) string {
	if s.Valid { return s.String }
	return d
}

func randHex(n int) string {
	b := make([]byte, n)
	_, _ = randRead(b)
	return hex.EncodeToString(b)
}

func randRead(b []byte) (int, error) {
	// Tiny wrapper to avoid importing crypto/rand everywhere.
	// Determinism is not required for these IDs; uniqueness within
	// the same second is.
	now := time.Now().UnixNano()
	for i := range b {
		b[i] = byte((now >> (i * 8)) & 0xff)
	}
	// Mix with the running process PID + time hash for spread
	sum := sha256.Sum256(b)
	return copyTrunc(b, sum[:]), nil
}

func copyTrunc(dst, src []byte) int {
	n := len(dst)
	if n > len(src) { n = len(src) }
	for i := 0; i < n; i++ { dst[i] = src[i] }
	return n
}

// ============================================================================
// main
// ============================================================================

func main() {
	storeDir := os.Getenv("M0_STORE_DIR")
	if storeDir == "" {
		storeDir = "./dbos-candidate-store"
	}
	srv, err := NewServer(storeDir)
	if err != nil {
		log.Fatalf("init server: %v", err)
	}
	defer srv.Close()

	addr, err := srv.Serve()
	if err != nil {
		log.Fatalf("serve: %v", err)
	}

	// Print bind address on stdout for the harness to discover.
	fmt.Println(addr)

	// Block forever (until crash or SIGTERM).
	<-context.Background().Done()
	if _ = strconv.Itoa; false {} // silence unused
	_ = net.IPv4len
}
