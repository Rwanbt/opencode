<!-- SPDX-License-Identifier: MIT -->
# FRONTIER REVIEW VERDICT — Sovereign Knowledge Core V1

**Reviewer** : Claude Opus 5 (frontier review per runbook V2 §24)
**Date** : 2026-08-29
**Reviewed at HEAD** : `c3e7374798` (branch `feat/sovereign-knowledge-core`, 115 commits)
**Packet under review** : `FRONTIER-REVIEW-PACKET.md` (captured at `c67a7e22`, 111 commits)

> Method note. Every load-bearing claim below is tagged VERIFIED
> (command executed / exact lines read), INFERRED, or UNVERIFIED.
> Where I ran a probe, the probe and its output are reproduced so
> the operator can replay it. Where I lacked context, I say so
> rather than guessing.

---

## 0. Reproduction — did the packet's numbers hold?

**VERIFIED.** All three suites and all seven CLI captures reproduce at
`c3e7374798`. No regression.

| Claim | Result | Evidence |
|---|---|---|
| 79 contracts tests | **79 pass, exit 0** | `bun --cwd packages/contracts test` |
| 522 TS knowledge tests | **522 pass, 65 files, exit 0** | `bun --cwd packages/unifia test test/knowledge` |
| 34 Rust tests | **34 pass, exit 0** | `cargo test` in the crate |
| **635 total** | **confirmed** | sum of the above |
| `drill` 6/6 | identical | byte-for-byte match with packet |
| `verify` 4/4, verdict OK | identical | `classA=12, orphans=0, parsed=11, failed=1` |
| `lifecycle-distribution` | identical | 11 scanned, same 4×9 grid |
| `size-distribution` | identical | 12 scanned, 9694 bytes, mean 807, median 710 |
| `tag-cooccurrence` | identical | 22 unique tags, 0 pairs |
| `supersede-graph` | identical | 1 edge, 0 dangling, depth=1 |
| `lifecycle-transitions` | identical | same matrix |

Two reproduction caveats, both benign:

1. **The packet is stale by 4 commits** (111 → 115, `c67a7e22` → `c3e7374798`).
   I verified the delta is **docs-only** (`git log c67a7e22..HEAD` = four
   `docs(knowledge):` commits), so the captured outputs remain valid. The
   TL;DR table should be refreshed before the packet is circulated further.
2. **The runner matters.** `bun --cwd packages/contracts test` passes (exit 0).
   `bun --cwd packages/contracts vitest run` **fails with exit 1** — four files
   (`capability-registry`, `event-sequencer`, `generative-ui`, `mcp-ui`) are
   bun-style top-level assertion scripts with no `describe`/`it`, so vitest
   reports "No test suite found". These files predate this branch
   (`origin/dev`, commit `91daa35a26`) and are outside Knowledge Core scope,
   but `vitest` is a declared devDependency of the package, so a reviewer or
   CI job that reaches for it gets a false red. Worth a one-line note in the
   packet, or a `vitest.config.ts` `include` glob.

---

## 1. Per-question verdicts

### Q1 — Lifecycle coverage — **PASS_WITH_CONCERNS**

The 4×9 matrix is real, implemented, tested, and the CLI rendering matches the
transition table exactly (VERIFIED via `lifecycle-transitions`). The nine memory
types and four states are sufficient to *represent* PC-01..PC-10, which are
predominantly `failure`-type engineering incidents. No structural gap in the
matrix itself.

Three divergences between ADR-KNOW-0009 and the implementation:

- **`superseded → active` is allowed by the implementation** but does not appear
  in the ADR's transition diagram, which shows only `archived ──[restore]──> active`.
  The implementation is *more permissive* than the accepted decision. Either the
  ADR diagram is incomplete or the matrix is. (VERIFIED: CLI matrix vs ADR §Décision.)
- **The 30-day candidate TTL is not implemented.** ADR-0009 rule 1 states a
  candidate has "une durée de vie maximale (par défaut 30 jours)". The only
  30-day constant in the subsystem is `admin/doctor.ts:125`, which measures
  *index staleness*, not candidate age. (VERIFIED by grep.)
