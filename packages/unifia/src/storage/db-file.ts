// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Unifia contributors
//
// Original work. No upstream derivation.

// Brand-aligned database file name. The legacy "opencode.db" stays as the
// source of a one-shot copy so existing installs (and any concurrent upstream
// install) keep working. See Runbook-Autonome-Independance-Unifia-2026-08-10
// §3 (carte C8-A) for the migration design.
//
// These live apart from storage/db.ts so tooling that only needs the file name
// — drizzle.config.ts — can import it without pulling in the database runtime.
// db.ts re-exports both names; importers keep using it.
export const DATABASE_FILE = "unifia.db"
export const LEGACY_DATABASE_FILE = "opencode.db"
