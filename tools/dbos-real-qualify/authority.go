package main

// Authority fencing surface (Unifia-owned, master plan §31-§33).
//
// DBOS = workflow durability; Unifia = WorkflowRun authority/fencing.
// These endpoints implement the substrate-neutral authority contract on
// the DBOS SQLite system DB: atomic claim, token-checked mutation and
// effect dispatch, generation-CAS takeover, and the FC-25 freeze
// barrier (a real OS process that blocks mid-request without
// releasing its token).
//
// M0_AUTHORITY_ONLY=1 skips the DBOS runtime and serves ONLY the
// authority endpoints: the second race participant is a real OS
// process of the same binary exercising the same SQLite authority
// tables (the fencing layer is substrate-independent).

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"sync"
	"time"
)

const authoritySchema = `
CREATE TABLE IF NOT EXISTS run_authority (
  run_id TEXT PRIMARY KEY,
  generation INTEGER NOT NULL,
  authority_owner_id TEXT NOT NULL,
  holder_pid INTEGER NOT NULL,
  acquired_at_epoch_ms INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS run_state_mutations (
  run_id TEXT NOT NULL,
  mutation TEXT NOT NULL,
  generation INTEGER NOT NULL,
  authority_owner_id TEXT NOT NULL,
  mutated_at_epoch_ms INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS effect_dispatch_auth (
  run_id TEXT NOT NULL,
  effect_key TEXT NOT NULL,
  generation INTEGER NOT NULL,
  authority_owner_id TEXT NOT NULL,
  authorized_at_epoch_ms INTEGER NOT NULL
);
`

// Freeze barrier state (per worker process, in-memory).
var (
	freezeMu    sync.Mutex
	freezeState = map[string]*freezeBarrier{}
)

type freezeBarrier struct {
	frozen   bool
	resumeCh chan struct{}
	pid      int
	// retainedToken is the (generation, owner) this process claimed.
	// After a takeover by another owner the retained token is STALE —
	// the zombie's post-resume mutations must be rejected with it.
	retainedGeneration int64
	retainedOwner      string
}

func (s *server) authorityOwnerID(requested string) string {
	if requested != "" {
		return requested
	}
	return os.Getenv("M0_AUTHORITY_OWNER_ID")
}

func (s *server) handleAuthorityClaim(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	var in struct {
		AuthorityOwnerID    string `json:"authorityOwnerId,omitempty"`
		AttemptedGeneration int64  `json:"attemptedGeneration"`
	}
	if err := json.NewDecoder(r.Body).Decode(&in); err != nil {
		http.Error(w, "bad request: "+err.Error(), http.StatusBadRequest)
		return
	}
	owner := s.authorityOwnerID(in.AuthorityOwnerID)
	runID := r.URL.Query().Get("runId")
	if runID == "" || owner == "" {
		http.Error(w, "runId and owner required", http.StatusBadRequest)
		return
	}
	tx, err := s.rawSQL.Begin()
	if err != nil {
		http.Error(w, "begin: "+err.Error(), http.StatusInternalServerError)
		return
	}
	defer tx.Rollback()
	var generation int64
	var currentOwner string
	var holderPID int64
	row := tx.QueryRow(`SELECT generation, authority_owner_id, holder_pid FROM run_authority WHERE run_id = ?`, runID)
	scanErr := row.Scan(&generation, &currentOwner, &holderPID)
	switch {
	case scanErr == sql.ErrNoRows:
		if _, ierr := tx.Exec(`INSERT INTO run_authority (run_id, generation, authority_owner_id, holder_pid, acquired_at_epoch_ms) VALUES (?, 1, ?, ?, ?)`, runID, owner, os.Getpid(), time.Now().UnixMilli()); ierr != nil {
			http.Error(w, "insert: "+ierr.Error(), http.StatusInternalServerError)
			return
		}
		generation, currentOwner, holderPID = 1, owner, int64(os.Getpid())
	case scanErr != nil:
		http.Error(w, "select: "+scanErr.Error(), http.StatusInternalServerError)
		return
	case currentOwner != owner:
		if cerr := tx.Commit(); cerr != nil {
			http.Error(w, "commit: "+cerr.Error(), http.StatusInternalServerError)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]any{"granted": false, "currentGeneration": generation, "authorityOwnerId": currentOwner, "holderPid": holderPID})
		return
	}
	if err := tx.Commit(); err != nil {
		http.Error(w, "commit: "+err.Error(), http.StatusInternalServerError)
		return
	}
	freezeMu.Lock()
	barrier, ok := freezeState[runID]
	if !ok {
		barrier = &freezeBarrier{pid: os.Getpid()}
		freezeState[runID] = barrier
	}
	barrier.retainedGeneration = generation
	barrier.retainedOwner = currentOwner
	freezeMu.Unlock()
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]any{"granted": true, "currentGeneration": generation, "authorityOwnerId": currentOwner, "holderPid": holderPID})
}

