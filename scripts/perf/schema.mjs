#!/usr/bin/env node
// SPDX-License-Identifier: MIT
// Measurement artifact JSON schema (carte A01).
// Implements the 8 mandatory fields from
// docs/perf-baselines/measurement-contract.md §3.
// Hand-rolled validator: no external deps, no global state, no I/O.
//
// Usage:
//   import { validateArtifact } from "./schema.mjs"
//   const { valid, errors } = validateArtifact(jsonObject)
//
// Returns { valid: true, errors: [] } when artifact passes all checks.
// Returns { valid: false, errors: [...] } with one entry per failed check.

const REQUIRED_STRING = ["source", "commit", "timestamp", "artifact"]
const REQUIRED_NUMBER = ["N"]
const REQUIRED_OBJECT = ["machine", "toolchain", "variance"]
const MIN_N = 5 // Plan §5 P0-A: N >= 5 cold and warm runs

const COMMIT_RE = /^[0-9a-f]{7,40}$/
const ISO_8601_UTC_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/

export function validateArtifact(obj) {
  const errors = []
  if (typeof obj !== "object" || obj === null || Array.isArray(obj)) {
    return { valid: false, errors: ["artifact must be a non-null object"] }
  }
  for (const field of REQUIRED_STRING) {
    if (typeof obj[field] !== "string" || obj[field].length === 0) {
      errors.push(`field "${field}" must be a non-empty string`)
    }
  }
  for (const field of REQUIRED_NUMBER) {
    if (typeof obj[field] !== "number" || !Number.isFinite(obj[field])) {
      errors.push(`field "${field}" must be a finite number`)
    }
  }
  for (const field of REQUIRED_OBJECT) {
    if (typeof obj[field] !== "object" || obj[field] === null || Array.isArray(obj[field])) {
      errors.push(`field "${field}" must be a non-null object`)
    }
  }
  if (typeof obj.N === "number" && obj.N < MIN_N) {
    errors.push(`field "N" must be >= ${MIN_N} (plan §5 P0-A); got ${obj.N}`)
  }
  if (typeof obj.commit === "string" && !COMMIT_RE.test(obj.commit)) {
    errors.push(`field "commit" must be a 7-40 char hex SHA; got "${obj.commit}"`)
  }
  if (typeof obj.timestamp === "string" && !ISO_8601_UTC_RE.test(obj.timestamp)) {
    errors.push(`field "timestamp" must be ISO 8601 UTC (e.g. "2026-08-24T10:30:00.000Z"); got "${obj.timestamp}"`)
  }
  return { valid: errors.length === 0, errors }
}
