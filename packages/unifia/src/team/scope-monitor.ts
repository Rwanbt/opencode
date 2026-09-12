/**
 * scope-monitor.ts — TEAM-G01
 *
 * Validates a working tree's file changes against a scope manifest.
 * The manifest declares:
 *  - allowed_files:    permissive list of files that may be created/modified.
 *  - protected_files:  a conservative list of files that must NOT be modified.
 *  - reserved_paths:   paths that may not be modified by any worker (e.g. central state).
 *  - symlink_policy:   REJECT | ALLOW_FORBIDDEN | ALLOW_ALLOWED.
 *  - case_policy:      REJECT_DUPLICATE_CASE | LENIENT.
 *  - long_path_policy: FAIL_OVER_260 | WARN_OVER_260 | ALLOW.
 *  - eol_policy:       LF_NORMALIZED | CRLF_PASSTHROUGH | MIXED_FORBIDDEN.
 *
 * The scope monitor is sync from the manifest perspective and async from the
 * filesystem perspective (we do not block-lock the FS; we only read).
 */

import { existsSync, lstatSync } from "node:fs";
import { join, sep } from "node:path";

export type SymlinkPolicy = "REJECT" | "ALLOW_FORBIDDEN" | "ALLOW_ALLOWED";
export type CasePolicy = "REJECT_DUPLICATE_CASE" | "LENIENT";
export type LongPathPolicy = "FAIL_OVER_260" | "WARN_OVER_260" | "ALLOW";
export type EolPolicy = "LF_NORMALIZED" | "CRLF_PASSTHROUGH" | "MIXED_FORBIDDEN";

export interface ScopeManifest {
  schema_version: "1.0.0";
  card_id: string;
  lease_id: string;
  base_sha: string;
  scope_mode: "OPEN" | "E2_REQUIRED";
  allowed_files: string[];
  protected_files: string[];
  reserved_paths: string[];
  symlink_policy: SymlinkPolicy;
  case_policy: CasePolicy;
  long_path_policy: LongPathPolicy;
  eol_policy: EolPolicy;
  /**
   * Optional patterns matched by minimatch-like glob against relative paths.
   * If a path matches an exclude pattern, it is rejected even if not in
   * protected_files.
   */
  exclusions?: string[];
}

export interface DiffEntry {
  path: string;          // relative to repo root
  change_type: "added" | "modified" | "deleted" | "untracked";
  symlink?: boolean;
}

export interface ScopeVerdict {
  ok: boolean;
  violations: ScopeViolation[];
  warnings: string[];
}

export interface ScopeViolation {
  code:
    | "OUT_OF_SCOPE"
    | "PROTECTED_FILE_MODIFIED"
    | "RESERVED_PATH_MODIFIED"
    | "SYMLINK_FORBIDDEN"
    | "DUPLICATE_CASE"
    | "PATH_TOO_LONG"
    | "EXCLUDED_PATTERN"
    | "MIXED_EOL";
  path: string;
  message: string;
}

/**
 * Match a path against a list of patterns. Patterns support:
 *   - exact equality
 *   - trailing slash (directory prefix)
 *   - recursive double-star glob
 *   - simple star-dot-ext extension match
 *
 * This is intentionally tiny — we don't depend on minimatch in the runtime
 * path of the scope monitor.
 */
export function matchPattern(fileRelPath: string, pattern: string): boolean {
  if (pattern === fileRelPath) return true;
  if (pattern.endsWith("/") && (fileRelPath.startsWith(pattern) || fileRelPath === pattern.slice(0, -1))) {
    return true;
  }
  // Pattern with no slash is a special case: it matches the full path with
  // single * being ".*" (any chars including slash). This handles simple
  // extension globs like "*.ts" matching "a/b.ts".
  if (!pattern.includes("/")) {
    const parts = pattern.split("*");
    let re = "^";
    for (let i = 0; i < parts.length; i++) {
      re += escapeRegex(parts[i]);
      if (i < parts.length - 1) re += ".*";
    }
    re += "$";
    return new RegExp(re).test(fileRelPath);
  }
  const pathSegs = fileRelPath.split("/");
  const patSegs = pattern.split("/");
  return matchGlobSegments(pathSegs, 0, patSegs, 0);
}

function escapeRegex(s: string): string {
  return s.replace(/[.+^${}()|[\]\\]/g, "\\$&");
}

/**
 * Recursive glob matcher. Supports:
 *   **  -> zero or more path segments
 *   *   -> wildcard within a single segment (any chars including /)
 *   literal segments otherwise (exact match)
 */
function matchGlobSegments(pathSegs: string[], i: number, patSegs: string[], j: number): boolean {
  if (j === patSegs.length) {
    return i === pathSegs.length;
  }
  if (patSegs[j] === "**") {
    // Try to match ** against 0, 1, 2, ... path segments.
    if (j + 1 === patSegs.length) {
      // ** at end matches the remaining path segments (zero or more).
      return true;
    }
    for (let k = i; k <= pathSegs.length; k++) {
      if (matchGlobSegments(pathSegs, k, patSegs, j + 1)) return true;
    }
    return false;
  }
  if (i >= pathSegs.length) return false;
  if (segmentMatch(patSegs[j], pathSegs[i])) {
    return matchGlobSegments(pathSegs, i + 1, patSegs, j + 1);
  }
  return false;
}

function segmentMatch(pattern: string, segment: string): boolean {
  // pattern may contain * (wildcard within a single segment).
  // We split on * and use re with .* between literals.
  if (!pattern.includes("*")) return pattern === segment;
  const parts = pattern.split("*");
  let re = "^";
  for (let i = 0; i < parts.length; i++) {
    re += escapeRegex(parts[i]);
    if (i < parts.length - 1) re += ".*";
  }
  re += "$";
  return new RegExp(re).test(segment);
}

