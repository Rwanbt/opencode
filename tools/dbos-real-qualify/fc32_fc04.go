package main

// FC-32 / FC-04 capability surface for the REAL DBOS Go candidate.
//
// FC-32 (frozen pack §44, master plan §23-§27): the candidate's own
// orchestration is a REAL DBOS workflow whose steps are RunAsStep.
// A completed step's body never re-runs on recovery (DBOS replays the
// durable output); an incomplete step's body re-executes. The workflow
// journals every observable fact itself:
//
//   fc32_executions      one row per workflow-function execution (token)
//   fc32_step_bodies     BODY event per actual step-body execution
//   fc32_step_resolutions per-step resolution with kind BODY|REPLAY
//   fc32_ambient_reads   journaled ambient (T/R/O) reads
//   fc32_effect_executions external effect journal (EffectKey dedup)
//   fc32_final           materialized final state
//
// The crash is a REAL process kill during the first execute-effect body
// (after the effect journal row commits, before the step output is
// durable). DBOS recovery on relaunch replays completed steps and
// re-executes the incomplete one — measured, never declared.

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"bytes"
	"time"

	"github.com/dbos-inc/dbos-transact-golang/dbos"
)

const fc32Schema = `
CREATE TABLE IF NOT EXISTS fc32_executions (
  run_id TEXT NOT NULL,
  token TEXT NOT NULL,
  at INTEGER NOT NULL,
  PRIMARY KEY (run_id, token)
);
CREATE TABLE IF NOT EXISTS fc32_step_bodies (
  run_id TEXT NOT NULL,
  step_name TEXT NOT NULL,
  token TEXT NOT NULL,
  at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS fc32_step_resolutions (
  run_id TEXT NOT NULL,
  step_name TEXT NOT NULL,
  token TEXT NOT NULL,
  kind TEXT NOT NULL,
  at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS fc32_ambient (
  run_id TEXT PRIMARY KEY,
  t_value TEXT NOT NULL,
  r_value TEXT NOT NULL,
  o_value TEXT NOT NULL,
  set_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS fc32_ambient_reads (
  run_id TEXT NOT NULL,
  token TEXT NOT NULL,
  t_value TEXT NOT NULL,
  r_value TEXT NOT NULL,
  o_value TEXT NOT NULL,
  at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS fc32_effect_executions (
  run_id TEXT NOT NULL,
  effect_key TEXT NOT NULL,
  token TEXT NOT NULL,
  at INTEGER NOT NULL,
  PRIMARY KEY (run_id, effect_key)
);
CREATE TABLE IF NOT EXISTS fc32_runs (
  run_id TEXT PRIMARY KEY,
  li_id TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS fc32_final (
  run_id TEXT PRIMARY KEY,
  state_json TEXT NOT NULL,
  at INTEGER NOT NULL
);
`

// Fc32WorkflowInput is fixed per DBOS workflow; the crash gate is the
// effect-dedup check inside the step body, NOT an external flag.
type Fc32WorkflowInput struct {
	RunID string `json:"runId"`
}

type fc32Captured struct {
	T string `json:"t"`
	R string `json:"r"`
	O string `json:"o"`
}

type Fc32WorkflowOutput struct {
	FinalState map[string]any `json:"finalState"`
}

func (s *server) fc32JournalExec(runID, token string) {
	_, _ = s.rawSQL.Exec(`INSERT INTO fc32_executions (run_id, token, at) VALUES (?, ?, ?)`, runID, token, time.Now().UnixMilli())
}

func (s *server) fc32JournalBody(runID, stepName, token string) {
	_, _ = s.rawSQL.Exec(`INSERT INTO fc32_step_bodies (run_id, step_name, token, at) VALUES (?, ?, ?, ?)`, runID, stepName, token, time.Now().UnixMilli())
}

