/* SPDX-License-Identifier: MIT */
/* Copyright (c) 2026 Unifia contributors */

/**
 * Typed qualification exception classes (mandate §19-§20).
 *
 * The runner previously classified every uncaught exception
 * as `FAIL_CORRECTABLE`. That hid genuine architecture-level
 * state from the canonical M0 results. The frozen rubric
 * requires a precise classification:
 *
 *   QualificationNotImplemented
 *     → NOT_IMPLEMENTED
 *     (the candidate does not yet implement the required
 *     capability, e.g. DBOS FC-14 raceAuthorities)
 *
 *   QualificationBlocked
 *     → BLOCKED
 *     (the methodology is unavailable in this environment,
 *     e.g. no VM / fault-injection layer for FC-13)
 *
 *   QualificationMethodologyInvalid
 *     → NOT_VALID
 *     (the methodology ran but failed to measure the
 *     property, e.g. FC-04 `ackLost: true` is a magic flag,
 *     not a real transport-level ACK loss)
 *
 *   QualificationCorrectableFailure
 *     → FAIL_CORRECTABLE
 *     (a real measurement found a defect that can be fixed
 *     inside the existing architecture)
 *
 *   QualificationArchitecturalFailure
 *     → FAIL_ARCHITECTURAL
 *     (a real measurement found a defect that contradicts a
 *     frozen architectural invariant)
 *
 *   QualificationHarnessError
 *     → HARNESS_ERROR
 *     (an unclassified exception — the qualification run
 *     itself is broken, not the candidate)
 *
 * The harness MUST classify every exception explicitly.
 * A run that surfaces an unclassified exception is a
 * harness bug, not candidate evidence.
 */

import type { QualificationStatus } from "./contract.ts"

export abstract class QualificationError extends Error {
  abstract readonly status: QualificationStatus
}

export class QualificationNotImplemented extends QualificationError {
  readonly status: QualificationStatus = "NOT_IMPLEMENTED"
  constructor(criterion: string, detail: string) {
    super(`NOT_IMPLEMENTED (${criterion}): ${detail}`)
    this.name = "QualificationNotImplemented"
  }
}

export class QualificationBlocked extends QualificationError {
  readonly status: QualificationStatus = "BLOCKED"
  constructor(criterion: string, detail: string) {
    super(`BLOCKED (${criterion}): ${detail}`)
    this.name = "QualificationBlocked"
  }
}

export class QualificationMethodologyInvalid extends QualificationError {
  readonly status: QualificationStatus = "NOT_VALID"
  constructor(criterion: string, detail: string) {
    super(`NOT_VALID (${criterion}): ${detail}`)
    this.name = "QualificationMethodologyInvalid"
  }
}

export class QualificationCorrectableFailure extends QualificationError {
  readonly status: QualificationStatus = "FAIL_CORRECTABLE"
  constructor(criterion: string, detail: string) {
    super(`FAIL_CORRECTABLE (${criterion}): ${detail}`)
    this.name = "QualificationCorrectableFailure"
  }
}

export class QualificationArchitecturalFailure extends QualificationError {
  readonly status: QualificationStatus = "FAIL_ARCHITECTURAL"
  constructor(criterion: string, detail: string) {
    super(`FAIL_ARCHITECTURAL (${criterion}): ${detail}`)
    this.name = "QualificationArchitecturalFailure"
  }
}

export class QualificationHarnessError extends QualificationError {
  readonly status: QualificationStatus = "HARNESS_ERROR"
  constructor(detail: string) {
    super(`HARNESS_ERROR: ${detail}`)
    this.name = "QualificationHarnessError"
  }
}

/**
 * Map any thrown value to a typed qualification error.
 * The status returned is the canonical mapping. If the
 * thrown value is already a QualificationError, the
 * original is preserved (idempotent).
 */
export function classifyQualificationError(
  criterion: string,
  thrown: unknown,
): QualificationError {
  if (thrown instanceof QualificationError) return thrown
  if (thrown instanceof Error) {
    return new QualificationHarnessError(`${criterion}: ${thrown.name}: ${thrown.message}`)
  }
  return new QualificationHarnessError(`${criterion}: ${String(thrown)}`)
}
