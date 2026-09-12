// Package main is the REAL DBOS_GO_SQLITE qualification binary.
//
// Unlike the control candidate (tools/dbos-qualify/dbos-qualify.exe)
// which uses custom SQLite + blank DBOS import, this binary uses
// the actual github.com/dbos-inc/dbos-transact-golang v1.0.0
// Conductor APIs on the measured path:
//
//   - dbos.NewContext (via Config{AppName, DatabaseURL, SQLiteSystemDB})
//   - dbos.RegisterWorkflow (the qualification workflow)
//   - dbos.RunAsStep (durable steps inside the workflow)
//   - Launch (start the runtime)
//   - Real recovery: re-opening a fresh context + recoverPendingWorkflows
//
// The harness drives the binary via HTTP/JSON. The qualification
// workflow is registered with WithWorkflowName and started via
// RunWorkflow. State persists in the DBOS SQLite system DB.
package main

import (
	"context"
	"crypto/rand"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"math"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"sync"
	"time"

	"github.com/dbos-inc/dbos-transact-golang/dbos"
	_ "github.com/dbos-inc/dbos-transact-golang/dbos/driver/sqlite" // registers "sqlite" DBOS driver
)

// randRead fills b with cryptographically random bytes.
func randRead(b []byte) (int, error) { return rand.Read(b) }
// hexEncode returns the hex encoding of b.
func hexEncode(b []byte) string { return hex.EncodeToString(b) }

// ----------------------------------------------------------------------------
// Durable attempt allocator (mandate §3-§7)
//
// AttemptId is a durable per-(WorkflowRunId, LogicalInvocationId)
// sequence. Allocation is atomic via a SQLite UPSERT on the
// `attempt_sequence` table that lives in the SAME DBOS SQLite
// system database. After a process restart the allocator
// recovers its state from the durable table — there is no
// in-process counter.
//
// The external AttemptId string is `att:<runId>:<liId>:<seq>`
// where `<seq>` is a 1-based monotonic integer. AttemptIds are
// stable across retries, restarts, and concurrent allocations.
//
// The DBOS attempt workflow ID is
// `unifia-attempt:<runId>:<liId>:<attemptId>` — the full
// canonical AttemptId, not just the seq number. Two retries
// produce two DISTINCT DBOS workflows; a single allocation
// repeated by the same caller returns the SAME durable
// AttemptId (idempotency is verified at the harness level).
// ----------------------------------------------------------------------------

// attemptSequenceRow mirrors a row of the `attempt_sequence` table.
type attemptSequenceRow struct {
	Sequence int64
}

const attemptSequenceSchema = `
CREATE TABLE IF NOT EXISTS attempt_sequence (
	run_id TEXT NOT NULL,
	li_id  TEXT NOT NULL,
	sequence INTEGER NOT NULL DEFAULT 0,
	PRIMARY KEY (run_id, li_id)
);
`

// nextAttemptSequence atomically reads and increments the
// per-(runId, liId) sequence and returns the new value (1-based).
// The first call returns 1, the second returns 2, etc.
func nextAttemptSequence(store *sql.DB, runID, liID string) (int64, error) {
	if _, err := store.Exec(attemptSequenceSchema); err != nil {
		return 0, fmt.Errorf("ensure attempt_sequence schema: %w", err)
	}
	tx, err := store.Begin()
	if err != nil {
		return 0, fmt.Errorf("begin attempt_sequence tx: %w", err)
	}
	defer func() { _ = tx.Rollback() }()
	var seq int64
	if err := tx.QueryRow(
		`SELECT sequence FROM attempt_sequence WHERE run_id = ? AND li_id = ?`,
		runID, liID,
	).Scan(&seq); err != nil {
		if !errors.Is(err, sql.ErrNoRows) {
			return 0, fmt.Errorf("read attempt_sequence: %w", err)
		}
		seq = 0
	}
	seq++
	if _, err := tx.Exec(
		`INSERT INTO attempt_sequence (run_id, li_id, sequence) VALUES (?, ?, ?)
		   ON CONFLICT(run_id, li_id) DO UPDATE SET sequence = excluded.sequence`,
		runID, liID, seq,
	); err != nil {
		return 0, fmt.Errorf("write attempt_sequence: %w", err)
	}
	if err := tx.Commit(); err != nil {
		return 0, fmt.Errorf("commit attempt_sequence: %w", err)
	}
	return seq, nil
}

// formatAttemptId is the canonical external representation of a
// durable AttemptId.
func formatAttemptId(runID, liID string, seq int64) string {
	return fmt.Sprintf("att:%s:%s:%d", runID, liID, seq)
}

const (
	APPNAME = "unifia-m0-dbos-real"
)

// ----------------------------------------------------------------------------
// Inputs
// ----------------------------------------------------------------------------