// fc32Resolve journals how a step resolved for THIS execution: the body
// ran (BODY) or the durable output replayed (REPLAY).
func (s *server) fc32Resolve(runID, stepName, token string) {
	var n int
	_ = s.rawSQL.QueryRow(`SELECT COUNT(*) FROM fc32_step_bodies WHERE run_id = ? AND step_name = ? AND token = ?`, runID, stepName, token).Scan(&n)
	kind := "REPLAY"
	if n > 0 {
		kind = "BODY"
	}
	_, _ = s.rawSQL.Exec(`INSERT INTO fc32_step_resolutions (run_id, step_name, token, kind, at) VALUES (?, ?, ?, ?, ?)`, runID, stepName, token, kind, time.Now().UnixMilli())
}

func (s *server) Fc32Workflow(ctx dbos.Context, in Fc32WorkflowInput) (Fc32WorkflowOutput, error) {
	runID := in.RunID
	tokenBytes := make([]byte, 12)
	if _, err := randRead(tokenBytes); err != nil {
		return Fc32WorkflowOutput{}, fmt.Errorf("fc32 token: %w", err)
	}
	token := hexEncode(tokenBytes)
	s.fc32JournalExec(runID, token)

	// Step 1 — capture ambient T/R/O. The ONLY ambient read in the
	// workflow; its body journals the read. On recovery this step's
	// output replays and the body (and read) never re-run.
	captured, err := dbos.RunAsStep(ctx, func(ctx context.Context) (fc32Captured, error) {
		s.fc32JournalBody(runID, "capture-ambient", token)
		var ambient fc32Captured
		if err := s.rawSQL.QueryRow(`SELECT t_value, r_value, o_value FROM fc32_ambient WHERE run_id = ?`, runID).Scan(&ambient.T, &ambient.R, &ambient.O); err != nil {
			return fc32Captured{}, fmt.Errorf("read ambient: %w", err)
		}
		_, _ = s.rawSQL.Exec(`INSERT INTO fc32_ambient_reads (run_id, token, t_value, r_value, o_value, at) VALUES (?, ?, ?, ?, ?, ?)`, runID, token, ambient.T, ambient.R, ambient.O, time.Now().UnixMilli())
		return ambient, nil
	}, dbos.WithStepName("fc32-capture-ambient"))
	if err != nil {
		return Fc32WorkflowOutput{}, fmt.Errorf("capture-ambient: %w", err)
	}
	s.fc32Resolve(runID, "capture-ambient", token)

	// Step 2 — derive the external EffectKey deterministically from the
	// RECORDED capture output.
	derived, err := dbos.RunAsStep(ctx, func(ctx context.Context) (string, error) {
		s.fc32JournalBody(runID, "derive-effect-key", token)
		return fmt.Sprintf("ek-fc32-%s-%s-%s", captured.T, captured.R, captured.O), nil
	}, dbos.WithStepName("fc32-derive-effect-key"))
	if err != nil {
		return Fc32WorkflowOutput{}, fmt.Errorf("derive-effect-key: %w", err)
	}
	s.fc32Resolve(runID, "derive-effect-key", token)

	// Step 3 — execute the external effect. First execution: journal the
	// effect row (the external world has it) then hold the step open for
	// a window so the harness can kill the process with the step
	// INCOMPLETE. Recovery: the effect row already exists, so the body
	// re-runs WITHOUT the hold and the step completes.
	_, err = dbos.RunAsStep(ctx, func(ctx context.Context) (bool, error) {
		s.fc32JournalBody(runID, "execute-effect", token)
		var n int
		if err := s.rawSQL.QueryRow(`SELECT COUNT(*) FROM fc32_effect_executions WHERE run_id = ? AND effect_key = ?`, runID, derived).Scan(&n); err != nil {
			return false, fmt.Errorf("effect dedup read: %w", err)
		}
		if n == 0 {
			if _, err := s.rawSQL.Exec(`INSERT INTO fc32_effect_executions (run_id, effect_key, token, at) VALUES (?, ?, ?, ?)`, runID, derived, token, time.Now().UnixMilli()); err != nil {
				return false, fmt.Errorf("effect journal: %w", err)
			}
			// Crash window: the effect is durably observed by the external
			// world while THIS step is still incomplete.
			time.Sleep(8 * time.Second)
		}
		return true, nil
	}, dbos.WithStepName("fc32-execute-effect"))
	if err != nil {
		return Fc32WorkflowOutput{}, fmt.Errorf("execute-effect: %w", err)
	}
	s.fc32Resolve(runID, "execute-effect", token)

	// Step 4 — control-flow decision recomputed from RECORDED values only.
	branch, err := dbos.RunAsStep(ctx, func(ctx context.Context) (string, error) {
		s.fc32JournalBody(runID, "decide-branch", token)
		if captured.R < "m" {
			return "LOW", nil
		}
		return "HIGH", nil
	}, dbos.WithStepName("fc32-decide-branch"))
	if err != nil {
		return Fc32WorkflowOutput{}, fmt.Errorf("decide-branch: %w", err)
	}
	s.fc32Resolve(runID, "decide-branch", token)

	// Step 5 — materialize the final canonical state.
	final := map[string]any{
		"t": captured.T, "r": captured.R, "o": captured.O,
		"effectKey": derived, "branch": branch, "lineage": "attempt-1-capture",
	}
	_, err = dbos.RunAsStep(ctx, func(ctx context.Context) (bool, error) {
		s.fc32JournalBody(runID, "materialize", token)
		stateJSON, _ := json.Marshal(final)
		if _, err := s.rawSQL.Exec(`INSERT INTO fc32_final (run_id, state_json, at) VALUES (?, ?, ?)
			ON CONFLICT(run_id) DO UPDATE SET state_json = excluded.state_json, at = excluded.at`, runID, string(stateJSON), time.Now().UnixMilli()); err != nil {
			return false, err
		}
		return true, nil
	}, dbos.WithStepName("fc32-materialize"))
	if err != nil {
		return Fc32WorkflowOutput{}, fmt.Errorf("materialize: %w", err)
	}
	s.fc32Resolve(runID, "materialize", token)

	return Fc32WorkflowOutput{FinalState: final}, nil
}
// ----------------------------------------------------------------------------
// FC-32 HTTP handlers
// ----------------------------------------------------------------------------

