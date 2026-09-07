<!-- SPDX-License-Identifier: MIT -->
# FRONTIER-QUESTIONS — Sovereign Knowledge Core V1

> Self-contained list of the 10 specific questions for the
> frontier reviewer. Companion to `FRONTIER-REVIEW-PACKET.md`
> (which holds the full context, code references, and live
> verification outputs).
>
> Designed for easy annotation: copy the file, fill in the
> `[ ]` boxes and `[answer]` slots under each question, and
> return it to the operator.

**Reviewer** : _________________________
**Model** : _________________________
**Date** : _________________________

---

## Q1 — Lifecycle coverage

Does the 4×9 matrix in
`packages/contracts/src/knowledge/lifecycle.ts` cover the
real promotion paths from PC-01..PC-10?

References :
- `packages/contracts/src/knowledge/lifecycle.ts`
- `packages/unifia/src/knowledge/memory/lifecycle.ts`
- `packages/unifia/src/knowledge/admin/lifecycle-transitions.ts`
- `docs/knowledge/PRODUCT-CASES.md` (PC-01..PC-10)

[ ] PASS  [ ] PASS_WITH_CONCERNS  [ ] FAIL  [ ] N/A

Notes / suggested changes :

```
[answer]
```

---

## Q2 — Egress default-deny

Does `decideEgress` in
`packages/unifia/src/knowledge/policy/` honour
ADR-KNOW-0006 for every Class D call site?

References :
- `docs/knowledge/adr/0006-knowledge-egress.md`
- `docs/knowledge/PERMISSIONS.md`
- `packages/unifia/src/knowledge/policy/decide.ts`
- `packages/unifia/src/knowledge/policy/store.ts`

[ ] PASS  [ ] PASS_WITH_CONCERNS  [ ] FAIL  [ ] N/A

Notes / suggested changes :

```
[answer]
```

---

## Q3 — Parser correctness

Does the wikilink parser in
`packages/unifia/src/knowledge/parser/wikilinks.ts`
handle `[[X]]`, `[[X|Y]]`, `[[X#H]]`, and code-fence
escapes correctly? The fenced-code regex uses
`[^\S\n]*` instead of `\s*` — is the rationale
documented?

References :
- `packages/unifia/src/knowledge/parser/wikilinks.ts`
- `packages/unifia/src/knowledge/parser/parser.ts`
- `tests/knowledge/parser/` (existing test suite)

[ ] PASS  [ ] PASS_WITH_CONCERNS  [ ] FAIL  [ ] N/A

Notes / suggested changes :

```
[answer]
```

---

## Q4 — BruteForceIndex scaling

ADR-KNOW-0008 defers ANN until >50k notes. Is the
threshold reasonable? Are tests at the boundary credible
(`bench-large 100 256`)?

References :
- `docs/knowledge/adr/0008-knowledge-search.md`
- `packages/unifia/src/knowledge/semantic/brute-force.ts`
- `packages/unifia/bin/unifia-knowledge.ts bench-large`

[ ] PASS  [ ] PASS_WITH_CONCERNS  [ ] FAIL  [ ] N/A

Notes / suggested changes :

```
[answer]
```

---

## Q5 — Default retrieval bounds

ADR-KNOW-0007 sets `maxCandidates=50`,
`maxPayloadBytes=1 MiB`, `maxSnippetBytes=64 KiB`,
`deadlineMs=2_000` desktop / `4_000` Android. Are these
appropriate?

References :
- `docs/knowledge/adr/0007-knowledge-native-port.md`
- `packages/contracts/src/knowledge/retrieval.ts`

[ ] PASS  [ ] PASS_WITH_CONCERNS  [ ] FAIL  [ ] N/A

Notes / suggested changes :

```
[answer]
```

---

## Q6 — Disaster recovery

Does the 5-step procedure in `DISASTER-RECOVERY.md` cover
the 6 crash scenarios in `hardening/crash-matrix.ts`?
(drill currently reports 6/6)

References :
- `docs/knowledge/DISASTER-RECOVERY.md`
- `packages/unifia/src/knowledge/hardening/crash-matrix.ts`
- `packages/unifia/bin/unifia-knowledge.ts drill`
- `packages/unifia/bin/unifia-knowledge.ts verify`

[ ] PASS  [ ] PASS_WITH_CONCERNS  [ ] FAIL  [ ] N/A

Notes / suggested changes :

```
[answer]
```

---

## Q7 — V1 test count

635 green tests (522 TS knowledge + 79 contracts + 34 Rust).
Is this adequate for the V1 DoD (12U + 10E requirements in
`SOVEREIGN-CORE-V1-DOD.md`)?

References :
- `docs/knowledge/SOVEREIGN-CORE-V1-DOD.md`
- `docs/knowledge/execution/TEST-MATRIX.md`
- `docs/knowledge/execution/COVERAGE.md`

[ ] PASS  [ ] PASS_WITH_CONCERNS  [ ] FAIL  [ ] N/A

Notes / suggested changes :

```
[answer]
```

---

## Q8 — Reversibility

Can a user uninstall V1 cleanly? (The `gc apply` command
should remove all derived state, leaving only Class A.)

References :
- `packages/unifia/src/knowledge/classb/gc.ts`
- `packages/unifia/bin/unifia-knowledge.ts gc`
- `docs/knowledge/execution/DISASTER-RECOVERY.md`

[ ] PASS  [ ] PASS_WITH_CONCERNS  [ ] FAIL  [ ] N/A

Notes / suggested changes :

```
[answer]
```

---

## Q9 — Documentation completeness

Is `PERMISSIONS.md` (5 KB, default-deny, 6 capabilities,
8 destinations, 7 what-V1-does-not-do) sufficient for an
operator to understand and modify V1?

References :
- `docs/knowledge/PERMISSIONS.md`
- `docs/knowledge/README.md`
- `docs/knowledge/CHANGELOG.md`

[ ] PASS  [ ] PASS_WITH_CONCERNS  [ ] FAIL  [ ] N/A

Notes / suggested changes :

```
[answer]
```

---

## Q10 — External boundaries

Are P10.2 / P10.3 / ONNX / this frontier review honestly
labeled, with clear reproduction steps for unblocking?

References :
- `docs/knowledge/execution/FRONTIER-REVIEW-PACKET.md`
  (External boundaries section)
- `docs/knowledge/execution/RISKS.md` (R-0003, R-0004, R-0011)
- `.artifacts/p10-device-{screen.png, report.json, run.md}`

[ ] PASS  [ ] PASS_WITH_CONCERNS  [ ] FAIL  [ ] N/A

Notes / suggested changes :

```
[answer]
```

---

## Summary (reviewer to fill in)

Overall verdict :
[ ] APPROVED  [ ] APPROVED_WITH_NITS  [ ] NEEDS_REVISION  [ ] REJECTED

Top 3 priority changes (if any) :

1. _________________________________________________
2. _________________________________________________
3. _________________________________________________

Estimated effort to address : _________________________

Ready to merge to `main` ?  [ ] Yes  [ ] No  [ ] After fixes

Reviewer signature : _________________________

---

*Generated 2026-08-29 alongside `FRONTIER-REVIEW-PACKET.md`
(HEAD `77fac901e6`, 113 commits, 635 verts, 55 subcommands,
38 admin tools). The packet itself is the source of truth
for all referenced paths and test counts.*