- **None of the three `doctor` checks promised in ADR-0009 §Conséquences exist**:
  stale candidates >30d, supersededs with empty `unifia_supersedes`, archives that
  were never active. `doctor.ts` implements six unrelated checks (duplicate id,
  invalid lifecycle, unknown wikilink target, active-not-in-index, stale index,
  gitignore match). (VERIFIED by reading all `message:` sites in `doctor.ts`.)

Not a blocker — the lifecycle *core* is sound. But ADR-0009's "Conséquences"
section currently describes work that was not done, which is the kind of drift
that misleads the next implementer.

### Q2 — Egress default-deny — **FAIL**

This is the most serious finding of the review, and it is a **documentation-versus-
implementation gap, not an active leak**. I want both halves of that sentence to
carry equal weight.

**What is actually true (the good news, VERIFIED):** there is *no network egress
capability anywhere in the subsystem*. `grep` for `fetch(`, `http://`, `https://`,
`net.`, `axios`, `undici`, `WebSocket` across `packages/unifia/src/knowledge/`
returns nothing. The Rust crate's entire dependency set is `thiserror`, `serde`,
`serde_json`, `camino`, `sha2`, `blake3`, and optional `rusqlite` — no `reqwest`,
no `hyper`, no `tokio::net`. **The offline-first posture is enforced structurally,
by the absence of any means to egress.** That is the strongest form of enforcement
there is, and it is a genuine achievement. Nothing is leaking today.

**What is not true (the problem):** the *policy layer* that three documents
describe as governing egress does not do so.

1. **A V1 note cannot carry portable restrictions at all.** `NoteFrontmatterSchema`
   is `.strict()` and declares nine keys, none of which is a restrictions block.
   Empirically verified:

   ```
   base note parses: true
   note WITH unifia_restrictions parses: false
     rejection: unrecognized_keys - Unrecognized key: "unifia_restrictions"
   ```

   `unifia_restrictions` appears **only in prose** — ADR-0002, ADR-0006,
   PRODUCT-CASES.md. Zero occurrences in `packages/` or `crates/`.

2. **The ContextRouter hardcodes every candidate to permissive values.**
   `context/router.ts:96-104` constructs each candidate with `trust: "verified"`
   and `restriction: "allow"` literals, regardless of note content. The `source/`
   layer contains zero references to `restriction`. Consequently `decideEgress`
   rule 3 (`item.restriction === "deny"` → deny) is **unreachable from the
   production path**; the only lever that can deny is `plan.defaultRestriction`,
   which denies uniformly and thus cannot express the per-note semantics the ADR
   was written to provide.

3. **`policy.json` is not wired to egress decisions.** `readPolicy` — which carries
   `egress: "deny"` and `egressByDestination` — is consumed by exactly two call
   sites: the CLI `policy` subcommand and `admin/summary.ts` (read-only reporting).
   Neither `router.ts` nor `inspector.ts` reads it. **An operator editing
   `policy.json` changes nothing about what the router will emit.**

4. **ADR-0006 cites two reference implementations that do not exist.**
   `packages/unifia/src/knowledge/policy/dataflow-guard.ts` (the actual file is
   `context/dataflow.ts`, and it is a regex secret-scanner for shell output — not
   the unified `AgentDataFlowGuard` the ADR describes) and
   `crates/unifia-knowledge-core/src/port/transport.rs` (**no `port/` directory
   exists**; the crate has 8 modules, none of them a port or transport). The
   ADR's claim of TS/Rust guard parity is unimplemented.

5. **The implementation contradicts its own header.** `egress.ts` opens by
   restating ADR rule 2 — "UNCLASSIFIED, unverified provenance, fallback cloud =
   DENY EXTERNAL" — then rule 5 of the same function returns
   `{ decision: "allow", reason: "allow with trust=unverified" }`.

6. **Rule 6 (audit) is unenforced.** `decideEgress` is pure and delegates event
   emission to the caller by comment. No caller emits `egress.decision`.

**Answering the question as asked** — "does `decideEgress` honour ADR-KNOW-0006
for every Class D call site?" — the honest answer is that `decideEgress` is called
from three sites (`router.ts`, `inspector.ts`, `spike/p0.ts`) and is never reached
by the MCP server (`mcp/server.ts` mentions egress only in a comment). But the
deeper issue is that the function is fed synthetic inputs, so even where it *is*
called it cannot enforce the ADR.