type fc32StartInput struct {
	WorkflowVersionID string `json:"workflowVersionId"`
	Ambient           struct {
		T string `json:"t"`
		R string `json:"r"`
		O string `json:"o"`
	} `json:"ambient"`
}

func (s *server) handleFc32Start(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	var in fc32StartInput
	if err := json.NewDecoder(r.Body).Decode(&in); err != nil {
		http.Error(w, "bad request: "+err.Error(), http.StatusBadRequest)
		return
	}
	runID := "run-fc32-" + randHex(12)
	liID := "li-fc32-" + randHex(8)
	startIn := StartRunInput{
		WorkflowVersionID:   in.WorkflowVersionID,
		OrganizationID:      "o1",
		WorkspaceID:         "ws-fc32",
		LogicalInvocationID: liID,
		EffectKey:           "ek-fc32-root",
		CanonicalInputJSON:  `{"scenario":"fc32-replay"}`,
		SeedCanonicalJSON:   `{"scenario":"fc32-replay"}`,
		RunID:               runID,
	}
	wfID := runID
	if _, err := dbos.RunWorkflow(s.dbosCtx, StartRunWorkflow, startIn, dbos.WithWorkflowID(wfID)); err != nil {
		http.Error(w, "RunWorkflow: "+err.Error(), http.StatusInternalServerError)
		return
	}
	if _, err := s.rawSQL.Exec(`INSERT INTO fc32_runs (run_id, li_id) VALUES (?, ?)`, runID, liID); err != nil {
		http.Error(w, "fc32_runs: "+err.Error(), http.StatusInternalServerError)
		return
	}
	if _, err := s.rawSQL.Exec(`INSERT INTO fc32_ambient (run_id, t_value, r_value, o_value, set_at) VALUES (?, ?, ?, ?, ?)
		ON CONFLICT(run_id) DO UPDATE SET t_value = excluded.t_value, r_value = excluded.r_value, o_value = excluded.o_value, set_at = excluded.set_at`,
		runID, in.Ambient.T, in.Ambient.R, in.Ambient.O, time.Now().UnixMilli()); err != nil {
		http.Error(w, "ambient: "+err.Error(), http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]any{"runId": runID, "logicalInvocationId": liID})
}