// authorityTokenCheckTx validates the (generation, owner) token inside an
// open IMMEDIATE transaction. Returns the HTTP error code (0 = ok).
func authorityTokenCheckTx(tx *sql.Tx, runID string, attemptedGeneration int64, owner string) (code int, generation int64, currentOwner string) {
	err := tx.QueryRow(`SELECT generation, authority_owner_id FROM run_authority WHERE run_id = ?`, runID).Scan(&generation, &currentOwner)
	if err == sql.ErrNoRows {
		return http.StatusNotFound, 0, ""
	}
	if err != nil {
		return http.StatusInternalServerError, 0, ""
	}
	if generation != attemptedGeneration || currentOwner != owner {
		return http.StatusConflict, generation, currentOwner
	}
	return 0, generation, currentOwner
}

func writeAuthorityRejection(w http.ResponseWriter, code int, generation int64, currentOwner string) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(code)
	payload := map[string]any{"accepted": false}
	if code == http.StatusConflict {
		payload["reason"] = "STALE_AUTHORITY"
		payload["currentGeneration"] = generation
		payload["currentAuthorityOwnerId"] = currentOwner
	} else if code == http.StatusNotFound {
		payload["reason"] = "UNKNOWN_RUN"
	}
	_ = json.NewEncoder(w).Encode(payload)
}

func (s *server) handleAuthorityMutate(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	var in struct {
		Token struct {
			AttemptedGeneration int64  `json:"attemptedGeneration"`
			AuthorityOwnerID    string `json:"authorityOwnerId"`
		} `json:"token"`
		Mutation string `json:"mutation"`
	}
	if err := json.NewDecoder(r.Body).Decode(&in); err != nil {
		http.Error(w, "bad request: "+err.Error(), http.StatusBadRequest)
		return
	}
	runID := r.URL.Query().Get("runId")
	tx, err := s.rawSQL.Begin()
	if err != nil {
		http.Error(w, "begin: "+err.Error(), http.StatusInternalServerError)
		return
	}
	defer tx.Rollback()
	code, generation, currentOwner := authorityTokenCheckTx(tx, runID, in.Token.AttemptedGeneration, in.Token.AuthorityOwnerID)
	if code != 0 {
		writeAuthorityRejection(w, code, generation, currentOwner)
		return
	}
	if _, err := tx.Exec(`INSERT INTO run_state_mutations (run_id, mutation, generation, authority_owner_id, mutated_at_epoch_ms) VALUES (?, ?, ?, ?, ?)`, runID, in.Mutation, generation, currentOwner, time.Now().UnixMilli()); err != nil {
		http.Error(w, "insert: "+err.Error(), http.StatusInternalServerError)
		return
	}
	if err := tx.Commit(); err != nil {
		http.Error(w, "commit: "+err.Error(), http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]any{"accepted": true, "generation": generation, "authorityOwnerId": currentOwner})
}

func (s *server) handleAuthorityDispatch(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	var in struct {
		Token struct {
			AttemptedGeneration int64  `json:"attemptedGeneration"`
			AuthorityOwnerID    string `json:"authorityOwnerId"`
		} `json:"token"`
		EffectKey string `json:"effectKey"`
	}
	if err := json.NewDecoder(r.Body).Decode(&in); err != nil {
		http.Error(w, "bad request: "+err.Error(), http.StatusBadRequest)
		return
	}
	runID := r.URL.Query().Get("runId")
	tx, err := s.rawSQL.Begin()
	if err != nil {
		http.Error(w, "begin: "+err.Error(), http.StatusInternalServerError)
		return
	}
	defer tx.Rollback()
	code, generation, currentOwner := authorityTokenCheckTx(tx, runID, in.Token.AttemptedGeneration, in.Token.AuthorityOwnerID)
	if code != 0 {
		writeAuthorityRejection(w, code, generation, currentOwner)
		return
	}
	if _, err := tx.Exec(`INSERT INTO effect_dispatch_auth (run_id, effect_key, generation, authority_owner_id, authorized_at_epoch_ms) VALUES (?, ?, ?, ?, ?)`, runID, in.EffectKey, generation, currentOwner, time.Now().UnixMilli()); err != nil {
		http.Error(w, "insert: "+err.Error(), http.StatusInternalServerError)
		return
	}
	if err := tx.Commit(); err != nil {
		http.Error(w, "commit: "+err.Error(), http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]any{"accepted": true, "effectKey": in.EffectKey, "generation": generation, "authorityOwnerId": currentOwner})
}

