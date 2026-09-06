# Archive — pre-CP6.3 attribution repair

**Date**: 2026-09-04
**Reason**: Per Erwan review of HEAD `beb2dd33ea` (CP6.3 M0 closure), the previous canonical
result file `M0_RESULTS_DBOS_GO_SQLITE.json` and `evidence/dbos-go-sqlite/` folder declared
`candidate: "DBOS_GO_SQLITE"` while the actual measured execution substrate was the
**custom Go + custom SQLite** control (blank DBOS import only).

This is unacceptable: a reviewer or downstream script could attribute the PASS evidence to a
real DBOS candidate that does not yet exist.

## Migration

| Archived                                  | New canonical                                                                                |
| ----------------------------------------- | -------------------------------------------------------------------------------------------- |
| `M0_RESULTS_DBOS_GO_SQLITE.json`          | `M0_RESULTS_CUSTOM_GO_SQLITE_CONTROL.json` (re-published with full provenance metadata)     |
| `evidence/dbos-go-sqlite/`                | `evidence/custom-go-sqlite-control/` (re-published atomically, repo-relative stable paths)   |

The archived files retain their original `candidate: "DBOS_GO_SQLITE"` value
**intentionally** so future readers can compare before/after and so the migration is
explicit, not silent.

## Per-file metadata

| File                                                        | `legacyCandidateLabel` | `actualMeasuredCandidate` | `superseded` |
| ----------------------------------------------------------- | ---------------------- | ------------------------- | ------------ |
| `M0_RESULTS_DBOS_GO_SQLITE.pre-cp6-3.json`                 | `DBOS_GO_SQLITE`       | `CUSTOM_GO_SQLITE_CONTROL`| `true`       |
| `evidence-dbos-go-sqlite/FC-*/result.json` (each FC)        | `DBOS_GO_SQLITE`       | `CUSTOM_GO_SQLITE_CONTROL`| `true`       |

The legacy label is preserved so that any external reference to the old file path can
be traced back to its source. The actual measured candidate is the custom Go control;
the real DBOS Go candidate is not yet built.

## Stale evidence warning

The archived result files contain `evidencePath` values that point to absolute
`C:\Users\<user>\AppData\Local\Temp\...` paths. These are NOT reproducible from a
fresh clone. They are preserved as-is for traceability only.

**Do not** cite this archived evidence as M0-canonical. Always cite the new files
in `docs/automation-v2/m0/M0_RESULTS_CUSTOM_GO_SQLITE_CONTROL.json` and
`docs/automation-v2/m0/evidence/custom-go-sqlite-control/`.

## Future real DBOS_GO_SQLITE

When the real DBOS Go v1.0.0 candidate is built (using
`github.com/dbos-inc/dbos-transact-golang` v1.0.0 APIs: `dbos.NewContext`,
`RegisterWorkflow`, `Launch`, `RunWorkflow`, `RunAsStep`, real recovery path), the
canonical `M0_RESULTS_DBOS_GO_SQLITE.json` will be re-published with full provenance
metadata:
```
{
  "candidate": "DBOS_GO_SQLITE",
  "executionSubstrate": "DBOS_GO_V1",
  "realDbosApisUsed": true,
  ...
}
```

Until that happens, `DBOS_GO_SQLITE` is a placeholder value. No M0 evidence currently
exists for it.