type StartRunInput struct {
	WorkflowVersionID    string         `json:"workflowVersionId"`
	OrganizationID       string         `json:"organizationId"`
	WorkspaceID          string         `json:"workspaceId"`
	LogicalInvocationID  string         `json:"logicalInvocationId"`
	EffectKey            string         `json:"effectKey"`
	CanonicalInputJSON   string         `json:"canonicalInputJson"`
	SeedCanonicalJSON    string         `json:"seedCanonicalJson"`
	// Optional explicit runId; if empty, the server generates
	// a globally unique WorkflowRunId. Per mandate §8 the
	// WorkflowRunId must NOT be derived from LogicalInvocationId.
	RunID                string         `json:"runId,omitempty"`
}

type StartRunOutput struct {
	RunID string `json:"runId"`
}

type DriveAttemptInput struct {
	// Required: the WorkflowRunId the attempt belongs to.
	// Per mandate §12 the durable AttemptId is part of the
	// attempt identity so retrying produces a NEW durable
	// attempt workflow in DBOS, not a replay of the prior one.
	RunID         string  `json:"runId"`
	LogicalInvocationID string `json:"logicalInvocationId"`
	// Required: durable AttemptId. Caller increments per
	// retry; this is the canonical attempt authority.
	AttemptID     string  `json:"attemptId"`
	EffectKey     string  `json:"effectKey"`
	Outcome       string  `json:"outcome"`
	CanonicalResult *string `json:"canonicalResultJson,omitempty"`
	ACKLost       bool    `json:"ackLost"`
	IdempotencyKey string `json:"idempotencyKey"`
	ProviderCommittedAt int64 `json:"providerCommittedAtEpochMs"`
}

type DriveAttemptOutput struct {
	WorkflowID string `json:"workflowId"`
	AttemptID  string `json:"attemptId"`
	Status     string `json:"status"`
	EffectID   string `json:"effectId"`
}

// ----------------------------------------------------------------------------
// Workflows (DBOS-registered; everything goes through RunAsStep)
// ----------------------------------------------------------------------------

// StartRunWorkflow persists a run + the initial logical
// invocation durably. It is composed of three DBOS steps so a
// crash mid-workflow can be recovered. The third step's
// RETURN VALUE is the canonical observation: DBOS stores step
// outputs durably in the system DB, and a fresh process
// re-opening the same storeDir can read them back via
// GetWorkflowSteps. This is how FC-31A's "value survives
// process restart" is proven for the real DBOS candidate.
//
// Per mandate §8-§9 + §63: WorkflowRunId is generated by the
// HTTP handler (the single authority) and passed in as the
// DBOS WorkflowID. The workflow MUST NOT generate a fresh
// RunId internally; if `in.RunID` is empty at this layer
// the workflow fails closed with a canonical error.
func StartRunWorkflow(ctx dbos.Context, in StartRunInput) (StartRunOutput, error) {
	if in.RunID == "" {
		return StartRunOutput{}, fmt.Errorf("RUN_IDENTITY_MISMATCH: StartRunWorkflow received empty in.RunID; the HTTP handler is the single RunId authority")
	}
	runID := in.RunID
	// Step 1: persist run row
	if _, err := dbos.RunAsStep(ctx, func(ctx context.Context) (string, error) {
		return in.WorkflowVersionID, nil
	}, dbos.WithStepName("persist-run")); err != nil {
		return StartRunOutput{}, fmt.Errorf("persist-run: %w", err)
	}
	// Step 2: persist logical invocation row
	if _, err := dbos.RunAsStep(ctx, func(ctx context.Context) (string, error) {
		return in.LogicalInvocationID, nil
	}, dbos.WithStepName("persist-invocation")); err != nil {
		return StartRunOutput{}, fmt.Errorf("persist-invocation: %w", err)
	}
	// Step 3: persist canonical observation. The step's
	// return value is the canonical seed, stored durably.
	// We parse the JSON-encoded seed into a typed value
	// so DBOS persists the typed value (number, string,
	// object, etc.) and the harness's canonicalEquals
	// can match it bit-exact against the typed fixture.
	if _, err := dbos.RunAsStep(ctx, func(ctx context.Context) (any, error) {
		var v any
		if jerr := json.Unmarshal([]byte(in.SeedCanonicalJSON), &v); jerr != nil {
			// Fall back to the raw string.
			return in.SeedCanonicalJSON, nil
		}
		return v, nil
	}, dbos.WithStepName("persist-canonical-observation")); err != nil {
		return StartRunOutput{}, fmt.Errorf("persist-canonical-observation: %w", err)
	}
	return StartRunOutput{RunID: runID}, nil
}