func (s *server) handleAuthorityTakeover(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	var in struct {
		NewAuthorityOwnerID string `json:"newAuthorityOwnerId"`
	}
	if err := json.NewDecoder(r.Body).Decode(&in); err != nil {
		http.Error(w, "bad request: "+err.Error(), http.StatusBadRequest)
		return
	}
	runID := r.URL.Query().Get("runId")
	tx, err := s.rawSQL.Begin()
	if err != nil {
		http.Error(w, "begin: "+err.Error(), http.StatusInternalServerError)
		return
	}
	defer tx.Rollback()
	var generation int64
	var currentOwner string
	if err := tx.QueryRow(`SELECT generation, authority_owner_id FROM run_authority WHERE run_id = ?`, runID).Scan(&generation, &currentOwner); err != nil {
		writeAuthorityRejection(w, http.StatusNotFound, 0, "")
		return
	}
	newGen := generation + 1
	if _, err := tx.Exec(`UPDATE run_authority SET generation = ?, authority_owner_id = ?, holder_pid = 0, acquired_at_epoch_ms = ? WHERE run_id = ?`, newGen, in.NewAuthorityOwnerID, time.Now().UnixMilli(), runID); err != nil {
		http.Error(w, "update: "+err.Error(), http.StatusInternalServerError)
		return
	}
	if err := tx.Commit(); err != nil {
		http.Error(w, "commit: "+err.Error(), http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]any{"ok": true, "previousGeneration": generation, "previousOwner": currentOwner, "newGeneration": newGen, "newOwner": in.NewAuthorityOwnerID})
}

func (s *server) handleAuthorityInspect(w http.ResponseWriter, r *http.Request) {
	runID := r.URL.Query().Get("runId")
	var generation int64
	var currentOwner string
	var holderPID int64
	if err := s.rawSQL.QueryRow(`SELECT generation, authority_owner_id, holder_pid FROM run_authority WHERE run_id = ?`, runID).Scan(&generation, &currentOwner, &holderPID); err != nil {
		http.Error(w, "run not found", http.StatusNotFound)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]any{"currentGeneration": generation, "authorityOwnerId": currentOwner, "holderPid": holderPID})
}

// FC-25 freeze barrier: the worker blocks mid-request (alive, holding
// its token) until /resume arrives.
func (s *server) handleAuthorityAwaitResume(w http.ResponseWriter, r *http.Request) {
	runID := r.URL.Query().Get("runId")
	freezeMu.Lock()
	barrier, ok := freezeState[runID]
	if !ok {
		barrier = &freezeBarrier{pid: os.Getpid()}
		freezeState[runID] = barrier
	}
	if barrier.resumeCh == nil {
		barrier.resumeCh = make(chan struct{})
	}
	barrier.frozen = true
	barrier.pid = os.Getpid()
	ch := barrier.resumeCh
	freezeMu.Unlock()
	<-ch
	freezeMu.Lock()
	barrier.frozen = false
	freezeMu.Unlock()
	w.WriteHeader(http.StatusOK)
}

func (s *server) handleAuthorityResume(w http.ResponseWriter, r *http.Request) {
	runID := r.URL.Query().Get("runId")
	freezeMu.Lock()
	if barrier, ok := freezeState[runID]; ok && barrier.resumeCh != nil {
		close(barrier.resumeCh)
		barrier.resumeCh = nil
	}
	freezeMu.Unlock()
	w.WriteHeader(http.StatusOK)
}

func (s *server) handleAuthorityStatus(w http.ResponseWriter, r *http.Request) {
	runID := r.URL.Query().Get("runId")
	freezeMu.Lock()
	barrier, ok := freezeState[runID]
	freezeMu.Unlock()
	if !ok {
		http.Error(w, "no barrier for run", http.StatusNotFound)
		return
	}
	generation := barrier.retainedGeneration
	owner := barrier.retainedOwner
	_ = s.rawSQL.QueryRow(`SELECT generation, authority_owner_id FROM run_authority WHERE run_id = ?`, runID).Scan(&generation, &owner)
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]any{"pid": os.Getpid(), "alive": true, "frozen": barrier.frozen, "generation": generation, "authorityOwnerId": owner})
}

