<!-- SPDX-License-Identifier: MIT -->
# Changelog — Sovereign Knowledge Core V1

> All notable changes to the Knowledge subsystem are documented
> here. Format follows [Keep a Changelog](https://keepachangelog.com/).

## [0.6.0-knowledge] - 2026-08-30 (durability and card closure)

### Fixed (security)
- **Anonymous MCP calls are refused.** serveMcp substituted the daemon's own
  privileged token when a request carried none, so an unauthenticated
  JSON-RPC call was served with the server's credential. The test named
  "serves a search with the session token" sent no token and passed,
  enshrining the bypass.
- **Wire payloads are validated** against the official Zod schemas through a
  `{ token, request }` envelope; authorisation runs before validation so an
  unauthorised caller cannot probe a schema.

### Fixed (correctness)
- **Deadlines bind.** The read path used synchronous fs calls, so no timer
  could fire during a scan: a 5ms budget returned after 128ms. readdir, stat
  and readFile are awaited; 1ms now returns in 2ms, truncated.
- **archive works** — the WAL grouped it with delete and demanded no new
  hash, making it unperformable. Corrected on both the TS and Rust sides.
- **supersede records the replacement on the successor**, refuses cycles and
  self-supersession; **move is implemented**; every mutation of an existing
  note is compare-and-swap protected in the contract as well as the writer.

### Added
- **Durable commits** (`mutation/durability.ts`): fsync of the temporary, of
  the WAL append — the commit point — and of the directory; an O_EXCL
  cross-process WriteLock with stale reclaim; recovery on open. 15 crash
  tests against the real filesystem. The matrix found a real bug while being
  written: an append following a torn line concatenated onto it.
- **egress.decision audit trail** (ADR-KNOW-0006 §6): every decision, allow
  and deny, with hash, qualified destination, reason and guard version.
  decideEgress stays pure; the sink is wired at the composition root.

### Tests
- 817 passing: 703 TS knowledge (was 658) + 79 contracts + 35 Rust.

### Status
- All cards from the three counter-reviews are closed; R-0012 §6, R-0013 and
  R-0014 closed. Remaining scope deferrals are named in RISKS.
- 0 push, 0 PR, 0 merge, 0 release, 0 publication.

## [0.5.0-knowledge] - 2026-08-30 (write path and MCP daemon)

### Added
- **Class A write path.** `MutationWriter` was an interface with no
  implementation, so `knowledge_propose` could only refuse and the memory
  layer could not remember anything. `VaultMutationWriter` validates the
  intent, confines the target on real paths, refuses credential bodies,
  honours compare-and-swap, appends to a persisted WAL before the file
  becomes visible, and writes atomically. A new note enters as a `candidate`;
  `delete` is refused (ADR-KNOW-0009). Writes are opt-in:
  `composeKnowledgeService({ writable: true })`.
- **MCP daemon.** `serveMcp()` answers the six capabilities as JSON-RPC 2.0
  over an injected transport, reusing `@unifia/mcp-transport`.
  `unifia knowledge mcp serve <workspace>` holds one server and one registry
  for the process lifetime, so a token stays valid across calls and a
  revocation is immediate. `@unifia/mcp-transport` is now a declared
  dependency; it resolved through the workspace but was never listed.
- `source/containment.ts` — one containment definition shared by reader and
  writer, so the two cannot disagree about where the vault ends.

### Removed
- `buildSyntheticRetrieval` — fabricated a candidate with hardcoded trust and
  restriction, then returned `decision === "allow" ? [] : []`, two identical
  branches. Superseded by real retrieval, no production consumer.
- `decideEgressBatch` — zero consumers, zero tests.

### Tests
- 771 passing: 658 TS knowledge (was 632) + 79 contracts + 34 Rust.

### Status
- R-0013 closed. Remaining boundaries named in RISKS: no token persistence
  across daemon restarts, no FTS5 runtime, no ONNX model, no OS watcher, no
  Android device.
- 0 push, 0 PR, 0 merge, 0 release, 0 publication.

## [0.4.0-knowledge] - 2026-08-30 (production-readiness counter-review)

### Fixed (security)
- **No capability serves a note the policy denies.** `get()` built its
  candidate with `restriction: "allow"` hardcoded and never called
  `decideEgress` — the defect just removed from the router, reintroduced one
  layer up. A `remote_model: deny` note was served in full remotely, and
  `backlinks` leaked its id and snippet. All read paths now share one
  hydration that resolves the note's own restriction and applies the guard; a
  denied note answers like an absent one.
- **The vault root is a real boundary.** Containment was decided lexically
  while `statSync` follows junctions, so a link inside the vault pointing
  anywhere on disk was walked and read. Decided on realpath now, per entry,
  with cycle detection. Verified against a real Windows junction.
- **Restrictions survive serialisation.** `serialiseNote()` omitted
  `unifia_restrictions`, so a round-trip silently stripped a note's egress
  restrictions.
- **Android evidence is validated.** An empty `ProbeEvidence` produced a PASS
  reading `" on  at : "`.

### Fixed (correctness)
- **Deadlines bound the calls, not the gaps.** A 300ms `list()` ran to
  completion against a 20ms deadline. Now 44ms with `truncated: true`.
- **MCP is composed for real.** The server was constructed nowhere outside
  tests; `mcp-token issue/check/revoke` could not work across processes.
  `mcp/compose.ts` binds workspace, policy, service, registry and server;
  `mcp-token session` exercises the lifecycle honestly.
- **`knowledge_get` returns what its contract declares** — body, id, locator,
  versionHash — and honours `maxBytes`.
- **`trace` walks real lineage** (`unifia_supersedes`) instead of reusing
  backlinks, which mixed in ordinary wikilinks and mislabelled directions.
- **Notes are no longer duplicated** between the personal and project mounts.
- **`status.vector`** reports a loaded model, not a policy flag.
- **`verify --strict`** exits non-zero on WARN or NOT_EXECUTED.
- **`fakeHash`** (32-bit djb2 repeated eight times, cast to
  `KnowledgeVersionHash`) replaced with sha256.
- The CLI kept a second `parseFlags` that dropped bare `--flag` forms.

### Changed
- `commands-report.ts` (891 lines) split into `commands-vault.ts` (525) and
  `commands-graph.ts` (442); dispatcher down to 1045.

### Tests
- 745 passing: 632 TS knowledge (was 612) + 79 contracts + 34 Rust.

### Status
- Verdict: READY_FOR_REVIEW, not PRODUCTION_READY.
- R-0013 opened: no Class A writer, no MCP daemon.
- 0 push, 0 PR, 0 merge, 0 release, 0 publication.

## [0.3.0-knowledge] - 2026-08-29 (remediation after frontier counter-review)

### Fixed (security)
- **Egress overrides can no longer widen a portable `deny`.** `decideEgress`
  evaluated the per-item `allow` override before the item's own restriction,
  so a note marked `remote_model: deny` was returned as `allow` toward a
  permissive provider. Every deny is now decided before any allow.
- **Unresolved provenance is denied toward non-local destinations**
  (ADR-KNOW-0006 §2), instead of being allowed with a note in the reason.
- **The MCP server authenticates.** All six methods were anonymous; the
  workspace was checked on `propose` alone; `status` was unrate-limited.
  Every method now requires a scoped token and passes one guard.
- **MCP tokens** use a 32-byte CSPRNG id (was `Date.now()` + counter), always
  carry a TTL (was: omitting `ttlMs` minted a perpetual token), cap it at 24
  hours, and carry a method allowlist defaulting to read-only.
- **`ExternalSource` capabilities are enforced.** `list`/`read`/`watch`
  reached the backend even when the capability was absent.

### Fixed (correctness)
- **CLI `search` queries the real vault.** It answered from two notes declared
  inline, so any two queries returned `hits=2 scanned=2`.
- **`ContextRouter` honours its contract**: query, types, tags, lifecycle,
  a global `maxCandidates`, UTF-8 `maxSnippetBytes` and `maxPayloadBytes`, a
  real deadline with truncation reported, real snippets and sha256 hashes,
  real lifecycle and provenance, deterministic ranking.
- **`policy.json` reaches the egress decision** through the new
  `facade/compose.ts`. It previously had two consumers, both administrative.
- **Wikilinks and headings inside fenced or inline code are no longer
  extracted.** The parser and the derived indexer each carried their own
  regex; both now share `parser/code-mask.ts`.
- **One lifecycle transition table.** Two copies disagreed with
  `intentForTransition`, which refused `superseded -> active` while both
  tables advertised it. That transition is removed per ADR-KNOW-0009.
- **No fabricated PASS.** Android probes required no evidence; `verify`
  hardcoded `classBReachable: true` and passed on a stub-filesystem
  simulation and on vaults with orphans. Checks now carry
  PASS/WARN/FAIL/NOT_EXECUTED and name the offending files.
- **The facade stops returning empty successes.** `get`, `backlinks` and
  `status` do the work; `propose` refuses with a typed error when no writer
  is configured.
- `cargo fmt --check` was red across all 8 Rust modules while the report
  recorded the Rust gates green.

### Added
- `unifia_restrictions` frontmatter key — a V1 note could not express
  restrictions at all: the strict schema rejected every spelling. One
  canonical representation, fail-closed defaults, `mostRestrictive()` for
  the heritage rule. Recorded as a dated amendment to ADR-KNOW-0006.
- `ProviderDestinationPlan.destinationKind` (`local` | `remote`, omitted =
  remote) so the guard can tell an on-device read from an egress.
- `VaultSource` — the first source that reads Class A from disk.
- `capability_unavailable` error kind.
- `bin/knowledge/` — the CLI was 2048 lines against a 1500-line blocking
  budget and the plan forbids adding to it before decomposing. Split into
  usage, shared, runtime and commands-report; the dispatcher is now 1110.
- Characterization suite `test/knowledge/regression/`, written red.

### Documentation
- `SOVEREIGN-CORE-V1-DOD.md` — every one of the 22 requirements was
  `PENDING`, and all 12 U-commands pointed at `src/` where the tests live in
  `test/`. Audited: 10 PASS, 7 PARTIAL, 4 NOT_EXECUTED, with replayable
  commands.
- `FINAL-REPORT.md` — dated addendum listing the seven refuted claims and
  classifying every surface as implemented / tested with real I/O /
  simulated / disabled / external boundary.
- `PERMISSIONS.md` — five verified misstatements corrected.
- `RISKS.md` — R-0012 opened for the unimplemented parts of ADR-KNOW-0006.

### Tests
- 725 passing: 612 TS knowledge (was 522) + 79 contracts + 34 Rust.

### Status
- Branch: `feat/sovereign-knowledge-core`, no upstream.
- 0 push, 0 PR, 0 merge, 0 release, 0 publication.

## [0.2.0-knowledge] - 2026-08-29 (admin tools + hardening)

### Added
- **19 admin modules** under `packages/unifia/src/knowledge/admin/`:
  corpus-classify, validate, summary, report, tag-search, backlinks,
  stats, by-type, broken-links, headings, list, show, tags, projects,
  supersede (plan), by-lifecycle, by-project, orphans, lifecycle-
  distribution, stale, recent, references, fingerprint, by-tag,
  vault-compare, supersede-graph, duplicates, timeline,
  tag-cooccurrence, supersede-classify, note-diff.
- **49 CLI subcommands** in `bin/unifia-knowledge.ts`, each wired
  through the dispatcher and the help text.
- **P11.14 policy.json runtime** : operator-editable policy at
  `<workspace>/.unifia/policy.json` (egress defaults, per-destination
  overrides, feature flags, default token TTL, trusted devices).
- **P11.4-7 hardening suite** : disaster-recovery, migration
  dry-run + rollback, sovereignty test runner, Git pre-commit
  scan hook.
- **P11.10 corpus classification** : real-fixture `classify` for
  notesFailed / totalChunks / totalEdges.
- **P11.19 summary CLI** : one-line + sectioned vault summary.
- **P11.17 disaster-recovery drill** : 6 crash scenarios.
- **P11.13 full verify** : sovereignty + recovery + reachability +
  classify, all sequential.
- **P11.22 validate** : per-type field check + custom missing
  fields, 8 categories.
- **P11.23 report** : Markdown workspace report, configurable
  title, optional sections.
- **P9.2 MCP token registry** : issue/revoke/isValid/TTL, scoped
  to workspace.
- **P2.6-8 Class B extensions** : portable-store, reachability
  scan, GC recommendation + apply.
- **P4.4 lifecycle audit log** : append-only, queryable by id /
  source / transition / time-range.
- **P7.4 cross-mode bus pipeline** : emits `decision.created`,
  `tool.executed`, `session.ended` on the DomainBus.
- **PERMISSIONS.md** : 5 KB doc covering default-deny, 6 V1
  capabilities, 8 destinations, restrictions per source, tokens,
  audit, 7 what-V1-does-not-do, 6 operator-facing commands, 9
  modification procedure.
- **DISASTER-RECOVERY.md** : 5-step procedure (verify-class-a/b,
  rebuild-c/d, confirm-sovereignty).
- **CHANGELOG.md v0.2.0** : this entry.

### Tests
- 595 tests passants : 482 TS knowledge + 79 contracts + 34 Rust.

### Status
- Branch : `feat/sovereign-knowledge-core`
- HEAD : `d494e5333e` (P11.50)
- 96 commits, 295 files added, ~32 000 insertions.
- 0 push, 0 PR, 0 merge, 0 release, 0 publication.

## [0.1.0-knowledge] - 2026-08-29

### Added
- **`@unifia/contracts/knowledge/`** : 10 fichiers, 37 tests Zod.
  Identity (UUIDv7, locator, hash), space (4 kinds), restrictions
  (remote/local/embeddable/exportable), lifecycle (4 states,
  9 types), retrieval (bounded), mutation (8 kinds with
  intent completeness), context (ContextPack), native-port
  (7 methods), errors (11 typed kinds), MCP (6 capabilities).
- **`packages/unifia/src/knowledge/`** : 21 modules
  - `domain/` : `KnowledgeFailure` with 11 typed kinds.
  - `parser/` : YAML frontmatter (gray-matter + strict Zod),
    wikilinks (`[[X]]`, `[[X|Y]]`, `[[X#H]]`), headings,
    section slicer, fenced code blocks.
  - `source/` : `KnowledgeSource` interface + `SourceRegistry`
    + 4 V1 spaces (Personal, Project, External, Session).
  - `policy/` : `decideEgress` honouring ADR-KNOW-0006.
  - `context/` : `ContextRouter` (per-type cap, token
    budget), `inspect()` (read-only), `classifyText` (secret
    detection).
  - `derived/` : SQLite+FTS5 DDL (V1 migration, additive),
    `chunkBody`, `extractEdges`, `indexNote`.
  - `admin/` : `doctor()` with 11 categories.
  - `memory/` : lifecycle transitions, auto-promotion,
    Inbox.
  - `semantic/` : `cosine`, `BruteForceIndex`, embedding
    scoring per runbook §8.8, benchmark.
  - `stack/` : ai-native-dev-stack source mapping
    (9 source kinds, copy-on-write `StackMapping`).
  - `facade/` : `KnowledgeService` shared by Code/Work/Design.
  - `git/` : `GitProvider` + pre-push secret scan.
  - `mcp/` : `McpKnowledgeServer` with rate limit + byte cap.
  - `mobile/` : `STORAGE_MATRIX_TEMPLATE` (4 kinds), Android
    device probe.
  - `events/` : `DomainBus` (10 event kinds).
  - `cross-mode/` : `CrossModePipeline` (Design → Code → Work).
  - `hardening/` : `CRASH_SCENARIOS` (6), sovereignty checks,
    path containment, fuzz with xorshift32, large vault
    simulator, SBOM walker (CycloneDX 1.5).
  - `wal/` : TS adapter of the Rust WAL.
  - `classb/` : TS adapter of the Rust Class B.
  - `control/` : TS adapter of the Rust ControlStore.
  - `spike/` : P0 spike primitives (callBounded,
    ATOMIC_WRITE_MATRIX, sandbox, FTS probe, prepush, synthetic
    retrieval).
- **`crates/unifia-knowledge-core/`** : 8 modules Rust, 18 tests.
  - `error` : `KnowledgeError` (11 kinds, snake_case).
  - `hash` : BLAKE3 + SHA-256, 64-char hex validation.
  - `path` : `ResolvedKnowledgePath` with symlink/junction
    containment.
  - `watcher` : debounce/coalesce primitive, `hash_file`.
  - `wal` : append-only WAL with 8 kinds, idempotent replay.
  - `classb` : copy-on-write aliases, reachability report, GC.
  - `control_store` : Class C (device_id, PolicyGrant,
    EgressGrant, control log).
- **`bin/unifia-knowledge.ts`** : CLI surface (status, sources,
  search, doctor, bench, bench-large).
- **9 ADR** at `docs/knowledge/adr/0001..0009-knowledge-*.md`
  (identity, canonical, Class B, Class C, Class D, egress,
  NativePort, search, lifecycle).
- **10 cas réels** dans `PRODUCT-CASES.md` (PC-01..PC-10)
  extraits de `KNOWN_FAILURE_PATTERNS.md` et `KNOWN_ISSUES.md`.
- **DoD** : 12 user-level + 10 engineering-level requirements.
- **22 fixtures** : 11 dev + 11 holdout, isolation validée par
  `check-isolation.ts`.

### Validation
- 255 tests passants : 168 TS knowledge + 69 contracts + 18 Rust.
- Typecheck `bun run typecheck` (packages/unifia) : exit 0.
- `cargo clippy --all-targets --all-features -- -D warnings` : exit 0.
- `biome check packages/unifia/src/knowledge` : 0 warning.

### Status
- Branch : `feat/sovereign-knowledge-core`
- HEAD : `ef11945cdc`
- 24 commits, 130 files added, ~13 000 insertions.
- 0 push, 0 PR, 0 merge, 0 release, 0 publication.

### External boundaries
- Android device : `NOT_EXECUTED_EXTERNAL_BOUNDARY` (P10.2 / P10.3).
- ONNX embedding model : `disabled` by default.
- Frontier review : not triggered (runbook §24).