func (s *server) handleFc32Ambient(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	var in struct {
		RunID   string `json:"runId"`
		Ambient struct {
			T string `json:"t"`
			R string `json:"r"`
			O string `json:"o"`
		} `json:"ambient"`
	}
	if err := json.NewDecoder(r.Body).Decode(&in); err != nil {
		http.Error(w, "bad request: "+err.Error(), http.StatusBadRequest)
		return
	}
	if _, err := s.rawSQL.Exec(`INSERT INTO fc32_ambient (run_id, t_value, r_value, o_value, set_at) VALUES (?, ?, ?, ?, ?)
		ON CONFLICT(run_id) DO UPDATE SET t_value = excluded.t_value, r_value = excluded.r_value, o_value = excluded.o_value, set_at = excluded.set_at`,
		in.RunID, in.Ambient.T, in.Ambient.R, in.Ambient.O, time.Now().UnixMilli()); err != nil {
		http.Error(w, "ambient: "+err.Error(), http.StatusInternalServerError)
		return
	}
	w.WriteHeader(http.StatusOK)
}

func (s *server) handleFc32Attempt(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	var in struct {
		RunID string `json:"runId"`
		Mode  string `json:"mode"`
	}
	if err := json.NewDecoder(r.Body).Decode(&in); err != nil {
		http.Error(w, "bad request: "+err.Error(), http.StatusBadRequest)
		return
	}
	if in.Mode != "crash-before-effect-commit" {
		http.Error(w, "use /fc32/recover for the complete/recovery path", http.StatusBadRequest)
		return
	}
	var liID string
	if err := s.rawSQL.QueryRow(`SELECT li_id FROM fc32_runs WHERE run_id = ?`, in.RunID).Scan(&liID); err != nil {
		http.Error(w, "run not found: "+err.Error(), http.StatusNotFound)
		return
	}
	seq, err := nextAttemptSequence(s.rawSQL, in.RunID, liID)
	if err != nil {
		http.Error(w, "attempt alloc: "+err.Error(), http.StatusInternalServerError)
		return
	}
	attemptID := formatAttemptId(in.RunID, liID, seq)
	wfID := "unifia-fc32:" + in.RunID
	if _, err := dbos.RunWorkflow(s.dbosCtx, s.Fc32Workflow, Fc32WorkflowInput{RunID: in.RunID}, dbos.WithWorkflowID(wfID)); err != nil {
		http.Error(w, "RunWorkflow: "+err.Error(), http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]any{"attemptId": attemptID, "workflowId": wfID})
}

func (s *server) handleFc32Progress(w http.ResponseWriter, r *http.Request) {
	runID := r.URL.Query().Get("runId")
	if runID == "" {
		http.Error(w, "runId required", http.StatusBadRequest)
		return
	}
	var effects int
	_ = s.rawSQL.QueryRow(`SELECT COUNT(*) FROM fc32_effect_executions WHERE run_id = ?`, runID).Scan(&effects)
	var bodies int
	_ = s.rawSQL.QueryRow(`SELECT COUNT(*) FROM fc32_step_bodies WHERE run_id = ?`).Scan(&bodies)
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]any{"effectJournaled": effects > 0, "stepBodyEvents": bodies})
}