// Stale endpoints use the worker's RETAINED token (post-takeover these
// must be REJECTED — the zombie resumed with a stale generation).
func (s *server) handleAuthorityStaleMutate(w http.ResponseWriter, r *http.Request) {
	runID := r.URL.Query().Get("runId")
	freezeMu.Lock()
	barrier, ok := freezeState[runID]
	freezeMu.Unlock()
	if !ok {
		http.Error(w, "no retained token for run", http.StatusNotFound)
		return
	}
	var in struct {
		Mutation string `json:"mutation"`
	}
	_ = json.NewDecoder(r.Body).Decode(&in)
	tx, err := s.rawSQL.Begin()
	if err != nil {
		http.Error(w, "begin: "+err.Error(), http.StatusInternalServerError)
		return
	}
	defer tx.Rollback()
	code, generation, currentOwner := authorityTokenCheckTx(tx, runID, barrier.retainedGeneration, barrier.retainedOwner)
	if code != 0 {
		writeAuthorityRejection(w, code, generation, currentOwner)
		return
	}
	if _, err := tx.Exec(`INSERT INTO run_state_mutations (run_id, mutation, generation, authority_owner_id, mutated_at_epoch_ms) VALUES (?, ?, ?, ?, ?)`, runID, in.Mutation, generation, currentOwner, time.Now().UnixMilli()); err != nil {
		http.Error(w, "insert: "+err.Error(), http.StatusInternalServerError)
		return
	}
	if err := tx.Commit(); err != nil {
		http.Error(w, "commit: "+err.Error(), http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]any{"accepted": true, "generation": generation, "authorityOwnerId": currentOwner})
}

func (s *server) handleAuthorityStaleDispatch(w http.ResponseWriter, r *http.Request) {
	runID := r.URL.Query().Get("runId")
	freezeMu.Lock()
	barrier, ok := freezeState[runID]
	freezeMu.Unlock()
	if !ok {
		http.Error(w, "no retained token for run", http.StatusNotFound)
		return
	}
	var in struct {
		EffectKey string `json:"effectKey"`
	}
	_ = json.NewDecoder(r.Body).Decode(&in)
	tx, err := s.rawSQL.Begin()
	if err != nil {
		http.Error(w, "begin: "+err.Error(), http.StatusInternalServerError)
		return
	}
	defer tx.Rollback()
	code, generation, currentOwner := authorityTokenCheckTx(tx, runID, barrier.retainedGeneration, barrier.retainedOwner)
	if code != 0 {
		writeAuthorityRejection(w, code, generation, currentOwner)
		return
	}
	if _, err := tx.Exec(`INSERT INTO effect_dispatch_auth (run_id, effect_key, generation, authority_owner_id, authorized_at_epoch_ms) VALUES (?, ?, ?, ?, ?)`, runID, in.EffectKey, generation, currentOwner, time.Now().UnixMilli()); err != nil {
		http.Error(w, "insert: "+err.Error(), http.StatusInternalServerError)
		return
	}
	if err := tx.Commit(); err != nil {
		http.Error(w, "commit: "+err.Error(), http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]any{"accepted": true, "effectKey": in.EffectKey, "generation": generation, "authorityOwnerId": currentOwner})
}

func (s *server) registerAuthority(mux *http.ServeMux) error {
	if _, err := s.rawSQL.Exec(authoritySchema); err != nil {
		return fmt.Errorf("authority schema: %w", err)
	}
	mux.HandleFunc("/authority/claim", s.handleAuthorityClaim)
	mux.HandleFunc("/authority/mutate", s.handleAuthorityMutate)
	mux.HandleFunc("/authority/dispatch", s.handleAuthorityDispatch)
	mux.HandleFunc("/authority/takeover", s.handleAuthorityTakeover)
	mux.HandleFunc("/authority/inspect", s.handleAuthorityInspect)
	mux.HandleFunc("/authority/await-resume", s.handleAuthorityAwaitResume)
	mux.HandleFunc("/authority/resume", s.handleAuthorityResume)
	mux.HandleFunc("/authority/status", s.handleAuthorityStatus)
	mux.HandleFunc("/authority/stale-mutate", s.handleAuthorityStaleMutate)
	mux.HandleFunc("/authority/stale-dispatch", s.handleAuthorityStaleDispatch)
	return nil
}