**Severity calibration.** I am marking this FAIL because ADR-KNOW-0006 is status
`ACCEPTED` with no deferral marker, and PERMISSIONS.md states the enforcement as
present-tense fact. A reader of these documents would reasonably believe a
mechanism exists that does not. The *risk* is latent, not active: it materializes
the day the first provider call is added. That is precisely when a "sovereign"
product is least able to afford a policy layer that was never wired.

### Q3 — Parser correctness — **FAIL**

`[[X]]`, `[[X|Y]]`, `[[X#H]]`, and `[[X#H|Y]]` all parse correctly, with sensible
trimming and empty-target rejection. **Code-fence escaping does not work.** Probe:

```
input:  Real link to [[Alpha]] and [[Beta|B]] and [[Gamma#Head]].
        ```ts
        // this is code, NOT a link: [[NotALink]]
        ```
        Trailing [[Delta]].

targets extracted: ["Alpha","Beta","Gamma","NotALink","Delta"]
fences found: 1
NotALink leaked into links? true
```

`WIKILINK_RE` has no fence awareness, and `parser.ts:42-45` calls
`extractWikilinks(note.body)` and `extractFences(note.body)` as independent
passes — fence ranges are never subtracted from link ranges. Every wikilink
written inside a fenced example becomes a real graph edge.

This is not cosmetic in *this* product. Unifia is a code workspace whose vault
documents its own syntax; ADR-0002 and PERMISSIONS.md both contain fenced YAML
examples. The tools affected are `backlinks`, `broken-links`, `references`,
`edge-density`, and `supersede-graph` — precisely the graph-integrity surface.
It also degrades `doctor`'s "wikilink to X is not in the known set" check into a
false-positive generator for any note that documents link syntax.

The `[^\S\n]*` sub-question: the rationale is **not documented**. The choice is
*correct* — `[^\S\n]` is horizontal whitespace, which prevents `\s*` from
swallowing the newline that the fence grammar depends on — but nothing in the
file says so, and this is exactly the class of subtle regex decision that
AGENTS.md's "comments = WHY only" rule exists to capture.

### Q4 — BruteForceIndex scaling — **PASS_WITH_CONCERNS**

Deferring ANN is the right call for V1, and 50k is a defensible order of
magnitude for a personal vault. Two caveats.

The implementation is not merely O(n) per query — `query()` pushes **every** entry
scoring above `minSimilarity` into an unbounded array, sorts the whole thing, then
slices `topK`. With the default `minSimilarity = 0`, a 50k-note vault allocates a
50k-element array and performs a 50k-element sort *per query*. A bounded top-K
heap would be O(n log k) with O(k) memory and is a ~15-line change. The 50k
threshold understates the real cost because the constant factor is the sort, not
the cosine.

The boundary tests are not boundary tests. `bench-large 100 256` exercises 100
vectors — **500× below** the documented threshold. That is a smoke test, not
evidence about behaviour at the deferral boundary. R-0008 correctly registers the
O(n) concern, so this is honestly tracked; the gap is between the risk register
and the test evidence, not in the decision itself.

### Q5 — Default retrieval bounds — **PASS_WITH_CONCERNS**

The *values* are well chosen. `maxCandidates=50` against a 1 MiB payload gives
~20 KiB/item, comfortably above the 64 KiB snippet cap for typical notes;
2s desktop / 4s Android is a reasonable split; the Zod schema caps each at a sane
ceiling (1000 candidates, 16 MiB, 1 MiB, 60s). No objection to the numbers.

The concern is that **three of the four bounds are declared but not enforced**.
In `context/router.ts`, only `maxCandidates` is used (passed as `limit` to
`source.list`). `maxPayloadBytes` and `maxSnippetBytes` appear nowhere in the
router. `deadlineMs` is accepted into `ContextRouterConfig` and then explicitly
disclaimed in the field comment: "Hard deadline in ms; the router is purely sync
today." The router instead enforces its own `DEFAULT_TOKEN_BUDGET = 8_000` — a
different unit, not traceable to ADR-KNOW-0007.

The ADR's framing is "the TypeScript layer decides WHAT to retrieve; the Rust
layer guarantees that the operation is correctly bounded" — and the Rust layer
has no port module yet (see Q2 finding 4). So the guarantee currently rests with
neither layer. The constants are correct; the enforcement is pending.

### Q6 — Disaster recovery — **PASS_WITH_CONCERNS**