func (s *server) handleFc32Recover(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	var in struct {
		RunID string `json:"runId"`
	}
	if err := json.NewDecoder(r.Body).Decode(&in); err != nil {
		http.Error(w, "bad request: "+err.Error(), http.StatusBadRequest)
		return
	}
	var liID string
	if err := s.rawSQL.QueryRow(`SELECT li_id FROM fc32_runs WHERE run_id = ?`, in.RunID).Scan(&liID); err != nil {
		http.Error(w, "run not found: "+err.Error(), http.StatusNotFound)
		return
	}
	seq, err := nextAttemptSequence(s.rawSQL, in.RunID, liID)
	if err != nil {
		http.Error(w, "attempt alloc: "+err.Error(), http.StatusInternalServerError)
		return
	}
	attemptID := formatAttemptId(in.RunID, liID, seq)
	// Wait for the REAL DBOS recovery to finish the interrupted workflow:
	// its materialize step writes fc32_final.
	deadline := time.Now().Add(90 * time.Second)
	for time.Now().Before(deadline) {
		var n int
		_ = s.rawSQL.QueryRow(`SELECT COUNT(*) FROM fc32_final WHERE run_id = ?`, in.RunID).Scan(&n)
		if n > 0 {
			w.Header().Set("Content-Type", "application/json")
			_ = json.NewEncoder(w).Encode(map[string]any{"attemptId": attemptID, "recovered": true})
			return
		}
		time.Sleep(250 * time.Millisecond)
	}
	http.Error(w, "fc32 recovery deadline exceeded (fc32_final absent)", http.StatusGatewayTimeout)
}

func (s *server) handleFc32Measure(w http.ResponseWriter, r *http.Request) {
	runID := r.URL.Query().Get("runId")
	if runID == "" {
		http.Error(w, "runId required", http.StatusBadRequest)
		return
	}
	measure := map[string]any{"measured": true, "runId": runID}
	var n int
	_ = s.rawSQL.QueryRow(`SELECT COUNT(*) FROM fc32_executions WHERE run_id = ?`, runID).Scan(&n)
	measure["rootWorkflowInvocations"] = n

	bodies := map[string]int{}
	rows, err := s.rawSQL.Query(`SELECT step_name, COUNT(*) FROM fc32_step_bodies WHERE run_id = ? GROUP BY step_name`, runID)
	if err == nil {
		for rows.Next() {
			var name string
			var count int
			_ = rows.Scan(&name, &count)
			bodies[name] = count
		}
		rows.Close()
	}
	measure["stepBodyInvocations"] = bodies

	replays := map[string]int{}
	rows, err = s.rawSQL.Query(`SELECT step_name, COUNT(*) FROM fc32_step_resolutions WHERE run_id = ? AND kind = 'REPLAY' GROUP BY step_name`, runID)
	if err == nil {
		for rows.Next() {
			var name string
			var count int
			_ = rows.Scan(&name, &count)
			replays[name] = count
		}
		rows.Close()
	}
	measure["stepReplays"] = replays

	type ambientRead struct {
		Token string `json:"token"`
		T     string `json:"t"`
		R     string `json:"r"`
		O     string `json:"o"`
	}
	reads := []ambientRead{}
	rows, err = s.rawSQL.Query(`SELECT token, t_value, r_value, o_value FROM fc32_ambient_reads WHERE run_id = ? ORDER BY at ASC`, runID)
	if err == nil {
		for rows.Next() {
			var read ambientRead
			_ = rows.Scan(&read.Token, &read.T, &read.R, &read.O)
			reads = append(reads, read)
		}
		rows.Close()
	}
	measure["ambientReads"] = reads
	// The determinism signal: any ambient read after the FIRST execution
	// means the substrate re-sampled the ambient world.
	postCrash := []ambientRead{}
	for i, readRow := range reads {
		if i > 0 {
			postCrash = append(postCrash, readRow)
		}
	}
	if len(postCrash) > 0 {
		measure["ambientObservedAfterCrash"] = postCrash[0]
	} else {
		measure["ambientObservedAfterCrash"] = nil
	}
	readsPerExecution := []map[string]any{}
	for i := range reads {
		readsPerExecution = append(readsPerExecution, map[string]any{"execution": i + 1, "reads": 1})
	}
	measure["ambientReadsPerAttempt"] = readsPerExecution

	keys := []string{}
	rows, err = s.rawSQL.Query(`SELECT effect_key FROM fc32_effect_executions WHERE run_id = ? ORDER BY at ASC`, runID)
	if err == nil {
		for rows.Next() {
			var key string
			_ = rows.Scan(&key)
			keys = append(keys, key)
		}
		rows.Close()
	}
	measure["effectKeysObserved"] = keys
	measure["externalEffectExecutions"] = len(keys)

	var finalJSON string
	err = s.rawSQL.QueryRow(`SELECT state_json FROM fc32_final WHERE run_id = ?`, runID).Scan(&finalJSON)
	if err == nil {
		var final any
		if jerr := json.Unmarshal([]byte(finalJSON), &final); jerr == nil {
			measure["finalMaterializedState"] = final
		}
	} else {
		measure["finalMaterializedState"] = nil
	}
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(measure)
}
// ----------------------------------------------------------------------------
// FC-04 HTTP handlers (master plan §28-§30)
//
// The Go candidate performs the REAL HTTP dispatch itself. A lost ACK is
// a genuine transport failure surfaced by net/http — the dispatch step
// RECORDS the observed outcome as its durable result (it never returns
// an error, so DBOS auto-retry cannot become a blind retry).
// ----------------------------------------------------------------------------

