import { test, expect, describe } from "bun:test";
import { matchPattern, verifyScope, manifestHash, fileHasCrlf } from "../../src/team/scope-monitor";
import { writeFileSync, mkdtempSync, symlinkSync, rmSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

describe("scope-monitor.matchPattern", () => {
  test("exact match", () => {
    expect(matchPattern("src/a.ts", "src/a.ts")).toBe(true);
  });

  test("directory prefix (trailing /)", () => {
    expect(matchPattern("src/a/b.ts", "src/")).toBe(true);
  });

  test("recursive **", () => {
    expect(matchPattern("src/a/b/c.ts", "src/**/c.ts")).toBe(true);
  });

  test("extension match", () => {
    expect(matchPattern("a/b.ts", "*.ts")).toBe(true);
  });

  test("non-match", () => {
    expect(matchPattern("src/a.ts", "src/b.ts")).toBe(false);
  });
});

describe("scope-monitor.verifyScope", () => {
  const m = {
    schema_version: "1.0.0" as const,
    card_id: "TEAM-T",
    lease_id: "LEASE-T",
    base_sha: "0".repeat(40),
    scope_mode: "OPEN" as const,
    allowed_files: ["src/team/**/*.ts", "test/team/**/*.test.ts"],
    protected_files: ["src/forbidden.ts"],
    reserved_paths: ["Execution/NightShift"],
    symlink_policy: "REJECT" as const,
    case_policy: "REJECT_DUPLICATE_CASE" as const,
    long_path_policy: "FAIL_OVER_260" as const,
    eol_policy: "LF_NORMALIZED" as const,
    exclusions: [],
  };

  test("verdict OK for files in allowed_files", () => {
    const v = verifyScope(m, [{ path: "src/team/lock.ts", change_type: "added" }], "/");
    expect(v.ok).toBe(true);
    expect(v.violations).toHaveLength(0);
  });

  test("verdict KO for OUT_OF_SCOPE", () => {
    const v = verifyScope(m, [{ path: "src/other.ts", change_type: "added" }], "/");
    expect(v.ok).toBe(false);
    expect(v.violations[0].code).toBe("OUT_OF_SCOPE");
  });

  test("verdict KO for PROTECTED_FILE_MODIFIED", () => {
    const v = verifyScope(m, [{ path: "src/forbidden.ts", change_type: "modified" }], "/");
    expect(v.ok).toBe(false);
    expect(v.violations[0].code).toBe("PROTECTED_FILE_MODIFIED");
  });

  test("verdict KO for RESERVED_PATH_MODIFIED", () => {
    const v = verifyScope(m, [
      { path: "Execution/NightShift/2026-07-21/RUN-IMPLEMENTATION/secret", change_type: "added" },
    ], "/");
    expect(v.ok).toBe(false);
    expect(v.violations[0].code).toBe("RESERVED_PATH_MODIFIED");
  });

  test("verdict KO for SYMLINK_FORBIDDEN", () => {
    const v = verifyScope(m, [{ path: "src/team/link.ts", change_type: "modified", symlink: true }], "/");
    expect(v.ok).toBe(false);
    expect(v.violations[0].code).toBe("SYMLINK_FORBIDDEN");
  });
});

describe("scope-monitor.manifestHash", () => {
  test("hash is deterministic given sorted keys", async () => {
    const m = {
      schema_version: "1.0.0" as const,
      card_id: "TEAM-T",
      lease_id: "LEASE-T",
      base_sha: "0".repeat(40),
      scope_mode: "OPEN" as const,
      allowed_files: ["a.ts"],
      protected_files: [],
      reserved_paths: [],
      symlink_policy: "REJECT" as const,
      case_policy: "LENIENT" as const,
      long_path_policy: "ALLOW" as const,
      eol_policy: "LF_NORMALIZED" as const,
    };
    const h1 = await manifestHash(m);
    const h2 = await manifestHash(m);
    expect(h1).toBe(h2);
    expect(h1).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("scope-monitor.fileHasCrlf", () => {
  test("detect CRLF", () => {
    const dir = mkdtempSync(join(tmpdir(), "team-scope-"));
    const p = join(dir, "f.txt");
    writeFileSync(p, "line1\r\nline2\r\n");
    expect(fileHasCrlf(p)).toBe(true);
  });
  test("LF-only is false", () => {
    const dir = mkdtempSync(join(tmpdir(), "team-scope-"));
    const p = join(dir, "f.txt");
    writeFileSync(p, "line1\nline2\n");
    expect(fileHasCrlf(p)).toBe(false);
  });
});


const securityManifest = {
  schema_version: "1.0.0" as const, card_id: "TEAM-T", lease_id: "LEASE-T", base_sha: "0".repeat(40),
  scope_mode: "OPEN" as const, allowed_files: ["src/team/**/*.ts"], protected_files: [], reserved_paths: [],
  symlink_policy: "REJECT" as const, case_policy: "REJECT_DUPLICATE_CASE" as const,
  long_path_policy: "FAIL_OVER_260" as const, eol_policy: "LF_NORMALIZED" as const,
};
describe("scope-monitor.security", () => {
  test("verdict KO for repository escape path", () => {
    const v = verifyScope(securityManifest, [{ path: "../outside.ts", change_type: "added" }], "/");
    expect(v.ok).toBe(false);
    expect(v.violations[0].code).toBe("OUT_OF_SCOPE");
  });

  test("detects a real symlink when diff metadata omits the flag", () => {
    const manifest = {
      schema_version: "1.0.0" as const,
      card_id: "TEAM-T", lease_id: "LEASE-T", base_sha: "0".repeat(40),
      scope_mode: "OPEN" as const, allowed_files: ["src/team/**/*.ts"],
      protected_files: [], reserved_paths: [], symlink_policy: "REJECT" as const,
      case_policy: "REJECT_DUPLICATE_CASE" as const, long_path_policy: "FAIL_OVER_260" as const,
      eol_policy: "LF_NORMALIZED" as const,
    };
    const tempRoot = mkdtempSync(join(tmpdir(), "scope-monitor-symlink-"));
    const target = join(tempRoot, "target.ts");
    const linkDirectory = join(tempRoot, "src", "team");
    const link = join(linkDirectory, "link.ts");
    mkdirSync(linkDirectory, { recursive: true });
    writeFileSync(target, "export {}\n");
    symlinkSync(target, link);
    try {
      const v = verifyScope(manifest, [{ path: "src/team/link.ts", change_type: "added" }], tempRoot);
      expect(v.ok).toBe(false);
      expect(v.violations[0].code).toBe("SYMLINK_FORBIDDEN");
    } finally {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });
});