The drill genuinely passes 6/6 (VERIFIED), the six scenarios in
`hardening/recovery.ts` are real crash points with named invariants
(`INV-RECOVERY-PRE-FSYNC` … `-DURING-COMPACTION`), and DISASTER-RECOVERY.md is a
clear, well-sequenced operator document with explicit success/failure criteria
per step and a "what this NEVER does" section. This is above-average operational
work.

**The question's premise does not hold, though: the 5 steps and the 6 scenarios
are orthogonal axes and do not map onto each other.** The DR document decomposes
by *storage class* (verify A, verify B, rebuild C, rebuild D, confirm sovereignty).
The crash matrix decomposes by *failure timing* (before fsync, after fsync before
rename, …). Neither document cross-references the other. So "do the 5 steps cover
the 6 scenarios" cannot be answered yes or no as posed — the correct answer is
that no coverage relation is asserted or testable. Adding a short mapping table
("a crash at `during-wal-compaction` lands you in Step 3") would make the DR
document actionable from a crash symptom, which is how an operator actually
arrives at it.

One substantive correction: **the packet, not the DR document, has the class
taxonomy wrong.** The packet's "Architecture invariants" section says
"Class B = derived (SQLite + FTS5, embeddings, graph)" and "Class D = delivery
(MCP, NativePort, ContextPack)". The ADRs say the opposite and are canonical:
ADR-0003 is titled "Class B — Portable metadata (copy-on-write)" and states
explicitly that "la DB est **Class D**, pas Class B"; ADR-0005 is titled
"Class D — Derived state (reconstructible)". DISASTER-RECOVERY.md agrees with the
ADRs. The packet — the document written to onboard an external reviewer —
inverts the two. Fix the packet.

Also: `verify` returns `PASS` on `disaster-recovery` with `missing=[network]` and
on `reachability` with `missingSidecars=12`, and `PASS` on `classify` with
`failed=1`. On the dev fixtures the parse failure is `README.md` (a non-note), so
the outcome is benign — but `classify` does not name the failing file, which
leaves an operator with a bare `notes failed: 1` and no way to act. A one-line
change to print the path would materially improve that tool.

### Q7 — V1 test count — **FAIL**

635 tests is a substantial, genuinely green suite, and the ratio (1114
`expect()` calls across 522 TS tests) suggests real assertions rather than
smoke tests. My objection is not to the number. It is that **the number cannot
currently be connected to the DoD at all.**

`SOVEREIGN-CORE-V1-DOD.md` §"Statut par item" lists **every requirement as
PENDING** — `U-01..U-12 PENDING`, `E-01` through `E-10` each `PENDING`. The
document that defines "done" asserts that nothing is done. Either it is badly
stale, or V1 is not done by its own definition. Given the DoD's own pass
condition requires "la preuve existe dans `docs/knowledge/execution/evidence/`",
this is not a formality — the traceability from test to requirement is the
artifact, and it is missing.

Spot-checking the single most important item makes the problem concrete. **U-07
is "Egress refusée par défaut pour UNCLASSIFIED"**, and it specifies:

- *Commande* : `bun --cwd packages/unifia test src/knowledge/policy/` — **this
  command fails** (exit 1; tests live under `test/knowledge/policy/`, not `src/`).
- *Preuve* : "test `egress-default-deny.test.ts` avec 4 cas" — **this file does
  not exist** anywhere in the repository.
- The actual egress tests are three cases in `test/knowledge/context/context.test.ts`,
  and **all three pass `trust: "verified"`**. The "provenance non résolue" case that
  U-07 names, and that ADR-0006 rule 2 governs, is untested — which is how the
  `unverified → allow` contradiction in Q2 survived.

So for the DoD item that encodes the product's central promise: the oracle command
is broken, the named proof artifact is absent, the test count is 3 not 4, and the
underlying feature is unimplemented. That is a FAIL, and it is the same root cause
as Q2.

To be concrete about what would fix it, rather than "add more tests":

- `decideEgress` with `trust: "unverified"` and `plan.defaultRestriction: "allow"`
  — asserts ADR-0006 rule 2, and currently **fails**, which is the point.
- `decideEgress` with `item.restriction: "deny"` and `plan.defaultRestriction:
  "allow"` — asserts "portable restrictions can only restrict" (rule 1).