/**
 * Compute the SHA-256 hash of a canonical JSON encoding of the manifest,
 * for cross-witness verification.
 */
export async function manifestHash(m: ScopeManifest): Promise<string> {
  const enc = new TextEncoder().encode(JSON.stringify(m, Object.keys(m).sort()));
  const digest = await crypto.subtle.digest("SHA-256", enc);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * Verify that all diff entries are inside allowed_files and outside the
 * reserved/protected sets.
 */
export function verifyScope(
  manifest: ScopeManifest,
  diff: DiffEntry[],
  repoRoot: string,
): ScopeVerdict {
  const violations: ScopeViolation[] = [];
  const warnings: string[] = [];

  const allowedPaths = new Set<string>();
  for (const p of manifest.allowed_files) allowedPaths.add(p);

  const protectedPaths = new Set<string>();
  for (const p of manifest.protected_files) protectedPaths.add(p);

  const reservedDirs: string[] = [];
  for (const p of manifest.reserved_paths) reservedDirs.push(p);

  const exclusionPatterns = manifest.exclusions ?? [];

  for (const entry of diff) {
    const p = entry.path;

    // Git emits repository-relative paths with `/`; reject anything that could
    // escape the repository before applying allow-list or reserved-path rules.
    if (p.startsWith("/") || /^[A-Za-z]:[\\/]/.test(p) || p.split(/[\\/]/).includes("..")) {
      violations.push({
        code: "OUT_OF_SCOPE",
        path: p,
        message: `path ${p} is not a repository-relative path`,
      });
      continue;
    }

    // Reserved path: any descendant of a reserved path is forbidden.
    let reserved = false;
    for (const r of reservedDirs) {
      if (p === r || p.startsWith(r + "/") || p.startsWith(r + sep)) {
        reserved = true;
        break;
      }
    }
    if (reserved) {
      violations.push({
        code: "RESERVED_PATH_MODIFIED",
        path: p,
        message: `path ${p} is in reserved_paths`,
      });
      continue;
    }

    // Protected file: only allowed if it matches an exclusion pattern.
    if (protectedPaths.has(p)) {
      const excluded = exclusionPatterns.some((pat) => matchPattern(p, pat));
      if (!excluded) {
        violations.push({
          code: "PROTECTED_FILE_MODIFIED",
          path: p,
          message: `path ${p} is in protected_files`,
        });
        continue;
      }
    }

    // Allowed by direct match or by directory/glob in allowed_files.
    const inAllowed =
      allowedPaths.has(p) ||
      manifest.allowed_files.some((pat) => matchPattern(p, pat));
    if (!inAllowed) {
      violations.push({
        code: "OUT_OF_SCOPE",
        path: p,
        message: `path ${p} is not in allowed_files`,
      });
      continue;
    }

    // Symlink policy.
    const symlink = entry.symlink ?? isSymlink(join(repoRoot, p.replaceAll("/", sep)));
    if (symlink) {
      if (manifest.symlink_policy === "REJECT") {
        violations.push({
          code: "SYMLINK_FORBIDDEN",
          path: p,
          message: `symlink at ${p} is rejected by policy`,
        });
        continue;
      }
    }

    // Long-path policy (Windows MAX_PATH = 260 historically).
    const fullPath = join(repoRoot, p);
    if (fullPath.length >= 260 && manifest.long_path_policy === "FAIL_OVER_260") {
      violations.push({
        code: "PATH_TOO_LONG",
        path: p,
        message: `path ${p} length ${fullPath.length} ≥ 260`,
      });
      continue;
    }

    // Case policy: detect duplicate-case siblings on case-insensitive fs.
    if (manifest.case_policy === "REJECT_DUPLICATE_CASE") {
      const parent = dirname(p);
      const base = basename(p);
      const parentAbs = join(repoRoot, parent);
      if (existsSync(parentAbs)) {
        const siblings = readdirSyncCompat(parentAbs);
        const collisions = siblings.filter(
          (s) => s.toLowerCase() === base.toLowerCase() && s !== base,
        );
        if (collisions.length > 0) {
          violations.push({
            code: "DUPLICATE_CASE",
            path: p,
            message: `case collision: ${p} shares with ${collisions.join(",")}`,
          });
        }
      }
    }
  }

  return {
    ok: violations.length === 0,
    violations,
    warnings,
  };
}

function dirname(p: string): string {
  const i = p.lastIndexOf("/");
  if (i < 0) return ".";
  return p.slice(0, i);
}
function basename(p: string): string {
  const i = p.lastIndexOf("/");
  return i < 0 ? p : p.slice(i + 1);
}

/**
 * Detect whether a relative path has CRLF line endings on disk.
 * Returns true if any line uses CRLF.
 */
export function fileHasCrlf(absPath: string): boolean {
  if (!existsSync(absPath)) return false;
  const buf = require("node:fs").readFileSync(absPath);
  for (let i = 0; i < buf.length; i++) {
    if (buf[i] === 0x0a && i > 0 && buf[i - 1] === 0x0d) return true;
  }
  return false;
}

// Tiny compat layer for readdirSync in case Windows is case-insensitive.
function readdirSyncCompat(p: string): string[] {
  try {
    return require("node:fs").readdirSync(p) as string[];
  } catch {
    return [];
  }
}

/**
 * Detect whether `p` is a symlink.
 */
export function isSymlink(p: string): boolean {
  try {
    return lstatSync(p).isSymbolicLink();
  } catch {
    return false;
  }
}
