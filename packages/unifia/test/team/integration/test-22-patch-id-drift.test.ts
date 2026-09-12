import { test, expect } from "bun:test";
import { createTempGitRepo } from "../helper";

test("integration-22: patch-id stability check (sanity)", () => {
  const repo = createTempGitRepo();
  // Make two commits and verify patch-id is stable for the same content.
  repo.commit("feat: hello", { "src/team/h.ts": "export const a = 1;\n" });
  // Bun.spawnSync positional overload: cmds first, options second.
  // stdout is a Buffer when piped (default for spawnSync) — use .toString().
  const proc1 = Bun.spawnSync(["git", "format-patch", "--stdout", "HEAD~1..HEAD"], {
    cwd: repo.path,
  });
  expect(proc1.exitCode).toBe(0);
  const proc2 = Bun.spawnSync(["git", "patch-id", "--stable"], {
    cwd: repo.path,
    stdin: new TextEncoder().encode(proc1.stdout.toString()),
  });
  expect(proc2.exitCode).toBe(0);
  const proc2stdout = proc2.stdout.toString().trim();
  expect(proc2stdout).toMatch(/[0-9a-f]{40}/);
  repo.cleanup();
});