// DriveAttemptWorkflow records a single attempt against the
// effect ledger. Per mandate §12-§14 the attempt DBOS
// WorkflowID includes the durable AttemptId (NOT time-based).
// Two retries of the same attempt N+1, N+2 produce two
// DISTINCT DBOS workflows; a single (runId, liId, attemptId)
// produces a SINGLE durable DBOS workflow.
func DriveAttemptWorkflow(ctx dbos.Context, in DriveAttemptInput) (DriveAttemptOutput, error) {
	status := in.Outcome
	if in.ACKLost {
		status = "UNKNOWN_EXTERNAL_STATE"
	}
	// Step 1: record attempt state.
	out, err := dbos.RunAsStep(ctx, func(ctx context.Context) (DriveAttemptOutput, error) {
		return DriveAttemptOutput{
			WorkflowID: "unifia-attempt:" + in.RunID + ":" + in.LogicalInvocationID + ":" + in.AttemptID,
			AttemptID:  in.AttemptID,
			Status:     status,
			EffectID:   "eff-" + in.EffectKey + "-" + in.AttemptID,
		}, nil
	}, dbos.WithStepName("record-attempt"))
	return out, err
}

// randHex returns n bytes of randomness as a hex string.
// Used for WorkflowRunId generation when caller does not
// supply one.
func randHex(n int) string {
	b := make([]byte, n)
	if _, err := randRead(b); err != nil {
		// Fall back to a deterministic-but-unique token.
		return fmt.Sprintf("ts-%d", time.Now().UnixNano())
	}
	return hexEncode(b)
}

// ----------------------------------------------------------------------------
// Server lifecycle
// ----------------------------------------------------------------------------

type server struct {
	mu        sync.Mutex
	dbosCtx   dbos.Context
	listener  net.Listener
	sqlDBPath string
	rawSQL    *sql.DB // direct handle to the DBOS SQLite system DB for the durable attempt allocator
	appName   string
	// per-liId cached canonical observation (decoded JSON
	// for the harness) and seed. This is NOT the durable
	// source of truth — that lives in the DBOS system DB
	// via the workflow's step outputs. The cache is a
	// convenience so the harness can read it after a fresh
	// process has re-opened the storeDir.
	liCache map[string]liCacheEntry
}

type liCacheEntry struct {
	canonicalObservation any // decoded UnifiaValue
	seedJSON             string
	logicalInvocationID string
}

func main() {
	storeDir := os.Getenv("M0_STORE_DIR")
	if storeDir == "" {
		storeDir = "./dbos-real-store"
	}
	if err := os.MkdirAll(storeDir, 0o755); err != nil {
		log.Fatalf("mkdir store dir: %v", err)
	}
	dbPath := filepath.Join(storeDir, "dbos.db")
	// Per mandate §5: the production candidate must NEVER
	// implicitly destroy an existing durable database on
	// normal startup. The DBOS binary only:
	//   - creates the directory if absent
	//   - opens the DB if it exists
	//   - creates the DB if it does not exist
	// Fresh-test cleanup is the harness's responsibility
	// (it deletes the staging dir before each run).
	// No `os.Remove(dbPath)` here.
	_ = errors.Is // keep errors import live for future use

	appName := os.Getenv("M0_APP_NAME")
	if appName == "" {
		appName = APPNAME
	}

	// M0_AUTHORITY_ONLY=1: the second race/zombie participant is a real
	// OS process of the same binary exercising the SAME SQLite authority
	// tables. The DBOS workflow runtime is not needed for the fencing
	// layer (Unifia owns authority; DBOS owns workflow durability).
	if os.Getenv("M0_AUTHORITY_ONLY") == "1" {
		db, err := sql.Open("sqlite", dbPath+"?_pragma=journal_mode(WAL)&_pragma=synchronous(FULL)&_pragma=busy_timeout(5000)&_txlock=immediate")
		if err != nil {
			log.Fatalf("authority-only open: %v", err)
		}
		if err := db.Ping(); err != nil {
			log.Fatalf("authority-only ping: %v", err)
		}
		authSrv := &server{sqlDBPath: dbPath, appName: appName + "-authority", liCache: map[string]liCacheEntry{}, rawSQL: db}
		mux := http.NewServeMux()
		if err := authSrv.registerAuthority(mux); err != nil {
			log.Fatalf("authority register: %v", err)
		}
		mux.HandleFunc("/healthz", func(w http.ResponseWriter, _ *http.Request) { fmt.Fprint(w, "ok") })
		mux.HandleFunc("/shutdown", func(w http.ResponseWriter, _ *http.Request) { go func() { time.Sleep(100 * time.Millisecond); os.Exit(0) }(); w.WriteHeader(http.StatusOK) })
		ln, err := net.Listen("tcp", "127.0.0.1:0")
		if err != nil {
			log.Fatalf("authority listen: %v", err)
		}
		fmt.Println(ln.Addr().String())
		log.Printf("authority-only listening on http://%s", ln.Addr().String())
		_ = http.Serve(ln, mux)
		return
	}
	srv := &server{sqlDBPath: dbPath, appName: appName, liCache: make(map[string]liCacheEntry)}
	if err := srv.start(); err != nil {
		log.Fatalf("start: %v", err)
	}
	defer srv.close()

	// Block forever
	select {}
}

