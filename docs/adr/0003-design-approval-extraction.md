<!-- SPDX-License-Identifier: MIT -->

# ADR-0003 — Extract the Design approval machine from the surface

- Status: accepted
- Date: 2026-09-01
- Series: app quality (follows ADR-0001 factory-with-deps, ADR-0002 coordinator LOC floor)

## Context

`design-surface.tsx` owned the create/export approval state machine and the
four operations that talk to the approval broker. The module imports Solid's
client-only runtime, so `bun:test` cannot evaluate it: the only coverage
available was `design-surface.test.ts` reading the file as text and matching
regexes against it.

A regex confirms a string is present. It cannot tell you that the expired
branch of the modal rendered no reachable control, that `cancel` refused the
one state where cancelling mattered, or that unmounting left a request
pending on the broker. All three shipped. The file had also reached 1152
LOC, past the 800-LOC alert in CLAUDE.md.

## Decision

Move the state type, the reducer, the two predicates and the four broker
operations into `design-approval.ts`, with the client injected (factory with
deps, ADR-0001). `design-surface.tsx` keeps the signal, the expiry timer and
the markup, and wires them to `createApprovalOperations`.

`design-approval.test.ts` drives the operations against a fake broker that
records every call. `design-surface.test.ts` keeps only what is genuinely a
property of the markup.

## Rejected alternatives

- **Leave the machine in place and widen the regexes.** Adds assertions
  about the shape of the source, not the behaviour of the code; the defects
  above would all still pass.
- **Cover it through the Playwright e2e suite alone.** The expiry path needs
  a five-minute TTL or a clock fake, and a broker refusing to cancel an
  already-expired approval is awkward to stage end to end. Worth having as
  well, not instead.

## Consequences

- One reducer, exercised for real; the surface can no longer drift from it.
- Single responsibility holds: the machine knows nothing about Solid, the
  surface knows nothing about the broker's error shapes.
- No circular dependency: `design-surface.tsx` → `design-approval.ts` →
  nothing in `pages/`.
- `design-surface.tsx` drops below 1000 LOC. Still above the 500-LOC target;
  it remains a coordinator in the sense of ADR-0002.