- A `ContextRouter` test asserting that a note whose frontmatter denies remote
  egress is absent from the resulting `ContextPack` — currently impossible to
  write, which is itself the finding.
- `NoteFrontmatterSchema` round-trip with a restrictions block — currently fails
  on `unrecognized_keys`.

### Q8 — Reversibility — **FAIL** (as posed)

The question asserts "the `gc apply` command should remove all derived state,
leaving only Class A." **It does not, and it is not designed to.**
`applyGcRecommendation` (`classb/gc.ts:79-105`) deletes orphan **alias entries
from `portable-store.json`** and writes the store back. It never touches
`derived.db`, the FTS index, embeddings, or `.unifia/` control state. It is a
Class B alias reconciler, correctly scoped and correctly documented *in its own
file header* ("V1 ships a *recommendation* only… V1 never deletes Class B entries
automatically") — the file is fine; the question's premise about it is wrong.

Worse for the stated use case: `applyGcRecommendation` **throws** unless
`safeToApply`, which requires `missingSidecarLocators.length === 0`. On the
reference dev fixtures `missingSidecars=12`, so `gc apply` would refuse outright
on the very corpus the packet uses for verification.

The actual uninstall path exists and is sound — DISASTER-RECOVERY.md Step 4,
`rm .unifia/derived.db`, with Class A untouched and rebuild-on-next-open. Since
Class D is genuinely reconstructible and Class A is plain Markdown, **the
*property* of clean reversibility holds**. What does not exist is a command that
performs it. I am marking FAIL against the question as written rather than
against the architecture; the fix is to correct the claim (and, if a one-command
uninstall is wanted, that is a V1.1 item, not something to bolt on now).

### Q9 — Documentation completeness — **PASS_WITH_CONCERNS**

PERMISSIONS.md is well-structured for its purpose: a clear default-deny statement,
an exhaustive capability table, a destination matrix, a modification procedure
that requires an ADR first, and an explicit "no automatic edit by an AI agent"
clause. The §2 capability list is **accurate** (VERIFIED: `MCP_KNOWLEDGE_METHODS`
contains exactly those six). The intent and shape of this document are right.

But an operator relying on it would be misled on at least five specific points,
all verified:

| PERMISSIONS.md claim | Reality |
|---|---|
| §4 notes carry a `portable_restrictions:` frontmatter block | String absent from the entire codebase; the strict schema rejects it. **A third name** for this concept — ADR-0006 says `unifia_restrictions`, contracts say `PortableRestrictions` (`remoteModel`/`localModel`/`embeddable`/`exportable`), PERMISSIONS.md says `portable_restrictions` (`remote_model`/`git_remote`/`external_editor`/`mcp`). Three documents, three field sets, zero implementations. |
| §4 "The `ContextRouter` enforces these restrictions before hydrating a `ContextPack`" | The router hardcodes `restriction: "allow"` (Q2). |
| §4 "reported in `ContextDiagnostics.droppedByEgress`" | No such field; the real one is `candidatesDroppedByRestriction`. |
| §5 token has "a TTL (default 1 hour, max 24 hours)" and "a method allowlist" | `McpTokenRegistry.issue()` takes only `{workspace, ttlMs?}`. Omitting `ttlMs` yields `expiresAt: null` — **a token that never expires**. No default, no maximum, no allowlist. (`DEFAULT_POLICY.defaultTokenTtlMs = 1h` exists in `policy/store.ts` but is never read by the MCP layer.) |
| §8 "run the 4 sovereignty probes" | `sovereignty-runner.ts` pushes **five** probes. The runner's own header comment also says "four", so the file contradicts itself. |

§7's "It does not phone home" is **true** and structurally guaranteed (no network
code at all). But the supporting sentence — "the `sovereignty` command rejects
environments that report internet=on" — overstates it: `probeInternetOff`,
`probeCloudOff`, and `probeDeviceIsolated` consume **operator-asserted booleans**,
not measurements. The source comment is honest about this ("Network and cloud
checks are operator-provided"); the user-facing doc is not.

Separately, `docs/knowledge/CHANGELOG.md` v0.2.0 is stale — it records 595 tests,
49 CLI subcommands, `HEAD d494e5333e`, 96 commits, against the current 635 / 55 /
`c3e7374798` / 115. And PRODUCT-CASES.md:97 contains mojibake
(`引用 (引用nent) le token`) where French text was corrupted.

### Q10 — External boundaries — **PASS**

This is the strongest part of the submission and I want to say so plainly. The
labeling is honest, specific, and falsifiable:

- P10.2 states `PASS_WITH_SAFE_FALLBACK` and then **volunteers the limitation**
  ("the installed APK v0.1.0 does not embed the Knowledge runtime — no
  `rootfs.tgz`"), names the exact unblock command, and estimates it (30–60 min).
  Device identity, SDK level, PID, thermals, and free space are all captured.
- P10.3 explicitly marks the stress test **NOT executed** rather than dressing an
  idle capture up as one.
- The ONNX boundary correctly ties `disabled` to runbook §8.8 and discloses that
  P5.5 uses a deterministic fake 4-dim embed — which means "semantic search is
  wired but unexercised on real notes" is stated rather than implied.
- R-0003, R-0004, and R-0011 track exactly these three items in RISKS.md, with
  matching IDs.
- The Mutations row (`0 push, 0 PR, 0 merge, 0 release, 0 publication`) is
  VERIFIED — the branch has no upstream.

Resisting the temptation to round `PASS_WITH_SAFE_FALLBACK` up to `PASS` is
exactly the discipline this section should show. No concerns.

---

## 2. Cross-cutting findings

**F-1 — The dominant failure mode is doc-ahead-of-code, and it is systematic.**
Q1, Q2, Q5, Q7, and Q9 are five faces of one pattern: an ADR or operator document
describes a mechanism in the present indicative, and the mechanism is partly or
wholly absent. Individually each is a doc bug. Together they mean **the document
set cannot currently be trusted as a description of the system** — which is
serious for a project whose entire value proposition is auditability by its owner.
The `AGENTS.md` rule this violates is "One authoritative source per piece of
system knowledge": here the ADRs, PERMISSIONS.md, and the code are three competing
sources for the same facts.

**F-2 — Portable restrictions are the missing keystone, and no risk tracks them.**
RISKS.md has eleven entries covering Bun drift, device access, ONNX, O(n) search,
Windows trash policy, and TS field shadowing. **None covers the fact that the
egress restriction mechanism is unimplemented.** This is the largest known gap in
the V1 scope and it is the only one absent from the risk register. It should be
R-0012, severity high, with the four ADR-0006 rules it blocks (portable
restrictions, heritage, one-shot grants, audit events) enumerated.

**F-3 — Three names for one concept.** `unifia_restrictions` (ADR-0002, ADR-0006)
vs `portable_restrictions` (PERMISSIONS.md) vs `PortableRestrictions`
(contracts, with a *different field set*: `embeddable`/`exportable` rather than
`git_remote`/`external_editor`/`mcp`). Before this is implemented, one name and
one field set must win, in one ADR. Implementing against the current documents
would produce a fourth variant.

**F-4 — The ADR set is internally consistent except around egress.** I checked
0001–0009 for mutual conflict. The Class A/B/C/D taxonomy is coherent and
consistently applied across 0002/0003/0004/0005 and DISASTER-RECOVERY.md; the
identity, canonical-state, and search ADRs do not contradict one another. The two
real conflicts are both ADR-0006's: it names implementation files that do not
exist, and its rule 2 is contradicted by the code that cites it. ADR-0009's
diagram-vs-matrix mismatch (Q1) is the only other one. **No ADR needs reversing** —
0006 needs a `PARTIALLY IMPLEMENTED` status marker and a deferral note, which is a
different and much cheaper action than reversal.

**F-5 — The 20 decisions are well-grounded; none should be reversed.** D-0001
(phase-by-phase with checkpoints), D-0002 (real cases from
`KNOWN_FAILURE_PATTERNS.md`, never invented), and D-0004 (deferred parts get
interfaces + default impls + tests, with `NOT_EXECUTED_EXTERNAL_BOUNDARY` labels)
are the load-bearing ones and all three are sound — D-0002 in particular is why
PC-01..PC-10 are credible rather than synthetic. D-0020 ("sources de vérité")
is ironically the decision that findings F-1/F-3 violate; it should be enforced,
not reversed. My one note is that the packet cites the decision count
inconsistently within a single document — "20+ … (D-0001..D-0020)" in one table
and "30+ entries D-0001 .. D-0030+" a few lines later. **VERIFIED: there are
exactly 20** (`grep -c '^## D-'`).

**F-6 — The test pyramid is well-shaped but has an inverted risk profile.** The
distribution (79 contract + 522 unit/integration + 34 Rust, plus a 6-scenario
crash drill, fuzz targets, and an SBOM check) is a genuinely good shape for a
subsystem of this size, and the hardening tier is more mature than most V1 work I
see. The problem is *where* the tests are concentrated relative to risk: 60+
tests on hardening and 22 on the parser, but 3 on egress — the single most
security-relevant decision function — with the highest-risk input (`unverified`)
untested. Depth should follow blast radius.

**F-7 — Offline-first is credibly enforced, and by the right mechanism.** Stated
plainly because it deserves to be: the sovereignty claim does not rest on policy
or discipline, it rests on the subsystem having no network code and no network
dependencies. That is verifiable in seconds and cannot silently regress without
a dependency change showing up in review. This is the single best architectural
decision in the submission.

**F-8 — Minor, verified.** `classify` reports `notes failed: N` without naming the
files. `verify` returns green with `missingSidecars=12` and `failed=1`, so the
top-line verdict is weakly discriminating on this fixture set. CHANGELOG v0.2.0
is ~19 commits stale. PRODUCT-CASES.md:97 has mojibake. The four
vitest-incompatible files in `packages/contracts/test/` (inherited from
`origin/dev`) make `vitest run` a false red.

---

## 3. Top 3 priority changes

**P1 — Reconcile ADR-KNOW-0006 and PERMISSIONS.md with the implemented reality.
(2–4 h, documentation only.)**
Do this before writing any code. Mark ADR-0006 `PARTIALLY IMPLEMENTED`, listing
which of its six rules V1 delivers (none of 1–4 and 6; rule 5's scope is limited
to `context/dataflow.ts`'s shell-output scanner). Correct the two dead
implementation paths (`policy/dataflow-guard.ts` → `context/dataflow.ts`;
delete the `port/transport.rs` claim). Fix the five verified misstatements in
PERMISSIONS.md §4/§5/§8 in the table above, and soften §7's sovereignty-probe
sentence to say the probes record operator assertions. Add R-0012 for the
unimplemented restriction mechanism. Fix the packet's inverted Class B/D
definitions. **This is first because it is cheap, needs no design decisions, and
removes an active source of misinformation — and because the alternative
(implementing the mechanism now) is a V1.1-sized project that should not be
rushed into a feature-complete branch.**

**P2 — Fix the wikilink code-fence leak. (2–3 h, code + tests, API-preserving.)**
Compute fence ranges in `extractWikilinks` (or filter in `parseDocument`) and drop
links whose `start` falls inside a fence. The `Wikilink` interface already carries
`start`/`end`, so this is a filter, not a signature change — public API and all
existing tests are preserved. Add the probe from Q3 as a regression test, plus
cases for inline code spans and tilde fences. Then re-run `backlinks`,
`broken-links`, and `edge-density` on the dev fixtures and record the deltas.
While in the file, add the one-line WHY comment for `[^\S\n]*`.

**P3 — Make the DoD reflect reality, and fix U-07's oracle. (3–5 h, documentation
+ 4 tests.)** Replace the all-PENDING status table with per-item PASS/PARTIAL/FAIL
backed by the replayable command and the evidence path the DoD's own pass
condition requires. Correct U-07's command (`test/knowledge/policy/`, not
`src/`). Add the four `decideEgress` tests enumerated in Q7 above — including the
two that **should fail today** (`trust: "unverified"` → currently `allow`;
frontmatter restrictions round-trip → currently `unrecognized_keys`), marked as
known-failing against R-0012 rather than deleted. A DoD that says PENDING for
everything is indistinguishable from a DoD nobody maintained, and it is the
artifact a future reviewer will reach for first.

*Total: roughly 1.5 engineer-days, overwhelmingly documentation.* Notably, **none
of the three requires new features, framework changes, or public API breaks**, per
the review constraints.

---

## 4. Overall verdict — **NEEDS_REVISION**

The engineering substrate is strong and I do not want the FAILs above to obscure
that. 635 tests are real and green and reproduce exactly. The Rust core is clean,
minimally-dependent, and correctly scoped. The CLI is deterministic across seven
separate admin tools. The crash drill, fuzz targets, SBOM check, and disaster-
recovery procedure are more operational maturity than most V1 subsystems carry.
The external-boundary labeling (Q10) is genuinely exemplary — the discipline to
write `PASS_WITH_SAFE_FALLBACK` and then volunteer the reason is rare. And the
offline-first posture is enforced the right way: by having no network code at all.

The verdict is NEEDS_REVISION for one reason, and it is not "the egress mechanism
is missing" — deferring a mechanism is a legitimate V1 choice. It is that
**three documents state the missing mechanism is present**, in a project whose
core promise is that its owner can audit it. ADR-KNOW-0006 is `ACCEPTED` with no
deferral marker; PERMISSIONS.md describes enforcement in the present tense;
the DoD's U-07 names a proof file that does not exist. A user reading these would
believe their notes carry enforceable egress restrictions. They do not — the
frontmatter schema rejects the field outright. Nothing leaks today, because
nothing *can* egress today; but the guarantee is documentary rather than
mechanical, and the gap is invisible from the docs.

That is a fixable problem, and mostly fixable with a text editor. P1–P3 are
~1.5 days and require no new features. I would re-review after those and expect
APPROVED — the architecture underneath is sound, the taxonomy is coherent, the
decisions are well-grounded, and no ADR needs reversing.

**Merge-ready? — After fixes.**

Specifically: **P1 is a merge blocker** (shipping documentation that overstates a
security guarantee is the one finding here with real user-facing consequence).
**P2 is a merge blocker** if `backlinks` / `broken-links` / `edge-density` are
part of the V1 surface, since they are currently wrong on any note that documents
link syntax — which includes this repository's own vault. **P3 should land before
merge** but is defensible as a same-week follow-up if tracked. Everything in F-8
is a nit and can follow at leisure.

---

## 5. Reviewer confidence

```
Confidence: 8/10  (bounded by the weakest load-bearing claim, below)

Verified by execution or exact-line reading:
  - 635/635 tests green across three suites (commands run, exit codes checked)
  - all 7 CLI captures reproduce byte-for-byte at c3e7374798
  - frontmatter rejects unifia_restrictions (probe executed, output reproduced)
  - wikilink fence leak (probe executed, output reproduced)
  - router.ts:96-104 hardcodes trust/restriction (lines read)
  - readPolicy consumed only by CLI + admin/summary.ts (grep, all sites listed)
  - port/transport.rs and policy/dataflow-guard.ts absent (ls + find)
  - egress-default-deny.test.ts absent; U-07 oracle command exits 1 (run)
  - DoD status table all-PENDING (lines read)
  - zero network code in TS knowledge/ and in crate deps (grep + Cargo.toml)
  - exactly 20 decisions; exactly 6 MCP methods (grep -c)
  - ADR-0003 states "la DB est Class D, pas Class B" (line read)

Inferred (not directly executed):
  - that the fence leak materially degrades backlinks/edge-density output.
    Mechanism is verified; I did not measure the delta on the dev fixtures.
  - that no caller emits egress.decision. Verified by absence across grep;
    an emission through an indirection I did not trace would falsify it.

Not inspected — flagged rather than assumed safe:
  - the 38 admin tools individually (I read doctor, gc, summary, classify and
    ran 7 via CLI; the remaining ~31 are unread)
  - most of the 522 TS tests individually; I sampled the policy, context, and
    parser suites
  - STATE.md (~74k chars) read only in structure, not line by line
  - crates: I ran the suite and read module names + Cargo.toml, but read only
    path.rs/wal.rs test names rather than their bodies
  - P10.2 device artefacts (.artifacts/) — not opened; Q10 verdict rests on
    the packet's self-description, which is internally consistent and
    self-limiting, not on independent confirmation of the capture

Open P0/P1 uncertainties:
  - P1: whether the missing restriction mechanism was a *conscious* V1 deferral
    that simply never reached the documents, or an oversight. This changes the
    framing of P1 (relabel vs. reassess scope) but not the required action.
    I did not find a decision record either way in DECISIONS.md D-0001..D-0020.

Irreversible actions taken: none beyond writing and committing this file.
No code, test, doc, or configuration was modified. No push, PR, or merge.
```

---

*Review performed against `feat/sovereign-knowledge-core` @ `c3e7374798`.
All probe commands are reproduced inline and re-runnable from the worktree root.*