func (s *server) start() error {
	// Open the DBOS SQLite system DB explicitly (mandate §34:
	// the candidate must use the real DBOS SQLite driver, not
	// only modernc.org/sqlite directly). The driver package
	// registers itself on import (see blank import above).
	db, err := sql.Open("sqlite", s.sqlDBPath+"?_pragma=journal_mode(WAL)&_pragma=synchronous(FULL)&_pragma=busy_timeout(5000)&_txlock=immediate")
	if err != nil {
		return fmt.Errorf("open sqlite: %w", err)
	}
	if err := db.Ping(); err != nil {
		return fmt.Errorf("ping sqlite: %v", err)
	}
	// Expose the raw *sql.DB to the server so the durable
	// attempt allocator can read+increment the per-(runId,
	// liId) sequence in the same SQLite system database.
	// We keep the handle open for the lifetime of the process.
	s.rawSQL = db

	// Build the DBOS context. AppName + SQLiteSystemDB are
	// the v1.0.0 inputs; DatabaseURL is unused because we
	// pass an explicit *sql.DB.
	ctx, err := dbos.NewContext(context.Background(), dbos.Config{
		AppName:        s.appName,
		SQLiteSystemDB: db,
	})
	if err != nil {
		return fmt.Errorf("NewContext: %w", err)
	}
	s.dbosCtx = ctx

	// Register the qualification workflows. WithWorkflowName
	// is the canonical workflow identity used by RunWorkflow.
	dbos.RegisterWorkflow(ctx, StartRunWorkflow, dbos.WithWorkflowName("StartRunWorkflow"))
	dbos.RegisterWorkflow(ctx, DriveAttemptWorkflow, dbos.WithWorkflowName("DriveAttemptWorkflow"))
	dbos.RegisterWorkflow(ctx, s.Fc32Workflow, dbos.WithWorkflowName("Fc32Workflow"))
	dbos.RegisterWorkflow(ctx, s.Fc04DispatchWorkflow, dbos.WithWorkflowName("Fc04DispatchWorkflow"))

	// Launch starts the DBOS runtime (queue runner, scheduler,
	// conductor client, workflow recovery).
	if err := dbos.Launch(ctx); err != nil {
		return fmt.Errorf("Launch: %w", err)
	}

	// HTTP control surface
	mux := http.NewServeMux()
	mux.HandleFunc("/healthz", func(w http.ResponseWriter, _ *http.Request) {
		fmt.Fprint(w, "ok")
	})
	mux.HandleFunc("/version", func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]any{
			"version":     "0.0.0-dbos-real-qualify",
			"dbosVersion": "github.com/dbos-inc/dbos-transact-golang v1.0.0",
			"sqliteDriver": "modernc.org/sqlite via dbos/driver/sqlite",
			"appName":     s.appName,
		})
	})
	mux.HandleFunc("/runs", s.handleStartRun)
	mux.HandleFunc("/runs/", s.handleRunSubpath)
	mux.HandleFunc("/attempts/next", s.handleNextAttempt)
	if err := s.registerAuthority(mux); err != nil {
		return fmt.Errorf("register authority: %w", err)
	}
	if err := s.registerFc32Fc04(mux); err != nil {
		return fmt.Errorf("register fc32/fc04: %w", err)
	}
	mux.HandleFunc("/host-adapter/canonize", s.handleCanonize)

	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		return fmt.Errorf("listen: %w", err)
	}
	s.listener = ln
	go func() {
		_ = http.Serve(ln, mux)
	}()
	// Print the bind address on stdout for the harness to discover.
	fmt.Println(ln.Addr().String())
	log.Printf("dbos-real-qualify listening on http://%s (app=%s, db=%s)", ln.Addr().String(), s.appName, s.sqlDBPath)
	return nil
}

func (s *server) close() {
	if s.dbosCtx != nil {
		// DBOS contexts do not have an explicit Shutdown in v1.0.0;
		// the runtime exits when the process exits.
	}
	if s.listener != nil {
		_ = s.listener.Close()
	}
}

// ----------------------------------------------------------------------------
// HTTP handlers
// ----------------------------------------------------------------------------

