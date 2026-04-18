/**
 * withInstanceForTest — Sprint 6 item 1 skeleton.
 *
 * Goal: give test authors a single entry point to run Effect-context aware
 * code (team tool, session runtime, permission checks) inside a minimal
 * InstanceContext wired to a tmpdir, without spawning a real Hono server.
 *
 * Status: SKELETON. Boots the ALS InstanceContext via `Instance.provide` on
 * a transient tmpdir project; the caller's `fn` runs with `Instance.directory`
 * et al. available. What is NOT yet wired (and prevents the `describe.skip`
 * in dag-team.test.ts from flipping):
 *
 *   [x] InstanceContext (directory, worktree, project) via Instance.provide.
 *   [ ] InstanceState backing via Layer.memoize — today each test falls back
 *       to the global default layer; for hermetic tests we want a fresh
 *       InstanceState per call (Layer.memoize on a per-test scope).
 *   [ ] Bus in-memory — the global bus is already process-scoped; tests can
 *       collect events via `Bus.subscribeAll` today, but a dedicated test
 *       bus would prevent cross-test leakage.
 *   [ ] SessionStatus / Session / Task in-memory — these services currently
 *       hit the real SQLite DB (in-memory via OPENCODE_DB=:memory: from
 *       preload.ts). That works, but a pure in-memory variant would avoid
 *       the SQL schema coupling and make call-site mocking easier.
 *   [ ] Permission in-memory — a test-time Permission.Service that auto-grants
 *       (or auto-denies) without prompting. Today the real permission service
 *       reads from config and can block on confirmations.
 *   [ ] Provider-mounted-on-mock — seed the provider registry with the
 *       `createMockProvider` harness so `session/llm.ts` resolves the mock
 *       model by default. Needs a test-only Provider.register() hook or a
 *       global override in Provider.list().
 *
 * Until those are wired, `test/e2e/dag-team.test.ts` full-e2e stays skipped.
 * The `dispatchDag` unit tests in the same file continue to guard the
 * ordering contract.
 *
 * Usage (once wired):
 *
 *   await withInstanceForTest(async () => {
 *     // team-tool dispatch goes here
 *   })
 */
import fs from "fs/promises"
import os from "os"
import path from "path"
import { Instance } from "@/project/instance"

export interface InstanceForTestOptions {
  /** Optional pre-existing directory to use as the project root. */
  directory?: string
  /**
   * Optional init hook run inside the instance ALS before `fn` — used to
   * seed Provider/Auth/Config under the Instance context. Runs once per
   * call (no caching across tests today).
   */
  init?: () => Promise<void>
}

/**
 * Boot a minimal Instance scope and run `fn` inside its ALS context.
 *
 * Caveat: `Instance.provide` caches by directory. For hermetic per-test
 * isolation we create a fresh tmpdir per call unless the caller passes a
 * `directory`. The cached entry is disposed on cleanup (best-effort).
 */
export async function withInstanceForTest<R>(
  fn: () => Promise<R>,
  opts: InstanceForTestOptions = {},
): Promise<R> {
  const directory =
    opts.directory ??
    (await fs.mkdtemp(path.join(os.tmpdir(), "opencode-test-instance-")))
  let produced = !opts.directory

  try {
    return await Instance.provide({
      directory,
      init: opts.init,
      fn,
    })
  } finally {
    // Best-effort disposal: `Instance.dispose` reads the current ALS, so we
    // re-enter the scope to trigger it. Swallow all errors — cleanup is a
    // convenience, not a correctness requirement.
    try {
      await Instance.provide({
        directory,
        fn: async () => {
          try {
            await Instance.dispose()
          } catch {
            // ignore
          }
        },
      })
    } catch {
      // ignore
    }
    if (produced) {
      try {
        await fs.rm(directory, { recursive: true, force: true })
      } catch {
        // ignore
      }
    }
  }
}