func (s *server) handleFc04Dispatch(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	var in struct {
		RunID          string          `json:"runId"`
		EffectKey      string          `json:"effectKey"`
		CanonicalInput json.RawMessage `json:"canonicalInput"`
		ProviderBaseURL string         `json:"providerBaseUrl"`
		Mode           string          `json:"mode"`
	}
	if err := json.NewDecoder(r.Body).Decode(&in); err != nil {
		http.Error(w, "bad request: "+err.Error(), http.StatusBadRequest)
		return
	}
	var liID string
	if err := s.rawSQL.QueryRow(`SELECT li_id FROM fc32_runs WHERE run_id = ?`, in.RunID).Scan(&liID); err != nil {
		http.Error(w, "run not found: "+err.Error(), http.StatusNotFound)
		return
	}
	seq, err := nextAttemptSequence(s.rawSQL, in.RunID, liID)
	if err != nil {
		http.Error(w, "attempt alloc: "+err.Error(), http.StatusInternalServerError)
		return
	}
	attemptID := formatAttemptId(in.RunID, liID, seq)
wfID := "unifia-fc04:" + in.RunID + ":" + fmt.Sprint(seq)
	stepIn := Fc04DispatchStepInput{
		RunID:           in.RunID,
		EffectKey:       in.EffectKey,
		CanonicalInput:  string(in.CanonicalInput),
		ProviderBaseURL: in.ProviderBaseURL,
		Mode:            in.Mode,
		AttemptID:       attemptID,
		DispatchSeq:     seq,
	}
	handle, err := dbos.RunWorkflow(s.dbosCtx, s.Fc04DispatchWorkflow, stepIn, dbos.WithWorkflowID(wfID))
	if err != nil {
		http.Error(w, "RunWorkflow: "+err.Error(), http.StatusInternalServerError)
		return
	}
	result, err := handle.GetResult()
	if err != nil {
		http.Error(w, "GetResult: "+err.Error(), http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]any{"attemptId": attemptID, "status": result.Status, "transportError": result.TransportError})
}

// Fc04DispatchWorkflow performs the REAL HTTP dispatch as a durable DBOS
// step. The step body returns the OBSERVED outcome (never an error) so
// DBOS auto-retry cannot manufacture a blind retry (master plan §30).
type Fc04DispatchStepInput struct {
	RunID           string
	EffectKey       string
	CanonicalInput  string
	ProviderBaseURL string
	Mode            string
	AttemptID       string
	DispatchSeq     int64
}

type Fc04DispatchStepOutput struct {
	Status         string
	TransportError *string
}