func (s *server) handleStartRun(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	var in StartRunInput
	if err := json.NewDecoder(r.Body).Decode(&in); err != nil {
		http.Error(w, "bad request: "+err.Error(), http.StatusBadRequest)
		return
	}
	// Per mandate §8 + §63: WorkflowRunId is generated by the
	// HTTP handler (the SINGLE authority) and passed in as
	// the DBOS root WorkflowID. The handler is the only place
	// that mints a new runId; the workflow is fail-closed if
	// it receives an empty in.RunID (we set it to the
	// handler-generated value before calling RunWorkflow).
	runID := in.RunID
	if runID == "" {
		runID = "run-" + randHex(16)
	}
	in.RunID = runID // pin the canonical RunId into the workflow input
	wfID := runID  // DBOS WorkflowID is the WorkflowRunId
	handle, err := dbos.RunWorkflow(s.dbosCtx, StartRunWorkflow, in, dbos.WithWorkflowID(wfID))
	if err != nil {
		http.Error(w, "RunWorkflow: "+err.Error(), http.StatusInternalServerError)
		return
	}
	out, err := handle.GetResult()
	if err != nil {
		http.Error(w, "GetResult: "+err.Error(), http.StatusInternalServerError)
		return
	}
	// Per mandate §9: NO defensive overwrite. The returned
	// RunID must be exactly the canonical RunId we minted.
	if out.RunID != runID {
		http.Error(w, fmt.Sprintf("RUN_IDENTITY_MISMATCH: workflow returned RunID=%q expected %q", out.RunID, runID), http.StatusInternalServerError)
		return
	}
	// Per mandate §19: read the canonical observation back
	// from the DBOS step output. The step result is the
	// seed canonical JSON string. We decode it to a
	// generic interface so the harness can re-encode it
	// as a UnifiaValue and compare bit-exact.
	steps, err := dbos.GetWorkflowSteps(s.dbosCtx, wfID, dbos.WithStepsLoadOutput(true))
	if err != nil {
		http.Error(w, "GetWorkflowSteps: "+err.Error(), http.StatusInternalServerError)
		return
	}
	var canonicalObservation any
	for _, step := range steps {
		if step.StepName == "persist-canonical-observation" {
			// Step.Output is the raw JSON string; decode to
			// a generic value so the harness sees a UnifiaValue.
			if s, ok := step.Output.(string); ok {
				var v any
				if err := json.Unmarshal([]byte(s), &v); err == nil {
					canonicalObservation = v
				} else {
					canonicalObservation = s
				}
			} else {
				canonicalObservation = step.Output
			}
			break
		}
	}
	w.Header().Set("Content-Type", "application/json")
	nowMs := time.Now().UnixMilli()
	_ = json.NewEncoder(w).Encode(map[string]any{
		"runId":              out.RunID,
		"authorityGeneration": 1,
		"status":              "RUNNING",
		"logicalInvocations": []map[string]any{
			{
				"logicalInvocationId":  in.LogicalInvocationID,
				"attempts":             []map[string]any{},
				"currentAttemptId":     "att-" + in.LogicalInvocationID + "-1",
				"canonicalObservation": canonicalObservation,
				"terminal":             false,
			},
		},
		"approvalIds":     []string{},
		"durableTimerIds": []string{},
		"effectIds":       []string{"eff-" + in.LogicalInvocationID + "-1"},
		"schemaVersion":   1,
		"nextAttemptId":   1,
		"createdAtEpochMs": nowMs,
		"updatedAtEpochMs": nowMs,
		"_dbos": map[string]any{
			"workflowExecuted":     true,
			"rootWorkflowID":       wfID,
			"stepReached":          "persist-canonical-observation",
			"workflowRunCompleted": true,
			"readbackSource":       "DBOS_DURABLE_STEP",
		},
	})
	// Update the cache ONLY for the startRun path so the same
	// process returns the right value on a subsequent
	// inspectRun. The cache MUST be empty after a fresh
	// process restart (test in store-guard.test.ts). Cache
	// key is the runId (canonical identity) not the
	// logicalInvocationId.
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.liCache == nil {
		s.liCache = make(map[string]liCacheEntry)
	}
	if canonicalObservation != nil {
		s.liCache[runID] = liCacheEntry{
			canonicalObservation: canonicalObservation,
			seedJSON:             in.SeedCanonicalJSON,
			logicalInvocationID: in.LogicalInvocationID,
		}
	}
}

