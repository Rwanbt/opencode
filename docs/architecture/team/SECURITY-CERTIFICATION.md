# Team V3 Security Validation — 2026-07-29

Status: **LOCAL VALIDATION PASSED — NOT A PRODUCTION SECURITY CERTIFICATION**

## Evidence

- Worker write execution is isolated in a generated worktree and fails closed if the worktree is missing or equals the primary checkout.
- Read tasks fail if they create a commit.
- Write tasks fail if any changed path is outside the declared `write_set`; an empty `write_set` authorizes no file.
- Worker sessions deny nested `task` and `team` dispatch. Reviewer sessions deny every tool and must use a model distinct from the implementer.
- Worker and reviewer sessions receive parent cancellation and persist terminal failure/completion status.
- HTTP task/event/gate payloads pass through DLP redaction before leaving the server.
- Only reviewed commits with a matching SHA can enter the generated integration branch. Protected branches are rejected.
- Integration failure resets the generated worktree to the exact base SHA, removes untracked files, verifies a clean status, and reports rollback failure rather than laundering it.

## Local verification

- `bun test test/team --timeout 30000`: 814 passed, 0 failed.
- `bun test test/server/team-routes.test.ts --timeout 30000`: lifecycle and redaction route coverage.
- `bun run typecheck` in `packages/unifia` and `packages/app`: passed.

## Boundaries not certified

- No external penetration test or malicious-provider red-team was run.
- No real provider credential was used in this local validation.
- The in-process route harness does not prove the application-wide Basic/JWT middleware; that middleware is owned and tested outside the Team route module.

Verdict: suitable for controlled local validation. Production security sign-off remains an explicit release gate.