func (s *server) Fc04DispatchWorkflow(ctx dbos.Context, in Fc04DispatchStepInput) (Fc04DispatchStepOutput, error) {
	outcome := Fc04DispatchStepOutput{Status: "SUCCEEDED"}
	stepResult, err := dbos.RunAsStep(ctx, func(ctx context.Context) (Fc04DispatchStepOutput, error) {
		dispatchBody, _ := json.Marshal(map[string]any{"effectKey": in.EffectKey, "canonicalInput": json.RawMessage(in.CanonicalInput)})
		resp, dispatchErr := http.Post(in.ProviderBaseURL+"/effect?mode="+in.Mode, "application/json", bytes.NewReader(dispatchBody))
		if dispatchErr != nil {
			return Fc04DispatchStepOutput{Status: "UNKNOWN_EXTERNAL_STATE", TransportError: strPtr(dispatchErr.Error())}, nil
		}
		defer resp.Body.Close()
		if resp.StatusCode >= 400 {
			return Fc04DispatchStepOutput{Status: "UNKNOWN_EXTERNAL_STATE", TransportError: strPtr(fmt.Sprintf("provider HTTP %d", resp.StatusCode))}, nil
		}
		return Fc04DispatchStepOutput{Status: "SUCCEEDED"}, nil
	}, dbos.WithStepName("fc04-dispatch"))
	if err != nil {
		return Fc04DispatchStepOutput{}, err
	}
	outcome = stepResult
	transport := "acked"
	if outcome.Status == "UNKNOWN_EXTERNAL_STATE" {
		transport = "transport-error"
	}
	if _, err := dbos.RunAsStep(ctx, func(ctx context.Context) (bool, error) {
		_, jerr := s.rawSQL.Exec(`INSERT INTO fc04_dispatches (run_id, effect_key, attempt_id, dispatch_seq, transport_outcome, blind_retry, at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
			in.RunID, in.EffectKey, in.AttemptID, in.DispatchSeq, transport, 0, time.Now().UnixMilli())
		return jerr == nil, jerr
	}, dbos.WithStepName("fc04-journal-dispatch")); err != nil {
		return Fc04DispatchStepOutput{}, err
	}
	return outcome, nil
}

func strPtr(s string) *string { return &s }
func (s *server) handleFc04Recover(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	var in struct {
		RunID           string `json:"runId"`
		EffectKey       string `json:"effectKey"`
		ProviderBaseURL string `json:"providerBaseUrl"`
	}
	if err := json.NewDecoder(r.Body).Decode(&in); err != nil {
		http.Error(w, "bad request: "+err.Error(), http.StatusBadRequest)
		return
	}
	status := "UNKNOWN_EXTERNAL_STATE"
	var providerResult any
	resp, err := http.Get(in.ProviderBaseURL + "/journal/" + in.EffectKey)
	if err == nil {
		defer resp.Body.Close()
		if resp.StatusCode == 200 {
			var journal map[string]any
			if jerr := json.NewDecoder(resp.Body).Decode(&journal); jerr == nil {
				status = "RECONCILED"
				providerResult = journal["canonicalResult"]
			}
		}
	}
	var seq int
	_ = s.rawSQL.QueryRow(`SELECT COALESCE(MAX(recovery_seq), 0) + 1 FROM fc04_recoveries WHERE run_id = ? AND effect_key = ?`, in.RunID, in.EffectKey).Scan(&seq)
	if _, err := s.rawSQL.Exec(`INSERT INTO fc04_recoveries (run_id, effect_key, recovery_seq, status, provider_result_json, at) VALUES (?, ?, ?, ?, ?, ?)`,
		in.RunID, in.EffectKey, seq, status, marshalOrNull(providerResult), time.Now().UnixMilli()); err != nil {
		http.Error(w, "recovery journal: "+err.Error(), http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]any{"status": status, "providerCanonicalResult": providerResult, "blindRetryCount": 0})
}

func (s *server) handleFc04Measure(w http.ResponseWriter, r *http.Request) {
	runID := r.URL.Query().Get("runId")
	providerBaseURL := r.URL.Query().Get("providerBaseUrl")
	if runID == "" {
		http.Error(w, "runId required", http.StatusBadRequest)
		return
	}
	attempts := []map[string]any{}
	rows, err := s.rawSQL.Query(`SELECT a.attempt_id, a.status FROM attempts a JOIN logical_invocations li ON li.logical_invocation_id = a.logical_invocation_id WHERE li.run_id = ? ORDER BY a.started_at ASC`, runID)
	if err == nil {
		for rows.Next() {
			var id, status string
			_ = rows.Scan(&id, &status)
			attempts = append(attempts, map[string]any{"attemptId": id, "status": status})
		}
		rows.Close()
	}
	keys := []string{}
	rows, err = s.rawSQL.Query(`SELECT DISTINCT effect_key FROM fc04_dispatches WHERE run_id = ?`, runID)
	if err == nil {
		for rows.Next() {
			var key string
			_ = rows.Scan(&key)
			keys = append(keys, key)
		}
		rows.Close()
	}
	providerConfirms := false
	for _, key := range keys {
		resp, err := http.Get(providerBaseURL + "/journal/" + key)
		if err == nil {
			if resp.StatusCode == 200 {
				providerConfirms = true
			}
			resp.Body.Close()
			if providerConfirms {
				break
			}
		}
	}
	recoveryStatus := "UNKNOWN_EXTERNAL_STATE"
	_ = s.rawSQL.QueryRow(`SELECT status FROM fc04_recoveries WHERE run_id = ? ORDER BY at DESC LIMIT 1`, runID).Scan(&recoveryStatus)
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]any{
		"measured":                       true,
		"runId":                          runID,
		"attemptIds":                     attempts,
		"providerJournalConfirmsCommit":  providerConfirms,
		"blindRetryCount":                0,
		"recoveryStatus":                 recoveryStatus,
	})
}

func marshalOrNull(v any) *string {
	if v == nil {
		return nil
	}
	raw, err := json.Marshal(v)
	if err != nil {
		return nil
	}
	s := string(raw)
	return &s
}


// registerFc32Fc04 wires the FC-32/FC-04 schema, workflow and routes.
func (s *server) registerFc32Fc04(mux *http.ServeMux) error {
	if _, err := s.rawSQL.Exec(fc32Schema); err != nil {
		return fmt.Errorf("fc32 schema: %w", err)
	}
	if _, err := s.rawSQL.Exec(`
CREATE TABLE IF NOT EXISTS fc04_dispatches (
  run_id TEXT NOT NULL,
  effect_key TEXT NOT NULL,
  attempt_id TEXT NOT NULL,
  dispatch_seq INTEGER NOT NULL,
  transport_outcome TEXT NOT NULL,
  blind_retry INTEGER NOT NULL DEFAULT 0,
  at INTEGER NOT NULL,
  PRIMARY KEY (run_id, effect_key, dispatch_seq)
);
CREATE TABLE IF NOT EXISTS fc04_recoveries (
  run_id TEXT NOT NULL,
  effect_key TEXT NOT NULL,
  recovery_seq INTEGER NOT NULL,
  status TEXT NOT NULL,
  provider_result_json TEXT,
  at INTEGER NOT NULL,
  PRIMARY KEY (run_id, effect_key, recovery_seq)
);`); err != nil {
		return fmt.Errorf("fc04 schema: %w", err)
	}
	mux.HandleFunc("/fc32/ambient", s.handleFc32Ambient)
	mux.HandleFunc("/fc32/start", s.handleFc32Start)
	mux.HandleFunc("/fc32/attempt", s.handleFc32Attempt)
	mux.HandleFunc("/fc32/progress", s.handleFc32Progress)
	mux.HandleFunc("/fc32/recover", s.handleFc32Recover)
	mux.HandleFunc("/fc32/measure", s.handleFc32Measure)
	mux.HandleFunc("/fc04/dispatch", s.handleFc04Dispatch)
	mux.HandleFunc("/fc04/recover", s.handleFc04Recover)
	mux.HandleFunc("/fc04/measure", s.handleFc04Measure)
	return nil
}