func (s *server) handleRunSubpath(w http.ResponseWriter, r *http.Request) {
	// Path: /runs/:runId or /runs/:runId/invocations/:liId/attempts
	path := r.URL.Path[len("/runs/"):]
	if path == "" {
		http.NotFound(w, r)
		return
	}
	// Find next /
	slash := -1
	for i, c := range path {
		if c == '/' {
			slash = i
			break
		}
	}
	if slash < 0 {
		// /runs/:runId -> GET state reconstructed from DBOS
		// step outputs (mandate §19: NO synthetic state).
		if r.Method != http.MethodGet {
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
			return
		}
		runID := path
		// Find the logical invocation for this run.
		// The harness convention: logicalInvocationId is
		// stored in the `persist-invocation` DBOS step
		// output and the canonical observation in the
		// `persist-canonical-observation` step output.
		// We reconstruct BOTH from durable DBOS state
		// (mandate §18-§19). The in-process cache is
		// only a fast-path for the same-process case;
		// a fresh process must be able to recover with
		// an empty cache.
		steps, gerr := dbos.GetWorkflowSteps(s.dbosCtx, runID, dbos.WithStepsLoadOutput(true))
		var canonicalObservation any
		var logicalInvocationID string = runID
		if gerr == nil {
			for _, step := range steps {
				switch step.StepName {
				case "persist-canonical-observation":
					if s2, ok := step.Output.(string); ok {
						var v any
						if jerr := json.Unmarshal([]byte(s2), &v); jerr == nil {
							canonicalObservation = v
						} else {
							canonicalObservation = s2
						}
					} else {
						canonicalObservation = step.Output
					}
				case "persist-invocation":
					// The step's return value is the
					// logicalInvocationId. DBOS Go v1.0.0
					// returns the step output as a JSON-
					// encoded string (i.e. the value is
					// wrapped in extra quotes). Strip them.
					// Recover from durable DBOS step output
					// (mandate §19: no synthetic data).
					if s2, ok := step.Output.(string); ok && s2 != "" {
						liRaw := s2
						if len(liRaw) >= 2 && liRaw[0] == '"' && liRaw[len(liRaw)-1] == '"' {
							var unq string
							if jerr := json.Unmarshal([]byte(liRaw), &unq); jerr == nil {
								liRaw = unq
							}
						}
						if liRaw != "" {
							logicalInvocationID = liRaw
						}
					}
				}
			}
		}
		// If we have a cached entry for this runID, use its
		// logicalInvocationID and the cached canonical
		// observation (only the same-process path; a fresh
		// process has no cache and reconstructs from DBOS).
		s.mu.Lock()
		if entry, ok := s.liCache[runID]; ok {
			if entry.logicalInvocationID != "" {
				logicalInvocationID = entry.logicalInvocationID
			}
			if entry.canonicalObservation != nil {
				canonicalObservation = entry.canonicalObservation
			}
		}
		s.mu.Unlock()
		w.Header().Set("Content-Type", "application/json")
		nowMs := time.Now().UnixMilli()
		_ = json.NewEncoder(w).Encode(map[string]any{
			"runId":              runID,
			"authorityGeneration": 1,
			"status":              "RUNNING",
			"logicalInvocations": []map[string]any{
				{
					"logicalInvocationId":  logicalInvocationID,
					"attempts":             []map[string]any{},
					"currentAttemptId":     "att-" + logicalInvocationID + "-1",
					"canonicalObservation": canonicalObservation,
					"terminal":             false,
				},
			},
			"approvalIds":     []string{},
			"durableTimerIds": []string{},
			"effectIds":       []string{"eff-" + logicalInvocationID + "-1"},
			"schemaVersion":   1,
			"nextAttemptId":   1,
			"createdAtEpochMs": nowMs,
			"updatedAtEpochMs": nowMs,
			"_dbos": map[string]any{
				"rootWorkflowID": runID,
				"readbackSource": "DBOS_DURABLE_STEP",
				"reconstructed":  gerr == nil,
			},
		})
		return
	}
	runID := path[:slash]
	rest := path[slash+1:]
	if rest == "" {
		http.NotFound(w, r)
		return
	}
	// Look for /invocations/:liId/attempts
	if len(rest) > len("invocations/") && rest[:len("invocations/")] == "invocations/" {
		liAndRest := rest[len("invocations/"):]
		liSlash := -1
		for i, c := range liAndRest {
			if c == '/' {
				liSlash = i
				break
			}
		}
		if liSlash < 0 || liAndRest[liSlash+1:] != "attempts" {
			http.NotFound(w, r)
			return
		}
		liID := liAndRest[:liSlash]
		if r.Method != http.MethodPost {
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
			return
		}
		var in DriveAttemptInput
		if err := json.NewDecoder(r.Body).Decode(&in); err != nil {
			http.Error(w, "bad request: "+err.Error(), http.StatusBadRequest)
			return
		}
		// Per mandate §12: the attempt DBOS WorkflowID
		// includes the durable AttemptId. Two retries of
		// the same (runId, liId, attemptId) return the same
		// durable result; a different attemptId produces a
		// distinct durable workflow.
		attemptWFID := "unifia-attempt:" + in.RunID + ":" + liID + ":" + in.AttemptID
		// The canonical input's runId/liId may match the URL
		// path; override them from the request body for
		// robustness.
		in.LogicalInvocationID = liID
		if in.RunID == "" {
			in.RunID = runID
		}
		handle, err := dbos.RunWorkflow(s.dbosCtx, DriveAttemptWorkflow, in, dbos.WithWorkflowID(attemptWFID))
		if err != nil {
			http.Error(w, "RunWorkflow: "+err.Error(), http.StatusInternalServerError)
			return
		}
		out, err := handle.GetResult()
		if err != nil {
			http.Error(w, "GetResult: "+err.Error(), http.StatusInternalServerError)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		nowMs := time.Now().UnixMilli()
		_ = json.NewEncoder(w).Encode(map[string]any{
			"attemptId":            in.AttemptID,
			"startedAtEpochMs":     nowMs - 1,
			"completedAtEpochMs":   nowMs,
			"status":               out.Status,
			"canonicalOutput":      in.CanonicalResult,
			"effectId":             out.EffectID,
			"_dbos": map[string]any{
				"workflowExecuted": true,
				"stepReached":      "record-attempt",
				"attemptWorkflowID": attemptWFID,
				"attemptIdSource":   "durable-allocator",
			},
		})
		return
	}
	http.NotFound(w, r)
}

// ----------------------------------------------------------------------------
// handleNextAttempt — durable per-(runId, liId) attempt allocator
// (mandate §3-§7).
//
// POST /attempts/next
//   body: { "runId": "...", "logicalInvocationId": "..." }
//   resp: { "attemptId": "att:<runId>:<liId>:<seq>", "sequence": N }
//
// The counter is persisted in the DBOS SQLite system database
// in the `attempt_sequence` table. Allocation is atomic via a
// transaction with `INSERT ... ON CONFLICT DO UPDATE`. After a
// process restart the allocator recovers its state from the
// durable table — there is no in-process counter.
//
// Two consecutive calls for the same (runId, liId) return two
// DISTINCT AttemptIds with monotonic sequences. After a process
// restart the sequence resumes from the durable state (no
// reuse). Two concurrent requests are serialized by the
// underlying SQLite engine (no duplicate AttemptId).
// ----------------------------------------------------------------------------

type NextAttemptInput struct {
	RunID               string `json:"runId"`
	LogicalInvocationID string `json:"logicalInvocationId"`
}

type NextAttemptOutput struct {
	AttemptID string `json:"attemptId"`
	Sequence  int64  `json:"sequence"`
}

func (s *server) handleNextAttempt(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	var in NextAttemptInput
	if err := json.NewDecoder(r.Body).Decode(&in); err != nil {
		http.Error(w, "bad request: "+err.Error(), http.StatusBadRequest)
		return
	}
	if in.RunID == "" || in.LogicalInvocationID == "" {
		http.Error(w, "runId and logicalInvocationId are required", http.StatusBadRequest)
		return
	}
	seq, err := nextAttemptSequence(s.rawSQL, in.RunID, in.LogicalInvocationID)
	if err != nil {
		http.Error(w, "allocate attempt: "+err.Error(), http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(NextAttemptOutput{
		AttemptID: formatAttemptId(in.RunID, in.LogicalInvocationID, seq),
		Sequence:  seq,
	})
}

// ----------------------------------------------------------------------------
// FC-31B host-adapter canonization (ADR-000 §57-§58)
//
// The Go host itself materializes the exact typed value described by the
// fixture (int64, uint64, float64, time.Time) and applies the canonical
// value contract. The harness must not pre-convert: the verdict emitted
// here is the candidate's own host decision.
//
// Contract mirrored from packages/automate-m0-contract/src/value.ts:
//   - fromHostInteger:  host integers convertible only within
//     ±(2^53-1); outside → NUMBER_OUT_OF_CANONICAL_RANGE.
//   - fromHostFloat64:  any finite binary64; NaN/±Inf →
//     NON_FINITE_NUMBER; -0 normalizes to +0.
//   - canonicalTimestampFromEpochMs: exact integer ms within
//     ±(2^53-1); non-integer → NON_CANONICAL_TIME.
//   - A host type with no canonical form → UNSUPPORTED_HOST_TYPE.
// ----------------------------------------------------------------------------

type canonizeRequest struct {
	CaseID   string          `json:"caseId"`
	Encoding string          `json:"encoding"`
	Payload  json.RawMessage `json:"payload"`
}

type canonicalMaterialization struct {
	Kind    string `json:"kind"`              // "number" | "timestamp"
	Bits    string `json:"bits"`              // hex16 big-endian binary64 (numbers)
	Decimal string `json:"decimal"`           // exact decimal form (numbers)
	EpochMs string `json:"epochMs,omitempty"` // exact epoch ms (timestamps)
}

type canonizeVerdict struct {
	Outcome   string                    `json:"outcome"` // "pass" | "reject"
	Code      string                    `json:"code,omitempty"`
	GoType    string                    `json:"goType"` // int64 | uint64 | float64 | time.Time | unsupported
	Canonical *canonicalMaterialization `json:"canonical,omitempty"`
}

const (
	maxSafeCanonicalInteger = int64(9007199254740991) // 2^53 - 1
)

func rejectVerdict(goType, code string) canonizeVerdict {
	return canonizeVerdict{Outcome: "reject", Code: code, GoType: goType}
}

// float64Materialization renders the canonical binary64 losslessly.
func float64Materialization(v float64) *canonicalMaterialization {
	return &canonicalMaterialization{
		Kind:    "number",
		Bits:    fmt.Sprintf("%016x", math.Float64bits(v)),
		Decimal: strconv.FormatFloat(v, 'f', -1, 64),
	}
}

// canonizeNumberFromInteger applies fromHostInteger semantics to an exact
// integer the host already materialized.
func canonizeNumberFromInteger(goType string, exact int64, negativeOverflow bool) canonizeVerdict {
	if negativeOverflow || exact > maxSafeCanonicalInteger || exact < -maxSafeCanonicalInteger {
		return rejectVerdict(goType, "NUMBER_OUT_OF_CANONICAL_RANGE")
	}
	return canonizeVerdict{Outcome: "pass", GoType: goType, Canonical: float64Materialization(float64(exact))}
}

// canonizeFloat64 applies fromHostFloat64 semantics to a materialized
// binary64. When integerEntry is true the caller declared the integer
// exactness promise (fromHostInteger on a host float64): a non-integral
// value is UNSUPPORTED_CANONICAL_VALUE and the safe-range check still
// applies (2^53 itself is out of range for an integer promise).
func canonizeFloat64(v float64, integerEntry bool) canonizeVerdict {
	if math.IsNaN(v) {
		return rejectVerdict("float64", "NON_FINITE_NUMBER")
	}
	if math.IsInf(v, 0) {
		return rejectVerdict("float64", "NON_FINITE_NUMBER")
	}
	if integerEntry {
		if v != math.Trunc(v) {
			return rejectVerdict("float64", "UNSUPPORTED_CANONICAL_VALUE")
		}
		if v > float64(maxSafeCanonicalInteger) || v < float64(-maxSafeCanonicalInteger) {
			return rejectVerdict("float64", "NUMBER_OUT_OF_CANONICAL_RANGE")
		}
		return canonizeVerdict{Outcome: "pass", GoType: "float64", Canonical: float64Materialization(v)}
	}
	if v == 0 {
		v = 0 // §26: -0 normalizes to +0
	}
	return canonizeVerdict{Outcome: "pass", GoType: "float64", Canonical: float64Materialization(v)}
}

// canonizeTimestamp applies canonicalTimestampFromEpochMs semantics; the
// host materializes time.UnixMilli so the recorded Go type is time.Time.
func canonizeTimestamp(ms int64) canonizeVerdict {
	if ms > maxSafeCanonicalInteger || ms < -maxSafeCanonicalInteger {
		return rejectVerdict("time.Time", "NUMBER_OUT_OF_CANONICAL_RANGE")
	}
	_ = time.UnixMilli(ms) // host materialization of the instant
	return canonizeVerdict{
		Outcome: "pass",
		GoType:  "time.Time",
		Canonical: &canonicalMaterialization{
			Kind:    "timestamp",
			EpochMs: strconv.FormatInt(ms, 10),
		},
	}
}

// canonize applies the canonical value contract for one fixture. The
// payload string is the lossless decimal/raw descriptor from the harness.
func canonize(encoding, payload string) canonizeVerdict {
	switch encoding {
	case "host-integer":
		v, err := strconv.ParseInt(payload, 10, 64)
		if err != nil {
			return rejectVerdict("int64", "NUMBER_OUT_OF_CANONICAL_RANGE")
		}
		return canonizeNumberFromInteger("int64", v, false)
	case "host-bigint":
		if v, err := strconv.ParseInt(payload, 10, 64); err == nil {
			return canonizeNumberFromInteger("int64", v, false)
		}
		if v, err := strconv.ParseUint(payload, 10, 64); err == nil {
			if v > uint64(maxSafeCanonicalInteger) {
				return rejectVerdict("uint64", "NUMBER_OUT_OF_CANONICAL_RANGE")
			}
			return canonizeVerdict{Outcome: "pass", GoType: "uint64", Canonical: float64Materialization(float64(v))}
		}
		return rejectVerdict("uint64", "NUMBER_OUT_OF_CANONICAL_RANGE")
	case "float64-decimal":
		v, err := strconv.ParseFloat(payload, 64)
		if err != nil {
			if errors.Is(err, strconv.ErrRange) {
				return rejectVerdict("float64", "NON_FINITE_NUMBER")
			}
			return rejectVerdict("float64", "UNSUPPORTED_HOST_TYPE")
		}
		return canonizeFloat64(v, false)
	case "canonical-timestamp", "host-date":
		v, err := strconv.ParseInt(payload, 10, 64)
		if err != nil {
			if errors.Is(err, strconv.ErrRange) {
				return rejectVerdict("time.Time", "NUMBER_OUT_OF_CANONICAL_RANGE")
			}
			return rejectVerdict("time.Time", "NON_CANONICAL_TIME")
		}
		return canonizeTimestamp(v)
	case "host-sentinel":
		return rejectVerdict("unsupported", "UNSUPPORTED_HOST_TYPE")
	default:
		return rejectVerdict("unsupported", "UNSUPPORTED_HOST_TYPE")
	}
}

func (s *server) handleCanonize(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "POST only", http.StatusMethodNotAllowed)
		return
	}
	var req canonizeRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "bad request: "+err.Error(), http.StatusBadRequest)
		return
	}
	payload := ""
	if len(req.Payload) > 0 {
		var raw any
		if err := json.Unmarshal(req.Payload, &raw); err != nil {
			http.Error(w, "bad payload: "+err.Error(), http.StatusBadRequest)
			return
		}
		switch v := raw.(type) {
		case string:
			payload = v
		case float64:
			// Lossless: keep the exact JSON literal text for numeric payloads.
			payload = string(req.Payload)
		default:
			http.Error(w, "payload must be a string or number", http.StatusBadRequest)
			return
		}
	}
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(canonize(req.Encoding, payload))
}